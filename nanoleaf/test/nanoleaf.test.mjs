// Tests for the Nanoleaf script, run with:
//   node --test "nanoleaf/test/*.test.mjs"
// A small HTTP server stands in for a three-panel Skylight.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { promisify } from 'node:util';

import {
  baseUrl, buildEffect, colourAt, driftFrames, getLayout, pair, panelSlices, parseGradient, sendEffect, stillColours,
} from '../lib.mjs';

const CLI = new URL('../nanoleaf.mjs', import.meta.url).pathname;
const TOKEN = 'tok3n';

// Three Skylight panels in a line, listed out of order; the controller
// square (type 31) lights up like the others.
const SKYLIGHT = {
  numPanels: 3,
  sideLength: 0,
  positionData: [
    { panelId: 9031, x: 540, y: 90, o: 0, shapeType: 30 },
    { panelId: 4012, x: 180, y: 90, o: 0, shapeType: 31 },
    { panelId: 177, x: 360, y: 90, o: 0, shapeType: 30 },
  ],
};
const RED_GREEN_BLUE = 'background: linear-gradient(90deg, #ff0000 0%, #00ff00 50%, #0000ff 100%);';

// ---------------------------------------------------------------------------
// A fake Skylight
// ---------------------------------------------------------------------------

let server;
let host;
let device;

function fakeSkylight() {
  return createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const send = (status, data) => {
        res.writeHead(status, data ? { 'Content-Type': 'application/json' } : {});
        res.end(data ? JSON.stringify(data) : undefined);
      };
      device.requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (req.method === 'POST' && req.url === '/api/v1/new') {
        return device.pairing ? send(200, { auth_token: TOKEN }) : send(403);
      }
      const match = req.url.match(/^\/api\/v1\/([^/]+)(\/.*)$/);
      if (!match) return send(404);
      if (match[1] !== TOKEN) return send(401);
      if (req.method === 'GET' && match[2] === '/') return send(200, { name: 'Skylight 1A2B', model: 'NL83' });
      if (req.method === 'GET' && match[2] === '/panelLayout/layout') return send(200, SKYLIGHT);
      if (req.method === 'PUT' && match[2] === '/effects') return send(204);
      return send(404);
    });
  });
}

before(async () => {
  server = fakeSkylight();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  host = `127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  device = { pairing: true, requests: [] };
});

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

describe('parseGradient', () => {
  test('read the CSS from colourio’s Copy CSS', () => {
    assert.deepEqual(parseGradient(RED_GREEN_BLUE), [
      { r: 255, g: 0, b: 0, at: 0 },
      { r: 0, g: 255, b: 0, at: 0.5 },
      { r: 0, g: 0, b: 255, at: 1 },
    ]);
  });

  test('read a link to your own photo, which carries the colours', () => {
    const l = Buffer.from([255, 0, 0, 0, 0, 255]).toString('base64url');
    const stops = parseGradient(`https://mwarkentin.github.io/colourio/#v=1&d=row&b=box&o=match&l=${l}&m=1600x1000`);
    assert.deepEqual(stops, [{ r: 255, g: 0, b: 0, at: 0 }, { r: 0, g: 0, b: 255, at: 1 }]);
  });

  test('explain that a sample link has no colours', () => {
    assert.throws(() => parseGradient('https://mwarkentin.github.io/colourio/#v=1&d=row&s=pier-at-sunset&p=290'), /Copy CSS/);
  });

  test('read plain hex colours, short ones too', () => {
    assert.deepEqual(parseGradient('#f80 #2244aa'), [
      { r: 255, g: 136, b: 0, at: 0 },
      { r: 34, g: 68, b: 170, at: 1 },
    ]);
  });

  test('refuse text without colours', () => {
    assert.throws(() => parseGradient(''), /Copy CSS/);
    assert.throws(() => parseGradient('hello'), /No colours found/);
  });

  test('blend between stops', () => {
    assert.deepEqual(colourAt(parseGradient('#000000 #ffffff'), 0.5), { r: 127.5, g: 127.5, b: 127.5 });
  });
});

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

describe('panelSlices', () => {
  test('order a line of panels and give each a third of the gradient', () => {
    const slices = panelSlices(SKYLIGHT);
    assert.deepEqual(slices.map((s) => s.id), [4012, 177, 9031]);
    assert.deepEqual(slices.map((s) => [s.from, s.to]), [[0, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 1]]);
  });

  test('reverse the gradient', () => {
    const slices = panelSlices(SKYLIGHT, { reverse: true });
    assert.deepEqual(slices.map((s) => s.id), [4012, 177, 9031]);
    assert.deepEqual(slices.map((s) => [s.from, s.to].map((n) => +n.toFixed(6))), [[0.666667, 1], [0.333333, 0.666667], [0, 0.333333]]);
  });

  test('run along a vertical line too', () => {
    const vertical = { positionData: SKYLIGHT.positionData.map((p) => ({ ...p, x: 90, y: p.x })) };
    assert.deepEqual(panelSlices(vertical).map((s) => s.id), [4012, 177, 9031]);
  });

  test('skip parts without lights', () => {
    const layout = { positionData: [...SKYLIGHT.positionData, { panelId: 0, x: 0, y: 90, o: 0, shapeType: 12 }] };
    assert.equal(panelSlices(layout).length, 3);
    assert.throws(() => panelSlices({ positionData: [] }), /no lit panels/);
  });
});

describe('colours', () => {
  test('give each panel the average of its third', () => {
    const colours = stillColours(parseGradient('#ff0000 #ff0000 #0000ff #0000ff'), panelSlices(SKYLIGHT));
    assert.deepEqual(colours, [
      { id: 4012, colour: { r: 255, g: 0, b: 0 } },
      { id: 177, colour: { r: 128, g: 0, b: 128 } },
      { id: 9031, colour: { r: 0, g: 0, b: 255 } },
    ]);
  });

  test('drift: start where the still does, flow without a seam', () => {
    const stops = parseGradient(RED_GREEN_BLUE);
    const slices = panelSlices(SKYLIGHT);
    const frames = driftFrames(stops, slices, 24);
    assert.equal(frames.length, 3);
    assert.ok(frames.every((p) => p.colours.length === 24));
    assert.deepEqual(frames.map((p) => p.colours[0]), stillColours(stops, slices).map((p) => p.colour));
    // Halfway round, the mirrored gradient puts blue on the first panel.
    assert.deepEqual(frames[0].colours[12], stillColours(stops, slices)[2].colour);
  });
});

describe('buildEffect', () => {
  const still = [{ id: 4012, colour: { r: 255, g: 0, b: 0 } }, { id: 177, colour: { r: 0, g: 0, b: 255 } }];

  test('a still scene', () => {
    assert.deepEqual(buildEffect(still), {
      write: {
        command: 'display', version: '2.0', animType: 'static', loop: false, palette: [], colorType: 'HSB',
        animData: '2 4012 1 255 0 0 0 10 177 1 0 0 255 0 10',
      },
    });
  });

  test('a saved scene', () => {
    const { write } = buildEffect(still, { name: 'Sunset' });
    assert.equal(write.command, 'add');
    assert.equal(write.animName, 'Sunset');
  });

  test('a flowing scene', () => {
    const frames = [{ id: 7, colours: [{ r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }] }];
    const { write } = buildEffect(frames, { drift: true, cycle: 60 });
    assert.equal(write.animType, 'custom');
    assert.equal(write.loop, true);
    assert.equal(write.animData, '1 7 2 1 2 3 0 300 4 5 6 0 300');
  });
});

// ---------------------------------------------------------------------------
// The API
// ---------------------------------------------------------------------------

describe('API', () => {
  test('use port 16021 unless told otherwise', () => {
    assert.equal(baseUrl('192.168.1.40'), 'http://192.168.1.40:16021/api/v1');
    assert.equal(baseUrl('127.0.0.1:9999'), 'http://127.0.0.1:9999/api/v1');
  });

  test('pair while pairing is open', async () => {
    assert.equal(await pair(host), TOKEN);
  });

  test('explain how to open pairing', async () => {
    device.pairing = false;
    await assert.rejects(pair(host), /Connect to API/);
  });

  test('explain a rejected token', async () => {
    await assert.rejects(getLayout(host, 'wrong'), /Pair again/);
  });

  test('explain lights that can’t be reached', async () => {
    await assert.rejects(getLayout('127.0.0.1:1', TOKEN), /same Wi-Fi/);
  });

  test('select a saved scene after adding it', async () => {
    await sendEffect(host, TOKEN, buildEffect([{ id: 1, colour: { r: 0, g: 0, b: 0 } }], { name: 'Dusk' }));
    assert.deepEqual(device.requests.map((r) => r.body.select ?? r.body.write.command), ['add', 'Dusk']);
  });
});

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

describe('command line', () => {
  const run = promisify(execFile);
  const config = join(mkdtempSync(join(tmpdir(), 'colourio-nanoleaf-')), 'nanoleaf.json');
  const cli = (...args) => run(process.execPath, [CLI, ...args], { env: { ...process.env, COLOURIO_NANOLEAF_CONFIG: config } });

  test('ask to pair first', async () => {
    await assert.rejects(cli('send', '#ff0000'), (error) => /Not paired yet/.test(error.stderr));
  });

  test('pair, then send a gradient', async () => {
    const paired = await cli('pair', host);
    assert.match(paired.stdout, /Paired with Skylight 1A2B/);
    assert.deepEqual(JSON.parse(readFileSync(config, 'utf8')), { host, token: TOKEN });
    assert.equal(statSync(config).mode & 0o777, 0o600);

    device.requests = [];
    const sent = await cli('send', RED_GREEN_BLUE);
    assert.match(sent.stdout, /Showing \(still\)/);
    const write = device.requests.find((r) => r.method === 'PUT').body.write;
    assert.equal(write.animType, 'static');
    assert.match(write.animData, /^3 4012 1 /);

    device.requests = [];
    const drift = await cli('send', RED_GREEN_BLUE, '--drift', '--cycle', '30', '--save', 'Flow');
    assert.match(drift.stdout, /Saved as “Flow” and showing \(flowing, 30s a cycle\)/);
    const puts = device.requests.filter((r) => r.method === 'PUT').map((r) => r.body);
    assert.equal(puts[0].write.animType, 'custom');
    assert.deepEqual(puts[1], { select: 'Flow' });

    const layout = await cli('layout');
    assert.match(layout.stdout, /1\. panel 4012 .*\n.*2\. panel 177 .*\n.*3\. panel 9031/);
  });

  test('refuse a silly cycle', async () => {
    await assert.rejects(cli('send', '#ff0000', '--drift', '--cycle', '1'), (error) => /--cycle/.test(error.stderr));
  });
});
