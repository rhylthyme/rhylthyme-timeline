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

test('classic player carries instance identity and groups instance rows', () => {
  const program = parsePyJson(fs.readFileSync(path.join(FIXTURES, 'programs', 'cookies_three_trays.json'), 'utf8'));
  const [nodes, edges] = extractStepDependencies(require('../src/index.js').expandReplicates(program));

  // Every replicate instance node knows what it is an instance of, and the
  // sub-track it lives in points at its parent track.
  const bake3 = nodes.find((n) => n.id === 'bake-r3');
  assert.strictEqual(bake3.instanceOf, 'bake');
  assert.strictEqual(bake3.instanceIndex, 3);
  assert.strictEqual(bake3.parentTrackId, null);
  const cool1 = nodes.find((n) => n.id === 'cool-r1');
  assert.strictEqual(cool1.instanceOf, 'cool');
  assert.strictEqual(cool1.instanceIndex, 1);
  assert.strictEqual(cool1.parentTrackId, 'cookies');
  assert.strictEqual(nodes.find((n) => n.id === 'mix').instanceOf, null);

  // …and the same identity reaches the step list the itinerary renders from.
  const data = calculateTimelineData(nodes, edges);
  const steps = [].concat(...data.tracks.map((t) => t.steps));
  assert.strictEqual(steps.find((s) => s.stepId === 'cool-r2').instanceOf, 'cool');
  assert.strictEqual(steps.find((s) => s.stepId === 'cool-r2').instanceIndex, 2);

  // The page groups those rows under one collapsible header.
  const html = buildPlayerHtml(program);
  assert.ok(html.includes('data-instance-group-header'), 'group header row');
  assert.ok(html.includes('function toggleInstanceGroup'), 'group toggle');
  assert.ok(html.includes('instanceDisplayName'), 'per-instance labels');
});

test('step alerts reach the player steps and the page carries the alert engine', () => {
  const program = {
    programId: 'alerts', name: 'Alerts',
    tracks: [{ trackId: 'oven', name: 'Oven', steps: [
      { stepId: 'bake', name: 'Bake', task: 'oven', duration: { type: 'fixed', seconds: 180 },
        startTrigger: { type: 'programStart' },
        alerts: [{ event: 'end', offsetSeconds: -120, message: 'Preheat the oven now' }, { event: 'start' }] },
      { stepId: 'rest', name: 'Rest', task: 'oven', duration: { type: 'fixed', seconds: 60 },
        startTrigger: { type: 'afterStep', stepId: 'bake' } },
    ] }],
    resourceConstraints: [{ task: 'oven', maxConcurrent: 1 }],
  };
  const [nodes, edges] = extractStepDependencies(JSON.parse(JSON.stringify(program)));
  const steps = [].concat(...calculateTimelineData(nodes, edges).tracks.map((t) => t.steps));
  assert.deepStrictEqual(steps.find((s) => s.stepId === 'bake').alerts, program.tracks[0].steps[0].alerts);
  assert.ok(!('alerts' in steps.find((s) => s.stepId === 'rest')));
  const html = buildPlayerHtml(program);
  assert.ok(html.includes(fs.readFileSync(path.join(__dirname, '..', 'player', 'step-alerts.js'), 'utf8')), 'engine inlined');
  assert.ok(html.includes('rhylthymeAlertSchedule') && html.includes('function processStepAlerts'));
});

test('the player words itself per platform (window.RHYLTHYME_PLATFORM)', () => {
  const vm = require('vm');
  const html = buildPlayerHtml(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'programs', 'thanksgiving_one_oven.json'), 'utf8')));
  assert.ok(html.includes('window.RHYLTHYME_PLATFORM_SUPPORT = 1;'));
  assert.ok(html.includes('data-i18n-title="controls.downloadSvg"'));
  const src = html.slice(html.indexOf('var I18N = (function() {'), html.indexOf('function updateAllTranslations()'));
  const load = (platform) => {
    const window = platform ? { RHYLTHYME_PLATFORM: platform } : {};
    window.parent = window;
    const sandbox = { window, navigator: { userAgent: '' }, document: { documentElement: { setAttribute() {} } } };
    vm.createContext(sandbox);
    vm.runInContext(src + '\nwindow.I18N = I18N;', sandbox);
    return sandbox.window.I18N;
  };
  const web = load(null);
  assert.strictEqual(web.getPlatform(), 'web');
  assert.strictEqual(web.t('settings.browserNotificationsDenied'),
    'Notifications are blocked for this site. Allow them in your browser settings.');
  for (const lang of ['en', 'es', 'fr', 'de', 'ja', 'zh']) {
    // A hard-coded English title before platform wording; the web keeps it.
    web.setLang(lang);
    assert.strictEqual(web.t('controls.downloadSvg'), 'Download as SVG', lang);
  }
  const keys = ['settings.browserNotifications', 'settings.browserNotificationsHint',
    'settings.browserNotificationsDenied', 'toast.undoFailed', 'controls.downloadSvg'];
  const webWords = /\b(browser|tabs?|website|cookies?)\b|navegador|pestaña|navigateur|onglet|\bTab\b|ブラウザ|タブ|浏览器|标签页|网站/i;
  for (const platform of ['macos', 'ios']) {
    const I18N = load(platform);
    assert.strictEqual(I18N.getPlatform(), platform);
    for (const lang of ['en', 'es', 'fr', 'de', 'ja', 'zh']) {
      I18N.setLang(lang);
      web.setLang(lang);
      for (const key of keys) {
        const s = I18N.t(key);
        assert.notStrictEqual(s, web.t(key), `${platform} ${lang} ${key} has its own wording`);
        assert.ok(!webWords.test(s), `${platform} ${lang} ${key}: ${s}`);
      }
    }
  }
});

test('the LIVE badge marks live sessions as a premium beta, in every language', () => {
  const vm = require('vm');
  const html = buildPlayerHtml(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'programs', 'thanksgiving_one_oven.json'), 'utf8')));
  const badge = html.slice(html.indexOf('<span id="live-badge"'), html.indexOf('</span>\n', html.indexOf('<span id="live-badge"')));
  assert.ok(badge.includes(' LIVE <small class="live-beta-badge" data-i18n="status.beta" data-i18n-title="status.premiumBeta"'), badge);
  assert.ok(badge.includes('>Beta</small>'), badge);
  const src = html.slice(html.indexOf('var I18N = (function() {'), html.indexOf('function updateAllTranslations()'));
  const beta = { en: /^Beta$/, es: /^Beta$/, fr: /^Bêta$/, de: /^Beta$/, ja: /^ベータ$/, zh: /^测试版$/ };
  for (const platform of [null, 'macos', 'ios']) {
    const window = platform ? { RHYLTHYME_PLATFORM: platform } : {};
    window.parent = window;
    const sandbox = { window, navigator: { userAgent: '' }, document: { documentElement: { setAttribute() {} } } };
    vm.createContext(sandbox);
    vm.runInContext(src + '\nwindow.I18N = I18N;', sandbox);
    const I18N = sandbox.window.I18N;
    for (const lang of Object.keys(beta)) {
      I18N.setLang(lang);
      assert.match(I18N.t('status.beta'), beta[lang], `${platform} ${lang}`);
      assert.match(I18N.t('status.premiumBeta'), /premium|プレミアム|高级/i, `${platform} ${lang}`);
    }
  }
});
