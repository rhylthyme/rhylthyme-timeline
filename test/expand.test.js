'use strict';
// expandReplicates with schema 0.3.0-alpha `instances` triggers
// ("each" / "all" / "any"). Mirrors the Python cases in
// rhylthyme-cli-runner/tests/test_expand_replicates.py; both expanders must
// produce the same expanded program.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../src/index.js');

function fixed(id, seconds, trigger, extra) {
  return Object.assign({
    stepId: id, name: id.toUpperCase(), task: 'prep',
    duration: { type: 'fixed', seconds }, startTrigger: trigger,
  }, extra || {});
}
function track(trackId, steps, extra) {
  return Object.assign({ trackId, name: trackId.toUpperCase(), steps }, extra || {});
}
function program(tracks) {
  return { schemaVersion: '0.3.0-alpha', programId: 'p', name: 'P', tracks, resourceConstraints: [{ task: 'prep', maxConcurrent: 9 }] };
}
function stepsById(e) { const m = {}; e.tracks.forEach((t) => t.steps.forEach((s) => { m[s.stepId] = s; })); return m; }
function trackOf(e) { const m = {}; e.tracks.forEach((t) => t.steps.forEach((s) => { m[s.stepId] = t.trackId; })); return m; }
function tracksById(e) { const m = {}; e.tracks.forEach((t) => { m[t.trackId] = t; }); return m; }
function noInstancesLeft(e) { return !JSON.stringify(e).includes('"instances"'); }

for (const mode of ['parallel', 'stagger', 'serial']) {
  test(`"each" pairs instance i with instance i (${mode})`, () => {
    const rep = mode === 'stagger' ? { count: 3, mode, delay: 60 } : { count: 3, mode };
    const e = R.expandReplicates(program([track('t', [
      fixed('x', 100, { type: 'programStart' }, { replicates: rep }),
      fixed('s', 50, { type: 'afterStep', stepId: 'x', instances: 'each' }),
    ])]));
    const by = stepsById(e);
    assert.equal(by.s, undefined); assert.equal(by.x, undefined);
    for (const i of [1, 2, 3]) {
      assert.deepEqual(by[`s-r${i}`].startTrigger, { type: 'afterStep', stepId: `x-r${i}` });
      assert.equal(by[`s-r${i}`].instanceOf, 's'); assert.equal(by[`s-r${i}`].instanceIndex, i);
      assert.equal(by[`s-r${i}`].name, `S (${i} of 3)`);
      assert.equal(by[`x-r${i}`].instanceOf, 'x'); assert.equal(by[`x-r${i}`].instanceIndex, i);
    }
    assert.ok(noInstancesLeft(e));
  });
}

test('"each" after a parallel replicate lands in the instance sub-track', () => {
  const e = R.expandReplicates(program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'parallel' } }),
    fixed('s', 50, { type: 'afterStep', stepId: 'x', instances: 'each' }),
  ])]));
  const where = trackOf(e), subs = tracksById(e);
  assert.equal(where['x-r1'], 't--x-r1'); assert.equal(where['s-r1'], 't--x-r1');
  assert.equal(where['x-r2'], 't--x-r2'); assert.equal(where['s-r2'], 't--x-r2');
  assert.equal(subs['t--x-r1'].parentTrackId, 't');
  assert.deepEqual(subs['t--x-r1'].steps.map((s) => s.stepId), ['x-r1', 's-r1']);
  assert.equal(subs.t, undefined, 'emptied parent track is dropped');
});

test('"each" after a serial replicate keeps the chain in-track and creates per-instance sub-tracks', () => {
  const e = R.expandReplicates(program([track('t', [
    fixed('m', 10, { type: 'programStart' }),
    fixed('x', 100, { type: 'afterStep', stepId: 'm' }, { replicates: { count: 3, mode: 'serial' } }),
    fixed('s', 50, { type: 'afterStep', stepId: 'x', instances: 'each' }),
  ])]));
  const subs = tracksById(e);
  assert.deepEqual(subs.t.steps.map((s) => s.stepId), ['m', 'x-r1', 'x-r2', 'x-r3']);
  assert.deepEqual(subs.t.steps[2].startTrigger, { type: 'afterStep', stepId: 'x-r1' });
  assert.deepEqual(e.tracks.map((t) => t.trackId), ['t', 't--x-r1', 't--x-r2', 't--x-r3']);
  for (const i of [1, 2, 3]) {
    assert.equal(subs[`t--x-r${i}`].parentTrackId, 't');
    assert.equal(subs[`t--x-r${i}`].name, `T - X (${i} of 3)`);
    assert.deepEqual(subs[`t--x-r${i}`].steps.map((s) => s.stepId), [`s-r${i}`]);
  }
  assert.ok(noInstancesLeft(e));
});

test('"each" preserves offset, buffer and event', () => {
  const e = R.expandReplicates(program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'parallel' } }),
    fixed('a', 5, { type: 'afterStep', stepId: 'x', instances: 'each', offsetSeconds: '2m', event: 'start' }),
    fixed('b', 5, { type: 'afterStepWithBuffer', stepId: 'x', instances: 'each', bufferSeconds: 30 }),
  ])]));
  const by = stepsById(e);
  assert.deepEqual(by['a-r2'].startTrigger, { type: 'afterStep', stepId: 'x-r2', offsetSeconds: '2m', event: 'start' });
  assert.deepEqual(by['b-r1'].startTrigger, { type: 'afterStepWithBuffer', stepId: 'x-r1', bufferSeconds: 30 });
});

test('"each" is transitive; a plain downstream reference joins all instances', () => {
  const e = R.expandReplicates(program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'parallel' } }),
    fixed('s', 50, { type: 'afterStep', stepId: 'x', instances: 'each' }),
    fixed('u', 20, { type: 'afterStep', stepId: 's', instances: 'each' }),
    fixed('z', 20, { type: 'afterStep', stepId: 'u' }),
  ])]));
  const by = stepsById(e), where = trackOf(e);
  for (const i of [1, 2]) {
    assert.deepEqual(by[`u-r${i}`].startTrigger, { type: 'afterStep', stepId: `s-r${i}` });
    assert.equal(by[`u-r${i}`].instanceOf, 'u');
    assert.equal(where[`u-r${i}`], `t--x-r${i}`);
  }
  assert.deepEqual(by.z.startTrigger, { logic: 'all', triggers: [{ type: 'afterStep', stepId: 'u-r1' }, { type: 'afterStep', stepId: 'u-r2' }] });
  assert.equal(where.z, 't');
});

test('"each" across tracks places the successor in the upstream instance sub-track', () => {
  const e = R.expandReplicates(program([
    track('b', [fixed('s', 50, { type: 'afterStep', stepId: 'x', instances: 'each' })]),
    track('a', [fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'parallel' } })]),
  ]));
  const where = trackOf(e);
  assert.equal(where['s-r1'], 'a--x-r1'); assert.equal(where['s-r2'], 'a--x-r2');
  assert.deepEqual(e.tracks.map((t) => t.trackId), ['a--x-r1', 'a--x-r2']);
});

test('compound "each" over two groups with equal counts pairs i to i; unequal counts throw', () => {
  const build = (ny) => program([
    track('a', [fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'parallel' } })]),
    track('b', [fixed('y', 80, { type: 'programStart' }, { replicates: { count: ny, mode: 'parallel' } })]),
    track('c', [fixed('s', 10, { logic: 'all', triggers: [
      { type: 'afterStep', stepId: 'x', instances: 'each' },
      { type: 'afterStep', stepId: 'y', instances: 'each' },
    ] })]),
  ]);
  const e = R.expandReplicates(build(2));
  assert.deepEqual(stepsById(e)['s-r2'].startTrigger, { logic: 'all', triggers: [{ type: 'afterStep', stepId: 'x-r2' }, { type: 'afterStep', stepId: 'y-r2' }] });
  assert.equal(trackOf(e)['s-r2'], 'a--x-r2');
  assert.throws(() => R.expandReplicates(build(3)), /E_EACH_COUNT_MISMATCH/);
});

test('"each" on a step that also declares replicates throws', () => {
  assert.throws(() => R.expandReplicates(program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'parallel' } }),
    fixed('s', 50, { type: 'afterStep', stepId: 'x', instances: 'each' }, { replicates: { count: 2 } }),
  ])])), /E_EACH_WITH_REPLICATES/);
});

for (const mode of ['parallel', 'serial']) {
  test(`"all" is an explicit barrier over every instance (${mode})`, () => {
    const e = R.expandReplicates(program([track('t', [
      fixed('x', 100, { type: 'programStart' }, { replicates: { count: 3, mode } }),
      fixed('z', 20, { type: 'afterStep', stepId: 'x', instances: 'all', offsetSeconds: 15 }),
    ])]));
    const z = stepsById(e).z;
    assert.deepEqual(z.startTrigger, { logic: 'all', triggers: [1, 2, 3].map((i) => ({ type: 'afterStep', stepId: `x-r${i}`, offsetSeconds: 15 })) });
    assert.equal(z.instanceOf, undefined);
    assert.ok(noInstancesLeft(e));
  });
}

test('"any" fires on the first instance', () => {
  const e = R.expandReplicates(program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'parallel' } }),
    fixed('z', 20, { type: 'afterStepWithBuffer', stepId: 'x', instances: 'any', bufferSeconds: 5 }),
  ])]));
  assert.deepEqual(stepsById(e).z.startTrigger, { logic: 'any', triggers: [1, 2].map((i) => ({ type: 'afterStepWithBuffer', stepId: `x-r${i}`, bufferSeconds: 5 })) });
  const tm = R.computeStepTimings(program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'stagger', delay: 30 } }),
    fixed('z', 20, { type: 'afterStep', stepId: 'x', instances: 'any' }),
  ])]));
  assert.equal(tm.z.start, 100);
});

test('"all" inside a compound "all" is flattened', () => {
  const e = R.expandReplicates(program([
    track('a', [fixed('m', 10, { type: 'programStart' })]),
    track('t', [
      fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'parallel' } }),
      fixed('z', 20, { logic: 'all', triggers: [{ type: 'afterStep', stepId: 'x', instances: 'all' }, { type: 'afterStep', stepId: 'm' }] }),
    ]),
  ]));
  assert.deepEqual(stepsById(e).z.startTrigger, { logic: 'all', triggers: [
    { type: 'afterStep', stepId: 'x-r1' }, { type: 'afterStep', stepId: 'x-r2' }, { type: 'afterStep', stepId: 'm' },
  ] });
});

test('`instances` on an unreplicated step is dropped (validator reports it)', () => {
  const e = R.expandReplicates(program([track('t', [
    fixed('m', 10, { type: 'programStart' }),
    fixed('z', 20, { type: 'afterStep', stepId: 'm', instances: 'each' }),
  ])]));
  assert.deepEqual(stepsById(e).z.startTrigger, { type: 'afterStep', stepId: 'm' });
  assert.ok(noInstancesLeft(e));
});

test('0.2.0 programs expand as before, with instance metadata stamped; input is not mutated', () => {
  const p = program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 2, mode: 'parallel' } }),
    fixed('z', 20, { type: 'afterStep', stepId: 'x' }),
  ])]);
  p.schemaVersion = '0.2.0';
  const before = JSON.stringify(p);
  const e = R.expandReplicates(p);
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(stepsById(e).z.startTrigger, { logic: 'all', triggers: [{ type: 'afterStep', stepId: 'x-r1' }, { type: 'afterStep', stepId: 'x-r2' }] });
  assert.equal(stepsById(e)['x-r2'].instanceOf, 'x');
  assert.equal(tracksById(e)['t--x-r2'].parentTrackId, 't');
});

test('cookie example expands to the expected shape and timings', () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'programs', 'cookies_three_trays.json'), 'utf8'));
  const e = R.expandReplicates(p);
  assert.deepEqual(e.tracks.map((t) => t.trackId), ['cookies', 'cookies--bake-r1', 'cookies--bake-r2', 'cookies--bake-r3']);
  assert.deepEqual(stepsById(e).box.startTrigger, { logic: 'all', triggers: [1, 2, 3].map((i) => ({ type: 'afterStep', stepId: `cool-r${i}` })) });
  const tm = R.computeStepTimings(p);
  for (const [id, exp] of Object.entries(p.metadata.expectedTimings)) {
    assert.equal(tm[id].start, exp.start, `${id} start`);
    assert.equal(tm[id].end, exp.end, `${id} end`);
  }
});

// ---- 0.3.0-alpha `replicates.maxInFlight` -----------------------------
// Mirrors the Python cases in test_expand_replicates.py.

function gatesOf(step) {
  var t = (step && step.startTrigger) || {};
  return (Array.isArray(t.triggers) ? t.triggers : [t]).filter((a) => a && a._synthetic === 'inFlight');
}

test('maxInFlight on a serial replicate gates through the "each" leaf', () => {
  const e = R.expandReplicates(program([track('t', [
    fixed('m', 10, { type: 'programStart' }),
    fixed('x', 100, { type: 'afterStep', stepId: 'm' }, { replicates: { count: 4, mode: 'serial', maxInFlight: 2 } }),
    fixed('s', 50, { type: 'afterStep', stepId: 'x', instances: 'each' }),
  ])]));
  const by = stepsById(e);
  // Instances 1..k keep their own trigger untouched: serial chaining only.
  assert.deepEqual(by['x-r1'].startTrigger, { type: 'afterStep', stepId: 'm' });
  assert.deepEqual(by['x-r2'].startTrigger, { type: 'afterStep', stepId: 'x-r1' });
  // i > k: own trigger AND the leaf of instance i-k, in one `all`.
  assert.deepEqual(by['x-r3'].startTrigger, { logic: 'all', triggers: [
    { type: 'afterStep', stepId: 'x-r2' },
    { type: 'afterStep', stepId: 's-r1', _synthetic: 'inFlight', inFlightOf: 'x', inFlightLimit: 2 },
  ] });
  assert.deepEqual(by['x-r4'].startTrigger, { logic: 'all', triggers: [
    { type: 'afterStep', stepId: 'x-r3' },
    { type: 'afterStep', stepId: 's-r2', _synthetic: 'inFlight', inFlightOf: 'x', inFlightLimit: 2 },
  ] });
  assert.ok(noInstancesLeft(e));
});

test('maxInFlight on a parallel replicate is a rolling window on the step itself', () => {
  const p = program([track('t', [
    fixed('x', 600, { type: 'programStart' }, { replicates: { count: 4, mode: 'parallel', maxInFlight: 2 } }),
  ])]);
  const by = stepsById(R.expandReplicates(p));
  assert.deepEqual(by['x-r1'].startTrigger, { type: 'programStart' });
  assert.deepEqual(by['x-r2'].startTrigger, { type: 'programStart' });
  assert.deepEqual(gatesOf(by['x-r3']).map((g) => g.stepId), ['x-r1']);
  assert.deepEqual(gatesOf(by['x-r4']).map((g) => g.stepId), ['x-r2']);
  // Exactly k start at t0; the next is admitted when the first leaf ends.
  const tm = R.computeStepTimings(p);
  assert.deepEqual([tm['x-r1'].start, tm['x-r2'].start, tm['x-r3'].start, tm['x-r4'].start], [0, 0, 600, 600]);
  assert.equal(Object.values(tm).filter((t) => t.start === 0).length, 2);
});

test('maxInFlight on a stagger replicate is a minimum gap the gate may push out', () => {
  const p = program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 4, mode: 'stagger', delay: 30, maxInFlight: 2 } }),
    fixed('s', 500, { type: 'afterStep', stepId: 'x', instances: 'each' }),
  ])]);
  const by = stepsById(R.expandReplicates(p));
  // The staggered offset survives alongside the gate, both inside one `all`.
  assert.deepEqual(by['x-r3'].startTrigger, { logic: 'all', triggers: [
    { type: 'programStart', offsetSeconds: 60 },
    { type: 'afterStep', stepId: 's-r1', _synthetic: 'inFlight', inFlightOf: 'x', inFlightLimit: 2 },
  ] });
  const tm = R.computeStepTimings(p);
  assert.deepEqual([tm['x-r1'].start, tm['x-r2'].start], [0, 30]);
  // The stagger would put x-r3 at 60; s-r1 ends at 600, so the gate wins.
  assert.equal(tm['s-r1'].end, 600);
  assert.equal(tm['x-r3'].start, 600);
  assert.equal(tm['x-r4'].start, 630);
});

test('multiple leaf chains each contribute one gate', () => {
  const e = R.expandReplicates(program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 3, mode: 'parallel', maxInFlight: 1 } }),
    fixed('a', 50, { type: 'afterStep', stepId: 'x', instances: 'each' }),
    fixed('b', 70, { type: 'afterStep', stepId: 'x', instances: 'each' }),
    fixed('c', 20, { type: 'afterStep', stepId: 'a', instances: 'each' }),
  ])]));
  const by = stepsById(e);
  // `a` has an "each" child (`c`) so it is not a leaf; `c` and `b` are.
  assert.deepEqual(gatesOf(by['x-r2']).map((g) => g.stepId), ['b-r1', 'c-r1']);
  assert.deepEqual(gatesOf(by['x-r3']).map((g) => g.stepId), ['b-r2', 'c-r2']);
  gatesOf(by['x-r2']).forEach((g) => assert.deepEqual([g.inFlightOf, g.inFlightLimit], ['x', 1]));
});

test('a gate merges into an `all` trigger and nests inside an `any` one', () => {
  const build = (logic) => program([
    track('a', [fixed('m', 10, { type: 'programStart' }), fixed('n', 20, { type: 'programStart' })]),
    track('t', [
      fixed('x', 100, { logic, triggers: [{ type: 'afterStep', stepId: 'm' }, { type: 'afterStep', stepId: 'n' }] },
        { replicates: { count: 2, mode: 'parallel', maxInFlight: 1 } }),
    ]),
  ]);
  const all = stepsById(R.expandReplicates(build('all')))['x-r2'].startTrigger;
  assert.deepEqual(all, { logic: 'all', triggers: [
    { type: 'afterStep', stepId: 'm' }, { type: 'afterStep', stepId: 'n' },
    { type: 'afterStep', stepId: 'x-r1', _synthetic: 'inFlight', inFlightOf: 'x', inFlightLimit: 1 },
  ] });
  const any = stepsById(R.expandReplicates(build('any')))['x-r2'].startTrigger;
  assert.deepEqual(any, { logic: 'all', triggers: [
    { logic: 'any', triggers: [{ type: 'afterStep', stepId: 'm' }, { type: 'afterStep', stepId: 'n' }] },
    { type: 'afterStep', stepId: 'x-r1', _synthetic: 'inFlight', inFlightOf: 'x', inFlightLimit: 1 },
  ] });
});

test('maxInFlight >= count is a no-op, and a tagged gate is never re-expanded', () => {
  const build = (k) => program([track('t', [
    fixed('x', 100, { type: 'programStart' }, { replicates: { count: 3, mode: 'parallel', maxInFlight: k } }),
    fixed('s', 50, { type: 'afterStep', stepId: 'x', instances: 'each' }),
  ])]);
  for (const k of [3, 5]) {
    const by = stepsById(R.expandReplicates(build(k)));
    [1, 2, 3].forEach((i) => assert.deepEqual(by[`x-r${i}`].startTrigger, { type: 'programStart' }));
  }
  // Re-expanding an already expanded program leaves the gates alone: they
  // carry no `replicates` and no `instances`, so nothing matches them.
  const once = R.expandReplicates(build(1));
  const twice = R.expandReplicates(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
  assert.equal(JSON.stringify(once).split('"_synthetic":"inFlight"').length - 1, 2);
});

test('PCR and airport examples expand to their hand-computed schedules', () => {
  for (const name of ['pcr_twelve_samples', 'airport_landings_taxi_gate']) {
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'programs', `${name}.json`), 'utf8'));
    const tm = R.computeStepTimings(p);
    for (const [id, exp] of Object.entries(p.metadata.expectedTimings)) {
      assert.equal(tm[id].start, exp.start, `${name}:${id} start`);
      assert.equal(tm[id].end, exp.end, `${name}:${id} end`);
    }
  }
});
