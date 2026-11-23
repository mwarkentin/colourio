// Tests for the scene library, run with:
//   node --test "nanoleaf/test/*.test.mjs"
// Everything happens in temporary folders; no lights are involved.

import assert from 'node:assert/strict';
import fs, {
  lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, mock, test } from 'node:test';

import { DRIFT_STEPS, parseGradient, sceneEffect } from '../lib.mjs';
import {
  checkName, closeNames, emptyLibrary, findScene, forgetScene, keepScene, makeScene, NAME_LIMIT, readLibrary, sceneStops,
  VERSION, writeFileAtomic, writeLibrary,
} from '../library.mjs';

const NOW = new Date('2026-11-23T14:00:00.000Z');
const RED_GREEN_BLUE = parseGradient('background: linear-gradient(90deg, #ff0000 0%, #00ff00 50%, #0000ff 100%);');
const still = { drift: false, cycle: 60, reverse: false };
const sunset = makeScene('Sunset', RED_GREEN_BLUE, still, NOW);

const folder = () => mkdtempSync(join(tmpdir(), 'colourio-scenes-'));
const libraryOf = (...scenes) => ({ version: VERSION, scenes });
const raw = (file) => JSON.parse(readFileSync(file, 'utf8'));

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

describe('scene names', () => {
  test('tidy a name, keeping its case and accents', () => {
    assert.equal(checkName('  Sunset over the bay  '), 'Sunset over the bay');
    assert.equal(checkName('Café'), 'Café');
    // An accent typed as a separate mark is the same name.
    assert.equal(checkName('Café'), 'Café');
  });

  test('refuse names that won’t work', () => {
    assert.throws(() => checkName(''), /need a name/);
    assert.throws(() => checkName('   '), /need a name/);
    assert.throws(() => checkName('x'.repeat(NAME_LIMIT + 1)), /up to 40 characters/);
    assert.equal(checkName('x'.repeat(NAME_LIMIT)).length, NAME_LIMIT);
    assert.throws(() => checkName('Two\nlines'), /control characters/);
    assert.throws(() => checkName('-drift'), /start with “-”/);
    assert.throws(() => checkName('*Solid*'), /used by the lights/);
  });
});

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

describe('scenes', () => {
  test('store the gradient and options, not panel colours', () => {
    assert.deepEqual(sunset, {
      name: 'Sunset', drift: false, cycle: 60, reverse: false, savedAt: '2026-11-23T14:00:00.000Z',
      stops: ['#ff0000 0%', '#00ff00 50%', '#0000ff 100%'],
    });
  });

  test('give back the same stops', () => {
    assert.deepEqual(sceneStops(sunset), RED_GREEN_BLUE);
    // Copy CSS gives 24 stops at percentages like 4.35%.
    const css = parseGradient('#112233 0%, #445566 4.35%, #778899 95.65%, #aabbcc 100%');
    assert.deepEqual(sceneStops(makeScene('Copy CSS', css, still, NOW)), css);
    // A link's colours sit at thirds, which round to a millionth.
    const link = parseGradient('#000000 #555555 #aaaaaa #ffffff');
    sceneStops(makeScene('Link', link, still, NOW)).forEach((stop, i) => {
      assert.ok(Math.abs(stop.at - link[i].at) < 1e-6);
    });
  });

  test('keep drift, cycle and direction', () => {
    const flow = makeScene('Flow', RED_GREEN_BLUE, { drift: true, cycle: 90, reverse: true }, NOW);
    assert.equal(flow.drift, true);
    assert.equal(flow.cycle, 90);
    assert.equal(flow.reverse, true);
  });

  test('refuse a cycle out of range', () => {
    assert.throws(() => makeScene('Fast', RED_GREEN_BLUE, { drift: true, cycle: 1 }, NOW), /cycle/);
  });
});

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

describe('reading the library', () => {
  test('treat a missing file as an empty library, without making one', () => {
    const dir = folder();
    assert.deepEqual(readLibrary(join(dir, 'nanoleaf-scenes.json')), emptyLibrary());
    assert.deepEqual(readdirSync(dir), []);
  });

  test('treat an empty file as an empty library', () => {
    const file = join(folder(), 'nanoleaf-scenes.json');
    for (const text of ['', '  \n', '﻿']) {
      writeFileSync(file, text);
      assert.deepEqual(readLibrary(file), emptyLibrary());
    }
  });

  test('read a file saved with a byte order mark, or as UTF-16 by PowerShell', () => {
    const file = join(folder(), 'nanoleaf-scenes.json');
    const json = JSON.stringify(libraryOf(sunset));
    writeFileSync(file, '﻿' + json);
    assert.deepEqual(readLibrary(file).scenes, [sunset]);
    writeFileSync(file, Buffer.from('﻿' + json, 'utf16le'));
    assert.deepEqual(readLibrary(file).scenes, [sunset]);
  });

  test('fill in options a hand-written scene leaves out, and keep fields it doesn’t know', () => {
    const file = join(folder(), 'nanoleaf-scenes.json');
    writeFileSync(file, JSON.stringify({ version: 1, scenes: [{ name: 'Mine', stops: ['#ffffff 0%'], mood: 'calm' }] }));
    assert.deepEqual(readLibrary(file).scenes, [{ name: 'Mine', drift: false, cycle: 60, reverse: false, stops: ['#ffffff 0%'], mood: 'calm' }]);
  });

  test('explain a damaged file, and leave it alone', () => {
    const file = join(folder(), 'nanoleaf-scenes.json');
    const cases = [
      ['{"version": 1, "scenes": [', /isn’t valid JSON/],
      ['[]', /isn’t a scene library/],
      ['{"scenes": []}', /no “version”/],
      ['{"version": 1}', /no list of “scenes”/],
      ['{"version": 1, "scenes": [{"name": "A", "stops": []}]}', /Scene 1 \(“A”\) has no colours/],
      ['{"version": 1, "scenes": [{"name": "A", "stops": ["red"]}]}', /Scene 1 \(“A”\) has a colour stop/],
      ['{"version": 1, "scenes": [{"name": "A", "stops": ["#ff0000 0%"], "cycle": 0}]}', /“cycle”/],
      ['{"version": 1, "scenes": [{"name": "A", "stops": ["#ff0000 0%"], "drift": "yes"}]}', /“drift”/],
      ['{"version": 1, "scenes": [{"name": "", "stops": ["#ff0000 0%"]}]}', /Scene 1 \(“”\) has a name that won’t work/],
      ['{"version": 1, "scenes": [{"name": "A", "stops": ["#ff0000 0%"]}, {"name": "a", "stops": ["#ff0000 0%"]}]}', /two scenes called “a”/],
    ];
    for (const [text, message] of cases) {
      writeFileSync(file, text);
      assert.throws(() => readLibrary(file), (error) => message.test(error.message) && error.message.includes(file)
        && /Nothing was changed/.test(error.message), text);
      assert.equal(readFileSync(file, 'utf8'), text);
    }
  });

  test('refuse a library from a newer version', () => {
    const file = join(folder(), 'nanoleaf-scenes.json');
    writeFileSync(file, JSON.stringify({ version: VERSION + 1, scenes: [] }));
    assert.throws(() => readLibrary(file), /newer version/);
  });
});

describe('writing the library', () => {
  test('write a versioned file, sorted by name, that reads back the same', () => {
    const dir = folder();
    const file = join(dir, 'colourio', 'nanoleaf-scenes.json');
    const dusk = makeScene('dusk', parseGradient('#222244 #000000'), still, NOW);
    writeLibrary(file, libraryOf(sunset, dusk));
    const written = raw(file);
    assert.equal(written.version, 1);
    assert.deepEqual(written.scenes.map((s) => s.name), ['dusk', 'Sunset']);
    assert.ok(readFileSync(file, 'utf8').endsWith('}\n'));
    assert.deepEqual(readLibrary(file), libraryOf(dusk, sunset));
  });

  test('make the file, and a new folder, readable only by you', { skip: process.platform === 'win32' }, () => {
    const dir = join(folder(), 'colourio');
    const file = join(dir, 'nanoleaf-scenes.json');
    writeLibrary(file, libraryOf(sunset));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    // Replacing a file you made readable by others makes it private again.
    writeFileSync(file, '{}', { mode: 0o644 });
    writeLibrary(file, libraryOf(sunset));
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  test('leave no temporary files behind', () => {
    const dir = folder();
    const file = join(dir, 'nanoleaf-scenes.json');
    writeLibrary(file, libraryOf(sunset));
    writeLibrary(file, libraryOf());
    assert.deepEqual(readdirSync(dir), ['nanoleaf-scenes.json']);
  });

  test('keep the old library whole if writing fails partway', () => {
    const dir = folder();
    const file = join(dir, 'nanoleaf-scenes.json');
    writeLibrary(file, libraryOf(sunset));
    const before = readFileSync(file, 'utf8');
    // The temporary file is written, then the computer "crashes" before it
    // replaces the library.
    const rename = mock.method(fs, 'renameSync', () => {
      throw new Error('Simulated crash');
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => writeLibrary(file, libraryOf()), /Simulated crash/);
    } finally {
      rename.mock.restore();
      syncBuiltinESMExports();
    }
    assert.equal(rename.mock.callCount(), 1);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.deepEqual(readdirSync(dir), ['nanoleaf-scenes.json']);
  });

  test('write through a symlink, keeping the link', { skip: process.platform === 'win32' }, () => {
    const dir = folder();
    mkdirSync(join(dir, 'dotfiles'));
    const real = join(dir, 'dotfiles', 'scenes.json');
    const link = join(dir, 'nanoleaf-scenes.json');
    writeFileSync(real, '');
    symlinkSync(real, link);
    writeLibrary(link, libraryOf(sunset));
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.deepEqual(raw(real).scenes, [sunset]);
  });

  test('write the pairing file the same way', { skip: process.platform === 'win32' }, () => {
    const file = join(folder(), 'nanoleaf.json');
    writeFileAtomic(file, '{"host": "192.168.1.40", "token": "t"}\n');
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });
});

// ---------------------------------------------------------------------------
// Finding scenes
// ---------------------------------------------------------------------------

describe('finding scenes', () => {
  const flow = makeScene('Flow', RED_GREEN_BLUE, { ...still, drift: true }, NOW);
  const glow = makeScene('Glow', RED_GREEN_BLUE, still, NOW);
  const ocean = makeScene('Ocean sunset', RED_GREEN_BLUE, still, NOW);
  const library = libraryOf(sunset, flow, glow, ocean);

  test('find a scene by name, in any case', () => {
    assert.equal(findScene(library, 'Sunset'), sunset);
    assert.equal(findScene(library, 'SUNSET'), sunset);
    assert.equal(findScene(library, '  ocean SUNSET '), ocean);
  });

  test('suggest close names for a typo', () => {
    assert.throws(() => findScene(library, 'Sunst'), /^Error: No scene called “Sunst”\. Did you mean “Sunset”\?$/);
    assert.throws(() => findScene(library, 'sunset beach'), /Did you mean “Sunset”\?/);
    assert.throws(() => findScene(library, 'lfow'), /Did you mean “Flow”\?/);
    assert.throws(() => findScene(library, 'Slow'), /Did you mean “Flow” or “Glow”\?/);
  });

  test('say how to list scenes when nothing is close', () => {
    assert.throws(() => findScene(library, 'Aurora'), /No scene called “Aurora”\. List your scenes with: .* scenes/);
  });

  test('say how to keep one when there are none', () => {
    assert.throws(() => findScene(emptyLibrary(), 'Sunset'), /haven’t kept any scenes yet.*--keep/);
  });

  test('rank names that contain what you typed first', () => {
    assert.deepEqual(closeNames(['Sunset', 'Ocean sunset', 'Sunrise'], 'sunset'), ['Ocean sunset', 'Sunset']);
    assert.deepEqual(closeNames(['Sunset'], ''), []);
  });

  test('keep a scene, replacing one with the same name in any case', () => {
    const first = keepScene(emptyLibrary(), sunset);
    assert.equal(first.replaced, null);
    const renamed = makeScene('sunset', parseGradient('#000000 #ffffff'), still, NOW);
    const second = keepScene(first.library, renamed);
    assert.equal(second.replaced, sunset);
    assert.deepEqual(second.library.scenes, [renamed]);
  });

  test('forget a scene', () => {
    const { library: left, scene } = forgetScene(library, 'flow');
    assert.equal(scene, flow);
    assert.deepEqual(left.scenes.map((s) => s.name), ['Sunset', 'Glow', 'Ocean sunset']);
    assert.throws(() => forgetScene(left, 'flow'), /No scene called “flow”/);
  });
});

// ---------------------------------------------------------------------------
// Playing a kept scene on other lights
// ---------------------------------------------------------------------------

describe('replaying on other lights', () => {
  const skylight = (x, y = 90) => ({ x, y, o: 0, shapeType: 30 });
  const THREE = { positionData: [180, 360, 540].map((x, i) => ({ panelId: 10 + i, ...skylight(x) })) };
  const FIVE = { positionData: [180, 360, 540, 720, 900].map((x, i) => ({ panelId: 20 + i, ...skylight(x) })) };
  // Two rows of three, side by side across the line.
  const GRID = {
    positionData: [180, 360, 540].flatMap((x, i) => [{ panelId: 30 + i, ...skylight(x) }, { panelId: 40 + i, ...skylight(x, 270) }]),
  };
  // The strongest channel: each end panel averages a stretch of the
  // gradient, so with three panels the first is orange, mostly red.
  const mostly = (colour) => ['r', 'g', 'b'].reduce((a, b) => (colour[b] > colour[a] ? b : a));

  test('fit the same scene to three panels, five panels, or a grid', () => {
    const stops = sceneStops(sunset);
    for (const [layout, count] of [[THREE, 3], [FIVE, 5], [GRID, 6]]) {
      const { effect, still: colours } = sceneEffect(stops, layout, sunset);
      assert.equal(colours.length, count);
      assert.ok(effect.write.animData.startsWith(`${count} `));
      assert.equal(effect.write.command, 'display', 'a kept scene’s name doesn’t save it');
      assert.equal(mostly(colours[0].colour), 'r', JSON.stringify(colours[0]));
      assert.equal(mostly(colours.at(-1).colour), 'b', JSON.stringify(colours.at(-1)));
    }
    // Panels side by side in the grid share a colour.
    const { still: grid } = sceneEffect(stops, GRID, sunset);
    assert.deepEqual(grid[0].colour, grid[1].colour);
  });

  test('play a kept scene the way round it was kept', () => {
    const reversed = makeScene('Back', RED_GREEN_BLUE, { ...still, reverse: true }, NOW);
    const { still: colours } = sceneEffect(sceneStops(reversed), FIVE, reversed);
    assert.equal(mostly(colours[0].colour), 'b');
    assert.equal(mostly(colours.at(-1).colour), 'r');
  });

  test('play a flowing scene at its own speed, and save it under its name', () => {
    const flow = makeScene('Flow', RED_GREEN_BLUE, { drift: true, cycle: 96, reverse: false }, NOW);
    const { write } = sceneEffect(sceneStops(flow), FIVE, { ...flow, saveAs: flow.name }).effect;
    assert.equal(write.command, 'add');
    assert.equal(write.animName, 'Flow');
    assert.equal(write.animType, 'custom');
    const numbers = write.animData.split(' ').map(Number);
    assert.equal(numbers[0], 5);
    assert.equal(numbers[2], DRIFT_STEPS * 2, 'frames per panel');
    assert.equal(numbers[7], 20, 'tenths of a second per frame: 96s / 48 frames');
  });
});
