# Changelog

All notable changes to this package are documented here. The format follows
Keep a Changelog; versions follow SemVer.

## [Unreleased]

### Added
- `renderTimelineSvg` looks. `style: 'web'` follows the interactive
  timeline (its `vivid` palette, flat bars, dark axis, clock labels);
  `style: 'publication'` is tuned for figures (white page, no brand mark or
  title, axis title, Helvetica/Arial, full track names, step names set
  beside a bar that is too short for them, labels drawn above the arrows).
  New options: `palette` (the interactive timeline's seven palettes plus
  `okabe-ito` and `grayscale`, or an array), `colorBy: 'track' | 'task'`,
  `colors`, a configurable `legend` (`position`, `items`, `labels`,
  `title`, `columns`, `frame`, `onlyUsed`, `capacity`), `title`,
  `subtitle`, `brand`, `background`, `fontFamily`, `fontScale`,
  `rowHeight`, `labelWidth`, `timeFormat`, `startAt` (wall-clock axis),
  `tickInterval`, `axisTitle`, `grid`, `labelOverflow`, `showDurations`,
  `tooltips`, `fontWidthFactor` (for rasterisers that substitute a wider
  face). Bar text picks dark or white ink from the bar's luminance;
  long programs get a sensible number of ticks. Exports `PALETTES`,
  `STYLES`, `textWidth`. **The default (`classic`) drawing is unchanged**:
  the snapshot hashes were not regenerated.
- `rhylthyme-render` (`bin/render.js`): program JSON to SVG, PNG or PDF
  with every option above as a flag. `examples/render.js` forwards to it.
- Predicted offsets in `<rhylthyme-timeline>`. A program with
  `metadata.offsetsUse: "predicted"` (program schema 0.3.0-alpha) resolves
  a NEGATIVE `offsetSeconds` against a *predicted* end of the step it is
  anchored on instead of that step's authored `defaultSeconds`. Supply the
  predictions with the new `predictions` property (or the
  `data-predictions` attribute), `{stepId: {seconds, low, high, basis}}`
  exactly as `predict_durations` / `analyze_schedule` return them. A
  prediction is used only for an `indefinite` anchor, only when `basis` is
  not `"none"`, and only when it is sharper than the guess
  (`high - low < defaultSeconds`); otherwise the authored number is used
  unchanged. It is applied by resolving a program COPY carrying the
  predicted `defaultSeconds`, so the frozen `planned` block of the run
  record and any drawing made from `computeStepTimings(program)` still come
  from the program as authored. New read-only `offsetsUse` and
  `predictedAnchors` properties expose what is in force. Without the flag
  the `predictions` property changes nothing.
- Run records carry which durations the run's offsets were resolved
  against: `context.offsetsUse` (`"planned"` | `"predicted"`) and, on each
  step gated by a negative offset that used a prediction,
  `predictedAnchorSeconds` (runs schema 0.1.0-alpha).
- Planned-vs-actual rendering. `renderTimelineSvg` takes `baseline` (a
  second timings map, normally `computeStepTimings(program)`): every step
  it covers gets a thin ghost bar under its own bar at the planned
  position (`<rect class="rt-baseline" data-step>`), rows grow to fit
  both, and each bar is outlined by the sign of its end deviation and
  tagged `data-deviation="early" | "late" | "on-time"` with
  `data-deviation-seconds`. `deviationThreshold` (default 30 s) sets the
  on-time dead band and is named in the four new legend keys. Passing a
  run record as `run` is shorthand for
  `{ timings: timingsFromRun(program, run), baseline: computeStepTimings(program) }`.
  Without either option every drawing is byte-identical to 2.0.0-beta.3,
  asserted over the whole corpus by `test/fixtures/render-snapshots.json`
  (regenerate with `tools/gen-render-snapshots.js`).
- `actualFromRun(record, program?, opts?)`, `timingsFromRun(program,
  record, opts?)` and `runtimeStepId(entry, knownIds?)` map a run record
  (rhylthyme-spec `runs` schema 0.1.0-alpha) onto expanded step ids and
  into `computeStepTimings`' `actual`. `opts.endsOnly` keeps only the
  observed ends.
- Replay parity: `test/fixtures/runs/thanksgiving_one_oven.run.json` (a
  recorded run of the Thanksgiving example, written by
  `tools/gen-run-fixture.py`) is fed back into the engine as ends-only
  actuals and every start it resolves matches the `triggerFiredAt` the
  runtime recorded, within 0.5 s. `manual` gates and negative offsets are
  excluded: the executor picks the moment for the first, and the second is
  fired by the live runtime from the anchor's *projected* end, which the
  observed end has since contradicted. (`event: "start"` was excluded too
  until the CLI runner learned to anchor on the referenced step's start, as
  this engine does.) The Python half of the check is
  `rhylthyme-cli-runner/tests/test_replay.py`.
- `engine.test.js` now also asserts `test/fixtures/hash-parity.json`
  through `tools/hash-program.js`, so `programVersion` parity with Python
  is checked from both sides.
- `expandReplicates` understands program schema 0.3.0-alpha `instances`
  on `afterStep` / `afterStepWithBuffer`: `"each"` replicates the
  referencing step once per instance of the replicated step (paired
  i -> i, transitive, offset/buffer/event preserved, placed in instance
  i's sub-track; serial replicates get per-instance sub-tracks
  `<trackId>--<stepId>-r<i>`), `"all"` is an explicit `compound{all}`
  barrier (the existing default join), `"any"` a `compound{any}`.
  Expanded instances carry `instanceOf` / `instanceIndex`; sub-tracks
  carry `parentTrackId`. No `instances` key survives expansion, so
  `computeStepTimings` and the renderer see only 0.2.0 constructs.
- `supportedSchemaVersions` includes `0.3.0-alpha`.
- `tools/gen-python-timings.py` regenerates
  `test/fixtures/python-timings.json` from the Python reference resolver;
  fixtures may declare `metadata.expectedTimings`, which the engine test
  asserts on both sides. Parity corpus is now 43 programs / 685 steps
  (adds `cookies_three_trays.json`, `pcr_twelve_samples.json` and
  `airport_landings_taxi_gate.json`).
- `expandReplicates` understands `replicates.maxInFlight` (0.3.0-alpha):
  for a replicated step with `maxInFlight: k`, every instance past the
  k-th gets one synthetic `afterStep` per leaf chain, on instance i-k of
  the last `instances: "each"` descendant (on the step itself when it has
  none, which makes a parallel fan-out a rolling window). The gate is
  merged into the instance's own trigger under `logic: "all"` and tagged
  `_synthetic: "inFlight"` with `inFlightOf` / `inFlightLimit`; the tags
  are inert for `computeStepTimings` and stop a second expansion pass
  from matching the trigger.
- `renderTimelineSvg` draws each in-flight gate as a dotted, labelled
  arrow (`<g class="rt-inflight" data-inflight-of data-limit data-from
  data-step>`, `stroke-dasharray="1.5,3"`, label `<task> <= <k>`) from the
  leaf instance to the instance it holds back, never as an ordinary
  dependency arrow, with an "in-flight limit" legend key when one is
  drawn. Barrier detection ignores synthetic sub-triggers.

### Changed
- `test/fixtures/runs/thanksgiving_one_oven.run.json` regenerated: the CLI
  runner that produces it now fires `event: "start"` triggers from the
  referenced step's start and negative offsets from the anchor's projected
  end, so `salad` and the whole potato chain run earlier than before. The
  overlay entry in `test/fixtures/render-snapshots.json` moved with it; no
  default drawing changed.

### Fixed
- `player/build.js`: `markStaggerFloats` now reaches the staggered
  `offsetSeconds` of an instance whose trigger the in-flight pass wrapped
  in a compound, keeping the page byte-identical to the Python visualizer.

## [2.0.0-beta.3] - 2026-09-10

### Changed
- Shorter SVG legend labels: dependency, negative offset, indefinite,
  variable, manual.

## [2.0.0-beta.2] - 2026-09-10

### Changed
- `renderTimelineSvg` restyled to match the web player: dependency edges
  are cubic Bézier S-curves (horizontal for forward hops, vertical for
  near-vertical and backward negative-offset hops) with a fixed-size
  arrowhead; bars have larger rounded corners, a white outline and a soft
  drop shadow; light vertical gridlines run down from the axis ticks;
  track labels and bar labels are semibold. Bars keep `class="rt-bar"`
  and `data-step`; edges gain `class="rt-edge"`.

## [2.0.0-beta.1] - 2026-09-09

Pre-release of the player Web Component. The engine API is unchanged and
1.x-compatible; the major bump marks the new element API as part of the
public surface once it leaves beta.

### Added
- `src/element.js`: `<rhylthyme-timeline>` custom element (shadow DOM,
  `light` / `dark` / `cookbook` presets, `--rt-*` custom properties).
  Attributes `src`, `mode`, `speed`, `time-format`, `start-at`, `theme`,
  `view`; `program` property; `start/pause/stop/toggle/seek`,
  `startStep`, `completeStep`; `rt-*` events. Exported as
  `@rhylthyme/timeline/element`.
- `computeStepTimings(program, { actual, now })`: actual start/end
  overrides and a current time, so manual gates float forward until
  started and indefinite steps stretch until finished. Downstream steps
  re-plan from the engine, not from a second routine.
- `renderTimelineSvg` options `timings`, `now` (cursor), `states`
  (done / active / waiting bar styling) and `width`; bars carry
  `class="rt-bar"` and `data-step`.
- `stepNeedsStart(step)` and `stepNeedsFinish(step)` exports.
- `examples/player.html` demo; `test/element.test.js` drives the element
  in headless Chrome through a full run with a fake clock.

## [1.4.1] - 2026-09-09

### Changed
- The player template no longer carries the rhylthyme.com "Request a
  video" sticker (a server-side upsell); the export and the parity
  fixture strip it together.
- README: the static SVG is one section (`renderTimeline` only injects
  `renderTimelineSvg`'s output into the DOM).

## [1.4.0] - 2026-09-09

### Added
- `player/`: the interactive visualizer from rhylthyme-server (timeline
  with live cursor and playback controls, itinerary, DAG, resources,
  editor). `player/template.html` is exported from the server's
  `web_visualizer.py`; `player/build.js` ports the Python that fills it
  (`extract_step_dependencies`, `calculate_timeline_data`, the page's
  scalar fields, Python-compatible `json.dumps`) and is exposed as
  `require('@rhylthyme/timeline/player').buildPlayerHtml(program, environment?)`
  and as a CLI. `test/player.test.js` checks the output is byte-identical
  to the server's for all 39 corpus programs.
- `examples/index.html`: dependency-free browser demo of `renderTimeline`.

## [1.3.0] - 2026-09-09

### Added
- `expandReplicates(program)`: port of the Python `expand_replicates`
  (track and step `replicates` in parallel / stagger / serial modes, legacy
  `batch_size` + `stagger`). Applied automatically by `computeStepTimings`
  and `renderTimelineSvg`, so programs with replicates now resolve exactly
  as the Python validator resolves them.

### Changed
- Indefinite steps without `defaultSeconds` plan as a 60 s placeholder
  (previously 0), matching the Python validator.
- The parity test now covers every program in the corpus with no
  exclusions; the Python validator was fixed in step (it now honours
  `bufferSeconds`, resolves negative offsets against the planned end, and
  parses unit strings), so the two implementations agree on 616 steps
  across 39 programs.

## [1.2.0] - 2026-09-08

Extracted from `rhylthyme-server/static/js/timeline-render.js` into its own
package with no code changes relative to the copy shipped there.

### Added
- Cross-track dependency arrows in `renderTimelineSvg` (dashed when the
  offset is negative), staggered so arrows into the same row do not overprint.
- Marks for step kinds: hatched, dashed-border bars for indefinite steps; a
  faded extension from default to maximum for variable steps; a flag on
  steps gated by a manual trigger.
- One-line legend and a right-aligned track/total subtitle.
- `opts` argument on `renderTimelineSvg` / `renderTimeline`
  (`{ arrows, marks, legend }`).
- `supportedSchemaVersions` export.

## [1.1.0] - 2026-09-06

### Added
- `parseSeconds` and `stepDurationSeconds` exports.
- Trigger support for `afterStepWithBuffer`, `event: "start"`, `onAbort`,
  compound `all` / `any` triggers, and unit-string offsets and durations.
- `resolved` flag and `trackId` on each timing.

### Fixed
- Unit-string durations (`"5m"`, `"1h30m"`) no longer resolve to `NaN`.
- Negative offsets are honoured instead of ignored.

## [1.0.0] - 2026

Initial standalone renderer: `computeStepTimings`, `renderTimelineSvg`,
`renderTimeline`.
