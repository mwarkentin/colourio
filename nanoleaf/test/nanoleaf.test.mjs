// Tests for the Nanoleaf script, run with:
//   node --test "nanoleaf/test/*.test.mjs"
// A small HTTP server stands in for a three-panel Skylight.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { promisify } from 'node:util';

import {
  ansi256, baseUrl, buildEffect, colourAt, colourDepth, DRIFT_STEPS, driftFrames, getLayout, gradientColours, pair, paint,
  panelSlices, parseGradient, sendEffect, stillColours,
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
// The same lights after adding two panels.
const FIVE_PANELS = {
  numPanels: 5,
  sideLength: 0,
  positionData: [180, 360, 540, 720, 900].map((x, i) => ({ panelId: 500 + i, x, y: 90, o: 0, shapeType: 30 })),
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
      if (req.method === 'GET' && match[2] === '/panelLayout/layout') return send(200, device.layout);
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
  device = { pairing: true, requests: [], layout: SKYLIGHT };
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

  test('drift: every panel shows every colour, not just its third', () => {
    const frames = driftFrames(parseGradient(RED_GREEN_BLUE), panelSlices(SKYLIGHT));
    assert.equal(frames.length, 3);
    for (const panel of frames) {
      assert.equal(panel.colours.length, DRIFT_STEPS * 2, 'out and back');
      for (const channel of ['r', 'g', 'b']) {
        assert.ok(Math.max(...panel.colours.map((c) => c[channel])) >= 240, `panel ${panel.id} reaches pure ${channel}`);
      }
    }
  });

  test('drift: panels keep their spacing and the loop has no jumps', () => {
    const distance = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
    const frames = driftFrames(parseGradient(RED_GREEN_BLUE), panelSlices(SKYLIGHT));
    // The middle panel starts at the gradient's midpoint: green.
    assert.ok(distance(frames[1].colours[0], { r: 0, g: 255, b: 0 }) <= 10, JSON.stringify(frames[1].colours[0]));
    // The first panel sits a third of the gradient behind, so it reaches
    // that green a third of 24 steps later.
    assert.ok(distance(frames[0].colours[DRIFT_STEPS / 3], frames[1].colours[0]) <= 1);
    // Each frame, including last back to first, is a small step.
    for (const panel of frames) {
      panel.colours.forEach((c, k) => {
        assert.ok(distance(c, panel.colours[(k + 1) % panel.colours.length]) <= 50, `panel ${panel.id} frame ${k}`);
      });
    }
  });

  test('describe the gradient as 24 colours', () => {
    const colours = gradientColours(parseGradient('#000000 #ffffff'));
    assert.equal(colours.length, 24);
    assert.ok(colours[0].r < colours[23].r);
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
    assert.match(drift.stdout, /Each panel flows through these 24 colours and back/);
    const puts = device.requests.filter((r) => r.method === 'PUT').map((r) => r.body);
    assert.equal(puts[0].write.animType, 'custom');
    assert.deepEqual(puts[1], { select: 'Flow' });

    const layout = await cli('layout');
    assert.match(layout.stdout, /1\. panel 4012 .*\n.*2\. panel 177 .*\n.*3\. panel 9031/);

    // Options can still come before the command.
    assert.match((await cli('--cycle', '30', '--drift', 'send', '#ff0000 #0000ff')).stdout, /flowing, 30s a cycle/);
  });

  test('refuse a silly cycle', async () => {
    await assert.rejects(cli('send', '#ff0000', '--drift', '--cycle', '1'), (error) => /--cycle/.test(error.stderr));
  });
});

describe('scene library from the command line', () => {
  const run = promisify(execFile);
  const dir = mkdtempSync(join(tmpdir(), 'colourio-nanoleaf-'));
  const config = join(dir, 'nanoleaf.json');
  // The library sits next to the pairing file unless told otherwise.
  const scenes = join(dir, 'nanoleaf-scenes.json');
  const { FORCE_COLOR, NO_COLOR, ...env } = process.env;
  const cli = (args, extra = {}) => run(process.execPath, [CLI, ...args], { env: { ...env, COLOURIO_NANOLEAF_CONFIG: config, ...extra } });
  const library = () => JSON.parse(readFileSync(scenes, 'utf8'));
  const puts = () => device.requests.filter((r) => r.method === 'PUT').map((r) => r.body);
  const fails = (pattern) => (error) => {
    assert.match(error.stderr, pattern);
    return true;
  };

  before(() => writeFileSync(config, JSON.stringify({ host, token: TOKEN })));

  test('start with an empty library', async () => {
    assert.match((await cli(['scenes'])).stdout, /No scenes kept yet/);
    assert.equal(existsSync(scenes), false);
  });

  test('send --keep shows the gradient and keeps it, without saving it on the lights', async () => {
    const { stdout } = await cli(['send', RED_GREEN_BLUE, '--keep', 'Sunset']);
    assert.match(stdout, /Showing \(still\)\.\nKept “Sunset” in your scene library\. Show it again any time with: .* play Sunset\n/);
    assert.deepEqual(puts().map((b) => b.write.command), ['display']);
    const { version, scenes: kept } = library();
    assert.equal(version, 1);
    assert.deepEqual(kept.map(({ savedAt, ...scene }) => scene), [{
      name: 'Sunset', drift: false, cycle: 60, reverse: false, stops: ['#ff0000 0%', '#00ff00 50%', '#0000ff 100%'],
    }]);
    if (process.platform !== 'win32') assert.equal(statSync(scenes).mode & 0o777, 0o600);
  });

  test('send --save saves it on the lights and keeps it too', async () => {
    const { stdout } = await cli(['send', RED_GREEN_BLUE, '--drift', '--cycle', '30', '--reverse', '--save', 'Ocean flow']);
    assert.match(stdout, /Saved as “Ocean flow” and showing \(flowing, 30s a cycle\)\./);
    assert.match(stdout, /Kept “Ocean flow” .* play "Ocean flow"/);
    assert.deepEqual(puts().map((b) => b.select ?? b.write.command), ['add', 'Ocean flow']);
    const kept = library().scenes.find((s) => s.name === 'Ocean flow');
    assert.deepEqual([kept.drift, kept.cycle, kept.reverse], [true, 30, true]);
  });

  test('keeping a name again replaces that scene', async () => {
    const { stdout } = await cli(['send', '#000000 #ffffff', '--keep', 'Dusk']);
    assert.match(stdout, /Kept “Dusk”/);
    assert.match((await cli(['send', '#222244 #000000', '--keep', 'dusk'])).stdout, /Replaced “dusk”/);
    const names = library().scenes.map((s) => s.name);
    assert.deepEqual(names, ['dusk', 'Ocean flow', 'Sunset']);
    assert.deepEqual(library().scenes[0].stops, ['#222244 0%', '#000000 100%']);
  });

  test('list scenes, with colour previews where the terminal shows them', async () => {
    const plain = (await cli(['scenes'])).stdout;
    assert.match(plain, /^3 scenes in .*nanoleaf-scenes\.json:\n/);
    assert.match(plain, /\n {2}dusk {8}#[0-9a-f]{6}( #[0-9a-f]{6}){4} {2}still {2}\d{4}-\d{2}-\d{2}\n/);
    assert.match(plain, /\n {2}Ocean flow {2}.* {2}flowing, 30s a cycle, reversed {2}\d{4}/);
    assert.doesNotMatch(plain, /\x1b\[/);

    const truecolour = (await cli(['scenes'], { FORCE_COLOR: '3' })).stdout;
    assert.match(truecolour, /\x1b\[48;2;\d+;\d+;\d+m \x1b\[0m/);
    assert.equal(truecolour.split('\n')[3].match(/\x1b\[48;2;/g).length, DRIFT_STEPS, 'one block per colour');
    assert.match((await cli(['scenes'], { FORCE_COLOR: '2' })).stdout, /\x1b\[48;5;\d+m/);
  });

  test('play a kept scene on whatever panels the lights have now', async () => {
    device.layout = FIVE_PANELS;
    const { stdout } = await cli(['play', 'sunset']);
    assert.match(stdout, /5\. #[0-9a-f]{6}\nShowing “Sunset” \(still\)\./);
    assert.deepEqual(puts().map((b) => b.write.command), ['display']);
    assert.match(puts()[0].write.animData, /^5 500 1 /);
  });

  test('play a flowing scene, unquoted, and save it on the lights', async () => {
    const { stdout } = await cli(['play', 'Ocean', 'flow', '--save']);
    assert.match(stdout, /Each panel flows through these 24 colours and back/);
    assert.match(stdout, /Saved “Ocean flow” on the lights and showing it \(flowing, 30s a cycle\)\./);
    const [add, select] = puts();
    assert.equal(add.write.animType, 'custom');
    assert.equal(add.write.animName, 'Ocean flow');
    assert.deepEqual(select, { select: 'Ocean flow' });
  });

  test('suggest a close name, without touching the lights', async () => {
    await assert.rejects(cli(['play', 'Sunst']), fails(/No scene called “Sunst”\. Did you mean “Sunset”\?/));
    await assert.rejects(cli(['play']), fails(/Which scene\?/));
    assert.deepEqual(device.requests, []);
  });

  test('refuse options that only send takes', async () => {
    await assert.rejects(cli(['play', 'Sunset', '--drift']), fails(/“play” doesn’t take --drift/));
    await assert.rejects(cli(['scenes', '--reverse']), fails(/“scenes” doesn’t take --reverse/));
    await assert.rejects(cli(['send', '#ff0000', '--keep', 'A', '--save', 'B']), fails(/--keep or --save, not both/));
    assert.deepEqual(device.requests, []);
  });

  test('refuse a name that won’t work before touching the lights', async () => {
    await assert.rejects(cli(['send', '#ff0000', '--keep', '*Solid*']), fails(/used by the lights/));
    await assert.rejects(cli(['send', '#ff0000', '--save', 'x'.repeat(41)]), fails(/up to 40 characters/));
    assert.deepEqual(device.requests, []);
  });

  test('sync saves every kept scene on the lights, without changing what’s showing', async () => {
    device.layout = FIVE_PANELS;
    const { stdout } = await cli(['sync']);
    assert.match(stdout, /Saved 3 scenes on the lights/);
    const sent = puts();
    assert.deepEqual(sent.map((b) => [b.write.command, b.write.animName]), [['add', 'dusk'], ['add', 'Ocean flow'], ['add', 'Sunset']]);
    assert.ok(sent.every((b) => b.write.animData.startsWith('5 ')), 'fitted to the five panels');
  });

  test('forget a scene', async () => {
    assert.match((await cli(['forget', 'DUSK'])).stdout, /Forgot “dusk”\. A copy saved on the lights stays/);
    assert.deepEqual(library().scenes.map((s) => s.name), ['Ocean flow', 'Sunset']);
    await assert.rejects(cli(['forget', 'dusk']), fails(/No scene called “dusk”/));
  });

  test('report a damaged library, change nothing, and leave the file alone', async () => {
    const other = join(dir, 'damaged.json');
    writeFileSync(other, '{"version": 1, "scenes": [');
    const extra = { COLOURIO_NANOLEAF_SCENES: other };
    for (const args of [['scenes'], ['play', 'Sunset'], ['sync'], ['forget', 'Sunset'], ['send', '#ff0000', '--keep', 'New']]) {
      await assert.rejects(cli(args, extra), fails(/damaged\.json isn’t valid JSON .* Nothing was changed/), args.join(' '));
    }
    assert.equal(readFileSync(other, 'utf8'), '{"version": 1, "scenes": [');
    assert.deepEqual(device.requests, []);
  });

  test('keep working without the library', async () => {
    const { stdout } = await cli(['send', '#ff0000'], { COLOURIO_NANOLEAF_SCENES: join(dir, 'damaged.json') });
    assert.match(stdout, /Showing \(still\)/);
  });
});

// ---------------------------------------------------------------------------
// Colour previews
// ---------------------------------------------------------------------------

describe('terminal previews', () => {
  test('use the terminal’s own colour depth, and FORCE_COLOR when piped', () => {
    assert.equal(colourDepth({ isTTY: true, getColorDepth: () => 24 }, {}), 24);
    assert.equal(colourDepth({ isTTY: false }, {}), 1);
    assert.equal(colourDepth({ isTTY: false }, { FORCE_COLOR: '3' }), 24);
    assert.equal(colourDepth({ isTTY: false }, { FORCE_COLOR: '2' }), 8);
    assert.equal(colourDepth({ isTTY: false }, { FORCE_COLOR: '0' }), 1);
  });

  test('paint true colour, the nearest of 256 colours, or nothing', () => {
    const orange = { r: 255, g: 136, b: 0 };
    assert.equal(paint(orange, 2, 24), '\x1b[48;2;255;136;0m  \x1b[0m');
    assert.equal(paint(orange, 2, 8), '\x1b[48;5;208m  \x1b[0m');
    assert.equal(paint(orange, 2, 4), '');
    assert.equal(ansi256({ r: 255, g: 0, b: 0 }), 196);
    assert.equal(ansi256({ r: 255, g: 255, b: 255 }), 231);
    assert.equal(ansi256({ r: 128, g: 128, b: 128 }), 244);
  });
});
