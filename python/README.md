# rhylthyme-timeline

The timing engine and Gantt renderer behind rhylthyme.com, packaged for
`pip`. It draws a Rhylthyme program (parallel tracks of timed steps with
shared-equipment limits) as an SVG, PNG or PDF, publication-ready. The code
is the JavaScript module
[`@rhylthyme/timeline`](https://github.com/rhylthyme/rhylthyme-timeline);
this package carries a copy and runs it with **Node.js 18 or newer**, which
you need on your PATH.

```bash
pip install rhylthyme-timeline
rhylthyme-render dinner.json -o dinner.svg
rhylthyme-render dinner.json -o dinner.png --style web --palette vivid --start-at 2026-10-03T12:50:00
rhylthyme-render dinner.json -o figure.pdf --style publication --legend right
rhylthyme-render --help
```

PNG needs `rsvg-convert` on the PATH (librsvg) or the `@resvg/resvg-js` npm
package; SVG and PDF need nothing else.

From Python:

```python
from rhylthyme_timeline import render, renderer_path
svg = render(program, style="web", colorBy="task")
renderer_path()   # the index.js to require() from your own Node code
```

`pip install rhylthyme` brings this package in together with the `rhylthyme`
command-line tool and the importers.
