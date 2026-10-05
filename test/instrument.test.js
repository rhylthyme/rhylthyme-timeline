'use strict';
// Instrument steps (galago-tools via rhylthyme-galago) may omit `duration`;
// they end when the instrument replies. For timing the engine estimates one,
// in the offline order of rhylthyme_galago.fill_durations: a duration-like
// command param, else 60 s. Renders mark estimated lengths.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/index.js');

function program(...steps) {
  return { programId: 'p', name: 'P', tracks: [{ trackId: 'bench', name: 'Bench', steps }] };
}
const load = { stepId: 'load', name: 'Load', duration: { type: 'fixed', seconds: 3 }, startTrigger: { type: 'programStart' } };
const shake = {
  stepId: 'shake', name: 'Shake',
  instrument: { tool: 'shaker', command: 'start_shake', params: { speed: 1000, duration: 5 } },
  startTrigger: { type: 'afterStep', stepId: 'load' },
};

test('estimate from a duration-like param, else 60 s', () => {
  assert.deepEqual(T.instrumentEstimate(shake), { seconds: 5, source: 'params' });
  const wait = { instrument: { tool: 's', command: 'wait_for_shake_to_finish', params: { timeout: 90 } } };
  assert.deepEqual(T.instrumentEstimate(wait), { seconds: 90, source: 'params' });
  assert.deepEqual(T.instrumentEstimate({ instrument: { tool: 's', command: 'home' } }), { seconds: 60, source: 'default' });
});

test('authored durations and hand steps are not estimated', () => {
  assert.equal(T.instrumentEstimate(load), null);
  assert.equal(T.instrumentEstimate(Object.assign({}, shake, { duration: 7 })), null);
  assert.equal(T.stepDurationSeconds(Object.assign({}, shake, { duration: 7 })), 7);
});

test('timings use the estimate', () => {
  const t = T.computeStepTimings(program(load, shake));
  assert.deepEqual([t.shake.start, t.shake.end], [3, 8]);
});

test('estimated bars are marked and name their tool', () => {
  const svg = T.renderTimelineSvg(program(load, shake), { tooltips: true });
  assert.match(svg, /≈/);
  assert.match(svg, /estimated\), on shaker: start_shake/);
  assert.match(svg, /stroke-dasharray="2,2"/);
  const plain = T.renderTimelineSvg(program(load), { tooltips: true });
  assert.doesNotMatch(plain, /estimated/);
});

test('durations filled by rhylthyme plan still read as estimates', () => {
  const planned = Object.assign({}, shake, {
    duration: { type: 'fixed', seconds: 5 },
    metadata: { durationEstimate: { source: 'tool', seconds: 5 } },
  });
  assert.match(T.renderTimelineSvg(program(load, planned), { tooltips: true }), /estimated/);
});

test('until and start/end steps: the tooltip names the call waited on', () => {
  const log = {
    stepId: 'log', name: 'Log pH',
    instrument: { tool: 'ph', until: { command: 'log_series', params: { count: 10, interval_s: 3 } } },
    startTrigger: { type: 'afterStep', stepId: 'load' },
  };
  const heat = {
    stepId: 'heat', name: 'Heat', duration: { type: 'fixed', seconds: 60 },
    instrument: { tool: 'stirrer', start: [{ command: 'start_heating' }], end: [{ command: 'stop_heating' }] },
    startTrigger: { type: 'afterStep', stepId: 'log' },
  };
  const svg = T.renderTimelineSvg(program(load, log, heat), { tooltips: true });
  assert.match(svg, /on ph: log_series/);
  assert.match(svg, /on stirrer</);
  assert.doesNotMatch(svg, /undefined/);
});
