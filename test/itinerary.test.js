"use strict";
// itinerary(program, opts): the plan as a list, from the core engine. The
// last tests hold it to analyzeSchedule(...).steps (./schedule) on every
// program we have, so the two cannot drift apart.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const R = require("../src/index.js");
const { analyzeSchedule } = require("../src/schedule");

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

const FIELDS = ["stepId", "name", "trackId", "instanceOf", "instanceIndex", "startSeconds", "endSeconds", "durationSeconds", "task", "startAt", "endAt"];
const pick = (e) => Object.fromEntries(FIELDS.map((k) => [k, e[k]]));

for (const anchor of [{}, { startAt: "2026-11-26T14:00:00-05:00" }, { finishAt: "2026-11-26T18:00:00Z" }]) {
  const label = Object.keys(anchor)[0] || "no anchor";
  test(`itinerary agrees with analyzeSchedule(...).steps (${label})`, (t) => {
    const files = parityPrograms();
    if (!fs.existsSync(path.join(EXAMPLES, "programs"))) t.diagnostic(`rhylthyme-examples not found at ${EXAMPLES}; fixtures only`);
    let compared = 0;
    for (const [rel, file] of files) {
      const p = JSON.parse(fs.readFileSync(file, "utf8"));
      const expected = analyzeSchedule(p, anchor).steps.map(pick);
      const actual = R.itinerary(p, anchor).map(pick);
      assert.deepEqual(actual, expected, rel);
      compared++;
    }
    assert.ok(compared > 0);
    t.diagnostic(`${compared} programs compared`);
  });
}
