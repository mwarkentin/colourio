// The scene library: gradients you keep on this computer, so they outlive
// the lights' own list of scenes (a factory reset, a firmware update, a
// scene deleted in the app) and play on any panels. A scene stores the
// gradient and the options it was sent with, not panel colours; the effect
// is rebuilt for whatever panels are there when it's played.
//
// The library is a JSON file of its own, apart from the token in
// nanoleaf.json, so it can be backed up, copied or shared on its own:
//
//   {
//     "version": 1,
//     "scenes": [
//       { "name": "Sunset", "drift": false, "cycle": 60, "reverse": false,
//         "savedAt": "2026-11-23T14:00:00.000Z",
//         "stops": ["#ff5e3a 0%", "#ff9f40 50%", "#3a1c71 100%"] }
//     ]
//   }

import { randomBytes } from 'node:crypto';
import {
  closeSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { toHex } from './lib.mjs';

export const VERSION = 1;
// Nanoleaf doesn't document a limit on scene names, so keep them short
// enough to fit anywhere the app shows them.
export const NAME_LIMIT = 40;
export const CYCLE_MIN = 5;
export const CYCLE_MAX = 3600;
const DEFAULTS = { drift: false, cycle: 60, reverse: false };

const CLI = 'node nanoleaf/nanoleaf.mjs';

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

// A scene name, tidied: the same name always matches, however it was typed.
export function checkName(value) {
  const name = String(value ?? '').normalize('NFC').trim();
  if (!name) throw new Error('Scenes need a name, like --save Sunset.');
  if (/\p{Cc}/u.test(name)) throw new Error('Scene names can’t contain line breaks, tabs or other control characters.');
  const length = [...name].length;
  if (length > NAME_LIMIT) throw new Error(`Scene names can be up to ${NAME_LIMIT} characters; “${name}” has ${length}.`);
  if (name.startsWith('-')) throw new Error('Scene names can’t start with “-”.');
  // The lights report what's showing as *Solid*, *Dynamic* and the like.
  if (/^\*.*\*$/.test(name)) throw new Error(`Names like “${name}” are used by the lights themselves, so pick another.`);
  return name;
}

export const validCycle = (cycle) => typeof cycle === 'number' && cycle >= CYCLE_MIN && cycle <= CYCLE_MAX;

// "#rrggbb 12.5%", like a stop in colourio's Copy CSS.
const STOP = /^#([0-9a-f]{6}) (-?\d+(?:\.\d+)?)%$/i;
const stopText = (stop) => `${toHex(stop)} ${+(stop.at * 100).toFixed(4)}%`;

function parseStop(text) {
  const match = typeof text === 'string' && STOP.exec(text);
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return { r: value >> 16, g: (value >> 8) & 255, b: value & 255, at: Number(match[2]) / 100 };
}

// The colour stops [{r, g, b, at}] of a kept scene, ready for the effect.
export const sceneStops = (scene) => scene.stops.map(parseStop).sort((a, b) => a.at - b.at);

// A scene to keep, from the stops parseGradient gives and send's options.
export function makeScene(name, stops, { drift, cycle, reverse } = {}, now = new Date()) {
  return checkScene({
    name, drift: Boolean(drift), cycle: cycle ?? DEFAULTS.cycle, reverse: Boolean(reverse), savedAt: now.toISOString(),
    stops: stops.map(stopText),
  });
}

// Checks a scene as read from the file, filling in options it leaves out.
// Fields this version doesn't know are kept as they are.
function checkScene(raw, where = 'The scene') {
  const bad = (what) => new Error(`${where} ${what}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('isn’t a scene.');
  let name;
  try {
    name = checkName(raw.name);
  } catch (error) {
    throw bad(`has a name that won’t work. ${error.message}`);
  }
  // Name first, so the file reads well.
  const scene = { name, ...DEFAULTS, ...raw };
  scene.name = name;
  if (typeof scene.drift !== 'boolean') throw bad('has a “drift” that isn’t true or false.');
  if (typeof scene.reverse !== 'boolean') throw bad('has a “reverse” that isn’t true or false.');
  if (!validCycle(scene.cycle)) throw bad(`has a “cycle” that isn’t ${CYCLE_MIN} to ${CYCLE_MAX} seconds.`);
  if (scene.savedAt !== undefined && Number.isNaN(Date.parse(scene.savedAt))) throw bad('has a “savedAt” that isn’t a date.');
  if (!Array.isArray(scene.stops) || !scene.stops.length) throw bad('has no colours.');
  const broken = scene.stops.find((stop) => !parseStop(stop));
  if (broken !== undefined) throw bad(`has a colour stop that isn’t like "#ff8800 50%": ${JSON.stringify(broken)}.`);
  return scene;
}

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

const key = (name) => String(name).normalize('NFC').trim().toLowerCase();
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.name < b.name ? -1 : 1);

export const emptyLibrary = () => ({ version: VERSION, scenes: [] });

// A missing or empty file is an empty library. Anything else that isn't a
// library is an error: the file is left alone rather than overwritten.
export function readLibrary(file) {
  let text;
  try {
    text = readFileSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return emptyLibrary();
    throw new Error(`Couldn’t read your scene library at ${file}: ${error.message}`);
  }
  // Allow for editors that save with a byte order mark, and for PowerShell,
  // which saves as UTF-16.
  text = text[0] === 0xff && text[1] === 0xfe ? text.toString('utf16le') : text.toString('utf8');
  text = text.replace(/^﻿/, '');
  if (!text.trim()) return emptyLibrary();

  const problem = (what) => new Error(
    `Your scene library at ${file} ${what} Nothing was changed: fix the file, or move it aside to start a new library.`,
  );
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw problem(`isn’t valid JSON (${error.message}).`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw problem('isn’t a scene library.');
  if (Number.isInteger(data.version) && data.version > VERSION) {
    throw new Error(`Your scene library at ${file} was written by a newer version of this script. Update colourio, then try again.`);
  }
  if (data.version !== VERSION) throw problem(`has no “version”: ${VERSION}, so it isn’t a scene library.`);
  if (!Array.isArray(data.scenes)) throw problem('has no list of “scenes”.');

  const seen = new Map();
  const scenes = data.scenes.map((raw, i) => {
    const label = typeof raw?.name === 'string' ? ` (“${raw.name}”)` : '';
    let scene;
    try {
      scene = checkScene(raw, `Scene ${i + 1}${label}`);
    } catch (error) {
      throw problem(`has a problem. ${error.message}`);
    }
    if (seen.has(key(scene.name))) throw problem(`has two scenes called “${scene.name}”.`);
    seen.set(key(scene.name), scene);
    return scene;
  });
  return { ...data, scenes };
}

export function writeLibrary(file, library) {
  const scenes = [...library.scenes].sort(byName);
  writeFileAtomic(file, JSON.stringify({ ...library, version: VERSION, scenes }, null, 2) + '\n');
}

// Adds a scene, replacing one with the same name in any case.
export function keepScene(library, scene) {
  const replaced = library.scenes.find((s) => key(s.name) === key(scene.name)) || null;
  const scenes = library.scenes.filter((s) => s !== replaced).concat(scene);
  return { library: { ...library, scenes }, replaced };
}

export function findScene(library, query) {
  const wanted = key(query);
  const scene = library.scenes.find((s) => s.name === query) || library.scenes.find((s) => key(s.name) === wanted);
  if (scene) return scene;

  const asked = `No scene called “${String(query).trim()}”`;
  if (!library.scenes.length) throw new Error(`${asked}: you haven’t saved any scenes yet. Save one with: ${CLI} send --save NAME`);
  const close = closeNames(library.scenes.map((s) => s.name), query);
  if (!close.length) throw new Error(`${asked}. List your scenes with: ${CLI} scenes`);
  const quoted = close.map((n) => `“${n}”`);
  const options = quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}` : quoted[0];
  throw new Error(`${asked}. Did you mean ${options}?`);
}

export function forgetScene(library, query) {
  const scene = findScene(library, query);
  return { library: { ...library, scenes: library.scenes.filter((s) => s !== scene) }, scene };
}

// Up to `max` names that look like a mistyped `query`: those containing it
// (or contained in it), then those a few keystrokes away.
export function closeNames(names, query, max = 3) {
  const q = key(query);
  if (!q) return [];
  const limit = Math.max(1, Math.round(q.length / 3));
  return names
    .map((name) => {
      const n = key(name);
      return { name, d: n.includes(q) || q.includes(n) ? 0 : typoDistance(n, q) };
    })
    .filter(({ d }) => d <= limit)
    .sort((a, b) => a.d - b.d || byName(a, b))
    .slice(0, max)
    .map(({ name }) => name);
}

// Edits (insert, delete, change, or swap two neighbours) between a and b.
function typoDistance(a, b) {
  const s = [...a];
  const t = [...b];
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j++) d[0][j] = j;
  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[s.length][t.length];
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

// Writes a file readable only by you, so that a crash or a full disk midway
// leaves the old file whole: the text goes to a temporary file beside it,
// which then replaces it in one step. A symlinked file stays a symlink.
export function writeFileAtomic(file, text, mode = 0o600) {
  let target = file;
  try {
    target = realpathSync(file);
  } catch {
    // Not there yet.
  }
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.${basename(target)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  let fd;
  try {
    fd = openSync(temp, 'wx', mode);
    writeFileSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, target);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, { force: true });
    throw error;
  }
  // Make the rename itself survive a power cut, where the system allows.
  try {
    const dirFd = openSync(dir, 'r');
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    // Windows can't open folders this way; the rename has happened anyway.
  }
}
