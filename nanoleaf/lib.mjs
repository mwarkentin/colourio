// Turns a colourio gradient into a Nanoleaf scene: parsing, mapping colours
// onto panels by position, building the effect, and the bits of Nanoleaf's
// local OpenAPI the CLI uses. nanoleaf.mjs is the command line; tests import
// this module directly.

export const PORT = 16021;
const TIMEOUT_MS = 8000;

// Shape types (from the OpenAPI layout docs) with no lights of their own:
// Rhythm module, Shapes controller, Lines connector, controller cap and
// power connector. Everything else in the layout is lit. Skylight panels are
// types 30-32, and its controller square lights up like the others.
const UNLIT_SHAPES = new Set([1, 12, 16, 19, 20]);
// Side lengths in layout units, for shapes this is likely to drive.
const SIDE_LENGTHS = { 0: 150, 2: 100, 3: 100, 4: 100, 7: 67, 8: 134, 9: 67, 14: 134, 17: 154, 18: 77, 30: 180, 31: 180, 32: 180 };

// ---------------------------------------------------------------------------
// Gradients
// ---------------------------------------------------------------------------

const hexToRgb = (hex) => {
  const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c).slice(1) : hex.slice(1);
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};

export const toHex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

const evenly = (colours) => colours.map((c, i) => ({ ...c, at: colours.length > 1 ? i / (colours.length - 1) : 0 }));

// Accepts what colourio gives you: the CSS from "Copy CSS"
// ("background: linear-gradient(90deg, #a1b2c3 0%, ...)"), a share link that
// carries the colours (links to your own photos do), or just hex colours.
// Returns colour stops [{r, g, b, at}] with `at` from 0 to 1.
export function parseGradient(text) {
  const input = String(text || '').trim();
  if (!input) throw new Error('No colours given. Click Copy CSS in colourio first, or pass the colours.');

  const fragment = input.includes('#') && /^https?:\/\//.test(input) ? input.slice(input.indexOf('#') + 1) : null;
  if (fragment !== null) {
    const params = new URLSearchParams(fragment);
    if (!params.get('l')) {
      throw new Error('That link opens a sample, so it has no colours in it. Use Copy CSS in colourio instead.');
    }
    const bytes = Buffer.from(params.get('l'), 'base64url');
    if (bytes.length < 3 || bytes.length % 3) throw new Error('That colourio link is damaged.');
    const colours = [];
    for (let i = 0; i < bytes.length; i += 3) colours.push({ r: bytes[i], g: bytes[i + 1], b: bytes[i + 2] });
    return evenly(colours);
  }

  // Hex colours, each optionally followed by a percentage, as in CSS stops.
  const stops = [...input.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b(?:\s+(-?[\d.]+)%)?/gi)];
  if (!stops.length) throw new Error('No colours found. Expected CSS from colourio, a colourio link, or hex colours like #ff8800.');
  const colours = stops.map((m) => ({ ...hexToRgb('#' + m[1]), at: m[2] === undefined ? null : Number(m[2]) / 100 }));
  if (colours.some((c) => c.at === null)) return evenly(colours);
  return colours.sort((a, b) => a.at - b.at);
}

// The colour at t (0-1), blending between stops as CSS does.
export function colourAt(stops, t) {
  if (t <= stops[0].at) return stops[0];
  const last = stops[stops.length - 1];
  if (t >= last.at) return last;
  let i = 1;
  while (stops[i].at < t) i++;
  const a = stops[i - 1];
  const b = stops[i];
  const f = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at);
  return { r: a.r + (b.r - a.r) * f, g: a.g + (b.g - a.g) * f, b: a.b + (b.b - a.b) * f };
}

// The average colour from `from` to `to`. `colour(t)` gives the colour at t.
function average(colour, from, to, samples = 64) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < samples; i++) {
    const c = colour(from + ((i + 0.5) / samples) * (to - from));
    r += c.r;
    g += c.g;
    b += c.b;
  }
  return { r: Math.round(r / samples), g: Math.round(g / samples), b: Math.round(b / samples) };
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

// The lit panels from GET /panelLayout/layout, in order along the layout's
// longer side, with the stretch of the gradient (0-1) each one covers. A
// line of panels gets one slice each; panels side by side across the line
// share a slice.
export function panelSlices(layout, { reverse = false } = {}) {
  const panels = (layout.positionData || []).filter((p) => !UNLIT_SHAPES.has(p.shapeType));
  if (!panels.length) throw new Error('The layout has no lit panels.');
  const xs = panels.map((p) => p.x);
  const ys = panels.map((p) => p.y);
  const axis = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys) ? 'x' : 'y';
  const sorted = [...panels].sort((a, b) => a[axis] - b[axis] || a.panelId - b.panelId);

  const ranges = sorted.map((p) => {
    const side = SIDE_LENGTHS[p.shapeType] || layout.sideLength || 100;
    return { panel: p, from: p[axis] - side / 2, to: p[axis] + side / 2 };
  });
  const start = Math.min(...ranges.map((r) => r.from));
  const span = Math.max(...ranges.map((r) => r.to)) - start;
  return ranges.map(({ panel, from, to }) => {
    let a = (from - start) / span;
    let b = (to - start) / span;
    if (reverse) [a, b] = [1 - b, 1 - a];
    return { id: panel.panelId, shapeType: panel.shapeType, x: panel.x, y: panel.y, from: a, to: b };
  });
}

// One colour per panel: the average of its slice of the gradient.
export function stillColours(stops, slices) {
  return slices.map((s) => ({ id: s.id, colour: average((t) => colourAt(stops, t), s.from, s.to) }));
}

// Steps through the gradient each way when drifting, matching the 24 stops
// in colourio's Copy CSS.
export const DRIFT_STEPS = 24;

// The gradient as `count` colours, each the average of an equal stretch.
export function gradientColours(stops, count = DRIFT_STEPS) {
  return Array.from({ length: count }, (_, i) => average((t) => colourAt(stops, t), i / count, (i + 1) / count));
}

// Frames for a gradient that flows along the panels. It's laid end to end
// with a mirrored copy (start → end → start), so the loop has no seam. Each
// frame moves every panel one step along it and shows just that step's
// colour, so every panel passes through the whole gradient while staying as
// far along it from its neighbours as it sits from them on the ceiling.
export function driftFrames(stops, slices, steps = DRIFT_STEPS) {
  const loop = (u) => {
    const v = ((u % 2) + 2) % 2;
    return colourAt(stops, v <= 1 ? v : 2 - v);
  };
  const step = 1 / steps;
  return slices.map((s) => {
    const centre = (s.from + s.to) / 2;
    return {
      id: s.id,
      colours: Array.from({ length: steps * 2 }, (_, k) => {
        const at = centre + k * step;
        return average(loop, at - step / 2, at + step / 2);
      }),
    };
  });
}

// The body for PUT /effects. Colours fade in over `fade` seconds (still) or
// a loop takes `cycle` seconds (drift). With a name, the scene is saved on
// the device as well as shown.
export function buildEffect(panels, { drift = false, fade = 1, cycle = 60, name } = {}) {
  const tenths = (seconds) => Math.max(1, Math.round(seconds * 10));
  const parts = [panels.length];
  if (drift) {
    const step = tenths(cycle / panels[0].colours.length);
    for (const p of panels) {
      parts.push(p.id, p.colours.length);
      for (const c of p.colours) parts.push(c.r, c.g, c.b, 0, step);
    }
  } else {
    for (const p of panels) parts.push(p.id, 1, p.colour.r, p.colour.g, p.colour.b, 0, tenths(fade));
  }
  const write = {
    command: name ? 'add' : 'display',
    version: '2.0',
    animType: drift ? 'custom' : 'static',
    animData: parts.join(' '),
    loop: drift,
    palette: [],
    colorType: 'HSB',
  };
  if (name) write.animName = name;
  return { write };
}

// ---------------------------------------------------------------------------
// Nanoleaf OpenAPI (local, plain HTTP on port 16021)
// ---------------------------------------------------------------------------

export const baseUrl = (host) => `http://${/:\d+$/.test(host) ? host : `${host}:${PORT}`}/api/v1`;

async function call(host, path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(baseUrl(host) + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const err = new Error(`Couldn't reach the lights at ${host}. Is this computer on the same Wi-Fi?`);
    err.cause = error;
    throw err;
  }
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`The lights answered ${res.status}${text ? `: ${text}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// Works only while pairing is open: on a Skylight, tap Connect to API in the
// device's settings in the Nanoleaf app, then pair within 30 seconds.
export async function pair(host) {
  try {
    const { auth_token: token } = await call(host, '/new', { method: 'POST' });
    if (!token) throw new Error('The lights didn’t send a token.');
    return token;
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      throw new Error('Pairing isn’t open. In the Nanoleaf app, open the Skylight’s settings and tap Connect to API, then try again within 30 seconds.');
    }
    throw error;
  }
}

const authed = (token) => `/${encodeURIComponent(token)}`;
const explain = (error) => {
  if (error.status === 401) throw new Error('The lights didn’t accept the saved token. Pair again.');
  throw error;
};

export const getInfo = (host, token) => call(host, authed(token) + '/').catch(explain);
export const getLayout = (host, token) => call(host, authed(token) + '/panelLayout/layout').catch(explain);

export async function sendEffect(host, token, effect) {
  await call(host, authed(token) + '/effects', { method: 'PUT', body: effect }).catch(explain);
  // A saved scene is stored, not shown, so select it too.
  if (effect.write.animName) {
    await call(host, authed(token) + '/effects', { method: 'PUT', body: { select: effect.write.animName } }).catch(explain);
  }
}
