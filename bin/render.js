#!/usr/bin/env node
// Render a Rhylthyme program to a figure: SVG, or PNG / PDF when a
// rasteriser is available (rsvg-convert on PATH, or @resvg/resvg-js for PNG).
//
//   rhylthyme-render program.json -o figure.svg --style publication
//   rhylthyme-render program.json -o figure.pdf --style publication \
//       --color-by task --palette okabe-ito --legend right --legend-title Resources
//   rhylthyme-render program.json --run run.json -o overlay.png --style web
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const Rhylthyme = require("../src/index.js");

const HELP = `Usage: rhylthyme-render <program.json> [options]

Output
  -o, --output FILE        .svg (default: <program>.svg), .png or .pdf
      --scale N            PNG pixels per SVG unit (default 2)
      --timings            Also print each step's resolved start and end

Look
      --style NAME         classic (default) | web | publication
      --palette NAME       ${Object.keys(Rhylthyme.PALETTES).join(" | ")}
                           or a comma-separated list of hex colours
      --color-by KEY       track (default) | task
      --color KEY=HEX      Pin one track id, track name or task (repeatable)
      --width PX           Figure width in SVG units (default 820)
      --row-height PX      Height of one track row
      --font-family CSS    e.g. "Helvetica, Arial, sans-serif"
      --font-scale N       Grow all type and rows, e.g. 1.25
      --background COLOR   Hex colour, or "none" for transparent
      --title TEXT         Title text;  --no-title to omit it
      --subtitle TEXT      Right-hand header text;  --no-subtitle to omit it
      --brand / --no-brand Footer mark

Axis and labels
      --time-format F      clock (0:30, 1:00) | minutes (30m, 1h)
      --start-at ISO       Label the axis with wall-clock times from this start
      --tick-interval SEC  Seconds between ticks
      --axis-title TEXT    Axis title;  --no-axis-title to omit it
      --label-overflow M   truncate | hide | outside (beside the bar)
      --durations          Append each step's duration to its label
      --no-grid  --no-arrows  --no-marks

Legend
      --legend POS         bottom (default) | top | right | none
      --legend-items LIST  Comma-separated keys, shown as listed:
                           tracks, tasks, dependency, negative-offset,
                           indefinite, variable, manual, barrier, barrier-any,
                           in-flight, planned, late, early, on-time
      --legend-label K=T   Rename one key, e.g. dependency="Finish-to-start"
      --legend-title TEXT  --legend-columns N  --legend-frame
      --legend-all         List every key, not only the ones in the drawing

Planned vs actual
      --run FILE           A run record: draws actual bars over the plan
`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { legend: {}, colors: {} };
  const out = { input: null, output: null, scale: 2, timings: false, run: null, opts };
  const need = (i, flag) => (i < argv.length ? argv[i] : fail(`${flag} needs a value`));
  const pair = (text, flag) => {
    const at = text.indexOf("=");
    if (at < 1) fail(`${flag} expects KEY=VALUE`);
    return [text.slice(0, at), text.slice(at + 1)];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h": case "--help": process.stdout.write(HELP); process.exit(0); break;
      case "-o": case "--output": out.output = need(++i, a); break;
      case "--scale": out.scale = Number(need(++i, a)); break;
      case "--timings": out.timings = true; break;
      case "--run": out.run = need(++i, a); break;
      case "--style": opts.style = need(++i, a); break;
      case "--palette": {
        const v = need(++i, a);
        opts.palette = v.includes("#") ? v.split(",").map((s) => s.trim()) : v;
        break;
      }
      case "--color-by": opts.colorBy = need(++i, a); break;
      case "--color": { const [k, v] = pair(need(++i, a), a); opts.colors[k] = v; break; }
      case "--width": opts.width = Number(need(++i, a)); break;
      case "--row-height": opts.rowHeight = Number(need(++i, a)); break;
      case "--font-family": opts.fontFamily = need(++i, a); break;
      case "--font-scale": opts.fontScale = Number(need(++i, a)); break;
      case "--background": opts.background = need(++i, a); break;
      case "--title": opts.title = need(++i, a); break;
      case "--no-title": opts.title = false; break;
      case "--subtitle": opts.subtitle = need(++i, a); break;
      case "--no-subtitle": opts.subtitle = false; break;
      case "--brand": opts.brand = true; break;
      case "--no-brand": opts.brand = false; break;
      case "--time-format": opts.timeFormat = need(++i, a); break;
      case "--start-at": opts.startAt = need(++i, a); break;
      case "--tick-interval": opts.tickInterval = Number(need(++i, a)); break;
      case "--axis-title": opts.axisTitle = need(++i, a); break;
      case "--no-axis-title": opts.axisTitle = false; break;
      case "--label-overflow": opts.labelOverflow = need(++i, a); break;
      case "--durations": opts.showDurations = true; break;
      case "--no-grid": opts.grid = false; break;
      case "--no-arrows": opts.arrows = false; break;
      case "--no-marks": opts.marks = false; break;
      case "--legend": opts.legend.position = need(++i, a); break;
      case "--legend-items": opts.legend.items = need(++i, a).split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--legend-label": {
        const [k, v] = pair(need(++i, a), a);
        (opts.legend.labels = opts.legend.labels || {})[k] = v;
        break;
      }
      case "--legend-title": opts.legend.title = need(++i, a); break;
      case "--legend-columns": opts.legend.columns = Number(need(++i, a)); break;
      case "--legend-frame": opts.legend.frame = true; break;
      case "--legend-all": opts.legend.onlyUsed = false; break;
      default:
        if (a.startsWith("-")) fail(`Unknown option ${a}\n\n${HELP}`);
        if (!out.input) out.input = a;
        else if (!out.output) out.output = a; // legacy: render.js <program> <out>
        else fail(`Unexpected argument ${a}`);
    }
  }
  if (opts.style && !Rhylthyme.STYLES.includes(opts.style)) fail(`--style must be one of ${Rhylthyme.STYLES.join(", ")}`);
  if (typeof opts.palette === "string" && !Rhylthyme.PALETTES[opts.palette]) fail(`Unknown palette "${opts.palette}". Known: ${Object.keys(Rhylthyme.PALETTES).join(", ")}`);
  if (!Object.keys(opts.colors).length) delete opts.colors;
  if (!Object.keys(opts.legend).length) delete opts.legend;
  return out;
}

function hasRsvg() {
  const r = spawnSync("rsvg-convert", ["--version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

function convert(svg, file, scale, background) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") {
    if (!hasRsvg()) fail("PDF output needs rsvg-convert on PATH (macOS: brew install librsvg; Debian: apt install librsvg2-bin).");
    const r = spawnSync("rsvg-convert", ["-f", "pdf", "-o", file], { input: svg });
    if (r.status !== 0) fail(`rsvg-convert failed: ${r.stderr}`);
    return;
  }
  if (hasRsvg()) {
    const r = spawnSync("rsvg-convert", ["-f", "png", "-z", String(scale), "-o", file], { input: svg });
    if (r.status !== 0) fail(`rsvg-convert failed: ${r.stderr}`);
    return;
  }
  let Resvg;
  try { ({ Resvg } = require("@resvg/resvg-js")); } catch (e) {
    fail("PNG output needs rsvg-convert on PATH or the @resvg/resvg-js package (npm i @resvg/resvg-js).");
  }
  const width = Number(/width="(\d+)"/.exec(svg)[1]) * scale;
  const png = new Resvg(svg, { fitTo: { mode: "width", value: width }, background }).render().asPng();
  fs.writeFileSync(file, png);
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.input) { process.stdout.write(HELP); process.exit(1); }
  const program = JSON.parse(fs.readFileSync(args.input, "utf8"));
  const opts = args.opts;
  if (args.run) opts.run = JSON.parse(fs.readFileSync(args.run, "utf8"));

  if (args.timings) {
    const timings = Rhylthyme.computeStepTimings(program);
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
    for (const track of Rhylthyme.expandReplicates(program).tracks || []) {
      for (const step of track.steps || []) {
        const t = timings[step.stepId];
        if (t) console.log(`${fmt(t.start).padStart(7)} – ${fmt(t.end).padStart(7)}  ${track.name}: ${step.name}${t.resolved ? "" : "  (unresolved)"}`);
      }
    }
  }

  const svg = Rhylthyme.renderTimelineSvg(program, opts);
  if (!svg) fail("Nothing to draw: the program has no steps.");
  const out = args.output || path.basename(args.input, path.extname(args.input)) + ".svg";
  if (/\.(png|pdf)$/i.test(out)) convert(svg, out, args.scale > 0 ? args.scale : 2, opts.background || (opts.style && opts.style !== "classic" ? "#ffffff" : "#fafafa"));
  else fs.writeFileSync(out, svg);
  console.log(`wrote ${out}`);
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { parseArgs, main };
