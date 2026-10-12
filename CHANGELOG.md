# Changelog

All notable changes to this package are documented here. The format follows
Keep a Changelog; versions follow SemVer.

## [2.0.0-beta.8] - unreleased

### Changed
- **The chart key is off by default.** `renderTimelineSvg` no longer draws
  the legend (dependency, negative offset, indefinite, variable, manual,
  and the planned-vs-actual keys) unless asked: `legend: true` for the
  style's key, or a legend options object. `legend: false` and
  `{ show: false }` still hide it. Charts without it are shorter by the
  key's row. The player gains a `legend` attribute to show it; translated
  `legend*` labels no longer turn it on by themselves. `rhylthyme-render`
  draws it only with a `--legend*` option. The render snapshots are of the
  keyed drawing and are now checked with `legend: true`.

## [2.0.0-beta.7] - 2026-10-11

### Added
- `findingCodes` in `@rhylthyme/timeline/schedule` (and its browser entry,
  without the LabMCP catalogue): `src/schedule/finding-codes.json`, every
  code `validateProgram` can emit with its area, severities, summary,
  explanation, a triggering program fragment, fix and Python counterpart
  (`rhylthyme validate --json` and `validate_program_structured`). Types
  `FindingCodeCatalogue`, `FindingCode`, `FindingCodeExample`.
  `test/finding-codes.test.js` checks it both ways: every code literal in
  `src/schedule/*.js` and every schema keyword the checker reports is
  catalogued, every catalogued code is in the source, each example makes
  `validateProgram` report its code with its severity, the codes reported
  on test fixtures, rhylthyme-examples and the parity mutations are all
  catalogued, also with an instances error added to each (the path where
  schema findings do not quiet the logic checks), every finding helper call
  passes its code as a literal the scan reads, and (with Python) the Python
  column is right, `--strict` included (`python.strict`). The parity
  test's program builders moved to `test/helpers/parity-programs.js` so
  both tests share them.
- `itinerary(program, { startAt?, finishAt?, actual?, now? })` in the core
  engine: every expanded step in plan order with `name`, `trackName`,
  `instanceOf` / `instanceIndex`, seconds, `needsStart` / `needsFinish`,
  `task`, and ISO `startAt` / `endAt` when anchored (the same anchoring as
  `analyzeSchedule`). Lets an app list the plan without loading
  `./schedule` (#4). Types `ItineraryOptions` and `ItineraryEntry`;
  `test/itinerary.test.js` checks it against `analyzeSchedule(...).steps`
  on every rhylthyme-examples and gold program. The core has no LabMCP
  catalogue, so a LabMCP step with no duration gets the generic instrument
  estimate there.
- `itinerary` in `@rhylthyme/timeline/schedule`: the core `itinerary` after
  the LabMCP catalogue estimates, so it agrees with `analyzeSchedule` on
  every program.
- `labmcp.registerCatalog(catalog)` and `labmcp.hasCatalog()`;
  `labmcp.CATALOG` is now the registered catalogue or `null`.
- `<rhylthyme-timeline>`: `rt-step-began` and `rt-step-ended`, fired for
  every step (replicate instances and steps that start and end on their
  own included), exactly once per step per run, in time order within a
  tick, with `detail {stepId, time, by}`. `time` is the transition's own
  second, not the tick's. `by` is `person` or `plan` on began, and on
  ended the run record's `endedBy` with `executor` called `person`
  (`person`, `timer`, `trigger`, `abort`; `stop()` ends running steps
  with `abort`). A forward `seek()` fires what it passes over; a new
  `start()` after `stop()` is a fresh run. `rt-step-start` and
  `rt-step-complete` are unchanged. Typed in `RhylthymeTimelineEventMap`
  (`StepBeganBy`, `StepEndedBy`, `StepTransitionDetail`). (#6)
- `<rhylthyme-timeline>`: `by: 'dropped'` on `rt-step-ended`. When a run
  under way is dropped while steps are running (the program replaced
  through `program` or `src`, or the element removed from the document for
  good), each of them ends `dropped` at `currentTime` (clamped to the
  step's own begin after a backward seek, as `abort` ends are), in program
  order, before the `abandoned` run record. Begins and ends therefore
  always pair. Nothing else fires for that run: it is inert (`start()`,
  `pause()`, `seek()` do nothing; `startStep()` / `completeStep()` return
  `false`) until `stop()`, which fires only `rt-stop`, or a new program.
  An idle element (never started, stopped, completed) has no run to drop:
  removing it or replacing its program fires nothing, and its next
  `start()` is a normal run. The run record is unchanged (those steps stay
  open). `dropped` is not `abort`: filter it out to see only real ends; a
  framework re-render that swaps the program produces it. Added to
  `StepEndedBy`. (#6)
- `<rhylthyme-timeline>`: an `rt-seek` event, `detail {from, to}` in
  program-clock seconds, once per `seek()` that changes the time, after the
  step events a forward seek fires; a `seek()` from a handler queues
  behind the outer seek's `rt-seek`, so they arrive in call order. A
  backward seek still fires no step
  events (each step fires at most once per run); a host that mirrors the
  playhead resyncs from `stepStates` on `rt-seek`, a record-keeping host can
  ignore it. Typed as `SeekDetail` in `RhylthymeTimelineEventMap`. (#6)
- README: "Delivery guarantees and policies" under the element's events
  states the rule, reason and consequences for host pages of the three
  policies: dropped runs end with `dropped`; seeks never fire a step twice
  and announce themselves with `rt-seek`; a `stop()` called from a handler
  takes effect after the current batch (the rest of the batch, then the
  `abort` ends, then `rt-stop`), so the events always agree with the run
  record. The last is the existing behaviour, now documented; the one
  change is that the tick whose handler called `stop()` (or replaced the
  program) no longer fires a trailing `rt-tick` after `rt-stop`.
- `<rhylthyme-timeline>`: a `labels` property for translating the player
  (#7). Every user-visible string now comes from one `MESSAGES` table in
  `src/element.js`; `labels` merges a partial override over the English
  defaults, as strings (with `{0}`, `{1}`… placeholders) or functions.
  Unknown keys and non-string values are ignored, a throwing function
  falls back to English, and the text is always escaped. Typed as
  `RhylthymeTimelineLabels` in `types/element.d.ts`. English output is
  unchanged.
- Accessible buttons: the glyphs (▶ ❚❚ ■ ✓) are wrapped in
  `aria-hidden` spans and every transport, step and factor-form button
  carries an `aria-label` with its text. The status element gains a
  `data-status` attribute holding the untranslated state.
- The chart inside the player is translatable too: `chartSubtitle` and
  the `legend*` keys are passed to the renderer when set (English
  output unchanged).
- A `locale` attribute/property (opt-in): the clock, durations and speed
  options are formatted with `Intl` in that locale (`""`/`"auto"`: the
  browser's). Without it, times keep their fixed formats.
- `validateProgram` checks the JSON Schema too (#8). The 0.2.0-alpha and
  0.3.0-alpha program schemas from rhylthyme-spec are bundled
  (`src/schedule/schemas/`, byte-for-byte copies) and checked by a small
  zero-dependency Draft 7 checker (`src/schedule/json-schema.js`) for the
  keywords they use, with Python `jsonschema`'s semantics: `oneOf` means
  exactly one, `integer` rejects 2.5 and `"2"`, `format` is not checked,
  siblings of `$ref` are ignored. `schemaVersion` 0.3.x selects
  0.3.0-alpha, anything else 0.2.0-alpha. Failures are errors coded
  `schema_<keyword>` with a `where` path and a `fix`. Time strings are
  read as seconds first, as the Python validator does; the authored
  program is checked, then (when that passes) the expanded one.
- `schemaFindings(program)`, `programSchema(schemaVersion)` and
  `checkJsonSchema(value, schema)` in `./schedule`, with types.
- `test/parity.test.js`: the issue #8 programs and schema mutations of
  every example program (a required key dropped, a wrong type, a float for
  an integer, an ambiguous `oneOf`, unknown keys) must get the same
  verdict from JS and Python.
- `<rhylthyme-timeline labels='{"stop":"Arrêter","startStep":"Démarrer : {0}"}'>`:
  the player's translations can be set from HTML as a JSON object of
  strings (`{0}`, `{1}`… placeholders included), observed like the other
  attributes. As with `data-factors` / `factors`, whichever of the
  attribute and the `labels` property was set last supplies the whole
  table, and the getter returns the table in effect. A value that is not
  a JSON object is ignored with one `console.warn`, keeping the labels in
  effect; removing the attribute clears the labels it supplied. Writing
  the attribute again with the value it already has counts as setting it
  (the same now holds for `data-factors`).

### Changed
- `<rhylthyme-timeline>`: removing the element no longer drops its run at
  once. The decision runs in a microtask queued at disconnect: an element
  re-inserted synchronously (`appendChild` to another parent, or
  `remove()` and re-insert with no `await` in between) has been moved,
  keeps its run, and its clock resumes; any `await`, `setTimeout` or later
  render before the re-insert counts as removal for good;
  previously any disconnect abandoned the run and left the moved element
  showing "running" with no clock. As a result, the `abandoned` run record
  of an element removed mid-run arrives a microtask after `remove()`
  rather than during it. Replacing the program still drops the run
  synchronously.
- `@rhylthyme/timeline/schedule` no longer bundles the 350 KB LabMCP
  instrument catalogue for browsers (#5). The Node entry (`require` and
  `import`) still registers it, so Node results are unchanged. A new
  `browser` export condition gives the module without it, the side-effect
  subpath `@rhylthyme/timeline/schedule/labmcp-catalog` registers it
  (eagerly or through a lazy `import()`), and `browser/labmcp-catalog.js`
  does the same for `browser/schedule.js` (465 KB → 223 KB). Without the
  catalogue, a LabMCP step gets an `instrument_catalog_not_loaded` warning
  instead of its call checks, and programs without LabMCP steps are
  unaffected. `validateProgram` and `analyzeSchedule` stay synchronous.
- Programs that break the schema are now invalid in JS as they already
  were in Python. Most visible: a program with no `resourceConstraints`,
  `environment` or `environmentType` (`schema_anyOf`; add
  `"resourceConstraints": []`), an indefinite step without
  `defaultSeconds` (`schema_oneOf`), a missing track or step `name`
  (`schema_required`, previously a warning only), and a string or
  fractional `maxConcurrent` (`schema_type`).
- `browser/schedule.js` grows by about 77 KB (14 KB gzipped) for the two
  schemas and the checker.
- `validateProgram` checks the JSON Schema on the expanded program only, as
  the Python validator does, instead of on the authored program and then
  the expanded one. Programs whose authored form breaks the schema but
  whose expansion does not are now accepted on both sides (a number as a
  replicated step's or track's name, a replicate `count` of 0, a track
  without steps, which expansion leaves out with an `empty_track`
  warning; a `replicates` of `null`, `[]` or `{}`, which Python's expander
  treats as absent). A program the expander cannot run on (a track with no
  `trackId`; a replicated track or step with no `name` or `stepId`; a
  replicate `count` or legacy `batch_size` that is not a whole number; a
  replicated step whose `mode` is not parallel, serial or stagger), where
  Python's expander raises or drops the step, is checked as written; an expansion that fails reports
  `expansion_failed` together with the schema findings on the program as
  written, as Python does. Schema paths are moved back to the authored
  program: a finding on a replicate copy is reported once, at the step or
  track it is copied from, and its message names the copy.
- Each problem the schema reports is reported once, by its `schema_*`
  finding. These logic-check codes are gone: `missing_program_id`,
  `missing_name`, `no_tracks`, `bad_track`, `bad_step`,
  `missing_track_id`, `missing_track_name`, `missing_step_id`,
  `missing_step_name`, `missing_start_trigger`, `bad_duration_type`,
  `fixed_without_seconds`, `variable_without_bounds`,
  `indefinite_without_default`, `choice_too_few_options` and `bad_alert`.
  `compound_without_triggers`, `bad_trigger_logic`, `bad_trigger`,
  `unknown_trigger_type`, `trigger_without_step_id`,
  `buffer_without_seconds`, `bad_trigger_event`, `offset_without_seconds`,
  `bad_resource_constraint`, `bad_max_concurrent` and `unparseable_duration`
  remain only for what the schema accepts (`{"type": "programStart",
  "logic": "xor"}`, an empty task name, `seconds: "abc"`), and an overlap
  is no longer reported for a step whose `startTrigger` the schema rejects.
  An empty `programId`, `name` or `stepId` string is no longer an error
  (the schema and Python accept it).
- The `schema_*` findings say more: the fix for a missing `programId`,
  track or step `name`, `stepId` or `startTrigger` carries the advice the
  old codes gave (the startTrigger fix names the step before it), a
  message on a track or step names its id (`tracks[0].steps[2].duration
  (step "bake") ...`), an unknown duration or trigger `type` lists every
  allowed value, a missing top-level key is `schema_required` rather than
  part of `schema_anyOf`, the fix names every key the closest shape lacks,
  and a value of the wrong type is one `schema_type` finding, not also a
  `schema_oneOf` one.

### Fixed
- `startStep(id)` (and a gate's *Start* button) on a stopped player now
  starts a run first, as the transport's Start would. Before, the step
  went active on a clock that never moved and no `rt-step-began` fired.
  If the program declares variance factors, the form opens instead and
  `startStep` returns `false`.
- `analyzeSchedule(...).steps` (and `itinerary`) link the steps of a
  replicated track (`replicates` or legacy `batch_size` on the track) to
  their authored step through `instanceOf` / `instanceIndex`; they were
  `null`. `expandReplicates` itself is unchanged.
- An epoch-ms anchor of `0` (`startAt` / `finishAt`) is no longer ignored by
  `itinerary` or `analyzeSchedule`.
- Setting `labels` while the variance-factor form is open no longer
  erases what was typed or hides the error shown; the error is re-worded
  in the new labels.
- A `noProgram` function override receives `'program'` and `'src'`, not
  internal placeholders; templates still draw `{0}`/`{1}` as `<code>`.
- Properties set on a `<rhylthyme-timeline>` before `element.js` defined
  it (`program`, `labels`, `factors`, `predictions`, `mode`, `speed`,
  `timeFormat`, `locale`, `startAt`) are now passed through the element's
  setters when it upgrades. They used to stay as plain own properties
  that hid the element's accessors, so `el.labels` (for one) returned the
  raw object while the player showed something else. Where such a
  property and its attribute (`src`, `labels`, `data-factors`,
  `data-predictions`) were both present at upgrade, the property wins.

## [2.0.0-beta.6] - 2026-10-11

### Added
- `@rhylthyme/timeline/schedule`: the program validator and schedule
  analyzer from the MCP server (`validateProgram`, `analyzeSchedule`,
  `formatValidation`, `formatAnalysis`, the instance and alert checks,
  and the `galago`, `labmcp` and `history` helpers), moved here from
  rhylthyme-server's `mcp-api/` with their tests. Still zero dependencies.
  `browser/schedule.js` is the same module as one classic script
  (`window.RhylthymeSchedule`), built by `npm run build`.
- ES module entries (`esm/index.mjs`, `esm/schedule.mjs`) with every
  function as a named export, wired through `exports` conditions.
- Hand-written TypeScript types (`types/`): `Program` and its parts, the
  engine and renderer, `./schedule`, and the element (tag map, typed
  `rt-*` events). `tools/check-types.sh` compiles real use against the
  packed tarball in CI.
- `test/parity.test.js`: the JS and Python validators must agree on every
  program in rhylthyme-examples and on each invalid file's code.

### Fixed
- `import '@rhylthyme/timeline/element'` in a bundler no longer throws
  "load src/index.js (the engine) first": the element requires the engine
  when it runs as a module instead of reading `window.Rhylthyme`.

## [2.0.0-beta.5] - 2026-10-11

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
