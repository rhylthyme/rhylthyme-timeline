#!/usr/bin/env node
"use strict";

/**
 * Regenerate test/fixtures/render-snapshots.json.
 *
 * One SHA-256 per corpus program for `renderTimelineSvg(program)` with the
 * default options, plus one for the Thanksgiving planned-vs-actual overlay
 * (`{ run: record }`). render.test.js asserts these, which is what keeps a
 * change to the renderer from silently moving a drawing that is not supposed
 * to move: adding an option must leave every default drawing byte-identical.
 *
 * Usage (from rhylthyme-timeline):
 *
 *     node tools/gen-render-snapshots.js [--check]
 *
 * `--check` exits non-zero if the file on disk is stale instead of rewriting
 * it. Regenerate (and say why in CHANGELOG.md) only when the drawing was
 * meant to change.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const R = require("../src/index.js");
const FIXTURES = path.join(__dirname, "..", "test", "fixtures");
const PROGRAMS = path.join(FIXTURES, "programs");
const RUNS = path.join(FIXTURES, "runs");
const OUT_FILE = path.join(FIXTURES, "render-snapshots.json");

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function entry(svg) {
  return { length: svg.length, sha256: sha256(svg) };
}

function build() {
  const out = {
    generatedBy:
      "renderTimelineSvg (rhylthyme-timeline/src/index.js); regenerate with tools/gen-render-snapshots.js",
    note:
      "default = renderTimelineSvg(program); overlay = renderTimelineSvg(program, { run: record }).",
    default: {},
    overlay: {},
  };
  for (const name of fs.readdirSync(PROGRAMS).filter((f) => f.endsWith(".json")).sort()) {
    const program = JSON.parse(fs.readFileSync(path.join(PROGRAMS, name), "utf8"));
    out.default[name] = entry(R.renderTimelineSvg(program));
  }
  for (const name of fs.readdirSync(RUNS).filter((f) => f.endsWith(".run.json")).sort()) {
    const record = JSON.parse(fs.readFileSync(path.join(RUNS, name), "utf8"));
    const programName = name.replace(/\.run\.json$/, ".json");
    const program = JSON.parse(fs.readFileSync(path.join(PROGRAMS, programName), "utf8"));
    out.overlay[programName] = entry(R.renderTimelineSvg(program, { run: record }));
  }
  return JSON.stringify(out, null, 1) + "\n";
}

const text = build();
if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, "utf8") : "";
  if (current !== text) {
    console.error(`STALE: ${OUT_FILE} differs from the regenerated snapshots`);
    process.exit(1);
  }
  console.log(`up to date: ${OUT_FILE}`);
} else {
  fs.writeFileSync(OUT_FILE, text);
  const counts = JSON.parse(text);
  console.log(
    `wrote ${OUT_FILE} (${Object.keys(counts.default).length} default, ` +
      `${Object.keys(counts.overlay).length} overlay)`
  );
}
