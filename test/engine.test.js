"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const R = require("../src/index.js");
const pkg = require("../package.json");

function fixed(id, seconds, trigger, extra) {
  return Object.assign({
    stepId: id, name: id.toUpperCase(), task: "prep",
    duration: { type: "fixed", seconds },
    startTrigger: trigger,
  }, extra || {});
}

test("exports and version agree with package.json", () => {
  assert.equal(R.version, pkg.version);
  assert.deepEqual(R.supportedSchemaVersions, pkg.rhylthyme.supportedSchemaVersions);
  for (const f of ["computeStepTimings", "renderTimelineSvg", "renderTimeline", "parseSeconds", "stepDurationSeconds"]) {
    assert.equal(typeof R[f], "function", f);
  }
});

test("parseSeconds handles numbers, numeric strings and unit strings", () => {
  assert.equal(R.parseSeconds(90), 90);
  assert.equal(R.parseSeconds("90"), 90);
  assert.equal(R.parseSeconds("5m"), 300);
  assert.equal(R.parseSeconds("1h30m"), 5400);
  assert.equal(R.parseSeconds("-20m"), -1200);
  assert.equal(R.parseSeconds("2 hours 5 min"), 7500);
  assert.equal(R.parseSeconds("garbage"), 0);
  assert.equal(R.parseSeconds(null), 0);
});

test("computeStepTimings honors string durations, buffers, offsets, compound and manual triggers", () => {
  const p = { tracks: [{ trackId: "t", steps: [
    fixed("s1", "5m", { type: "programStart" }),
    fixed("s2", 60, { type: "afterStepWithBuffer", stepId: "s1", bufferSeconds: "2m" }),
    Object.assign(fixed("s3", 0, { logic: "all", triggers: [{ type: "afterStep", stepId: "s2" }, { type: "programStartOffset", offsetSeconds: "10m" }] }),
      { duration: { type: "variable", minSeconds: 10, maxSeconds: 100, defaultSeconds: 50 } }),
    fixed("s4", 30, { type: "manual" }),
    fixed("s5", 30, { type: "afterStep", stepId: "s1", event: "start", offsetSeconds: 15 }),
  ] }] };
  const t = R.computeStepTimings(p);
  assert.deepEqual([t.s1.start, t.s1.end], [0, 300]);
  assert.deepEqual([t.s2.start, t.s2.end], [420, 480]);
  assert.deepEqual([t.s3.start, t.s3.end], [600, 650]);
  assert.deepEqual([t.s4.start, t.s4.end], [650, 680]);
  assert.deepEqual([t.s5.start, t.s5.end], [15, 45]);
  Object.values(t).forEach((x) => assert.equal(x.resolved, true));
});

test("computeStepTimings marks cycles and dangling refs as unresolved", () => {
  const p = { tracks: [{ trackId: "t", steps: [
    fixed("x", 10, { type: "afterStep", stepId: "y" }),
    fixed("y", 10, { type: "afterStep", stepId: "x" }),
    fixed("z", 10, { type: "afterStep", stepId: "nope" }),
  ] }] };
  const t = R.computeStepTimings(p);
  assert.equal(t.x.resolved, false);
  assert.equal(t.y.resolved, false);
  assert.equal(t.z.resolved, false);
});

test("expandReplicates matches the Python expansion shape", () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "programs", "replicates_comprehensive_demo.json")));
  const e = R.expandReplicates(p);
  assert.notEqual(e, p, "returns a copy");
  assert.equal(p.tracks.length, 4, "input untouched");
  assert.equal(e.tracks.length, 14);
  const ids = new Set();
  e.tracks.forEach((t) => t.steps.forEach((s) => { assert.ok(!s.replicates); ids.add(s.stepId); }));
  assert.ok(ids.has("serial-process-r4") && ids.has("parallel-process-r3"));
  // A program without replicates is returned as-is.
  const plain = { tracks: [{ trackId: "t", steps: [fixed("a", 1, { type: "programStart" })] }] };
  assert.equal(R.expandReplicates(plain), plain);
  assert.equal(R.stepDurationSeconds({ duration: { type: "indefinite" } }), 60);
});

test("renderTimelineSvg draws arrows, marks and legend, and can switch them off", () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "programs", "thanksgiving_one_oven.json")));
  const svg = R.renderTimelineSvg(p);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes('marker-end="url(#rt-arrow)"'), "dependency arrows");
  assert.ok(svg.includes('class="rt-edge"') && svg.includes('stroke-dasharray="5,4"'), "negative-offset arrow");
  assert.ok(svg.includes('fill="url(#rt-hatch)"'), "indefinite hatch");
  assert.ok(svg.includes(">manual<"), "legend");
  const plain = R.renderTimelineSvg(p, { arrows: false, marks: false, legend: false });
  assert.ok(!plain.includes("marker-end"));
  assert.ok(!plain.includes(">manual<"));
  assert.equal(R.renderTimelineSvg({ tracks: [] }), "");
});

// Constructs on which this engine and the Python reference validator are
// KNOWN to disagree. Each is a documented semantic difference, not noise:
//   afterStepWithBuffer — Python's calculate_step_start_time ignores
//                         bufferSeconds; this engine adds it.
//   negative-offset     — Python places the step at the referenced step's
//                         START as a placeholder; this engine resolves
//                         ref.end + offset (clamped to ref.start).
//   replicates          — Python expands replicates/batch_size before
//                         resolving; this engine resolves the unexpanded
//                         program.
// Programs using any of them are excluded from the parity assertion and
// listed in the test output. Remove an entry here only when the Python
// side is changed to match (or vice versa) and the fixture regenerated.
const KNOWN_DIFFERENCES = [];

function constructsOf(program) {
  const c = new Set();
  for (const t of program.tracks || []) {
    if (t.replicates || t.batch_size > 1) c.add("replicates");
    for (const s of t.steps || []) {
      if (s.replicates) c.add("replicates");
      const trs = (s.startTrigger && s.startTrigger.triggers) || [s.startTrigger || {}];
      for (const tr of trs) {
        if (tr.type === "afterStepWithBuffer") c.add("afterStepWithBuffer");
        if (R.parseSeconds(tr.offsetSeconds) < 0) c.add("negative-offset");
      }
    }
  }
  return [...c];
}

test("engine agrees with the Python reference validator on the example corpus", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "python-timings.json")));
  const dir = path.join(__dirname, "fixtures", "programs");
  const names = Object.keys(fixture.programs);
  assert.ok(names.length >= 30, "fixture covers the corpus");
  const mismatches = [];
  const excluded = [];
  let compared = 0;
  for (const name of names) {
    const program = JSON.parse(fs.readFileSync(path.join(dir, name)));
    const known = constructsOf(program).filter((c) => KNOWN_DIFFERENCES.includes(c));
    if (known.length) { excluded.push(`${name} (${known.join(", ")})`); continue; }
    const js = R.computeStepTimings(program);
    for (const [stepId, py] of Object.entries(fixture.programs[name])) {
      if (!js[stepId] || !js[stepId].resolved) continue;
      compared++;
      if (Math.abs(js[stepId].start - py.start) > 0.5 || Math.abs(js[stepId].end - py.end) > 0.5) {
        mismatches.push(`${name}:${stepId} js=${js[stepId].start}-${js[stepId].end} py=${py.start}-${py.end}`);
      }
    }
  }
  console.log(`parity: ${compared} steps compared across ${names.length - excluded.length} programs; excluded for known differences: ${excluded.join("; ")}`);
  assert.ok(compared > 200, "enough steps compared");
  assert.deepEqual(mismatches, [], "start/end disagreements with the Python validator");
});

// programVersion parity: the canonical hash in tools/hash-program.js must
// reproduce test/fixtures/hash-parity.json, which was generated by the Python
// twin (rhylthyme_cli_runner.history.hash.program_version) and is asserted on
// that side by rhylthyme-cli-runner/tests/test_hash_parity.py.
test("hash-program.js reproduces the programVersion parity fixture", () => {
  const { programVersion, canonicalJson } = require("../tools/hash-program.js");
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hash-parity.json")));
  const dir = path.join(__dirname, "fixtures", "programs");
  const names = Object.keys(fixture.programs);
  assert.ok(names.length >= 30, "fixture covers the corpus");
  const mismatches = [];
  for (const name of names) {
    const program = JSON.parse(fs.readFileSync(path.join(dir, name)));
    const actual = programVersion(program);
    if (actual !== fixture.programs[name]) mismatches.push(`${name}: ${actual} != ${fixture.programs[name]}`);
  }
  assert.deepEqual(mismatches, [], "hashes disagree with the Python twin");
  // The canonical form itself: keys by code point, no whitespace, integral
  // floats without a fraction, non-ASCII left alone.
  assert.equal(canonicalJson({ b: 1, a: { z: [1.0, 2.5, "é"], y: true }, c: null }),
    '{"a":{"y":true,"z":[1,2.5,"é"]},"b":1,"c":null}');
  assert.equal(programVersion({ x: 1.0 }), programVersion({ x: 1 }));
  assert.match(programVersion({}), /^sha256:[0-9a-f]{64}$/);
});

// Replay parity (PRD §8 item 1): feed a recorded run's OBSERVED ENDS back
// into the resolver and every trigger must fire when the runtime recorded it
// firing. Two trigger forms cannot be reproduced from the ends alone and are
// skipped — the same two that
// rhylthyme_cli_runner.history.replay.executor_gated names, and the Python
// half of this check (tests/test_replay.py) skips exactly the same steps:
//   manual           the executor decides; nothing predicts it
//   negative offset  a hindsight replay resolves it against the end that
//                    happened (ref.end + offset); the live runtime had to
//                    fire it from the anchor's PROJECTED end
//                    (ref.start + defaultSeconds + offset), which the
//                    observed end has since contradicted
// event: "start" was a third until Phase 7 taught the CLI runner to anchor on
// the referenced step's start, exactly as this engine does.
function replayExclusion(step) {
  const trigger = step.startTrigger || {};
  const atoms = Array.isArray(trigger.triggers) ? trigger.triggers : [trigger];
  for (const atom of atoms) {
    if (!atom) continue;
    if (atom.type === "manual") return "manual gate";
    if (atom.type === "afterStep" || atom.type === "afterStepWithBuffer") {
      if (R.parseSeconds(atom.offsetSeconds) < 0) return "negative offset";
    }
  }
  return null;
}

test("replay: observed ends reproduce every recorded trigger firing", () => {
  const program = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "programs", "thanksgiving_one_oven.json")));
  const record = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "runs", "thanksgiving_one_oven.run.json")));
  assert.equal(record.programId, "thanksgiving-one-oven");
  assert.equal(record.outcome, "completed");

  const stepIndex = {};
  for (const t of R.expandReplicates(program).tracks) for (const s of t.steps) stepIndex[s.stepId] = s;

  // Only the ends: every start has to come out of the trigger graph.
  const ends = R.actualFromRun(record, program, { endsOnly: true });
  assert.equal(Object.keys(ends).length, record.steps.length);
  assert.ok(Object.values(ends).every((a) => a.start === undefined && typeof a.end === "number"));
  const replayed = R.computeStepTimings(program, { actual: ends });

  const mismatches = [], excluded = [];
  let compared = 0;
  for (const entry of record.steps) {
    const id = R.runtimeStepId(entry, Object.fromEntries(Object.keys(stepIndex).map((k) => [k, 1])));
    const reason = replayExclusion(stepIndex[id]);
    if (reason) { excluded.push(`${id} (${reason})`); continue; }
    const fired = entry.triggerFiredAt !== undefined ? entry.triggerFiredAt : entry.actual.start;
    compared++;
    if (Math.abs(replayed[id].start - fired) > 0.5) {
      mismatches.push(`${id} replay=${replayed[id].start} recorded=${fired}`);
    }
    // The observed end is what the engine used, not a recomputed duration.
    assert.equal(replayed[id].end, entry.actual.end, `${id} end`);
  }
  console.log(`replay: ${compared} trigger firings reproduced; skipped: ${excluded.join("; ")}`);
  assert.deepEqual(mismatches, [], "trigger firings the engine does not reproduce");
  assert.ok(compared >= 11, "enough steps compared");
  assert.deepEqual(excluded.sort(), ['guests-seated (manual gate)', 'potatoes-peel (negative offset)']);
});

test("actualFromRun / timingsFromRun map a record onto expanded step ids", () => {
  const program = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "programs", "thanksgiving_one_oven.json")));
  const record = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "runs", "thanksgiving_one_oven.run.json")));
  const actual = R.actualFromRun(record, program);
  assert.deepEqual(actual["turkey-prep"], { start: 0, end: 1000 });
  assert.equal(Object.keys(actual).length, 13);
  // Arguments may be given in either order; the program is optional.
  assert.deepEqual(R.actualFromRun(program, record), actual);
  assert.deepEqual(R.actualFromRun(record), actual);

  const timings = R.timingsFromRun(program, record);
  assert.deepEqual(R.timingsFromRun(record, program), timings);
  assert.deepEqual([timings["turkey-prep"].start, timings["turkey-prep"].end], [0, 1000]);
  assert.equal(timings["turkey-roast"].end, 12400.25);
  // A step's instance becomes the expander's -r<i> suffix.
  assert.equal(R.runtimeStepId({ stepId: "bake", instance: 3 }), "bake-r3");
  assert.equal(R.runtimeStepId({ stepId: "mix", instance: 1 }), "mix");
  assert.equal(R.runtimeStepId({ stepId: "x-r1", instance: 1 }, { "x-r1": 1 }), "x-r1");
  assert.deepEqual(R.actualFromRun(null), {});
});

// Worked examples carry their hand-computed schedule in
// metadata.expectedTimings (seconds, keyed by expanded step id); both the
// Python fixture and the JS engine must reproduce it exactly.
test("fixtures with metadata.expectedTimings resolve to their hand-computed schedule", () => {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "python-timings.json")));
  const dir = path.join(__dirname, "fixtures", "programs");
  let checked = 0;
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const program = JSON.parse(fs.readFileSync(path.join(dir, name)));
    const expected = program.metadata && program.metadata.expectedTimings;
    if (!expected) continue;
    checked++;
    const js = R.computeStepTimings(program);
    const py = fixture.programs[name] || {};
    for (const [stepId, t] of Object.entries(expected)) {
      assert.ok(js[stepId] && js[stepId].resolved, `${name}:${stepId} resolved by the JS engine`);
      assert.equal(js[stepId].start, t.start, `${name}:${stepId} start (js)`);
      assert.equal(js[stepId].end, t.end, `${name}:${stepId} end (js)`);
      assert.ok(py[stepId], `${name}:${stepId} present in python-timings.json (rerun tools/gen-python-timings.py)`);
      assert.equal(py[stepId].start, t.start, `${name}:${stepId} start (python)`);
      assert.equal(py[stepId].end, t.end, `${name}:${stepId} end (python)`);
    }
  }
  assert.ok(checked >= 1, "at least one fixture declares expectedTimings");
});
