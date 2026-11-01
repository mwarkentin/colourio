#!/usr/bin/env node
// Sends a colourio gradient to Nanoleaf lights, such as a Skylight, over
// your home network. See README.md.
//
//   node nanoleaf/nanoleaf.mjs pair <ip>      once, after Connect to API in the app
//   node nanoleaf/nanoleaf.mjs send [colours] [--drift] [--cycle 60] [--reverse] [--save NAME]
//   node nanoleaf/nanoleaf.mjs layout         list the panels in gradient order

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  buildEffect, driftFrames, getInfo, getLayout, pair, panelSlices, parseGradient, sendEffect, stillColours, toHex,
} from './lib.mjs';

const CONFIG = process.env.COLOURIO_NANOLEAF_CONFIG || join(homedir(), '.config', 'colourio', 'nanoleaf.json');

const HELP = `Send a colourio gradient to Nanoleaf lights.

  node nanoleaf/nanoleaf.mjs pair <ip>
      Pair with the lights. First, in the Nanoleaf app, open the Skylight's
      settings and tap Connect to API; then run this within 30 seconds.

  node nanoleaf/nanoleaf.mjs send [colours]
      Show a gradient. Click Copy CSS in colourio, then run this: with no
      colours given, it reads the clipboard. Also takes a colourio link to
      your own photo, or hex colours ("#ff8800 #2244aa").
        --drift          let the gradient flow along the panels and back
        --cycle <secs>   how long one flow takes (default 60)
        --reverse        start the gradient at the other end
        --save <name>    also save it as a scene on the lights

  node nanoleaf/nanoleaf.mjs layout
      List the panels in the order the gradient runs.
`;

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(config) {
  mkdirSync(dirname(CONFIG), { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n');
  chmodSync(CONFIG, 0o600);
}

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
  throw new Error('Couldn’t read the clipboard. Pass the colours instead: node nanoleaf/nanoleaf.mjs send "<CSS from colourio>"');
}

// A coloured block per panel, in terminals that support 24-bit colour.
const swatch = (c) => `\x1b[48;2;${c.r};${c.g};${c.b}m      \x1b[0m ${toHex(c)}`;

function paired() {
  const config = readConfig();
  if (!config.host || !config.token) throw new Error('Not paired yet. Run: node nanoleaf/nanoleaf.mjs pair <ip>');
  return config;
}

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      drift: { type: 'boolean', default: false },
      cycle: { type: 'string', default: '60' },
      reverse: { type: 'boolean', default: false },
      save: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, ...rest] = positionals;

  if (values.help || !command) {
    process.stdout.write(HELP);
    return;
  }

  if (command === 'pair') {
    const host = rest[0];
    if (!host) throw new Error('Which lights? Run: node nanoleaf/nanoleaf.mjs pair <ip>');
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
    const cycle = Number(values.cycle);
    if (!(cycle >= 5 && cycle <= 3600)) throw new Error('--cycle takes seconds, from 5 to 3600.');
    const stops = parseGradient(rest.length ? rest.join(' ') : readClipboard());
    const { host, token } = paired();
    const slices = panelSlices(await getLayout(host, token), { reverse: values.reverse });
    const still = stillColours(stops, slices);
    const panels = values.drift ? driftFrames(stops, slices) : still;
    await sendEffect(host, token, buildEffect(panels, { drift: values.drift, cycle, name: values.save }));
    still.forEach((p, i) => console.log(`  ${i + 1}. ${swatch(p.colour)}`));
    const how = values.drift ? `flowing, ${cycle}s a cycle` : 'still';
    console.log(values.save ? `Saved as “${values.save}” and showing (${how}).` : `Showing (${how}).`);
    return;
  }

  throw new Error(`Unknown command “${command}”. Run with --help to see the commands.`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
