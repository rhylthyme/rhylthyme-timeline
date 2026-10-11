"use strict";
// itinerary(program, opts): the plan as a list, from the core engine, and
// ./schedule's itinerary, which applies the LabMCP estimates first. The
// last tests hold both to analyzeSchedule(...).steps (./schedule) on every
// program we have (the core one on programs with no LabMCP estimate).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const R = require("../src/index.js");
const S = require("../src/schedule");
const { analyzeSchedule } = S;

const FIELDS = ["stepId", "name", "trackId", "instanceOf", "instanceIndex", "startSeconds", "endSeconds", "durationSeconds", "task", "startAt", "endAt"];
const pick = (e) => Object.fromEntries(FIELDS.map((k) => [k, e[k]]));

const EXAMPLES = process.env.RHYLTHYME_EXAMPLES || path.join(__dirname, "..", "..", "rhylthyme-examples");

const program = {
  programId: "tea",
  name: "Tea",
  tracks: [
    {
      trackId: "kitchen", name: "Kitchen", steps: [
        { stepId: "boil", name: "Boil", task: "kettle", duration: { type: "fixed", seconds: "3m" }, startTrigger: { type: "programStart" } },
        { stepId: "steep", name: "Steep", duration: { type: "fixed", seconds: 240 }, startTrigger: { type: "afterStep", stepId: "boil" } },
        { stepId: "serve", name: "Serve", duration: { type: "indefinite", defaultSeconds: 60 },
          startTrigger: { logic: "all", triggers: [{ type: "afterStep", stepId: "steep" }, { type: "manual" }] } },
      ],
    },
    {
      trackId: "table", steps: [
        { stepId: "cup", name: "Set cup", duration: { type: "fixed", seconds: 30 }, startTrigger: { type: "programStart" },
          replicates: { count: 2, instances: "each" } },
      ],
    },
  ],
  resourceConstraints: [{ task: "kettle", maxConcurrent: 1 }],
};

test("itinerary lists every expanded step in plan order with names and flags", () => {
  const it = R.itinerary(program);
  const byId = Object.fromEntries(it.map((e) => [e.stepId, e]));
  assert.deepEqual(byId.boil, {
    stepId: "boil", name: "Boil", trackId: "kitchen", trackName: "Kitchen",
    instanceOf: null, instanceIndex: null,
    startSeconds: 0, endSeconds: 180, durationSeconds: 180,
    needsStart: false, needsFinish: false, task: "kettle",
  });
  assert.equal(byId.serve.needsStart, true);
  assert.equal(byId.serve.needsFinish, true);
  assert.equal(byId.serve.startSeconds, 420);
  assert.equal(byId.steep.task, null);
  assert.ok(!("startAt" in byId.boil), "no wall clock without an anchor");
  // Order: start time, then name.
  for (let i = 1; i < it.length; i++) {
    const a = it[i - 1], b = it[i];
    assert.ok(a.startSeconds < b.startSeconds || (a.startSeconds === b.startSeconds && a.name.localeCompare(b.name) <= 0));
  }
  // The input is not mutated.
  assert.ok(program.tracks[1].steps[0].replicates);
});

test("itinerary links replicate instances to their authored step", () => {
  const inst = R.itinerary(program).filter((e) => e.instanceOf === "cup");
  assert.ok(inst.length >= 2, JSON.stringify(inst));
  inst.forEach((e) => {
    assert.equal(typeof e.instanceIndex, "number");
    assert.equal(e.trackName.length > 0, true);
  });
  assert.deepEqual(inst.map((e) => e.instanceIndex).sort(), [1, 2]);
});

test("startAt anchors wall-clock times at the program start", () => {
  const it = R.itinerary(program, { startAt: "2026-11-26T14:00:00Z" });
  const steep = it.find((e) => e.stepId === "steep");
  assert.equal(steep.startAt, "2026-11-26T14:03:00.000Z");
  assert.equal(steep.endAt, "2026-11-26T14:07:00.000Z");
});

test("finishAt wins over startAt and works back from the makespan", () => {
  const it = R.itinerary(program, { finishAt: "2026-11-26T18:00:00Z", startAt: "2000-01-01T00:00:00Z" });
  const last = it.reduce((m, e) => (e.endSeconds > m.endSeconds ? e : m));
  assert.equal(last.endAt, "2026-11-26T18:00:00.000Z");
  assert.equal(it.find((e) => e.stepId === "boil").startAt, "2026-11-26T17:52:00.000Z");
});

test("an unparseable anchor is ignored", () => {
  const it = R.itinerary(program, { startAt: "not a date" });
  assert.ok(it.every((e) => !("startAt" in e) && !("endAt" in e)));
});

test("actual and now are passed to the timing engine", () => {
  const it = R.itinerary(program, { actual: { boil: { start: 10, end: 250 } }, now: 600, startAt: "2026-11-26T14:00:00Z" });
  const boil = it.find((e) => e.stepId === "boil");
  assert.equal(boil.startSeconds, 10);
  assert.equal(boil.endSeconds, 250);
  assert.equal(it.find((e) => e.stepId === "steep").startSeconds, 250);
  assert.equal(it.find((e) => e.stepId === "serve").startSeconds, 600); // manual gate floats to now
  assert.equal(boil.endAt, "2026-11-26T14:04:10.000Z");
});

test("steps of a replicated track link to their authored step", () => {
  const p = { tracks: [
    { trackId: "plate", name: "Plate", replicates: { count: 2 }, steps: [
      { stepId: "a", name: "A", duration: { type: "fixed", seconds: 10 }, startTrigger: { type: "programStart" } },
      { stepId: "b", name: "B", duration: { type: "fixed", seconds: 10 }, startTrigger: { type: "afterStep", stepId: "a" },
        replicates: { count: 2 } },
    ] },
    { trackId: "legacy", name: "Legacy", batch_size: 3, steps: [
      { stepId: "c", name: "C", duration: { type: "fixed", seconds: 5 }, startTrigger: { type: "programStart" } },
    ] },
  ] };
  const by = Object.fromEntries(R.itinerary(p).map((e) => [e.stepId, [e.instanceOf, e.instanceIndex, e.trackId]]));
  assert.deepEqual(by["a-r1"], ["a", 1, "plate-r1"]);
  assert.deepEqual(by["a-r2"], ["a", 2, "plate-r2"]);
  assert.deepEqual(by["c-r3"], ["c", 3, "legacy-r3"]);
  // A replicated step inside a replicated track keeps its own (inner) link.
  assert.deepEqual(by["b-r2-r1"].slice(0, 2), ["b-r2", 1]);
  // analyzeSchedule reports the same links.
  const an = Object.fromEntries(analyzeSchedule(p).steps.map((e) => [e.stepId, [e.instanceOf, e.instanceIndex, e.trackId]]));
  assert.deepEqual(an, by);
  // The expansion itself is unchanged (the player keys run records on it).
  const ex = R.expandReplicates(p).tracks[0].steps[0];
  assert.equal(ex.stepId, "a-r1");
  assert.equal(ex.instanceOf, undefined);
});

test("an epoch-ms anchor works, 0 included", () => {
  assert.equal(R.itinerary(program, { startAt: 0 })[0].startAt, "1970-01-01T00:00:00.000Z");
  assert.equal(R.itinerary(program, { startAt: Date.UTC(2026, 10, 26, 14) }).find((e) => e.stepId === "steep").startAt, "2026-11-26T14:03:00.000Z");
  assert.equal(R.itinerary(program, { startAt: new Date("2026-11-26T14:00:00Z") }).find((e) => e.stepId === "steep").startAt, "2026-11-26T14:03:00.000Z");
  const last = R.itinerary(program, { finishAt: 0 }).reduce((m, e) => (e.endSeconds > m.endSeconds ? e : m));
  assert.equal(last.endAt, "1970-01-01T00:00:00.000Z");
  for (const v of [null, undefined, "", false, NaN]) {
    assert.ok(R.itinerary(program, { startAt: v }).every((e) => !("startAt" in e)), String(v));
  }
});

// The LabMCP steps from labmcp.test.js: "log" ends on a reply and has no
// duration, so analyzeSchedule times it by its catalogue estimate (27 s).
const labmcpProgram = {
  programId: "t", name: "T", tracks: [{ trackId: "bench", name: "Bench", steps: [
    { stepId: "heat", name: "Heat", duration: { type: "fixed", seconds: 120 }, startTrigger: { type: "programStart" } },
    { stepId: "log", name: "Log pH", startTrigger: { type: "afterStep", stepId: "heat" },
      instrument: { tool: "ph", toolType: "labmcp-atlas-ezo", until: { command: "log_series", params: { count: 10, interval_s: 3 } } } },
    { stepId: "after", name: "After", duration: { type: "fixed", seconds: 60 }, startTrigger: { type: "afterStep", stepId: "log" } },
  ] }],
};

test("./schedule's itinerary applies the LabMCP estimates, as analyzeSchedule does", () => {
  const anchor = { finishAt: "2026-11-26T18:00:00Z" };
  const expected = analyzeSchedule(labmcpProgram, anchor).steps.map(pick);
  assert.equal(expected.find((e) => e.stepId === "log").durationSeconds, 27);
  assert.deepEqual(S.itinerary(labmcpProgram, anchor).map(pick), expected);
  assert.deepEqual(R.itinerary(S.labmcp.withEstimates(labmcpProgram), anchor).map(pick), expected);
  // The core alone has no LabMCP catalogue: the generic instrument estimate.
  assert.equal(R.itinerary(labmcpProgram).find((e) => e.stepId === "log").durationSeconds, 60);
});

test("an empty or missing program gives an empty itinerary", () => {
  assert.deepEqual(R.itinerary({ tracks: [] }), []);
  assert.deepEqual(R.itinerary(null), []);
});

// ---------------------------------------------------------------- parity

function parityPrograms() {
  const out = [];
  const add = (label, file) => out.push([label, file]);
  for (const f of fs.readdirSync(path.join(__dirname, "fixtures", "schedule")).sort()) {
    if (f.endsWith(".json") && !f.includes("cases")) add(`fixtures/schedule/${f}`, path.join(__dirname, "fixtures", "schedule", f));
  }
  const programs = path.join(EXAMPLES, "programs");
  if (fs.existsSync(programs)) {
    for (const f of fs.readdirSync(programs).sort()) if (f.endsWith(".json")) add(`programs/${f}`, path.join(programs, f));
  }
  const gold = path.join(EXAMPLES, "gold");
  if (fs.existsSync(gold)) {
    for (const d of fs.readdirSync(gold).sort()) {
      const f = path.join(gold, d, "program.json");
      if (fs.existsSync(f)) add(`gold/${d}/program.json`, f);
    }
  }
  return out;
}


for (const anchor of [{}, { startAt: "2026-11-26T14:00:00-05:00" }, { finishAt: "2026-11-26T18:00:00Z" }]) {
  const label = Object.keys(anchor)[0] || "no anchor";
  test(`itinerary agrees with analyzeSchedule(...).steps (${label})`, (t) => {
    const files = parityPrograms();
    if (!fs.existsSync(path.join(EXAMPLES, "programs"))) t.diagnostic(`rhylthyme-examples not found at ${EXAMPLES}; fixtures only`);
    let compared = 0, withEstimates = 0;
    for (const [rel, file] of files) {
      const p = JSON.parse(fs.readFileSync(file, "utf8"));
      const expected = analyzeSchedule(p, anchor).steps.map(pick);
      assert.deepEqual(S.itinerary(p, anchor).map(pick), expected, `${rel} (./schedule)`);
      if (S.labmcp.withEstimates(p) === p) assert.deepEqual(R.itinerary(p, anchor).map(pick), expected, rel);
      else withEstimates++;
      compared++;
    }
    const lab = analyzeSchedule(labmcpProgram, anchor).steps.map(pick);
    assert.deepEqual(S.itinerary(labmcpProgram, anchor).map(pick), lab, "labmcpProgram (./schedule)");
    assert.ok(compared > 0);
    t.diagnostic(`${compared} programs compared (${withEstimates} with LabMCP estimates: ./schedule only)`);
  });
}
