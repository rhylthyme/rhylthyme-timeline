# @rhylthyme/timeline

Timing engine and static Gantt renderer for [Rhylthyme](https://www.rhylthyme.com)
programs. Zero dependencies, one UMD file, runs in the browser, Node and ESM.

A Rhylthyme program is JSON describing parallel **tracks** of sequential
**steps**, each with a duration (fixed, variable or indefinite) and a start
trigger (program start, an offset, after another step's end or start,
after with buffer, manual, on abort, or all/any of several). This package
turns that into resolved start and end times and draws them:

![Thanksgiving with One Oven: five tracks, an indefinite roast, a negative-offset dependency, a manual gate](docs/thanksgiving.png)

Rows are tracks and bars are steps at their resolved times. The roast is
*indefinite* (hatched): it ends when the cook says so, and everything after
it is planned against its default duration. Arrows are cross-track
dependencies; the dashed one is a negative offset ("peel the potatoes
45 min before the roast is due out"). The flag on "Guests seated" is a
*manual* gate; "Serve" waits for all four dishes. The oven has capacity
one, so the stuffing bakes only after the turkey comes out.

## Quickstart

Reproduce that picture in under a minute:

```bash
git clone https://github.com/rhylthyme/rhylthyme-timeline
cd rhylthyme-timeline
node examples/render.js test/fixtures/programs/thanksgiving_one_oven.json thanksgiving.svg
```

The script prints every step's resolved start and end and writes the SVG:

```
   0:00 –   20:00  Turkey: Season and truss
  20:00 – 185:00  Turkey: Roast until 74°C
 185:00 – 215:00  Turkey: Rest
 220:00 – 230:00  Turkey: Carve and serve
  90:00 – 115:00  Stuffing: Sauté aromatics, mix
 185:00 – 220:00  Stuffing: Bake stuffing
 140:00 – 155:00  Potatoes: Peel and cut
 155:00 – 175:00  Potatoes: Boil until tender
 175:00 – 185:00  Potatoes: Mash with butter
 190:00 – 205:00  Gravy: Make gravy from drippings
 210:00 – 215:00  Service: Dress the salad
 215:00 – 220:00  Service: Guests seated
 230:00 – 235:00  Service: Serve
wrote thanksgiving.svg
```

What `computeStepTimings` returns for the same program (seconds from
program start; `resolved` is `false` only for cycles or dangling references):

```js
const R = require('@rhylthyme/timeline');
R.computeStepTimings(program)
// {
//   'turkey-prep':  { start: 0,     end: 1200,  duration: 1200, trackId: 'turkey',   resolved: true },
//   'turkey-roast': { start: 1200,  end: 11100, duration: 9900, trackId: 'turkey',   resolved: true },
//   'potatoes-peel':{ start: 8400,  end: 9300,  duration: 900,  trackId: 'potatoes', resolved: true },  // roast end − 45 min
//   'guests-seated':{ start: 12900, end: 13200, duration: 300,  trackId: 'service',  resolved: true },  // manual gate, planned after the previous step
//   'serve':        { start: 13800, end: 14100, duration: 300,  trackId: 'service',  resolved: true },  // all four dishes done
//   ...
// }
```
For a PNG, `npm i @resvg/resvg-js` and give the output a `.png` name (or
run any SVG converter, e.g. `rsvg-convert -w 1640 -f png -o out.png thanksgiving.svg`).
Point it at your own program JSON to render that instead; the
[example corpus](test/fixtures/programs) has 39 more.

In a page, without a build step:

```html
<script src="https://cdn.jsdelivr.net/npm/@rhylthyme/timeline@1/src/index.js"></script>
<div id="timeline"></div>
<script>
  Rhylthyme.renderTimeline(document.getElementById('timeline'), program);
</script>
```

```js
// Node / bundlers
const Rhylthyme = require('@rhylthyme/timeline');
const timings = Rhylthyme.computeStepTimings(program);
const svg = Rhylthyme.renderTimelineSvg(program);
```

## API

| Function | Returns |
|---|---|
| `computeStepTimings(program)` | `{ [stepId]: { start, end, duration, trackId, resolved } }` in seconds from program start. `resolved` is `false` when a trigger could not be satisfied (cycle or dangling reference); such steps are placed at `t = 0`. |
| `renderTimelineSvg(program, opts?)` | SVG markup (string). `opts = { arrows, marks, legend }`, all default `true`: cross-track dependency arrows (dashed for negative offsets), hatched indefinite steps, faded variable-step extensions to their maximum, a flag on manual gates, and a one-line legend. |
| `renderTimeline(container, program, opts?)` | Injects the SVG into a DOM element and returns the markup. |
| `expandReplicates(program)` | A deep copy with track/step `replicates` (and legacy `batch_size`/`stagger`) expanded into flat tracks and steps, exactly as the Python `expand_replicates` does. The functions above apply it automatically. |
| `parseSeconds(value)` | `90`, `"90"`, `"5m"`, `"1h30m"`, `"-20m"` → seconds (number). |
| `stepDurationSeconds(step)` | Planning duration: fixed seconds, else variable default, else max, else min; indefinite → `defaultSeconds`, or a 60 s placeholder. |
| `version` | Package version string. |
| `supportedSchemaVersions` | Program schema versions this engine understands. |

### Trigger semantics

Timings follow the Python reference validator in
[`rhylthyme`](https://github.com/rhylthyme/rhylthyme-cli-runner):

| Trigger | Start |
|---|---|
| `programStart` | 0 (+ `offsetSeconds` if given) |
| `programStartOffset` | `offsetSeconds` |
| `afterStep` | referenced step's end (or start with `event: "start"`) + `offsetSeconds`; a negative offset is clamped so the step never begins before the referenced step |
| `afterStepWithBuffer` | referenced end + `bufferSeconds` + `offsetSeconds` |
| `onAbort` | referenced end (placeholder; fires only on abort at run time) |
| `manual` | end of the previous step in the same track |
| `{ logic: "all" \| "any", triggers: [...] }` | max / min of the sub-triggers |

Offsets and durations accept numbers (seconds) or unit strings.

## Versioning

SemVer. The exported function signatures are the public API; changing one
is a major release. Adding support for a new program-schema version is a
minor release and is recorded in `supportedSchemaVersions`. Rendering
changes that keep the SVG structure are patch releases.

`test/fixtures/python-timings.json` holds start/end times for the example
corpus computed by the Python reference validator; `npm test` asserts this
engine agrees with it on every step of every program (616 steps, 39
programs at 1.3.0), so the two implementations cannot drift silently.

## Related

- [rhylthyme-spec](https://github.com/rhylthyme/rhylthyme-spec): the JSON Schema
- [rhylthyme-examples](https://github.com/rhylthyme/rhylthyme-examples): the programs used as test fixtures
- The interactive player (`<rhylthyme-timeline>` Web Component) is planned as a second entry point of this package; see the roadmap in the server repository's `plans/rhylthyme-timeline.md`.

## License

Apache-2.0.
