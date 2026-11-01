// Tests for the print hosting Worker, run with:
//   node --test "worker/test/*.test.js"
// R2 and the rate limiter are small in-memory stand-ins for the parts of
// their APIs the Worker uses.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { crc32, deflateSync } from 'node:zlib';

import worker from '../src/index.js';
import { MAX_BYTES, handle, inspectPng } from '../src/prints.js';

const ORIGIN = 'https://mwarkentin.github.io';
const BASE = 'https://colourio-prints.example.workers.dev';
const FILE_URL = /^https:\/\/colourio-prints\.example\.workers\.dev\/v1\/prints\/[0-9a-f-]{36}\.png$/;

// A grey PNG whose header claims the given size. Only the first few pixels
// are stored, which is fine: the Worker reads just the header and the end.
function png(width = 4, height = 3) {
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  const rows = Math.min(height, 3); // enough pixels for a valid stream on small images
  const raw = Buffer.alloc(rows * (Math.min(width, 4) + 1), 0x80);
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function fakeR2() {
  const objects = new Map();
  const meta = (key) => {
    const { bytes, httpMetadata } = objects.get(key);
    return { key, size: bytes.length, httpEtag: `"${key}"`, httpMetadata };
  };
  return {
    objects,
    async put(key, value, options = {}) {
      objects.set(key, { bytes: new Uint8Array(value), httpMetadata: options.httpMetadata });
    },
    async get(key) {
      if (!objects.has(key)) return null;
      return { ...meta(key), body: new Blob([objects.get(key).bytes]).stream() };
    },
    async head(key) {
      return objects.has(key) ? meta(key) : null;
    },
  };
}

function fakeLimiter(allowed) {
  const keys = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      return { success: keys.length <= allowed };
    },
  };
}

let env;
beforeEach(() => {
  env = { PRINTS: fakeR2(), UPLOADS: fakeLimiter(100), ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:8000` };
  // The Worker logs each saved file; keep test output quiet.
  mock.method(console, 'log', () => {});
});
afterEach(() => mock.restoreAll());

function upload(body, { origin = ORIGIN, headers = {} } = {}) {
  const all = { 'Content-Type': 'image/png', 'CF-Connecting-IP': '203.0.113.7', ...headers };
  if (origin) all.Origin = origin;
  return handle(new Request(`${BASE}/v1/prints`, { method: 'POST', headers: all, body }), env);
}

describe('uploads', () => {
  test('answer a preflight from colourio', async () => {
    const res = await handle(new Request(`${BASE}/v1/prints`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    }), env);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.match(res.headers.get('Access-Control-Allow-Methods'), /POST/);
    assert.match(res.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
  });

  test('save a PNG and return its public URL', async () => {
    const bytes = png();
    const res = await upload(bytes);
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    const { url } = await res.json();
    assert.match(url, FILE_URL);
    const key = url.split('/').pop();
    assert.deepEqual(env.PRINTS.objects.get(key).bytes, bytes);
    assert.equal(env.PRINTS.objects.get(key).httpMetadata.contentType, 'image/png');
  });

  test('give every file its own name', async () => {
    const first = (await (await upload(png())).json()).url;
    const second = (await (await upload(png())).json()).url;
    assert.notEqual(first, second);
    assert.equal(env.PRINTS.objects.size, 2);
  });

  test('accept the largest print colourio makes', async () => {
    // 24 × 18 in at 150 ppi.
    assert.equal((await upload(png(3600, 2700))).status, 201);
  });

  test('refuse other sites and requests without an origin', async () => {
    for (const origin of ['https://example.com', null]) {
      const res = await upload(png(), { origin });
      assert.equal(res.status, 403);
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
    }
    assert.equal(env.PRINTS.objects.size, 0);
  });

  test('refuse files that are not PNGs', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(0)]);
    for (const body of [jpeg, 'hello', new Uint8Array(0)]) {
      const res = await upload(body);
      assert.equal(res.status, 415);
      assert.deepEqual(await res.json(), { error: 'not a PNG' });
    }
    assert.equal(env.PRINTS.objects.size, 0);
  });

  test('refuse a PNG that is cut short or has data after its end', async () => {
    const bytes = png();
    assert.equal((await upload(bytes.subarray(0, bytes.length - 1))).status, 415);
    assert.equal((await upload(new Uint8Array([...bytes, 0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]))).status, 415);
  });

  test('refuse images with too many pixels or too long a side', async () => {
    for (const [width, height] of [[5000, 5000], [20000, 10], [0, 10]]) {
      const res = await upload(png(width, height));
      assert.equal(res.status, 422, `${width}x${height}`);
    }
  });

  test('refuse files over the size limit', async () => {
    // Declared too large: refused before the body is read.
    const declared = await upload(png(), { headers: { 'Content-Length': String(MAX_BYTES + 1) } });
    assert.equal(declared.status, 413);
    assert.equal(env.UPLOADS.keys.length, 0);
    // Actually too large, whatever the header says.
    const big = new Uint8Array(MAX_BYTES + 1);
    big.set(png());
    assert.equal((await upload(big)).status, 413);
    assert.equal(env.PRINTS.objects.size, 0);
  });

  test('limit uploads per IP address', async () => {
    env.UPLOADS = fakeLimiter(2);
    assert.equal((await upload(png())).status, 201);
    assert.equal((await upload(png())).status, 201);
    const res = await upload(png());
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN, 'so colourio can read the error');
    assert.deepEqual(env.UPLOADS.keys, ['203.0.113.7', '203.0.113.7', '203.0.113.7']);
    assert.equal(env.PRINTS.objects.size, 2);
  });

  test('work without the rate limiter', async () => {
    delete env.UPLOADS;
    assert.equal((await upload(png())).status, 201);
  });
});

describe('files', () => {
  test('serve a saved PNG with long-lived caching', async () => {
    const bytes = png();
    const { url } = await (await upload(bytes)).json();
    const res = await handle(new Request(url), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'image/png');
    assert.equal(res.headers.get('Content-Length'), String(bytes.length));
    assert.match(res.headers.get('Cache-Control'), /immutable/);
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.ok(res.headers.get('ETag'));
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
  });

  test('answer HEAD without a body', async () => {
    const bytes = png();
    const { url } = await (await upload(bytes)).json();
    const res = await handle(new Request(url, { method: 'HEAD' }), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Length'), String(bytes.length));
    assert.equal(res.body, null);
  });

  test('404 for unknown files and anything else', async () => {
    const paths = [
      '/v1/prints/00000000-0000-0000-0000-000000000000.png',
      '/v1/prints/not-a-uuid.png',
      '/v1/prints',
      '/',
    ];
    for (const path of paths) {
      assert.equal((await handle(new Request(BASE + path), env)).status, 404, path);
    }
  });
});

describe('inspectPng', () => {
  test('read the size from the header', () => {
    assert.deepEqual(inspectPng(png(1800, 1800)), { width: 1800, height: 1800 });
  });
});

describe('worker', () => {
  test('turn unexpected errors into a 500 colourio can read', async () => {
    env.PRINTS.put = async () => { throw new Error('R2 is down'); };
    const logged = mock.method(console, 'error', () => {});
    const res = await worker.fetch(new Request(`${BASE}/v1/prints`, {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'image/png' }, body: png(),
    }), env);
    assert.equal(res.status, 500);
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.deepEqual(await res.json(), { error: 'server error' });
    assert.equal(logged.mock.callCount(), 1);
  });

  test('log each saved file without names or addresses', async () => {
    await upload(png(1800, 1800));
    assert.deepEqual(console.log.mock.calls.map((call) => call.arguments), [
      [{ event: 'print.saved', bytes: png(1800, 1800).length, width: 1800, height: 1800 }],
    ]);
  });
});
