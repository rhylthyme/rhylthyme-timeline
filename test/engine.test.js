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

test("renderTimelineSvg draws arrows, marks and legend, and can switch them off", () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "programs", "thanksgiving_one_oven.json")));
  const svg = R.renderTimelineSvg(p);
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes('marker-end="url(#rt-arrow)"'), "dependency arrows");
  assert.ok(svg.includes('stroke-dasharray="4,3"'), "negative-offset arrow");
  assert.ok(svg.includes('fill="url(#rt-hatch)"'), "indefinite hatch");
  assert.ok(svg.includes("manual gate"), "legend");
  const plain = R.renderTimelineSvg(p, { arrows: false, marks: false, legend: false });
  assert.ok(!plain.includes("marker-end"));
  assert.ok(!plain.includes("manual gate"));
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
const KNOWN_DIFFERENCES = ["afterStepWithBuffer", "negative-offset", "replicates"];

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
