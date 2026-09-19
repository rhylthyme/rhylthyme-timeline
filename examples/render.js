#!/usr/bin/env node
// Kept for old instructions: `node examples/render.js <program.json> [out.svg|out.png]`.
// The renderer CLI now lives in bin/render.js (installed as `rhylthyme-render`)
// and takes the look, palette and legend options; see `--help`.
"use strict";
require("../bin/render.js").main(["--timings", ...process.argv.slice(2)]);
