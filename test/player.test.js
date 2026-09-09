'use strict';
// The player page (player/build.js + player/template.html) must be
// byte-identical to what rhylthyme-server's web_visualizer.py generates.
// test/fixtures/python-player-html.json is written by the server's
// tools/player_parity_fixture.py; regenerate it (and player/template.html via
// tools/export_player_template.py) after changing the Python side.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildPlayerHtml, parsePyJson, calculateTimelineData, extractStepDependencies } = require('../player/build.js');

const FIXTURES = path.join(__dirname, 'fixtures');
const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'python-player-html.json'), 'utf8'));

test('player HTML matches the Python visualizer for every corpus program', () => {
  const names = Object.keys(expected);
  assert.ok(names.length >= 30, 'fixture covers the corpus');
  const mismatches = [];
  for (const name of names) {
    const text = fs.readFileSync(path.join(FIXTURES, 'programs', `${name}.json`), 'utf8');
    const html = buildPlayerHtml(parsePyJson(text));
    const sha = crypto.createHash('sha256').update(html).digest('hex');
    if (sha !== expected[name].sha256) mismatches.push(`${name}: js ${html.length} chars vs python ${expected[name].length}`);
  }
  assert.deepStrictEqual(mismatches, []);
});

test('calculateTimelineData resolves every step', () => {
  const program = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'programs', 'thanksgiving_one_oven.json'), 'utf8'));
  const [nodes, edges] = extractStepDependencies(program);
  const data = calculateTimelineData(nodes, edges);
  assert.strictEqual(data.tracks.length, 5);
  // The player keeps the server's legacy placement (negative-offset steps sit at the
  // referenced step's start), so its total differs from computeStepTimings (14100).
  assert.strictEqual(+data.totalDuration, 16200);
  assert.ok(data.tracks.every((t) => t.steps.every((s) => +s.endTime >= +s.startTime)));
});

test('buildPlayerHtml does not mutate its input', () => {
  const program = parsePyJson(fs.readFileSync(path.join(FIXTURES, 'programs', 'replicates_stagger_orders.json'), 'utf8'));
  const before = JSON.stringify(program);
  buildPlayerHtml(program);
  assert.strictEqual(JSON.stringify(program), before);
});
