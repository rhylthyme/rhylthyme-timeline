'use strict';
// The browser auto-planners, extracted from rhylthyme-server's visualizer
// template into static/js/auto-plan.js so they can run headless.
//
// Two contracts are asserted here:
//   1. the extraction changed nothing — a program without replicate instances
//      plans to exactly the start times the in-template code produced;
//   2. with the expanded program passed in, every strategy respects
//      replicates.maxInFlight as well as resourceConstraints.maxConcurrent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const AutoPlan = require('../player/auto-plan.js');
const { expandReplicates } = require('../src/index.js');

const PROGRAMS = path.join(__dirname, 'fixtures', 'programs');
const load = (name) => JSON.parse(fs.readFileSync(path.join(PROGRAMS, `${name}.json`), 'utf8'));

/**
 * The planner input the page builds in autoPlan(): one entry per rendered
 * step, with the trigger flattened to a single afterStep (or the previous
 * step in the track), exactly as timelineData carries it.
 */
function programData(program) {
  return {
    tracks: (program.tracks || []).map((track) => ({
      trackId: track.trackId,
      name: track.name,
      priority: track.priority || 100,
      steps: (track.steps || []).map((step, i) => {
        const d = step.duration || {};
        const trig = step.startTrigger || {};
        return {
          stepId: step.stepId,
          name: step.name,
          priority: step.priority || 100,
          duration: {
            type: d.type || 'fixed',
            seconds: d.seconds,
            minSeconds: d.minSeconds || null,
            maxSeconds: d.maxSeconds || null,
          },
          startTrigger: trig.type === 'afterStep' && trig.stepId
            ? { type: 'afterStep', stepId: trig.stepId }
            : (i > 0 ? { type: 'afterStep', stepId: track.steps[i - 1].stepId } : { type: 'programStart' }),
          task: step.task || '',
          instanceOf: step.instanceOf || null,
          instanceIndex: step.instanceIndex || null,
        };
      }),
    })),
  };
}

const starts = (plan) => {
  const out = {};
  plan.stepTimings.forEach((t) => { out[t.stepId] = t.startTime; });
  return out;
};
const timingsOf = (plan) => {
  const out = {};
  plan.stepTimings.forEach((t) => { if (!t.omitted) out[t.stepId] = { start: t.startTime, end: t.endTime }; });
  return out;
};
const makespan = (plan) => plan.stepTimings.reduce((m, t) => (t.omitted ? m : Math.max(m, t.endTime)), 0);

const COOKIE_MAKESPAN = 4440; // PRD §7: 74 minutes

// ---------------------------------------------------------------------------

test('extraction is behaviour-preserving for a program without instances', () => {
  // Captured from the pre-extraction in-template planners on
  // fixtures/programs/breakfast_schedule.json (no replicates, no compound
  // triggers). Any drift here is a regression in the extraction itself.
  const expected = {
    minimize_length: { 'eggs-crack-whisk': 0, 'eggs-heat-pan': 60, 'eggs-cook': 60, 'bacon-prep': 0, 'bacon-cook': 60, 'toast-cook': 0 },
    synchronized_finish: { 'eggs-crack-whisk': 150, 'eggs-heat-pan': 210, 'eggs-cook': 210, 'bacon-prep': 150, 'bacon-cook': 210, 'toast-cook': 0 },
    cover: { 'eggs-crack-whisk': 0, 'bacon-prep': 60, 'toast-cook': 120, 'eggs-heat-pan': 330, 'bacon-cook': 330, 'eggs-cook': 330 },
    fit_to_time: { 'eggs-crack-whisk': 0, 'eggs-heat-pan': 60, 'eggs-cook': 60, 'bacon-prep': 0, 'bacon-cook': 60, 'toast-cook': 0 },
  };
  const program = expandReplicates(load('breakfast_schedule'));
  assert.equal(AutoPlan.hasInstances(program), false);

  for (const strategy of Object.keys(expected)) {
    // Both with and without the expanded program: a program with no instances
    // must take the legacy path either way.
    for (const opts of [{}, { program }]) {
      const res = AutoPlan.applyAutoPlanStrategy(programData(program), Object.assign({
        strategy, targetDurationSeconds: 1800,
      }, opts));
      assert.ok(res.success, `${strategy} failed: ${res.error}`);
      assert.deepEqual(starts(res.plan), expected[strategy], `${strategy} start times`);
    }
  }
});

test('every strategy respects maxInFlight on the cookie example', () => {
  const program = expandReplicates(load('cookies_three_trays'));
  assert.equal(AutoPlan.hasInstances(program), true);

  for (const strategy of ['minimize_length', 'synchronized_finish', 'cover']) {
    const res = AutoPlan.applyAutoPlanStrategy(programData(program), { strategy, program });
    assert.ok(res.success, `${strategy} failed: ${res.error}`);

    // Never three trays between bake and box.
    const windows = AutoPlan.inFlightWindows(program, timingsOf(res.plan));
    const bake = windows.find((g) => g.inFlightOf === 'bake');
    assert.ok(bake, `${strategy}: no in-flight group`);
    assert.equal(bake.maxInFlight, 2);
    assert.ok(bake.peakInFlight <= 2, `${strategy}: ${bake.peakInFlight} trays in flight at ${bake.peakAtSeconds}s`);
    assert.deepEqual(AutoPlan.inFlightConflicts(program, timingsOf(res.plan)), []);

    // …and never a schedule shorter than the rack allows.
    assert.ok(makespan(res.plan) >= COOKIE_MAKESPAN,
      `${strategy}: makespan ${makespan(res.plan)} < ${COOKIE_MAKESPAN}`);
  }
});

test('minimize_length reproduces the hand-computed cookie schedule', () => {
  const raw = load('cookies_three_trays');
  const program = expandReplicates(raw);
  const res = AutoPlan.applyAutoPlanStrategy(programData(program), { strategy: 'minimize_length', program });
  const got = {};
  res.plan.stepTimings.forEach((t) => { got[t.stepId] = { start: t.startTime, end: t.endTime }; });
  assert.deepEqual(got, raw.metadata.expectedTimings);
});

test('fit_to_time drops an instance chain together and re-derives the barrier', () => {
  const program = expandReplicates(load('cookies_three_trays'));
  const res = AutoPlan.applyAutoPlanStrategy(programData(program), {
    strategy: 'fit_to_time', targetDurationSeconds: 4000, program,
  });
  assert.ok(res.success, res.error);

  const omitted = res.plan.stepTimings.filter((t) => t.omitted).map((t) => t.stepId).sort();
  // The third tray goes as a unit: the bake instance and the "each" cool
  // paired with it, never one without the other.
  assert.deepEqual(omitted, ['bake-r3', 'cool-r3']);

  const by = {};
  res.plan.stepTimings.forEach((t) => { by[t.stepId] = t; });
  // box is the "all" barrier: rebuilt over the two instances that remain, so
  // it starts when the later of them finishes cooling.
  assert.equal(by.box.startTime, Math.max(by['cool-r1'].endTime, by['cool-r2'].endTime));
  assert.equal(by.box.startTime, 3240);
  assert.ok(makespan(res.plan) <= 4000, `makespan ${makespan(res.plan)} still over target`);

  // The barrier rebuild is a real program rewrite, not just a filtered edge list.
  const trimmed = AutoPlan.rebuildBarriers(program, omitted);
  const box = trimmed.tracks[0].steps.find((s) => s.stepId === 'box');
  assert.deepEqual(box.startTrigger.triggers.map((t) => t.stepId), ['cool-r1', 'cool-r2']);
  assert.equal(trimmed.tracks[0].steps.some((s) => s.stepId === 'bake-r3'), false);
});

test('post-optimisation conflicts report in-flight over-subscription', () => {
  const program = expandReplicates(load('cookies_three_trays'));

  // Hand-edited schedule: bake-r3 starts as soon as the oven frees up,
  // ignoring the rack gate, so three trays are in flight from 2340s.
  const hand = {
    mix: { start: 0, dur: 900 },
    'bake-r1': { start: 900, dur: 720 },
    'bake-r2': { start: 1620, dur: 720 },
    'bake-r3': { start: 2340, dur: 720 },
    'cool-r1': { start: 1620, dur: 900 },
    'cool-r2': { start: 2340, dur: 900 },
    'cool-r3': { start: 3060, dur: 900 },
    box: { start: 3960, dur: 300 },
  };
  const byId = {};
  (program.tracks || []).forEach((t) => (t.steps || []).forEach((s) => { byId[s.stepId] = s; }));
  const optimizedSteps = {};
  Object.keys(hand).forEach((id) => {
    optimizedSteps[id] = {
      stepId: id, task: byId[id].task, startTime: hand[id].start, duration: hand[id].dur,
    };
  });

  const conflicts = AutoPlan.detectPostOptimizationConflicts(optimizedSteps, {
    resourceConstraints: program.resourceConstraints,
    program,
  });
  assert.ok(conflicts.every((c) => c.kind), 'every conflict item carries a kind');

  const inFlight = conflicts.filter((c) => c.kind === 'inFlight');
  assert.equal(inFlight.length, 1);
  assert.equal(inFlight[0].inFlightOf, 'bake');
  assert.equal(inFlight[0].maxInFlight, 2);
  assert.equal(inFlight[0].demand, 3);
  assert.deepEqual(inFlight[0].steps, ['bake-r1', 'bake-r2', 'bake-r3']);
  assert.match(inFlight[0].fix, /maxInFlight/);

  assert.deepEqual(conflicts.filter((c) => c.kind === 'maxConcurrent'), [],
    'the hand-edited schedule breaks only the in-flight cap');

  // Both kinds are reported together when both bind: pull the third tray onto
  // the rack while the first is still on it.
  const both = JSON.parse(JSON.stringify(optimizedSteps));
  both['cool-r3'].startTime = 2400;
  const mixed = AutoPlan.detectPostOptimizationConflicts(both, {
    resourceConstraints: program.resourceConstraints, program,
  });
  assert.ok(mixed.some((c) => c.kind === 'inFlight'), 'in-flight conflict');
  assert.ok(mixed.some((c) => c.kind === 'maxConcurrent' && c.resourceType === 'rack'),
    'rack maxConcurrent conflict reported alongside the in-flight one');

  // …and a schedule that honours the gate reports neither kind.
  const planned = AutoPlan.applyAutoPlanStrategy(programData(program), { strategy: 'minimize_length', program });
  const clean = {};
  planned.plan.stepTimings.forEach((t) => {
    clean[t.stepId] = { stepId: t.stepId, task: byId[t.stepId].task, startTime: t.startTime, duration: t.duration };
  });
  assert.deepEqual(AutoPlan.detectPostOptimizationConflicts(clean, {
    resourceConstraints: program.resourceConstraints, program,
  }), []);
});

test('in-flight awareness is inert without an expanded program', () => {
  const program = expandReplicates(load('cookies_three_trays'));
  const naive = AutoPlan.applyAutoPlanStrategy(programData(program), { strategy: 'minimize_length' });
  // Without the program the planner only sees the flattened triggers, so it
  // packs bake-r3 as soon as the oven frees up — the behaviour this phase
  // fixes, kept here to prove the fix comes from `options.program`.
  assert.equal(starts(naive.plan)['bake-r3'], 2340);
  assert.ok(makespan(naive.plan) < COOKIE_MAKESPAN);
});

test('the twelve-sample PCR example keeps its rotor within six in flight', () => {
  const program = expandReplicates(load('pcr_twelve_samples'));
  for (const strategy of ['minimize_length', 'synchronized_finish', 'cover']) {
    const res = AutoPlan.applyAutoPlanStrategy(programData(program), { strategy, program });
    assert.ok(res.success, `${strategy} failed: ${res.error}`);
    assert.deepEqual(AutoPlan.inFlightConflicts(program, timingsOf(res.plan)), [], strategy);
  }
});
