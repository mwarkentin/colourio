#!/usr/bin/env node
// Sends a colourio gradient to Nanoleaf lights, such as a Skylight, over
// your home network, and keeps a library of scenes on this computer. See
// README.md.
//
//   node nanoleaf/nanoleaf.mjs pair <ip>      once, after Connect to API in the app
//   node nanoleaf/nanoleaf.mjs send [colours] [--drift] [--cycle 60] [--reverse] [--save NAME]
//   node nanoleaf/nanoleaf.mjs scenes         list the scenes you've saved
//   node nanoleaf/nanoleaf.mjs play NAME|ID [--save]
//   node nanoleaf/nanoleaf.mjs sync           put every saved scene back on the lights
//   node nanoleaf/nanoleaf.mjs forget NAME|ID
//   node nanoleaf/nanoleaf.mjs layout         list the panels in gradient order

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { parseArgs } from 'node:util';

import {
  colourDepth, DRIFT_STEPS, getInfo, getLayout, gradientColours, pair, paint, panelSlices, parseGradient, sceneEffect,
  sendEffect, toHex, writeEffect,
} from './lib.mjs';
import {
  checkName, CYCLE_MAX, CYCLE_MIN, findScene, forgetScene, keepScene, makeScene, readLibrary, sceneStops, validCycle,
  writeFileAtomic, writeLibrary,
} from './library.mjs';

const CONFIG = process.env.COLOURIO_NANOLEAF_CONFIG || join(homedir(), '.config', 'colourio', 'nanoleaf.json');
const SCENES = process.env.COLOURIO_NANOLEAF_SCENES || join(dirname(CONFIG), 'nanoleaf-scenes.json');
const CLI = 'node nanoleaf/nanoleaf.mjs';

const HELP = `Send a colourio gradient to Nanoleaf lights.

  ${CLI} pair <ip>
      Pair with the lights. First, in the Nanoleaf app, open the Skylight's
      settings and tap Connect to API; then run this within 30 seconds.

  ${CLI} send [colours]
      Show a gradient. Click Copy CSS in colourio, then run this: with no
      colours given, it reads the clipboard. Also takes a colourio link to
      your own photo, or hex colours ("#ff8800 #2244aa").
        --drift          let the gradient flow along the panels and back
        --cycle <secs>   how long one flow takes (default 60)
        --reverse        start the gradient at the other end
        --save <name>    save it as a scene on the lights, and in your scene
                         library on this computer

  ${CLI} scenes
      List the scenes in your library, with their IDs.

  ${CLI} play <name or ID> [--save]
      Show a scene from your library, fitted to the panels the lights have
      now: play 1, or play pier at sunset. With --save, also save it as a
      scene on the lights.

  ${CLI} sync
      Save every scene in your library on the lights, for example after a
      reset. What's showing doesn't change.

  ${CLI} forget <name or ID>
      Remove a scene from your library. A copy saved on the lights stays.

  ${CLI} layout
      List the panels in the order the gradient runs.

Your scene library is ${tilde(SCENES)}.
`;

// Options each command takes. pair, layout and send take what they always
// have; the newer commands refuse options that don't apply to them.
const LEGACY = {
  drift: { type: 'boolean' },
  cycle: { type: 'string' },
  reverse: { type: 'boolean' },
  save: { type: 'string' },
};
const OPTIONS = {
  pair: LEGACY,
  layout: LEGACY,
  send: LEGACY,
  scenes: {},
  play: { save: { type: 'boolean' } },
  sync: {},
  forget: {},
};

function tilde(path) {
  const home = homedir();
  return path.startsWith(home + sep) ? '~' + path.slice(home.length) : path;
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

const saveConfig = (config) => writeFileAtomic(CONFIG, JSON.stringify(config, null, 2) + '\n');

function readClipboard() {
  const readers = [['pbpaste', []], ['wl-paste', ['--no-newline']], ['xclip', ['-o', '-selection', 'clipboard']],
    ['powershell', ['-NoProfile', '-Command', 'Get-Clipboard']]];
  for (const [command, args] of readers) {
    try {
      return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      // Try the next one.
    }
  }
  throw new Error(`Couldn’t read the clipboard. Pass the colours instead: ${CLI} send "<CSS from colourio>"`);
}

// Coloured blocks, in terminals that show 256 or more colours.
const DEPTH = colourDepth();
const swatch = (c) => [paint(c, 6, DEPTH), toHex(c)].filter(Boolean).join(' ');
const strip = (colours, width) => (DEPTH >= 8 ? colours.map((c) => paint(c, width, DEPTH)).join('') : colours.map(toHex).join(' '));
const how = ({ drift, cycle }) => (drift ? `flowing, ${cycle}s a cycle` : 'still');
// IDs lined up on the right, as wide as the longest.
const idColumn = (scenes) => {
  const width = String(Math.max(...scenes.map((s) => s.id))).length;
  return (scene) => String(scene.id).padStart(width);
};

function paired() {
  const config = readConfig();
  if (!config.host || !config.token) throw new Error(`Not paired yet. Run: ${CLI} pair <ip>`);
  return config;
}

// What send and play print once the lights have it.
function showColours(stops, still, { drift }) {
  if (drift) {
    console.log(`Each panel flows through these ${DRIFT_STEPS} colours and back:`);
    console.log(`  ${strip(gradientColours(stops), 2)}`);
  } else {
    still.forEach((p, i) => console.log(`  ${i + 1}. ${swatch(p.colour)}`));
  }
}

// Adds a scene to the library, reading it afresh in case it changed.
function keep(scene) {
  const { library, scene: kept, replaced } = keepScene(readLibrary(SCENES), scene);
  writeLibrary(SCENES, library);
  const what = replaced
    ? `Replaced “${kept.name}” in your scene library; it’s still scene ${kept.id}.`
    : `Kept “${kept.name}” in your scene library as scene ${kept.id}.`;
  console.log(`${what} Show it again any time with: ${CLI} play ${kept.id}`);
}

function options(command, argv) {
  try {
    return parseArgs({ args: argv, allowPositionals: true, options: { ...OPTIONS[command], help: { type: 'boolean', short: 'h' } } });
  } catch (error) {
    const option = error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && /'([^']+)'/.exec(error.message)?.[1];
    if (option) throw new Error(`“${command}” doesn’t take ${option}. Run with --help to see what each command takes.`);
    throw error;
  }
}

// The first argument that isn't an option or an option's value, so options
// can come before the command, as they always could.
function findCommand(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') return argv[i + 1];
    if (!argv[i].startsWith('-')) return argv[i];
    if (['--cycle', '--save'].includes(argv[i])) i++;
  }
  return undefined;
}

async function main(argv) {
  const command = findCommand(argv);
  if (!command) {
    process.stdout.write(HELP);
    return;
  }
  if (!OPTIONS[command]) throw new Error(`Unknown command “${command}”. Run with --help to see the commands.`);
  const { values, positionals } = options(command, argv);
  const rest = positionals.slice(1);
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  if (command === 'pair') {
    const host = rest[0];
    if (!host) throw new Error(`Which lights? Run: ${CLI} pair <ip>`);
    const token = await pair(host);
    const info = await getInfo(host, token);
    saveConfig({ host, token });
    console.log(`Paired with ${info.name || 'the lights'} (${info.model || 'unknown model'}). Saved to ${CONFIG}.`);
    return;
  }

  if (command === 'layout') {
    const { host, token } = paired();
    const slices = panelSlices(await getLayout(host, token), { reverse: values.reverse });
    console.log(`${slices.length} panels, in gradient order:`);
    slices.forEach((s, i) => console.log(`  ${i + 1}. panel ${s.id} at (${s.x}, ${s.y}), gradient ${Math.round(s.from * 100)}–${Math.round(s.to * 100)}%`));
    return;
  }

  if (command === 'send') {
    const settings = { drift: Boolean(values.drift), cycle: Number(values.cycle ?? 60), reverse: Boolean(values.reverse) };
    if (!validCycle(settings.cycle)) throw new Error(`--cycle takes seconds, from ${CYCLE_MIN} to ${CYCLE_MAX}.`);
    const name = values.save === undefined ? undefined : checkName(values.save);
    // Check the library can be read before the lights change.
    if (name) readLibrary(SCENES);
    const stops = parseGradient(rest.length ? rest.join(' ') : readClipboard());
    const scene = name && makeScene(name, stops, settings);
    const { host, token } = paired();
    const { effect, still } = sceneEffect(stops, await getLayout(host, token), { ...settings, saveAs: name });
    await sendEffect(host, token, effect);
    showColours(stops, still, settings);
    console.log(name ? `Saved as “${name}” and showing (${how(settings)}).` : `Showing (${how(settings)}).`);
    if (scene) keep(scene);
    return;
  }

  if (command === 'scenes') {
    const { scenes } = readLibrary(SCENES);
    if (!scenes.length) {
      console.log(`No scenes in your library yet. Save one with: ${CLI} send --save NAME`);
      return;
    }
    console.log(`${scenes.length} ${scenes.length === 1 ? 'scene' : 'scenes'} in ${tilde(SCENES)}:`);
    const width = Math.max(...scenes.map((s) => [...s.name].length));
    const id = idColumn(scenes);
    for (const scene of scenes) {
      const stops = sceneStops(scene);
      const preview = DEPTH >= 8 ? strip(gradientColours(stops), 1) : gradientColours(stops, 5).map(toHex).join(' ');
      const details = how(scene) + (scene.reverse ? ', reversed' : '');
      const saved = scene.savedAt ? `  ${new Date(scene.savedAt).toISOString().slice(0, 10)}` : '';
      const pad = ' '.repeat(width - [...scene.name].length);
      console.log(`  ${id(scene)}  ${scene.name}${pad}  ${preview}  ${details}${saved}`);
    }
    console.log(`Show one with: ${CLI} play ID (or its name)`);
    return;
  }

  if (command === 'play') {
    if (!rest.length) throw new Error(`Which scene? Run: ${CLI} play ID or NAME (list them with: ${CLI} scenes)`);
    const scene = findScene(readLibrary(SCENES), rest.join(' '));
    const { host, token } = paired();
    const stops = sceneStops(scene);
    const save = values.save ? scene.name : undefined;
    const { effect, still } = sceneEffect(stops, await getLayout(host, token), { ...scene, saveAs: save });
    await sendEffect(host, token, effect);
    showColours(stops, still, scene);
    console.log(save ? `Saved “${save}” on the lights and showing it (${how(scene)}).` : `Showing “${scene.name}” (${how(scene)}).`);
    return;
  }

  if (command === 'sync') {
    const { scenes } = readLibrary(SCENES);
    if (!scenes.length) {
      console.log(`No scenes in your library yet, so there’s nothing to put back. Save one with: ${CLI} send --save NAME`);
      return;
    }
    const { host, token } = paired();
    const layout = await getLayout(host, token);
    const id = idColumn(scenes);
    let done = 0;
    for (const scene of scenes) {
      try {
        await writeEffect(host, token, sceneEffect(sceneStops(scene), layout, { ...scene, saveAs: scene.name }).effect);
      } catch (error) {
        if (done) error.message = `Saved ${done} of ${scenes.length} scenes, then stopped. ${error.message}`;
        throw error;
      }
      done++;
      console.log(`  ${id(scene)}  ${scene.name}`);
    }
    const count = scenes.length === 1 ? '1 scene' : `${scenes.length} scenes`;
    console.log(`Saved ${count} on the lights, replacing any with the same names. What’s showing hasn’t changed.`);
    return;
  }

  if (command === 'forget') {
    if (!rest.length) throw new Error(`Which scene? Run: ${CLI} forget ID or NAME`);
    const { library, scene } = forgetScene(readLibrary(SCENES), rest.join(' '));
    writeLibrary(SCENES, library);
    console.log(`Forgot scene ${scene.id}, “${scene.name}”. A copy saved on the lights stays there until you delete it in the Nanoleaf app.`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
