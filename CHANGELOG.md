# Changelog

All notable changes to this package are documented here. The format follows
Keep a Changelog; versions follow SemVer.

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
