'use strict';
// renderTimelineSvg looks: `style` (classic | web | publication), palettes,
// colorBy, the configurable legend, label placement, axis formats. The
// classic default is pinned byte-for-byte by render.test.js; everything
// here is opt-in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const R = require('../src/index.js');

const PROGRAMS = path.join(__dirname, 'fixtures', 'programs');
const program = (name) => JSON.parse(fs.readFileSync(path.join(PROGRAMS, name), 'utf8'));
const thanksgiving = () => program('thanksgiving_one_oven.json');
const cookies = () => program('cookies_three_trays.json');

const fills = (svg) => [...svg.matchAll(/<rect class="rt-bar[^"]*" data-step="([^"]+)"[^>]*? fill="(#[0-9a-fA-F]{6})"/g)]
  .reduce((acc, m) => Object.assign(acc, { [m[1]]: m[2] }), {});
const legendKeys = (svg) => [...svg.matchAll(/<g class="rt-legend-item" data-key="([^"]+)">/g)].map((m) => m[1]);
const legendLabels = (svg) => [...svg.matchAll(/<g class="rt-legend-item"[^>]*>.*?<text[^>]*>([^<]*)<\/text><\/g>/g)].map((m) => m[1]);
const size = (svg) => { const m = /width="(\d+)" height="(\d+)"/.exec(svg); return { w: +m[1], h: +m[2] }; };

// Balanced-tag check: enough to catch a broken string concatenation.
function wellFormed(svg) {
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*?)(\/?)>/g)) {
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else if (!m[4]) stack.push(m[2]);
  }
  return stack.length === 0;
}

test('an unknown style, or none, is the classic drawing', () => {
  const p = thanksgiving();
  assert.equal(R.renderTimelineSvg(p, { style: 'nope' }), R.renderTimelineSvg(p));
  assert.equal(R.renderTimelineSvg(p, { style: 'classic' }), R.renderTimelineSvg(p));
  assert.deepEqual(R.STYLES, ['classic', 'web', 'publication']);
});

test('web style uses the interactive timeline\'s vivid palette on flat bars', () => {
  const p = thanksgiving();
  const svg = R.renderTimelineSvg(p, { style: 'web' });
  const byStep = fills(svg);
  p.tracks.forEach((t, ti) => t.steps.forEach((s) => {
    if (byStep[s.stepId]) assert.equal(byStep[s.stepId], R.PALETTES.vivid[ti % R.PALETTES.vivid.length], s.stepId);
  }));
  assert.ok(!/filter="url\(#rt-shadow\)"/.test(svg), 'no drop shadows');
  assert.ok(!/opacity="0\.78"/.test(svg), 'no alternating opacity');
  assert.match(svg, /<rect width="820" height="\d+" fill="#ffffff"\/>/);
  assert.match(svg, />0:00<\/text>/);
  assert.match(svg, />1:00<\/text>/);
  assert.match(svg, /<title>Thanksgiving with One Oven<\/title><desc>5 tracks/);
  assert.match(svg, /<rect class="rt-bar"[^>]*><title>[^<]+ — 0:00–/);
});

test('every named palette resolves, and an array palette is used as given', () => {
  const p = thanksgiving();
  for (const name of Object.keys(R.PALETTES)) {
    const first = Object.values(fills(R.renderTimelineSvg(p, { style: 'web', palette: name })))[0];
    assert.equal(first, R.PALETTES[name][0], name);
  }
  const custom = R.renderTimelineSvg(p, { style: 'web', palette: ['#123456', '#abcdef'] });
  assert.deepEqual([...new Set(Object.values(fills(custom)))].sort(), ['#123456', '#abcdef']);
  // `colors` pins one key without touching the rest.
  const pinned = fills(R.renderTimelineSvg(p, { style: 'web', colors: { [p.tracks[1].trackId]: '#000000' } }));
  assert.equal(pinned[p.tracks[1].steps[0].stepId], '#000000');
  assert.equal(pinned[p.tracks[0].steps[0].stepId], R.PALETTES.vivid[0]);
});

test('light bars get dark ink, dark bars white', () => {
  const svg = R.renderTimelineSvg(thanksgiving(), { style: 'web', palette: ['#FFED6F', '#252525'] });
  const inks = [...svg.matchAll(/<text class="rt-label" [^>]*fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.ok(inks.includes('#111827') && inks.includes('#ffffff'), String(inks));
});

test('colorBy "task" colours by resource and keys the legend with capacities', () => {
  const p = cookies();
  const svg = R.renderTimelineSvg(p, { style: 'publication', colorBy: 'task' });
  const expanded = R.expandReplicates(p);
  const tasks = [];
  expanded.tracks.forEach((t) => t.steps.forEach((s) => { if (s.task && !tasks.includes(s.task)) tasks.push(s.task); }));
  const byStep = fills(svg);
  expanded.tracks.forEach((t) => t.steps.forEach((s) => {
    if (byStep[s.stepId]) assert.equal(byStep[s.stepId], R.PALETTES.vivid[tasks.indexOf(s.task)], s.stepId);
  }));
  const labels = legendLabels(svg);
  for (const rc of p.resourceConstraints) assert.ok(labels.includes(`${rc.task} (max ${rc.maxConcurrent})`), rc.task);
  assert.equal(legendKeys(svg).filter((k) => k === 'task').length, tasks.length);
  // In the classic look too, without moving anything else out of place.
  assert.ok(legendKeys(R.renderTimelineSvg(p, { colorBy: 'task' })).includes('task'));
});

test('the automatic legend lists only what the drawing contains', () => {
  const t = legendKeys(R.renderTimelineSvg(thanksgiving(), { style: 'web' }));
  assert.deepEqual(t, ['dependency', 'negative-offset', 'indefinite', 'variable', 'manual']);
  const c = legendKeys(R.renderTimelineSvg(cookies(), { style: 'web' }));
  assert.deepEqual(c, ['dependency', 'barrier', 'in-flight']);
  const noArrows = legendKeys(R.renderTimelineSvg(cookies(), { style: 'web', arrows: false }));
  assert.deepEqual(noArrows, []);
  const plain = { name: 'Plain', tracks: [{ trackId: 'a', name: 'A', steps: [{ stepId: 's', name: 'S', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'programStart' } }] }] };
  const svg = R.renderTimelineSvg(plain, { style: 'web' });
  assert.ok(!svg.includes('rt-legend'), 'nothing to explain, no legend');
  assert.ok(size(svg).h < size(R.renderTimelineSvg(thanksgiving(), { style: 'web' })).h);
});

test('legend items, labels, title, position and frame are configurable', () => {
  const p = thanksgiving();
  const svg = R.renderTimelineSvg(p, {
    style: 'publication',
    legend: { position: 'right', items: ['tracks', 'dependency', 'barrier'], labels: { dependency: 'Finish-to-start' }, title: 'Key', frame: true },
  });
  assert.deepEqual(legendKeys(svg), [...p.tracks.map(() => 'track'), 'dependency', 'barrier'], 'an explicit list is shown as asked');
  assert.ok(legendLabels(svg).includes('Finish-to-start'));
  assert.match(svg, /<g class="rt-legend" data-position="right"/);
  assert.match(svg, /font-weight="600">Key<\/text>/);
  // The plot gives up width to a right-hand legend; rows stay inside it.
  const rowW = (s) => +/<rect x="\d+" y="[\d.]+" width="([\d.]+)" height="\d+" fill="#ffffff" stroke=/.exec(s)[1];
  assert.ok(rowW(svg) < rowW(R.renderTimelineSvg(p, { style: 'publication' })));

  const top = R.renderTimelineSvg(p, { style: 'web', legend: { position: 'top' } });
  const legendY = +/<g class="rt-legend-item"[^>]*><g transform="translate\([\d.]+,([\d.]+)\)/.exec(top)[1];
  const firstRowY = +/<rect x="\d+" y="([\d.]+)" width="[\d.]+" height="\d+" fill="#f9fafb"/.exec(top)[1];
  assert.ok(legendY < firstRowY, 'top legend sits above the rows');

  const cols = R.renderTimelineSvg(p, { style: 'web', legend: { columns: 2 } });
  assert.ok(size(cols).h > size(R.renderTimelineSvg(p, { style: 'web' })).h, 'two columns wrap onto more rows');
  assert.ok(!R.renderTimelineSvg(p, { style: 'web', legend: false }).includes('rt-legend'));
  assert.ok(!R.renderTimelineSvg(p, { style: 'web', legend: { show: false } }).includes('rt-legend'));
});

test('publication style: no brand, no title, axis title, no cut-off track names', () => {
  const p = program('wedding_and_reception.json');
  const svg = R.renderTimelineSvg(p, { style: 'publication', width: 1100 });
  assert.ok(!svg.includes('rhylthyme.com'));
  assert.ok(!/font-size="14" font-weight="600"/.test(svg), 'no title text');
  assert.match(svg, /class="rt-axis-title"[^>]*>Time \(h:mm\)</);
  assert.match(svg, /font-family="Helvetica, Arial, sans-serif"/);
  for (const t of p.tracks) assert.ok(svg.includes('>' + t.name.replace(/&/g, '&amp;') + '</text>'), t.name);
  assert.ok(svg.includes('rt-label-outside'), 'short bars are labelled beside the bar');
  // Labels are drawn after the arrows so no arrow strikes through a name.
  assert.ok(svg.lastIndexOf('class="rt-edge') < svg.indexOf('<g class="rt-labels">'));
  // Title, brand and an explicit axis title can be switched back on.
  const on = R.renderTimelineSvg(p, { style: 'publication', title: 'Figure 3', brand: true, axisTitle: 'Hours since doors' });
  assert.match(on, />Figure 3<\/text>/);
  assert.ok(on.includes('rhylthyme.com') && on.includes('>Hours since doors<'));
});

test('labelOverflow "hide" and "truncate" never place a label outside', () => {
  const p = program('wedding_and_reception.json');
  for (const mode of ['hide', 'truncate']) {
    assert.ok(!R.renderTimelineSvg(p, { style: 'publication', labelOverflow: mode }).includes('rt-label-outside'), mode);
  }
  const hidden = R.renderTimelineSvg(p, { style: 'publication', labelOverflow: 'hide' });
  assert.ok(!/class="rt-label"[^>]*>[^<]*…</.test(hidden), 'hide never truncates');
});

test('time axis: clock, minutes, wall clock, tick interval and long programs', () => {
  const p = thanksgiving();
  assert.match(R.renderTimelineSvg(p, { style: 'web', timeFormat: 'minutes' }), />1h<\/text>/);
  const wall = R.renderTimelineSvg(p, { style: 'publication', startAt: '2026-11-26T14:00:00' });
  assert.match(wall, />14:00<\/text>/);
  assert.match(wall, />15:00<\/text>/);
  assert.match(wall, /rt-axis-title[^>]*>Clock time</);
  const ticks = (svg) => [...svg.matchAll(/text-anchor="middle">(\d+:\d\d)<\/text>/g)].map((m) => m[1]);
  assert.deepEqual(ticks(R.renderTimelineSvg(p, { style: 'web', tickInterval: 7200 })), ['0:00', '2:00']);
  // A four-day program gets a handful of ticks, not one per hour.
  const long = { name: 'Long', tracks: [{ trackId: 'a', name: 'A', steps: [{ stepId: 's', name: 'S', duration: { type: 'fixed', seconds: 4 * 86400 }, startTrigger: { type: 'programStart' } }] }] };
  const n = ticks(R.renderTimelineSvg(long, { style: 'web' })).length;
  assert.ok(n >= 3 && n <= 14, `${n} ticks`);
  // A short one reads min:s.
  const short = { name: 'Short', tracks: [{ trackId: 'a', name: 'A', steps: [{ stepId: 's', name: 'S', duration: { type: 'fixed', seconds: 240 }, startTrigger: { type: 'programStart' } }] }] };
  assert.match(R.renderTimelineSvg(short, { style: 'publication' }), /rt-axis-title[^>]*>Time \(min:s\)</);
});

test('fontScale grows type and rows; background can be dropped', () => {
  const p = thanksgiving();
  const base = R.renderTimelineSvg(p, { style: 'publication' });
  const big = R.renderTimelineSvg(p, { style: 'publication', fontScale: 1.5 });
  assert.ok(size(big).h > size(base).h);
  assert.match(big, /font-size="18" font-weight="600"/); // 12 * 1.5 track labels
  assert.match(R.renderTimelineSvg(p, { style: 'publication', rowHeight: 30 }), /height="16"/);
  const clear = R.renderTimelineSvg(p, { style: 'publication', background: 'none' });
  assert.ok(!/<rect width="820" height="\d+" fill=/.test(clear));
});

test('planned-vs-actual works in the new looks, with its legend keys', () => {
  const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'runs', 'thanksgiving_one_oven.run.json'), 'utf8'));
  const svg = R.renderTimelineSvg(thanksgiving(), { style: 'publication', run });
  assert.ok(svg.includes('rt-baseline') && svg.includes('data-deviation='));
  for (const k of ['planned', 'late', 'early', 'on-time']) assert.ok(legendKeys(svg).includes(k), k);
});

test('every fixture renders well-formed SVG in every look', () => {
  const variants = [
    { style: 'web' }, { style: 'publication' },
    { style: 'publication', colorBy: 'task', palette: 'okabe-ito', legend: { position: 'right', frame: true, title: 'Key' }, fontScale: 1.2 },
    { style: 'web', palette: 'grayscale', legend: { position: 'top', items: ['tracks'] }, showDurations: true, startAt: '2026-01-01T09:00:00' },
  ];
  let n = 0;
  for (const name of fs.readdirSync(PROGRAMS).filter((f) => f.endsWith('.json'))) {
    for (const opts of variants) {
      const svg = R.renderTimelineSvg(program(name), opts);
      if (!svg) continue; // a program with no steps renders nothing, as before
      n++;
      assert.ok(wellFormed(svg), `${name} ${JSON.stringify(opts)}`);
      assert.ok(!/NaN|undefined|Infinity/.test(svg), `${name} ${JSON.stringify(opts)}`);
    }
  }
  assert.ok(n >= 150);
});

test('textWidth is a usable estimate', () => {
  assert.ok(R.textWidth('iiii', 10) < R.textWidth('mmmm', 10));
  assert.ok(R.textWidth('Hello', 20) > R.textWidth('Hello', 10) * 1.9);
  assert.ok(R.textWidth('Bold', 10, true) > R.textWidth('Bold', 10));
  assert.equal(R.textWidth('', 10), 0);
});
