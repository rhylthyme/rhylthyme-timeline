#!/usr/bin/env node
"use strict";

/**
 * Regenerate test/fixtures/engine-timings.json.
 *
 * computeStepTimings(program) for every corpus program: every step the
 * engine times (replicate instances included, unresolved steps too), keyed
 * by program file and step id. Other implementations that embed this engine
 * (the R package rhylthyme-r) assert they reproduce it exactly;
 * engine.test.js keeps it fresh.
 *
 * Usage (from rhylthyme-timeline):
 *
 *     node tools/gen-engine-timings.js [--check]
 *
 * `--check` exits non-zero if the file on disk is stale instead of rewriting
 * it. A timing change that is meant to happen regenerates this file, and the
 * copies in other repos then need updating (tools/check_mirrors.sh says which).
 */

const fs = require("fs");
const path = require("path");

const R = require("../src/index.js");
const FIXTURES = path.join(__dirname, "..", "test", "fixtures");
const PROGRAMS = path.join(FIXTURES, "programs");
const OUT_FILE = path.join(FIXTURES, "engine-timings.json");

function build() {
  const out = {
    generatedBy:
      "computeStepTimings (rhylthyme-timeline/src/index.js); regenerate with tools/gen-engine-timings.js",
    engineVersion: R.version,
    programs: {},
  };
  for (const name of fs.readdirSync(PROGRAMS).filter((f) => f.endsWith(".json")).sort()) {
    const program = JSON.parse(fs.readFileSync(path.join(PROGRAMS, name), "utf8"));
    const timings = R.computeStepTimings(program);
    const steps = {};
    for (const [stepId, t] of Object.entries(timings)) {
      steps[stepId] = { trackId: t.trackId, start: t.start, end: t.end, resolved: t.resolved };
    }
    out.programs[name] = steps;
  }
  return JSON.stringify(out, null, 1) + "\n";
}

module.exports = { build, OUT_FILE };

if (require.main === module) {
  const text = build();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf8") : "";
    if (current !== text) {
      console.error(`STALE: ${OUT_FILE} differs from the engine's current timings`);
      process.exit(1);
    }
    console.log(`up to date: ${OUT_FILE}`);
  } else {
    fs.writeFileSync(OUT_FILE, text);
    console.log(`wrote ${OUT_FILE} (${Object.keys(JSON.parse(text).programs).length} programs)`);
  }
}
