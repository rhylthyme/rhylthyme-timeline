'use strict';
// renderTimelineSvg: barrier glyphs (schema 0.3.0-alpha instances:"all" /
// "any", and the implicit join over a replicated step's instances), the
// dotted in-flight arrows the maxInFlight gates get, and the
// planned-vs-actual overlay driven by `baseline` / `run`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const R = require('../src/index.js');

const COOKIES = path.join(__dirname, 'fixtures', 'programs', 'cookies_three_trays.json');
const cookies = () => JSON.parse(fs.readFileSync(COOKIES, 'utf8'));
const PROGRAMS = path.join(__dirname, 'fixtures', 'programs');
const program = (name) => JSON.parse(fs.readFileSync(path.join(PROGRAMS, name), 'utf8'));
const thanksgiving = () => program('thanksgiving_one_oven.json');
const thanksgivingRun = () => JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'runs', 'thanksgiving_one_oven.run.json'), 'utf8'));

function bars(svg) {
  const re = /<rect class="rt-bar[^"]*" data-step="([^"]+)"(?: data-deviation="([^"]+)" data-deviation-seconds="(-?\d+)")? x="([\d.]+)" y="(\d+(?:\.\d+)?)" width="([\d.]+)" height="(\d+)"/g;
  const out = {}; let m;
  while ((m = re.exec(svg))) out[m[1]] = { deviation: m[2], seconds: m[3] && Number(m[3]), x: +m[4], y: +m[5], w: +m[6], h: +m[7] };
  return out;
}

function ghosts(svg) {
  const re = /<rect class="rt-baseline" data-step="([^"]+)" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="(\d+)"/g;
  const out = {}; let m;
  while ((m = re.exec(svg))) out[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5] };
  return out;
}

function glyphs(svg, kind) {
  const re = new RegExp('<g class="rt-barrier" data-barrier="' + kind + '" data-step="([^"]+)">', 'g');
  const out = []; let m;
  while ((m = re.exec(svg))) out.push(m[1]);
  return out;
}

function inflights(svg) {
  const re = /<g class="rt-inflight" data-inflight-of="([^"]+)" data-limit="([^"]+)" data-from="([^"]+)" data-step="([^"]+)">([^]*?)<\/g>/g;
  const out = []; let m;
  while ((m = re.exec(svg))) out.push({ of: m[1], limit: m[2], from: m[3], step: m[4], body: m[5] });
  return out;
}

test('cookie example: exactly one "all" barrier glyph, into box', () => {
  const svg = R.renderTimelineSvg(cookies(), { legend: false });
  assert.ok(svg.startsWith('<svg'));
  assert.deepEqual(glyphs(svg, 'all'), ['box']);
  assert.deepEqual(glyphs(svg, 'any'), []);
  // The three cool-r<i> -> box lines converge without their own arrowheads;
  // the glyph carries the single arrowhead. bake-r<i> -> cool-r<i> keep theirs.
  assert.equal((svg.match(/class="rt-edge rt-fanin"/g) || []).length, 3);
  // 3 bake-r<i> -> cool-r<i>, 1 barrier arrowhead, 1 in-flight gate.
  assert.equal((svg.match(/marker-end="url\(#rt-arrow\)"/g) || []).length, 3 + 1 + 1);
  // Solid bar for "all".
  const g = svg.match(/<g class="rt-barrier"[^]*?<\/g>/)[0];
  assert.ok(/<line [^>]*stroke-width="2.5"/.test(g));
  assert.ok(!/stroke-dasharray/.test(g));
});

test('instances:"any" draws a dashed barrier; legend names the glyph', () => {
  const p = cookies();
  p.tracks[0].steps[3].startTrigger = { type: 'afterStep', stepId: 'cool', instances: 'any' };
  const svg = R.renderTimelineSvg(p);
  assert.deepEqual(glyphs(svg, 'any'), ['box']);
  const g = svg.match(/<g class="rt-barrier"[^]*?<\/g>/)[0];
  assert.ok(/<line [^>]*stroke-dasharray/.test(g));
  assert.ok(svg.includes('>barrier (all instances)<'), 'legend key present when a barrier is drawn');
});

test('implicit 0.2.0 join over parallel instances is drawn as one barrier; arrows:false draws none', () => {
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'programs', 'replicates_lab_samples.json'), 'utf8'));
  const svg = R.renderTimelineSvg(p);
  const all = glyphs(svg, 'all');
  assert.ok(all.length >= 1, 'a plain reference to a parallel replicate joins all instances');
  assert.ok(new Set(all).size === all.length, 'one glyph per barrier step');
  assert.equal((R.renderTimelineSvg(p, { arrows: false }).match(/rt-barrier/g) || []).length, 0);
  // Programs without replicates never get a glyph.
  const plain = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'programs', 'thanksgiving_one_oven.json'), 'utf8'));
  assert.equal((R.renderTimelineSvg(plain).match(/rt-barrier/g) || []).length, 0);
  assert.ok(!R.renderTimelineSvg(plain).includes('>barrier (all instances)<'));
});

test('maxInFlight draws one dotted, labelled in-flight arrow, not a dependency arrow', () => {
  const svg = R.renderTimelineSvg(cookies(), { legend: false });
  const gates = inflights(svg);
  assert.equal(gates.length, 1, 'count 3 with maxInFlight 2 gates exactly bake-r3');
  const [g] = gates;
  assert.deepEqual([g.of, g.limit, g.from, g.step], ['bake', '2', 'cool-r1', 'bake-r3']);
  // Dotted, with its own dash pattern, and distinct from the negative-offset dash.
  assert.match(g.body, /class="rt-inflight-edge"[^>]*stroke-dasharray="1.5,3"/);
  assert.ok(!g.body.includes('stroke-dasharray="5,4"'));
  // Labelled with the leaf's task and the limit.
  assert.match(g.body, />rack \u2264 2</);
  // The gate is NOT also drawn as an ordinary dependency arrow, and it does
  // not turn bake-r3's compound trigger into a barrier glyph.
  assert.ok(!/class="rt-edge"[^>]*\n?/.test(g.body));
  assert.deepEqual(glyphs(svg, 'all'), ['box']);
  assert.equal((svg.match(/rt-inflight/g) || []).length, 2, 'the group and its path only');
  // arrows:false suppresses it, as it does every other edge.
  assert.equal((R.renderTimelineSvg(cookies(), { arrows: false }).match(/rt-inflight/g) || []).length, 0);
});

test('the in-flight legend key appears only when a gate is drawn', () => {
  assert.ok(R.renderTimelineSvg(cookies()).includes('>in-flight limit<'));
  const p = cookies();
  delete p.tracks[0].steps[1].replicates.maxInFlight;
  const svg = R.renderTimelineSvg(p);
  assert.ok(!svg.includes('>in-flight limit<'));
  assert.equal(inflights(svg).length, 0);
});

test('a parallel rolling window gates every instance past the window', () => {
  const p = {
    schemaVersion: '0.3.0-alpha', programId: 'w', name: 'W',
    resourceConstraints: [{ task: 'prep', maxConcurrent: 2 }],
    tracks: [{ trackId: 't', name: 'T', steps: [{
      stepId: 'x', name: 'X', task: 'prep',
      duration: { type: 'fixed', seconds: 600 },
      replicates: { count: 4, mode: 'parallel', maxInFlight: 2 },
      startTrigger: { type: 'programStart' },
    }] }],
  };
  const gates = inflights(R.renderTimelineSvg(p, { legend: false }));
  assert.deepEqual(gates.map((g) => [g.from, g.step]), [['x-r1', 'x-r3'], ['x-r2', 'x-r4']]);
  // With no "each" descendants the label falls back to the gated step's own task.
  gates.forEach((g) => assert.match(g.body, />prep \u2264 2</));
});

// ---------------------------------------------------------------------------
// Planned vs actual: `baseline` (and the `run` shorthand)
// ---------------------------------------------------------------------------

const SNAPSHOTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'render-snapshots.json'), 'utf8'));
const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

test('every default drawing is byte-for-byte what it was before `baseline` existed', () => {
  // The snapshots were taken from the renderer as it stood before the
  // planned-vs-actual options were added; adding an option must not move a
  // single pixel of a drawing that does not use it. Regenerate deliberately
  // with tools/gen-render-snapshots.js (and say why in CHANGELOG.md).
  const names = Object.keys(SNAPSHOTS.default);
  assert.ok(names.length >= 40, 'snapshots cover the corpus');
  const drifted = [];
  for (const name of names) {
    const svg = R.renderTimelineSvg(program(name));
    if (svg.length !== SNAPSHOTS.default[name].length || sha256(svg) !== SNAPSHOTS.default[name].sha256) drifted.push(name);
  }
  assert.deepEqual(drifted, [], 'default renderTimelineSvg output changed');
});

test('the Thanksgiving run overlay matches its snapshot', () => {
  const svg = R.renderTimelineSvg(thanksgiving(), { run: thanksgivingRun() });
  const expected = SNAPSHOTS.overlay['thanksgiving_one_oven.json'];
  assert.equal(svg.length, expected.length);
  assert.equal(sha256(svg), expected.sha256);
  // `run` is exactly timings-from-the-record over a computed plan.
  const explicit = R.renderTimelineSvg(thanksgiving(), {
    timings: R.timingsFromRun(thanksgiving(), thanksgivingRun()),
    baseline: R.computeStepTimings(thanksgiving()),
  });
  assert.equal(explicit, svg);
});

test('every baseline step gets a thinner ghost bar under its own bar', () => {
  const p = thanksgiving();
  const svg = R.renderTimelineSvg(p, { run: thanksgivingRun() });
  const actualBars = bars(svg), planBars = ghosts(svg);
  assert.equal(Object.keys(planBars).length, 13, 'one ghost per step');
  assert.deepEqual(Object.keys(planBars).sort(), Object.keys(actualBars).sort());

  const plan = R.computeStepTimings(p);
  for (const [stepId, ghost] of Object.entries(planBars)) {
    const bar = actualBars[stepId];
    assert.ok(ghost.h < bar.h, `${stepId}: ghost is thinner`);
    assert.ok(ghost.y > bar.y + bar.h, `${stepId}: ghost sits under the bar`);
    // Ghost x position tracks the PLANNED interval, the bar the actual one.
    assert.ok(ghost.w > 0);
    if (plan[stepId].start < R.timingsFromRun(p, thanksgivingRun())[stepId].start) {
      assert.ok(ghost.x < bar.x, `${stepId}: plan starts left of the actual start`);
    }
  }
  // Rows grew to fit two bars; the drawing is taller than the plain one.
  assert.ok(+svg.match(/height="(\d+)"/)[1] > +R.renderTimelineSvg(p).match(/height="(\d+)"/)[1]);
  // No ghosts and no deviation tags without the option.
  const plain = R.renderTimelineSvg(p);
  assert.equal((plain.match(/rt-baseline/g) || []).length, 0);
  assert.equal((plain.match(/data-deviation/g) || []).length, 0);
});

test('deviation sign: the roast that ran long is late, the early step early, the on-time step on time', () => {
  const svg = R.renderTimelineSvg(thanksgiving(), { run: thanksgivingRun() });
  const drawn = bars(svg);
  // turkey-prep was ended 200 s early by the cook.
  assert.equal(drawn['turkey-prep'].deviation, 'early');
  assert.equal(drawn['turkey-prep'].seconds, -200);
  // The indefinite roast ran 1500 s past its defaultSeconds, and everything
  // downstream of it inherits the slip.
  assert.equal(drawn['turkey-roast'].deviation, 'late');
  assert.equal(drawn['turkey-roast'].seconds, 1300);
  assert.equal(drawn['turkey-rest'].deviation, 'late');
  assert.equal(drawn['serve'].deviation, 'late');
  // potatoes-peel hangs off the roast by a NEGATIVE offset, so the runtime
  // fired it from the roast's projected end (its actual start plus
  // defaultSeconds) rather than from the roast's real, later end: the whole
  // potato chain runs to the plan's shape, shifted by the roast's early start.
  assert.equal(drawn['potatoes-peel'].deviation, 'early');
  assert.equal(drawn['potatoes-peel'].seconds, -200);
  // stuffing-prep hangs off programStartOffset, untouched by the roast.
  assert.equal(drawn['stuffing-prep'].deviation, 'on-time');
  assert.equal(drawn['stuffing-prep'].seconds, 0);
  const signs = Object.values(drawn).map((b) => b.deviation);
  assert.equal(signs.filter((s) => s === 'late').length, 8);
  assert.equal(signs.filter((s) => s === 'early').length, 4);
  assert.equal(signs.filter((s) => s === 'on-time').length, 1);
  // Late is outlined red, early blue, on time green.
  assert.match(svg, /data-step="turkey-roast"[^/]*stroke="#dc2626"/);
  assert.match(svg, /data-step="turkey-prep"[^/]*stroke="#2563eb"/);
  assert.match(svg, /data-step="stuffing-prep"[^/]*stroke="#16a34a"/);
});

test('deviationThreshold widens the on-time band', () => {
  const p = thanksgiving(), run = thanksgivingRun();
  const tight = bars(R.renderTimelineSvg(p, { run, deviationThreshold: 0 }));
  assert.equal(tight['stuffing-prep'].deviation, 'on-time', 'a deviation of exactly 0 is never late');
  assert.equal(tight['turkey-prep'].deviation, 'early');
  // A threshold past the biggest slip makes everything on time.
  const loose = bars(R.renderTimelineSvg(p, { run, deviationThreshold: 6000 }));
  assert.ok(Object.values(loose).every((b) => b.deviation === 'on-time'));
  // The legend names the threshold in force.
  assert.ok(R.renderTimelineSvg(p, { run }).includes('>late (&gt;30s)<'));
  assert.ok(R.renderTimelineSvg(p, { run, deviationThreshold: 120 }).includes('>late (&gt;120s)<'));
});

test('the four planned-vs-actual legend keys appear only with a baseline', () => {
  const p = thanksgiving();
  const svg = R.renderTimelineSvg(p, { run: thanksgivingRun() });
  for (const label of ['>planned<', '>late (&gt;30s)<', '>early<', '>on time<']) {
    assert.ok(svg.includes(label), label);
  }
  const plain = R.renderTimelineSvg(p);
  for (const label of ['>planned<', '>early<', '>on time<']) assert.ok(!plain.includes(label), label);
  // legend:false drops them with the rest of the key.
  const bare = R.renderTimelineSvg(p, { run: thanksgivingRun(), legend: false });
  assert.ok(!bare.includes('>planned<'));
  assert.ok(Object.keys(ghosts(bare)).length === 13, 'bars are unaffected by legend:false');
});

test('baseline works on a bare timings map and tolerates partial coverage', () => {
  const p = thanksgiving();
  const plan = R.computeStepTimings(p);
  const actual = R.computeStepTimings(p, { actual: { 'turkey-roast': { start: 1200, end: 13000 } } });
  const partial = { 'turkey-roast': plan['turkey-roast'] };
  const svg = R.renderTimelineSvg(p, { timings: actual, baseline: partial });
  assert.deepEqual(Object.keys(ghosts(svg)), ['turkey-roast'], 'only covered steps get a ghost');
  const drawn = bars(svg);
  assert.equal(drawn['turkey-roast'].deviation, 'late');
  assert.equal(drawn['turkey-rest'].deviation, undefined, 'a step outside the baseline is untagged');
  // A baseline that runs past the actuals still fits inside the axis.
  const wide = R.renderTimelineSvg(p, { timings: R.computeStepTimings(p, { actual: { serve: { start: 0, end: 60 } } }), baseline: plan });
  assert.ok(wide.includes('rt-baseline'));
  assert.ok(Object.values(ghosts(wide)).every((g) => g.x + g.w <= 820 - 18 + 0.5), 'ghosts stay inside the plot');
});
