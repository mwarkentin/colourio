// Print file hosting for colourio: routing and checks. src/index.js wraps it
// as the Worker; tests import it directly.
//
//   POST /v1/prints               save a PNG (the request body), answer {url}
//   GET  /v1/prints/<uuid>.png    serve a saved PNG (HEAD works too)
//
// colourio uploads each print file here, then hands its URL to Zazzle, which
// fetches the image for the product page and RealView mockup. Only pages in
// ALLOWED_ORIGINS may upload, and only real PNGs within the size limits are
// kept. Files get random names, so nobody can list or guess them. An R2
// lifecycle rule deletes old ones (see README.md).

export const MAX_BYTES = 20 * 1024 * 1024;
// A little above print.js's 16 megapixel cap, which rounding can overshoot.
export const MAX_PIXELS = 20_000_000;
// The largest canvas side most browsers can draw.
export const MAX_SIDE = 16384;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// Every PNG ends with an empty IEND chunk: length 0, type, CRC.
const PNG_END = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const FILE_PATH = /^\/v1\/prints\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.png$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
  const headers = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

export function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const startsWith = (bytes, expected, offset = 0) => expected.every((b, i) => bytes[offset + i] === b);

// Checks the PNG's signature, header and end without decoding the image, and
// returns its size in pixels.
export function inspectPng(bytes) {
  const minimum = PNG_SIGNATURE.length + 25 + PNG_END.length; // signature, IHDR chunk, IEND chunk
  if (bytes.length < minimum || !startsWith(bytes, PNG_SIGNATURE)) throw new HttpError(415, 'not a PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdr = view.getUint32(8) === 13 && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR';
  if (!ihdr || !startsWith(bytes, PNG_END, bytes.length - PNG_END.length)) throw new HttpError(415, 'not a PNG');
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new HttpError(422, 'image too large');
  }
  return { width, height };
}

async function rateLimit(request, env) {
  // The binding is optional, so the Worker still runs if it's removed.
  if (!env.UPLOADS) return;
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.UPLOADS.limit({ key });
  if (!success) throw new HttpError(429, 'too many uploads, try again in a minute');
}

async function savePrint(request, env) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_BYTES) throw new HttpError(413, 'file too large');
  await rateLimit(request, env);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new HttpError(413, 'file too large');
  const { width, height } = inspectPng(bytes);
  const id = crypto.randomUUID();
  await env.PRINTS.put(`${id}.png`, bytes, { httpMetadata: { contentType: 'image/png' } });
  console.log({ event: 'print.saved', bytes: bytes.length, width, height });
  return { url: `${new URL(request.url).origin}/v1/prints/${id}.png` };
}

// Files never change once saved, so they can be cached for good.
function fileHeaders(object) {
  return {
    'Content-Type': 'image/png',
    'Content-Length': String(object.size),
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: object.httpEtag,
    'X-Content-Type-Options': 'nosniff',
  };
}

async function serveFile(env, id, method) {
  const key = `${id}.png`;
  const object = method === 'HEAD' ? await env.PRINTS.head(key) : await env.PRINTS.get(key);
  if (!object) throw new HttpError(404, 'not found');
  return new Response(method === 'HEAD' ? null : object.body, { status: 200, headers: fileHeaders(object) });
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const cors = corsHeaders(request, env);
  const { method } = request;
  const file = url.pathname.match(FILE_PATH);
  try {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/v1/prints' && method === 'POST') {
      if (!cors['Access-Control-Allow-Origin']) throw new HttpError(403, 'origin not allowed');
      return json(await savePrint(request, env), 201, cors);
    }
    if (file && (method === 'GET' || method === 'HEAD')) return await serveFile(env, file[1], method);
    return json({ error: 'not found' }, 404, cors);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status, cors);
    throw error;
  }
}
