# Changelog

All notable changes to this package are documented here. The format follows
Keep a Changelog; versions follow SemVer.

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
