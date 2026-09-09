#!/usr/bin/env node
// Render a Rhylthyme program to SVG (and PNG if @resvg/resvg-js is installed).
//
//   node examples/render.js test/fixtures/programs/thanksgiving_one_oven.json out.svg
//   node examples/render.js my-program.json out.png      # needs: npm i @resvg/resvg-js
//
// Also prints the resolved start/end of every step, which is what the
// renderer draws.
"use strict";

const fs = require("fs");
const path = require("path");
const Rhylthyme = require("../src/index.js");

const [, , input, output] = process.argv;
if (!input) {
  console.error("usage: node examples/render.js <program.json> [out.svg|out.png]");
  process.exit(1);
}

const program = JSON.parse(fs.readFileSync(input, "utf8"));
const timings = Rhylthyme.computeStepTimings(program);

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
for (const track of program.tracks || []) {
  for (const step of track.steps || []) {
    const t = timings[step.stepId];
    console.log(`${fmt(t.start).padStart(7)} – ${fmt(t.end).padStart(7)}  ${track.name}: ${step.name}${t.resolved ? "" : "  (unresolved)"}`);
  }
}

const svg = Rhylthyme.renderTimelineSvg(program);
const out = output || path.basename(input, ".json") + ".svg";
if (out.endsWith(".png")) {
  let Resvg;
  try { ({ Resvg } = require("@resvg/resvg-js")); }
  catch (e) { console.error("PNG output needs @resvg/resvg-js: npm i @resvg/resvg-js"); process.exit(1); }
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1640 }, background: "#fafafa" }).render().asPng();
  fs.writeFileSync(out, png);
} else {
  fs.writeFileSync(out, svg);
}
console.log(`wrote ${out}`);
