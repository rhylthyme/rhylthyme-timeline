'use strict';
// Runs test/element-harness.html in headless Chrome and asserts on what it
// records. Skipped when no Chrome/Chromium binary is found (set CHROME_BIN).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const pkg = require('../package.json');

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
}

const chrome = findChrome();

// Chrome does not always exit after --dump-dom (seen on macOS), so read the
// dump from stdout and kill the process once the document has been printed.
function dumpDom(url) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-chrome-'));
    const child = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--user-data-dir=' + profile,
      '--dump-dom', url,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
      if (err) reject(err); else resolve(out);
    };
    const timer = setTimeout(() => finish(new Error('Chrome produced no DOM dump within 60 s')), 60000);
    child.stdout.setEncoding('utf8'); // keep multi-byte characters whole across chunks
    child.stdout.on('data', (chunk) => { out += chunk; if (out.includes('</html>')) finish(); });
    child.on('error', finish);
    child.on('exit', () => {
      finish(out.includes('</html>') ? null : new Error('Chrome exited without a DOM dump'));
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* temp dir */ }
    });
  });
}

// One Chrome run for every test in this file.
let _harnessOut = null;
function harnessOutput() {
  if (!_harnessOut) {
    _harnessOut = (async () => {
      const harness = path.join(__dirname, 'element-harness.html');
      const dom = await dumpDom('file://' + harness);
      const m = /<pre id="results">([\s\S]*?)<\/pre>/.exec(dom);
      assert.ok(m, 'harness wrote results');
      return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    })();
  }
  return _harnessOut;
}

// ---------------------------------------------------------------------
// A small JSON Schema checker for the subset the runs schema uses
// ($ref, type, required, properties, additionalProperties, enum, pattern,
// format: date-time, minimum/exclusiveMinimum, items, if/then). ajv is not
// a dependency of this zero-dependency package.
// ---------------------------------------------------------------------
function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function schemaErrors(schema, data, root, at, errors) {
  root = root || schema; at = at || '$'; errors = errors || [];
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => (o ? o[k] : undefined), root);
    assert.ok(target, `unresolved $ref ${schema.$ref}`);
    return schemaErrors(target, data, root, at, errors);
  }
  const actual = jsonType(data);
  if (schema.type) {
    const types = [].concat(schema.type);
    const ok = types.some((t) => t === actual || (t === 'number' && actual === 'integer'));
    if (!ok) { errors.push(`${at}: expected ${types.join('|')}, got ${actual}`); return errors; }
  }
  if (schema.enum && !schema.enum.includes(data)) errors.push(`${at}: ${JSON.stringify(data)} not one of ${JSON.stringify(schema.enum)}`);
  if (schema.pattern && typeof data === 'string' && !new RegExp(schema.pattern).test(data)) errors.push(`${at}: "${data}" does not match ${schema.pattern}`);
  if (schema.format === 'date-time' && typeof data === 'string' && Number.isNaN(Date.parse(data))) errors.push(`${at}: "${data}" is not a date-time`);
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) errors.push(`${at}: ${data} < minimum ${schema.minimum}`);
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) errors.push(`${at}: ${data} <= exclusiveMinimum ${schema.exclusiveMinimum}`);
  }
  if (actual === 'object') {
    for (const key of schema.required || []) if (!(key in data)) errors.push(`${at}: missing required property "${key}"`);
    const props = schema.properties || {};
    for (const key of Object.keys(data)) {
      if (props[key]) schemaErrors(props[key], data[key], root, `${at}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${at}: unexpected property "${key}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        schemaErrors(schema.additionalProperties, data[key], root, `${at}.${key}`, errors);
      }
    }
    if (schema.if && schema.then && schemaErrors(schema.if, data, root, at, []).length === 0) {
      schemaErrors(schema.then, data, root, at, errors);
    }
  }
  if (actual === 'array' && schema.items) data.forEach((v, i) => schemaErrors(schema.items, v, root, `${at}[${i}]`, errors));
  return errors;
}

const RUNS_SCHEMA_PATH = path.join(
  __dirname, '..', '..', 'rhylthyme-spec', 'src', 'rhylthyme_spec', 'schemas', 'runs_schema_0.1.0-alpha.json',
);
function runsSchema() {
  try { return JSON.parse(fs.readFileSync(RUNS_SCHEMA_PATH, 'utf8')); } catch (e) { return null; }
}

test('<rhylthyme-timeline> plays a program in headless Chrome', { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
  const out = await harnessOutput();
  assert.deepStrictEqual(out.errors, []);
  const c = out.checks;
  assert.strictEqual(c.rendersBars, 13);
  assert.strictEqual(c.hasControls, true);
  assert.strictEqual(c.hasCursorBeforeStart, true);
  assert.strictEqual(c.statusRunning, 'running');
  assert.strictEqual(c.roastState, 'active');
  assert.strictEqual(c.roastDoneButton, true);
  assert.strictEqual(c.timeDisplay, '21:40');
  assert.strictEqual(c.peelState, 'waiting');
  assert.strictEqual(c.peelStartButton, true);
  assert.strictEqual(c.peelFloatsTo, 9000);
  assert.strictEqual(c.peelStateAfterStart, 'active');
  assert.strictEqual(c.roastEnd, 11700);
  assert.strictEqual(c.roastState2, 'done');
  assert.strictEqual(c.restStart, 11700);
  assert.strictEqual(c.finalStatus, 'completed');
  assert.strictEqual(c.allDone, true);
  assert.deepStrictEqual(c.afterStop, ['stopped', 0, 1]); // the first step is active at t = 0
  assert.strictEqual(c.speed10Time, 100);
  assert.strictEqual(c.pausedStatus, 'paused');
  assert.strictEqual(c.staticControls, false);
  assert.strictEqual(c.staticCursor, false);
  assert.strictEqual(c.staticBars, 13);
  assert.strictEqual(c.hoursFormat, '1:02:05');
  assert.strictEqual(c.clockFormat, '14:10:00');

  // Replicate instances group in the step list, and a late actual completion
  // of cool-r1 re-anchors the in-flight-gated bake-r3 through the engine.
  assert.deepStrictEqual(c.cookieGroups, [
    ['bake', 'Bake tray', 3, 0, 0],
    ['cool', 'Cool on rack', 3, 0, 0],
  ]);
  assert.strictEqual(c.bakeR3Planned, 2520);
  // t = 2400: trays 1 and 2 are baked, trays 1 and 2 are on the rack.
  assert.deepStrictEqual(c.groupsMidRun, [['bake', 2, 0, 1], ['cool', 0, 2, 1]]);
  assert.strictEqual(c.coolR1ActualEnd, 2700);
  assert.strictEqual(c.bakeR3Reanchored, 2700);
  assert.strictEqual(c.coolR3Reanchored, 3420);
  assert.strictEqual(c.boxReanchored, 4320);

  assert.strictEqual(c.corpusRendered, 6);
  assert.ok(out.events.some((e) => e[0] === 'rt-complete'), 'rt-complete fired');
  assert.ok(out.events.some((e) => e[0] === 'rt-step-complete' && e[1] === 'turkey-roast' && e[2] === 11700), 'roast auto-completed at cap');
});

// ---------------------------------------------------------------------
// Run records (plans/execution-history-duration-prediction.md Phase 3)
// ---------------------------------------------------------------------

test('the player emits one run record per run: completed, aborted, abandoned',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const R = out.records;

    // The main element played the Thanksgiving program to the end, had its
    // program replaced mid-run, and was stopped mid-run on the cookies
    // program: one record each, in that order, and never twice for a run.
    assert.deepStrictEqual(R.mainOutcomes, ['completed', 'abandoned', 'aborted']);
    assert.strictEqual(out.checks.recordsAfterStopAndRemove, 1, 'stop()/disconnect after a recorded run must not re-emit');

    const c = R.completed;
    assert.ok(c, 'a completed run record was emitted');
    assert.deepStrictEqual(R.completedOutcomes, ['completed']);
    assert.strictEqual(c.schemaVersion, '0.1.0-alpha');
    assert.match(c.runId, /^2026-09-14T12:00:00Z-[0-9a-f]{4}$/);
    assert.strictEqual(c.programId, 'runrec-demo');
    assert.strictEqual(c.startedAt, '2026-09-14T12:00:00.000Z');
    assert.strictEqual(c.environmentId, null);
    assert.deepStrictEqual(c.runtime, { kind: 'web', version: pkg.version, clockMode: 'wall', speed: 1 });
    assert.deepStrictEqual(c.context, { serves: '2', userTags: { oven: 'gas' }, environmentType: 'kitchen', offsetsUse: 'planned' });
    assert.deepStrictEqual(c.steps, [
      {
        stepId: 'prep', instance: 1,
        planned: { start: 0, end: 60, durationType: 'fixed', seconds: 60 },
        pausedSeconds: 10,                       // the simulated tab-hide
        actual: { start: 0, end: 60 }, endedBy: 'timer', triggerFiredAt: 0,
      },
      {
        stepId: 'simmer', instance: 1,
        planned: { start: 60, end: 180, durationType: 'indefinite', defaultSeconds: 120 },
        waitedOn: ['prep'], pausedSeconds: 0,
        actual: { start: 60, end: 160 }, endedBy: 'executor', triggerFiredAt: 60,
      },
    ]);
    assert.strictEqual(out.checks.runRecordGetterMatches, true, 'element.runRecord returns the emitted record');
    // While the run is in flight the getter returns a live "abandoned" snapshot.
    assert.strictEqual(out.checks.liveSnapshotOutcome, 'abandoned');
    assert.deepStrictEqual(out.checks.pauseAttributed, [['prep', 10], ['simmer', 0]]);

    // stop() mid-run: the running step is closed out as aborted, speed recorded.
    const a = R.aborted;
    assert.strictEqual(a.outcome, 'aborted');
    assert.strictEqual(a.runtime.speed, 10);
    assert.strictEqual(a.runtime.clockMode, 'wall');
    assert.deepStrictEqual(a.steps.map((s) => [s.stepId, s.actual || null, s.endedBy || null]), [
      ['prep', { start: 0, end: 30 }, 'abort'],
      ['simmer', null, null],
    ]);

    // Removed from the DOM mid-run: the step that was running keeps an open
    // interval (no end, no endedBy) and the run is abandoned.
    const b = R.abandoned;
    assert.strictEqual(b.outcome, 'abandoned');
    assert.deepStrictEqual(b.steps.map((s) => [s.stepId, s.actual || null, s.endedBy || null]), [
      ['prep', { start: 0 }, null],
      ['simmer', null, null],
    ]);
  });

test('every emitted run record validates against runs_schema_0.1.0-alpha',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const schema = runsSchema();
    if (!schema) { assert.ok(true, 'rhylthyme-spec not checked out beside rhylthyme-timeline'); return; }
    const out = await harnessOutput();
    const records = [out.records.mainFirst, out.records.completed, out.records.aborted, out.records.abandoned, out.records.predicted];
    for (const record of records) {
      assert.ok(record, 'record present');
      assert.deepStrictEqual(schemaErrors(schema, record), [], `record ${record.runId} (${record.outcome})`);
    }
  });

// ---------------------------------------------------------------------
// Declared variance factors (Phase 4): the pre-flight prompt
// ---------------------------------------------------------------------

test('the player asks for declared variance factors before starting a run',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const f = out.factors;

    // The Thanksgiving example's two factors, one field each.
    assert.deepStrictEqual(f.declared, [
      ['turkeyKg', 'number', 'kg', null],
      ['oven', 'enum', null, ['gas', 'electric', 'convection']],
    ]);
    assert.strictEqual(f.formBeforeStart, false, 'the form only appears when a run is asked for');
    assert.strictEqual(f.statusAfterStart, 'stopped', 'start() opens the form instead of starting');
    assert.strictEqual(f.formAfterStart, true);
    assert.deepStrictEqual(f.fields, [
      ['turkeyKg', 'input', 'text'],
      ['oven', 'select', 'select-one'],
    ]);
    assert.strictEqual(f.unitShown, 'kg');
    // The enum is a picker whose empty option is the skip.
    assert.deepStrictEqual(f.enumOptions, ['', 'gas', 'electric', 'convection']);

    // Submitting the form starts the run and records the answers.
    assert.strictEqual(f.statusAfterSubmit, 'running');
    assert.strictEqual(f.formAfterSubmit, false);
    assert.deepStrictEqual(f.answered, { turkeyKg: 6.4, oven: 'convection' });
    assert.deepStrictEqual(f.events, [['prompt', { turkeyKg: 6.4, oven: 'convection' }, []]]);
    assert.deepStrictEqual(f.recordTags, { turkeyKg: 6.4, oven: 'convection' });

    // Every field is skippable: Start with an empty form records nothing.
    assert.strictEqual(f.skippedStatus, 'running');
    assert.deepStrictEqual(f.skippedTags, {});

    // A value that does not fit its type is refused, with a reason, and the
    // run does not start until it is fixed.
    assert.strictEqual(f.badStatus, 'stopped');
    assert.match(f.badError, /'heavy' is not a number/);
    assert.strictEqual(f.badStillOpen, true);
    assert.strictEqual(f.fixedStatus, 'running');
    assert.deepStrictEqual(f.fixedTags, { turkeyKg: 7 });

    // Presetting every factor skips the form; enums are matched
    // case-insensitively and recorded in the declared spelling, and keys the
    // program does not declare are dropped (as preset_answers does in Python).
    assert.deepStrictEqual(f.preset, { turkeyKg: 5.5, oven: 'gas' });
    assert.deepStrictEqual(f.presetEvent, [['property', []]]);
    assert.strictEqual(f.presetStatus, 'running');
    assert.strictEqual(f.presetFormShown, false);
    assert.deepStrictEqual(f.presetTags, { turkeyKg: 5.5, oven: 'gas' });

    // A bad enum is dropped by the setter, leaving that factor unanswered —
    // so the next start() asks again.
    assert.deepStrictEqual(f.badEnumDropped, { turkeyKg: 6 });
    assert.deepStrictEqual(f.badEnumSkipped, ['oven']);
    assert.strictEqual(f.reopensWhenIncomplete, 'stopped');

    // data-factors presets the same way, as key=value pairs or as JSON.
    assert.deepStrictEqual(f.fromAttribute, { turkeyKg: 4.2, oven: 'electric' });
    assert.strictEqual(f.attributeStatus, 'running');
    assert.deepStrictEqual(f.fromJsonAttribute, { turkeyKg: 8, oven: 'gas' });

    // A program that declares no factors is untouched.
    assert.deepStrictEqual(f.undeclared, []);
    assert.strictEqual(f.undeclaredAsk, false, 'askFactors() has nothing to ask');
    assert.strictEqual(f.undeclaredStatus, 'running', 'start() starts, as it always did');
    assert.strictEqual(f.undeclaredForm, false);
  });

// ---------------------------------------------------------------------
// Predicted offsets (Phase 7): metadata.offsetsUse + element.predictions
// ---------------------------------------------------------------------

test('metadata.offsetsUse "predicted" resolves a negative offset from the predicted anchor end',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const p = out.predicted;

    // Thanksgiving: turkey-prep 1200 s fixed, turkey-roast indefinite with
    // defaultSeconds 9900, potatoes-peel at afterStep(turkey-roast, -2700).
    // The plan therefore starts the peel at 1200 + 9900 - 2700 = 8400.
    assert.strictEqual(p.plannedOffsetsUse, 'planned');
    assert.strictEqual(p.plannedPeelStart, 8400, 'without the flag the prediction is ignored');
    assert.deepStrictEqual(p.plannedAnchors, {});

    // With the flag and a prediction of 7200 s for the roast, the peel moves
    // to 1200 + 7200 - 2700 = 5700 — predicted end minus 45 minutes.
    assert.strictEqual(p.beforePredictions, 8400, 'the flag alone changes nothing');
    assert.strictEqual(p.offsetsUse, 'predicted');
    assert.strictEqual(p.peelStart, 5700);
    assert.deepStrictEqual(p.anchors, { 'potatoes-peel': 7200 });
    assert.strictEqual(p.roastEnd, 8400, 'the roast is projected from the prediction too');
    assert.deepStrictEqual(p.roundTrip, {
      'turkey-roast': { seconds: 7200, low: 6900, high: 7500, basis: 'model', n: 20 },
    });

    // The record says which numbers were used, and the frozen plan does not
    // move: planned.end and planned.defaultSeconds are still the author's.
    assert.strictEqual(p.recordOffsetsUse, 'predicted');
    assert.deepStrictEqual(p.recordPeel, [[7200, 8400, 9300]]);
    assert.deepStrictEqual(p.recordRoastPlanned, [[11100, 9900]]);

    // Clearing the predictions puts the peel back where the plan had it.
    assert.strictEqual(p.clearedPeelStart, 8400);

    // The interval-width condition: history must be SHARPER than the guess.
    assert.strictEqual(p.wideIntervalPeel, 8400, 'high - low == defaultSeconds is not narrower');
    assert.strictEqual(p.narrowEnoughPeel, 5700, 'one second narrower is enough');
    assert.strictEqual(p.basisNonePeel, 8400, 'basis "none" is the predictor declining');
    assert.strictEqual(p.irrelevantPeel, 8400, 'a prediction for an unanchored step changes nothing');

    // data-predictions takes the same JSON; junk is ignored.
    assert.strictEqual(p.fromAttribute, 5700);
    assert.deepStrictEqual(p.badAttribute, [{}, 8400]);
  });

test('the player hashes programs exactly like tools/hash-program.js',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const { programVersion } = require('../tools/hash-program.js');
    const out = await harnessOutput();
    assert.strictEqual(out.hashed.length, 3);
    for (const entry of out.hashed) {
      const program = JSON.parse(Buffer.from(entry.b64, 'base64').toString('utf8'));
      assert.match(entry.hash, /^sha256:[0-9a-f]{64}$/);
      assert.strictEqual(entry.hash, programVersion(program), entry.name);
    }
    // ...and the record carries the hash of the program that was run.
    assert.strictEqual(out.records.mainFirst.programVersion, out.hashed[0].hash);
  });
