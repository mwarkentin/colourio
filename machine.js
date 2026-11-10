// A small state machine for colourio's flows that span several steps or wait
// on async work: loading an image, the source panel's mode, and the Share,
// Print and Wallpapers dialogs. See README → "State machines".
//
//   var print = colourioMachine({
//       name: 'print',
//       initial: 'closed',
//       states: {
//           closed: { OPEN: 'choosing' },
//           choosing: { CREATE: 'rendering', CLOSE: 'closed' },
//           ...
//       },
//       // Runs after every transition, self-transitions included: update
//       // the page for `state` here.
//       enter: function (state, data, from, event) { ... }
//   });
//   print.send('OPEN');     // true if the current state allows OPEN
//   print.is('rendering');  // also takes several states
//
// Async work takes a guard when it starts and reports through it, so a
// result that arrives after the user has moved on (closed the dialog,
// picked another product, opened another image) is dropped:
//
//   var guard = print.guard();
//   upload().then(function (url) { guard.send('UPLOADED', { url: url }); });
//
// Each machine's state is mirrored on <html> as data-<name>, for CSS,
// devtools and tests (html[data-print="uploading"]), and the machines are
// listed in window.colourioMachines, each with its last few transitions in
// `history`. An event the current state doesn't allow is a bug: it's
// ignored, logged to the console and reported to telemetry.
(function () {
    'use strict';

    var HISTORY_SIZE = 20;
    var has = function (object, key) { return Object.prototype.hasOwnProperty.call(object, key); };
    var machines = window.colourioMachines = window.colourioMachines || {};

    window.colourioMachine = function (config) {
        var name = config.name;
        var states = config.states;
        var root = document.documentElement;
        // Counts transitions, so a guard can tell whether any happened since.
        var step = 0;

        // Typos in the table fail on load, not at the moment they're needed.
        if (!has(states, config.initial)) { throw new Error(name + ': unknown initial state ' + config.initial); }
        Object.keys(states).forEach(function (state) {
            Object.keys(states[state]).forEach(function (event) {
                if (!has(states, states[state][event])) {
                    throw new Error(name + ': ' + state + ' --' + event + '--> unknown state ' + states[state][event]);
                }
            });
        });

        var machine = {
            name: name,
            state: config.initial,
            states: states,
            history: [],

            is: function () {
                return Array.prototype.indexOf.call(arguments, machine.state) !== -1;
            },

            can: function (event) {
                return has(states[machine.state], event);
            },

            send: function (event, data) {
                var from = machine.state;
                if (!machine.can(event)) {
                    var T = window.colourioTelemetry;
                    console.warn('[colourio] ' + name + ': ' + event + ' ignored in state ' + from);
                    if (T) { T.warn('State machine event ignored', { machine: name, state: from, event: event }); }
                    return false;
                }
                var to = states[from][event];
                machine.state = to;
                step++;
                machine.history.push({ from: from, event: event, to: to, at: Date.now() });
                if (machine.history.length > HISTORY_SIZE) { machine.history.shift(); }
                root.dataset[name] = to;
                if (config.enter) { config.enter(to, data, from, event); }
                return true;
            },

            // For async work: `active()` is true until the machine next
            // transitions, and `send` delivers only while it is. Unlike
            // send() on the machine, a dropped event is expected, so it's
            // silent.
            guard: function () {
                var at = step;
                var active = function () { return step === at; };
                return {
                    active: active,
                    send: function (event, data) { return active() && machine.send(event, data); }
                };
            }
        };

        root.dataset[name] = machine.state;
        machines[name] = machine;
        return machine;
    };
})();
