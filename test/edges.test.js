'use strict';
// Dependency edges are always curved: _depEdgeCurve (the static renderer's
// geometry), the web player's crossTrackDepPath in player/template.html
// (exported from rhylthyme-server's web_visualizer.py, the same rule), and
// every arrow the renderer draws for the corpus.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../src/index.js');

const curve = R._depEdgeCurve;
const TEMPLATE = fs.readFileSync(path.join(__dirname, '..', 'player', 'template.html'), 'utf8');

function extract(src, name) {
  const start = src.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' is in the template');
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

function at(c, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, e = 3 * u * t * t, f = t * t * t;
  return [a * c[0] + b * c[2] + e * c[4] + f * c[6], a * c[1] + b * c[3] + e * c[5] + f * c[7]];
}

/** Largest perpendicular distance of the cubic from its chord. */
function deviation(c) {
  const L = Math.hypot(c[6] - c[0], c[7] - c[1]) || 1;
  let m = 0;
  for (let i = 0; i <= 400; i++) {
    const [x, y] = at(c, i / 400);
    m = Math.max(m, Math.abs((c[6] - c[0]) * (c[1] - y) - (c[0] - x) * (c[7] - c[1])) / L);
  }
  return m;
}

/**
 * Angle in degrees between the end tangent (what orient="auto" turns the
 * arrowhead to) and the way the curve actually runs over its last `len`
 * pixels, the stretch the arrowhead covers. A curve that hooks back in its
 * last pixels has a large one, and Chrome then draws the arrowhead turned
 * sideways or backwards.
 */
function arrowTurn(c, len) {
  let t = 1, p;
  do { t -= 0.0005; p = at(c, t); } while (t > 0 && Math.hypot(c[6] - p[0], c[7] - p[1]) < len);
  const a = Math.atan2(c[7] - p[1], c[6] - p[0]), b = Math.atan2(c[7] - c[5], c[6] - c[4]);
  let d = Math.abs(a - b) * 180 / Math.PI;
  return d > 180 ? 360 - d : d;
}

function monotone(c, axis) {
  let up = false, down = false, prev = at(c, 0)[axis];
  for (let i = 1; i <= 400; i++) {
    const v = at(c, i / 400)[axis];
    if (v > prev + 1e-9) up = true;
    if (v < prev - 1e-9) down = true;
    prev = v;
  }
  return !(up && down);
}

const DXS = [-2000, -500, -150, -60, -10, 0, 10, 39, 40, 200, 2000];

test('_depEdgeCurve: every hop curves visibly, without loops or overshoot', () => {
  // [row height, half bar + 1, inset, toCentre, row pitch]: the renderer's
  // default rows, compact rows, a barrier's fan-in line, and the player's
  // geometry (rows h apart plus 10px track spacing, bars h - 10 tall).
  for (const [h, half, inset, toCentre, p] of [[46, 17, 3, false, 46], [20, 4, 3, false, 20], [46, 17, 18, true, 46], [40, 15, 0, false, 50]]) {
    for (const dy of [p, 3 * p, 8 * p, -p, -4 * p]) {
      for (const dx of DXS) {
        const x1 = 500, y1 = 300, x2 = x1 + dx, y2 = y1 + dy;
        const c = curve(x1, y1, x2, y2, h, half, inset, toCentre);
        const where = `h=${h} inset=${inset} dx=${dx} dy=${dy}`;
        // Visibly curved: at least 3px off the chord (2.5 for a short
        // forward or downward hop between the renderer's 46px rows, whose
        // bars leave a 12px gap; a backward hop bows further, see below).
        const minDev = p === h && dx >= 0 ? 2.5 : 3;
        assert.ok(deviation(c) >= minDev, `${where}: ${deviation(c).toFixed(2)}px off the chord`);
        assert.ok(monotone(c, 1), `${where}: y doubles back`);
        if (dx >= 40) assert.ok(monotone(c, 0), `${where}: x doubles back`);
        const dir = Math.sign(dy);
        // ends: forward at the bar end / (target start - inset) on the centre
        // lines; otherwise the facing edges (or the barrier's point)
        assert.equal(c[0], x1);
        if (dx >= 40) {
          assert.deepEqual([c[1], c[6], c[7]], [y1, x2 - inset, y2]);
        } else {
          assert.equal(c[1], y1 + dir * half);
          assert.deepEqual([c[6], c[7]], toCentre ? [x2 - inset, y2] : [x2, y2 - dir * half]);
        }
        // the arrowhead follows the end tangent: rightward into the start of
        // a forward hop, straight down (up) into it on a drop, and the curve
        // runs that way under the arrowhead (8px) instead of hooking back
        const tx = c[6] - c[4], ty = c[7] - c[5];
        if (dx >= 40) assert.ok(tx > 0 && ty === 0, `${where}: end tangent points right`);
        else assert.ok(tx === 0 && ty * dir > 0, `${where}: end tangent heads into the target row`);
        assert.ok(arrowTurn(c, 8) < 85, `${where}: arrowhead turned ${arrowTurn(c, 8).toFixed(0)} degrees off the curve`);
        for (let i = 0; i <= 100; i++) {
          const [x, y] = at(c, i / 100);
          assert.ok(y >= Math.min(c[1], c[7]) - 1e-6 && y <= Math.max(c[1], c[7]) + 1e-6, `${where}: y overshoots`);
          assert.ok(x >= Math.min(x1, c[6]) - 0.5 * h && x <= Math.max(x1, c[6]) + 1e-6, `${where}: x overshoots`);
        }
      }
    }
  }
});

/** Signed distances of the curve from its chord: an arc keeps one sign. */
function signedOffsets(c) {
  const L = Math.hypot(c[6] - c[0], c[7] - c[1]) || 1;
  const out = [];
  for (let i = 1; i < 400; i++) {
    const [x, y] = at(c, i / 400);
    out.push(((c[6] - c[0]) * (c[1] - y) - (c[0] - x) * (c[7] - c[1])) / L);
  }
  return out;
}

test('_depEdgeCurve: a backward (negative offset) hop is an arc however long it is', () => {
  // The step starts before its reference ends, so the arrow runs back
  // through the gap between the two facing bar edges, the only free
  // corridor between adjacent rows. The old curve was a thin smoothstep
  // along the chord (2.6px off it in the renderer's 12px gap, 4.4px in
  // the player's 20px, at any length): a long dashed diagonal with a hook
  // at the arrowhead. Now a one-sided arc, under the source bar and down
  // into the target, about 0.45 of the gap off the chord at any length
  // (over a third of the gap, or of |dx| if less, across several rows). A
  // bow relative to the chord's length would have to cross the bars.
  for (const [h, half, inset, toCentre, p, old] of [[46, 17, 3, false, 46, 2.6], [40, 15, 0, false, 50, 4.4], [20, 4, 3, false, 20, 0], [46, 17, 18, true, 46, 0]]) {
    for (const rows of [1, -1, 3]) {
      for (const D of [80, 150, 450, 900, 2000, 5000]) {
        const c = curve(1000, 0, 1000 - D, rows * p, h, half, inset, toCentre);
        const where = `h=${h} p=${p} toCentre=${toCentre} rows=${rows} dx=-${D}`;
        const gap = Math.abs(c[7] - c[1]);
        const off = signedOffsets(c), sign = Math.sign(off[200]);
        assert.ok(off.every((v) => v * sign >= -1e-6), `${where}: bows to one side of the chord`);
        const dev = deviation(c);
        const min = Math.abs(rows) === 1 ? 0.42 * gap : 0.35 * Math.min(gap, D);
        assert.ok(dev >= Math.max(3, min), `${where}: ${dev.toFixed(2)}px off the chord, gap ${gap}`);
        if (Math.abs(rows) === 1 && old) assert.ok(dev >= 1.9 * old, `${where}: ${dev.toFixed(2)}px, was ${old}px`);
        for (let i = 0; i <= 200; i++) {
          const y = at(c, i / 200)[1];
          assert.ok(y >= Math.min(c[1], c[7]) - 1e-6 && y <= Math.max(c[1], c[7]) + 1e-6, `${where}: y leaves the gap`);
        }
        assert.ok(c[4] === c[6] && (c[7] - c[5]) * Math.sign(rows) > 0.5 * gap, `${where}: arrives straight into the target`);
      }
    }
  }
  // continuous with the near-vertical curl at dx = 0
  const c0 = curve(300, 100, 300, 146, 46, 17, 3, false), c1 = curve(300, 100, 299.999, 146, 46, 17, 3, false);
  c0.forEach((v, n) => assert.ok(Math.abs(v - c1[n]) < 0.01, `control ${n}: ${v} vs ${c1[n]}`));
});

test('_depEdgeCurve: a long hop has no straight middle; a same-row hop arches', () => {
  const c = curve(0, 0, 2000, 46, 46, 17, 3, false);
  // reach 0.6 of the run, uncapped (it used to stop at 120px)
  assert.ok(Math.abs(c[2] - 0.6 * 1997) < 1e-9 && Math.abs(c[4] - 0.4 * 1997) < 1e-9);
  // a point a quarter of the way along is well off the chord
  const [x, y] = at(c, 0.25);
  assert.ok(Math.abs(y - (46 * x) / 1997) > 5);
  // same row (an in-flight gate could be): an arch above the bars
  const a = curve(100, 50, 400, 50, 46, 17, 3, false);
  assert.ok(deviation(a) >= 12 && a[3] < 33 && a[5] < 33);
});

test('the player draws its cross-track arrows with the same geometry', () => {
  const crossTrackDepPath = new Function(extract(TEMPLATE, 'crossTrackDepPath') + '\nreturn crossTrackDepPath;')();
  for (const h of [24, 40, 80]) {
    for (const dy of [h + 10, 5 * h, -(h + 10)]) {
      for (const dx of DXS.concat([0.5, 79.9])) {
        const d = crossTrackDepPath(100, 200, 100 + dx, 200 + dy, h);
        const got = d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g).map(Number);
        const want = curve(100, 200, 100 + dx, 200 + dy, h, Math.max(4, h / 2 - 5), 0, false);
        got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `h=${h} dx=${dx} dy=${dy}: ${d} vs ${want}`));
      }
    }
  }
});

test('the player draws DAG edges as curves, not straight lines', () => {
  assert.ok(TEMPLATE.includes('function dagEdgeGeometry('));
  assert.ok(!/\.selectAll\("line"\)\s*\.data\(edges\)/.test(TEMPLATE), 'DAG links are <line>s again');
});

test('every dependency arrow the renderer draws for the corpus is curved', () => {
  const dir = path.join(__dirname, 'fixtures', 'programs');
  let edges = 0;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const svg = R.renderTimelineSvg(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    for (const m of svg.matchAll(/<path class="(rt-edge[^"]*|rt-inflight-edge)" d="([^"]+)"/g)) {
      const c = m[2].match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.equal(c.length, 8, `${f}: one cubic: ${m[2]}`);
      assert.ok(deviation(c) >= 3, `${f} ${m[1]} ${m[2]}: ${deviation(c).toFixed(2)}px off the chord`);
      if (m[1] !== 'rt-edge rt-fanin') assert.ok(arrowTurn(c, 8) < 85, `${f} ${m[2]}: arrowhead turned off the curve`);
      assert.ok(monotone(c, 1) || monotone(c, 0), `${f} ${m[2]}: loops`);
      edges++;
    }
  }
  assert.ok(edges > 100, `the corpus has arrows (${edges})`);
});
