// Tests for machine.js, run with:
//   node --test "test/*.test.mjs"
// machine.js is a plain browser script, so it runs here in a sandbox with
// just enough of window and document.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, test } from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../machine.js', import.meta.url), 'utf8');

let page;

beforeEach(() => {
  const warnings = [];
  const reported = [];
  const window = {
    colourioTelemetry: { warn: (message, attributes) => reported.push({ message, attributes }) },
  };
  const document = { documentElement: { dataset: {} } };
  const console = { warn: (message) => warnings.push(message) };
  vm.runInNewContext(SOURCE, { window, document, console });
  page = { window, dataset: document.documentElement.dataset, warnings, reported };
});

const door = (enter) => page.window.colourioMachine({
  name: 'door',
  initial: 'closed',
  states: {
    closed: { OPEN: 'open', LOCK: 'locked' },
    open: { CLOSE: 'closed', OPEN: 'open' },
    locked: { UNLOCK: 'closed' },
  },
  enter,
});

describe('colourioMachine', () => {
  test('starts in its initial state, shown on <html>', () => {
    const machine = door();
    assert.equal(machine.state, 'closed');
    assert.equal(page.dataset.door, 'closed');
    assert.equal(page.window.colourioMachines.door, machine);
  });

  test('follows the transitions its table allows', () => {
    const machine = door();
    assert.equal(machine.send('OPEN'), true);
    assert.equal(machine.state, 'open');
    assert.equal(page.dataset.door, 'open');
    assert.equal(machine.is('open'), true);
    assert.equal(machine.is('closed', 'open'), true);
    assert.equal(machine.is('closed', 'locked'), false);
    assert.equal(machine.can('CLOSE'), true);
    assert.equal(machine.can('LOCK'), false);
  });

  test('calls enter after every transition, self-transitions included', () => {
    const calls = [];
    const machine = door((...args) => calls.push(args));
    machine.send('OPEN', { by: 'hand' });
    machine.send('OPEN');
    assert.deepEqual(calls, [
      ['open', { by: 'hand' }, 'closed', 'OPEN'],
      ['open', undefined, 'open', 'OPEN'],
    ]);
  });

  test('ignores, logs and reports an event the state does not allow', () => {
    const calls = [];
    const machine = door(() => calls.push(1));
    machine.send('LOCK');
    assert.equal(machine.send('OPEN'), false);
    assert.equal(machine.state, 'locked');
    assert.deepEqual(calls, [1]);
    assert.deepEqual(page.warnings, ['[colourio] door: OPEN ignored in state locked']);
    // The attributes object comes from the sandbox, so compare it as data.
    assert.deepEqual(JSON.parse(JSON.stringify(page.reported)), [{
      message: 'State machine event ignored',
      attributes: { machine: 'door', state: 'locked', event: 'OPEN' },
    }]);
  });

  test('does not mistake built-in object keys for events', () => {
    const machine = door();
    assert.equal(machine.send('constructor'), false);
    assert.equal(machine.send('toString'), false);
    assert.equal(machine.state, 'closed');
  });

  test('a guard delivers only until the machine moves on, silently', () => {
    const machine = door();
    machine.send('OPEN');
    const stale = machine.guard();
    machine.send('OPEN'); // a newer run of the same state
    const fresh = machine.guard();
    assert.equal(stale.active(), false);
    assert.equal(stale.send('CLOSE'), false);
    assert.equal(machine.state, 'open');
    assert.equal(fresh.active(), true);
    assert.equal(fresh.send('CLOSE'), true);
    assert.equal(fresh.active(), false);
    assert.equal(machine.state, 'closed');
    assert.deepEqual(page.warnings, []);
  });

  test('keeps the last 20 transitions', () => {
    const machine = door();
    for (let i = 0; i < 15; i++) {
      machine.send('OPEN');
      machine.send('CLOSE');
    }
    assert.equal(machine.history.length, 20);
    const { from, event, to } = machine.history.at(-1);
    assert.deepEqual({ from, event, to }, { from: 'open', event: 'CLOSE', to: 'closed' });
  });

  test('rejects a table with a typo when it is made', () => {
    const make = (initial, states) => () => page.window.colourioMachine({ name: 'bad', initial, states });
    assert.throws(make('shut', { closed: {} }), /bad: unknown initial state shut/);
    assert.throws(make('closed', { closed: { OPEN: 'opne' } }), /bad: closed --OPEN--> unknown state opne/);
  });
});
