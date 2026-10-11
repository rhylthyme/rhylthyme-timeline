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
    assert.strictEqual(R.abandonedSync, 0, 'removal is decided a microtask after remove()');
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

// ---------------------------------------------------------------------
// rt-step-began / rt-step-ended (issue #6): every step, once per run
// ---------------------------------------------------------------------

test('rt-step-began and rt-step-ended fire once per step per run, in time order',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const T = out.transitions;
    const steps = (log) => log.filter((e) => e[0] === 'rt-step-began' || e[0] === 'rt-step-ended');
    const nonDecreasing = (log) => log.every((e, i) => i === 0 || e[2] >= log[i - 1][2]);

    // Thanksgiving played to the end: exactly one began and one ended per
    // step, a step's began before its ended, everything in time order and
    // before rt-complete.
    assert.strictEqual(T.status, 'completed');
    assert.strictEqual(T.stepIds.length, 13);
    assert.deepStrictEqual(T.firstAfterStart, [['rt-step-began', 'turkey-prep', 0, 'plan']], 'start() fires the steps that begin at 0');
    const full = steps(T.full);
    assert.strictEqual(full.length, 26);
    for (const id of T.stepIds) {
      const began = full.filter((e) => e[0] === 'rt-step-began' && e[1] === id);
      const ended = full.filter((e) => e[0] === 'rt-step-ended' && e[1] === id);
      assert.strictEqual(began.length, 1, 'one rt-step-began for ' + id);
      assert.strictEqual(ended.length, 1, 'one rt-step-ended for ' + id);
      assert.ok(full.indexOf(began[0]) < full.indexOf(ended[0]), id + ' began before it ended');
      assert.ok(began[0][2] <= ended[0][2], id + ' times');
    }
    assert.ok(nonDecreasing(full), 'transitions fire in time order');
    const completeAt = T.full.findIndex((e) => e[0] === 'rt-complete');
    assert.ok(completeAt > T.full.lastIndexOf(full[full.length - 1]), 'every ended precedes rt-complete');
    // Times are the transitions' own seconds, not the 120 s ticks that found them.
    assert.deepStrictEqual(full.find((e) => e[1] === 'stuffing-prep' && e[0] === 'rt-step-began'), ['rt-step-began', 'stuffing-prep', 5400, 'plan']);
    assert.deepStrictEqual(full.find((e) => e[1] === 'potatoes-mash' && e[0] === 'rt-step-ended'), ['rt-step-ended', 'potatoes-mash', 11100, 'timer']);
    // by: the gates a person started, the roast capped by the peel hand-off.
    const beganBy = Object.fromEntries(full.filter((e) => e[0] === 'rt-step-began').map((e) => [e[1], e[3]]));
    const endedBy = Object.fromEntries(full.filter((e) => e[0] === 'rt-step-ended').map((e) => [e[1], e[3]]));
    assert.strictEqual(beganBy['potatoes-peel'], 'person');
    assert.strictEqual(beganBy['guests-seated'], 'person');
    assert.strictEqual(beganBy['turkey-prep'], 'plan');
    assert.strictEqual(endedBy['turkey-roast'], 'trigger');
    assert.strictEqual(endedBy['turkey-prep'], 'timer');
    // The old events are unchanged: rt-step-start only for startStep().
    assert.deepStrictEqual(T.full.filter((e) => e[0] === 'rt-step-start').map((e) => e[1]), ['potatoes-peel', 'guests-seated']);
    assert.deepStrictEqual(T.full.filter((e) => e[0] === 'rt-step-complete').map((e) => e[1]), ['turkey-roast']);
    // The same step's rt-step-start comes before its rt-step-began.
    assert.ok(T.full.findIndex((e) => e[0] === 'rt-step-start' && e[1] === 'potatoes-peel') <
      T.full.findIndex((e) => e[0] === 'rt-step-began' && e[1] === 'potatoes-peel'));

    // stop() after completion ends nothing again; a new start() is a fresh
    // run that fires from the top, and stop() mid-run ends the running step "abort".
    assert.strictEqual(T.afterCompletedStop, 0);
    assert.deepStrictEqual(steps(T.replay), [
      ['rt-step-began', 'turkey-prep', 0, 'plan'],
      ['rt-step-ended', 'turkey-prep', 1200, 'timer'],
      ['rt-step-began', 'turkey-roast', 1200, 'plan'],
      ['rt-step-ended', 'turkey-roast', 1300, 'abort'],
    ]);
    assert.strictEqual(T.replay[T.replay.length - 1][0], 'rt-stop', 'the abort ends fire before rt-stop');

    // Replicate instances each fire, and one tick that runs the whole program
    // fires them in time order, an end before the begins it makes way for.
    assert.deepStrictEqual(T.cookies, [
      ['rt-step-began', 'mix', 0, 'plan'],
      ['rt-step-ended', 'mix', 900, 'timer'],
      ['rt-step-began', 'bake-r1', 900, 'plan'],
      ['rt-step-ended', 'bake-r1', 1620, 'timer'],
      ['rt-step-began', 'bake-r2', 1620, 'plan'],
      ['rt-step-began', 'cool-r1', 1620, 'plan'],
      ['rt-step-ended', 'bake-r2', 2340, 'timer'],
      ['rt-step-began', 'cool-r2', 2340, 'plan'],
      ['rt-step-ended', 'cool-r1', 2520, 'timer'],
      ['rt-step-began', 'bake-r3', 2520, 'plan'],
      ['rt-step-ended', 'bake-r3', 3240, 'timer'],
      ['rt-step-ended', 'cool-r2', 3240, 'timer'],
      ['rt-step-began', 'cool-r3', 3240, 'plan'],
      ['rt-step-ended', 'cool-r3', 4140, 'timer'],
      ['rt-step-began', 'box', 4140, 'plan'],
      ['rt-step-ended', 'box', 4440, 'timer'],
    ]);

    // completeStep() is a person (the run record's endedBy "executor").
    assert.deepStrictEqual(T.person, [
      ['rt-step-began', 'prep', 0, 'plan'],
      ['rt-step-ended', 'prep', 60, 'timer'],
      ['rt-step-began', 'simmer', 60, 'plan'],
      ['rt-step-ended', 'simmer', 100, 'person'],
    ]);

    // A zero-length step ends right after its own begin and before the
    // begins that wait on it, whatever the track order.
    assert.deepStrictEqual(T.zeroLength, [
      ['rt-step-began', 'A', 0, 'plan'],
      ['rt-step-ended', 'A', 10, 'timer'],
      ['rt-step-began', 'Z1', 10, 'plan'],
      ['rt-step-ended', 'Z1', 10, 'timer'],
      ['rt-step-began', 'Z2', 10, 'plan'],
      ['rt-step-ended', 'Z2', 10, 'timer'],
      ['rt-step-began', 'B', 10, 'plan'],
      ['rt-step-ended', 'B', 20, 'timer'],
    ]);

    // stop() from a handler: the rest of the batch first, then the abort,
    // then rt-stop, and nothing after it.
    assert.deepStrictEqual(T.stopInHandler, [
      ['rt-start', null, 0, null],
      ['rt-step-began', 'A', 0, 'plan'],
      ['rt-step-ended', 'A', 10, 'timer'],
      ['rt-step-began', 'B', 10, 'plan'],
      ['rt-step-ended', 'B', 20, 'timer'],
      ['rt-step-began', 'C', 20, 'plan'],
      ['rt-step-ended', 'C', 25, 'abort'],
      ['rt-stop', null, null, null],
    ]);
    assert.strictEqual(T.stopInHandlerStatus, 'stopped');
    // completeStep() from a handler: its end is queued behind the batch, so
    // every step still begins before it ends and nothing repeats.
    const k = T.completeInHandler;
    assert.strictEqual(k.length, 8);
    for (const id of ['A', 'V', 'P', 'Q']) {
      const b = k.findIndex((e) => e[0] === 'rt-step-began' && e[1] === id);
      const en = k.findIndex((e) => e[0] === 'rt-step-ended' && e[1] === id);
      assert.ok(b >= 0 && en > b, id + ' began before it ended');
    }
    assert.deepStrictEqual(k.find((e) => e[0] === 'rt-step-ended' && e[1] === 'V'), ['rt-step-ended', 'V', 40, 'person']);

    // startStep() on a stopped player starts a run, then the step.
    assert.deepStrictEqual(T.startStepStopped, [true, 'running']);
    assert.deepStrictEqual(T.startStepStoppedLog.slice(0, 4), [
      ['rt-start', null, 0, null],
      ['rt-step-start', 'G', 0, null],
      ['rt-step-began', 'G', 0, 'person'],
      ['rt-step-ended', 'G', 10, 'timer'],
    ]);

    // seek(): forward fires what it passes over, backward fires nothing, and
    // seeking forward again fires only what is new.
    assert.deepStrictEqual(T.seekForward, [
      ['rt-step-began', 'mix', 0, 'plan'],
      ['rt-step-ended', 'mix', 900, 'timer'],
      ['rt-step-began', 'bake-r1', 900, 'plan'],
    ]);
    assert.deepStrictEqual(T.seekBack, []);
    assert.deepStrictEqual(T.seekOn, [
      ['rt-step-ended', 'bake-r1', 1620, 'timer'],
      ['rt-step-began', 'bake-r2', 1620, 'plan'],
      ['rt-step-began', 'cool-r1', 1620, 'plan'],
    ]);
  });

// ---------------------------------------------------------------------
// Delivery guarantees and policies (README): dropped runs, rt-seek,
// stop() from a handler
// ---------------------------------------------------------------------

test('a dropped run ends its running steps "dropped", then nothing else',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const P = out.policies;

    // Program replaced at t = 60 with A (0-100) and C (50-150) running: their
    // ends in program order at the drop second, then the abandoned record,
    // then the new program's rt-load. The record still leaves them open.
    assert.deepStrictEqual(P.replaced, [
      ['rt-step-ended', 'A', 60, 'dropped'],
      ['rt-step-ended', 'C', 60, 'dropped'],
      ['rt-run-record', 'abandoned'],
      ['rt-load'],
    ]);
    assert.deepStrictEqual(P.replacedRecord, ['abandoned', [
      ['A', { start: 0 }, null],
      ['B', { start: 0, end: 50 }, 'timer'],
      ['C', { start: 50 }, null],
    ]]);
    assert.deepStrictEqual(P.afterReplaced, [], 'nothing fires for the dropped run afterwards');

    // Replaced from a handler mid-batch: the rest of the batch, then the
    // dropped end at the tick's second, then the record; no trailing rt-tick.
    assert.deepStrictEqual(P.replacedInHandler, [
      ['rt-start', 0],
      ['rt-step-began', 'A', 0, 'plan'],
      ['rt-step-ended', 'A', 10, 'timer'],
      ['rt-step-began', 'B', 10, 'plan'],
      ['rt-step-ended', 'B', 20, 'timer'],
      ['rt-step-began', 'C', 20, 'plan'],
      ['rt-step-ended', 'C', 25, 'dropped'],
      ['rt-run-record', 'abandoned'],
      ['rt-load'],
    ]);

    // Removed for good: nothing during remove(), the dropped ends and the
    // record one microtask later. Put back afterwards it stays still (no
    // tick, no step events, even on visibilitychange); stop() starts over.
    assert.deepStrictEqual(P.removedSync, []);
    assert.deepStrictEqual(P.removed, [
      ['rt-step-ended', 'A', 60, 'dropped'],
      ['rt-step-ended', 'C', 60, 'dropped'],
      ['rt-run-record', 'abandoned'],
    ]);
    assert.deepStrictEqual(P.afterRemoved, []);
    assert.strictEqual(P.afterRemovedStatus, 'running');
    assert.deepStrictEqual(P.afterRemovedStop, [['rt-stop']]);

    // Moved (appendChild to another parent; remove() and re-insert in one
    // script): not dropped, the clock resumes and the run completes normally.
    assert.deepStrictEqual(P.moved, []);
    assert.strictEqual(P.movedStatus, 'running');
    assert.strictEqual(P.movedTimer, true, 'the clock restarts on reconnect');
    assert.deepStrictEqual(P.movedRunOn, [
      ['rt-step-ended', 'A', 100, 'timer'],
      ['rt-step-ended', 'C', 150, 'timer'],
      ['rt-complete', 160],
      ['rt-run-record', 'completed'],
    ]);
    assert.strictEqual(P.movedRecord, 'completed');
  });

test('stop() from a handler: the rest of the batch, the abort ends, rt-stop, then nothing',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    assert.deepStrictEqual(out.policies.stopInHandler, [
      ['rt-start', 0],
      ['rt-step-began', 'A', 0, 'plan'],
      ['rt-step-ended', 'A', 10, 'timer'],
      ['rt-step-began', 'B', 10, 'plan'],
      ['rt-step-ended', 'B', 20, 'timer'],
      ['rt-step-began', 'C', 20, 'plan'],
      ['rt-step-ended', 'C', 25, 'abort'],
      ['rt-run-record', 'aborted'],
      ['rt-stop'],
    ]);
  });

test('seek() fires rt-seek {from, to} after the step events it causes, never a step twice',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const P = out.policies;
    assert.deepStrictEqual(P.seekNoopAtZero, [], 'a seek to the current time fires nothing');
    assert.deepStrictEqual(P.seekForward, [
      ['rt-step-began', 'mix', 0, 'plan'],
      ['rt-step-ended', 'mix', 900, 'timer'],
      ['rt-step-began', 'bake-r1', 900, 'plan'],
      ['rt-seek', 0, 1000],
    ]);
    assert.deepStrictEqual(P.seekBack, [['rt-seek', 1000, 100]], 'backward: rt-seek only');
    assert.deepStrictEqual(P.seekSame, []);
    assert.deepStrictEqual(P.seekOn, [
      ['rt-step-ended', 'bake-r1', 1620, 'timer'],
      ['rt-step-began', 'bake-r2', 1620, 'plan'],
      ['rt-step-began', 'cool-r1', 1620, 'plan'],
      ['rt-seek', 100, 2000],
    ], 'forward again: only what has not fired, then rt-seek');
    assert.deepStrictEqual(P.seekWhileRunning, [], 'seek() is ignored while running');
  });

test('seek() from a handler: rt-seek events arrive in call order, from chaining to',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    assert.deepStrictEqual(out.policies.nestedSeek, [
      ['rt-step-began', 'A', 0, 'plan'],
      ['rt-step-began', 'B', 0, 'plan'],
      ['rt-step-ended', 'B', 50, 'timer'],  // its handler calls seek(70)
      ['rt-step-began', 'C', 50, 'plan'],
      ['rt-seek', 0, 60],
      ['rt-seek', 60, 70],
    ]);
  });

test('an idle element has no run to drop: removed, put back and started, it runs',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const P = out.policies;
    const run = [
      ['rt-start', 0],
      ['rt-step-began', 'A', 0, 'plan'],
      ['rt-step-began', 'B', 0, 'plan'],
      ['rt-step-ended', 'B', 50, 'timer'],
      ['rt-step-began', 'C', 50, 'plan'],
    ];
    for (const k of ['idleNeverStarted', 'idleStopped']) {
      assert.deepStrictEqual(P[k].removed, [], k + ': removal fires nothing');
      assert.deepStrictEqual(P[k].run, run, k + ': the next start() is a normal run');
      assert.strictEqual(P[k].time, 60, k + ': the clock moves');
    }
    // Removed mid-run, then the program replaced while detached: the setter
    // drops the run at once; the deferred removal check finds nothing left,
    // so the new program's run is not frozen.
    assert.deepStrictEqual(P.idleReplacedWhileDetached.log, [
      ['rt-step-ended', 'A', 10, 'dropped'],
      ['rt-step-ended', 'B', 10, 'dropped'],
      ['rt-run-record', 'abandoned'],
      ['rt-load'],
    ].concat(run));
    assert.strictEqual(P.idleReplacedWhileDetached.time, 60);
  });

test('a dropped run is inert until stop(); a dropped end is never before its begin',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const P = out.policies;
    // Dropped while running, put back: completeStep / startStep refuse,
    // start / pause / toggle / tick fire nothing and the clock stays still.
    assert.deepStrictEqual(P.inertRunning, {
      calls: { completeA: false, completeC: false, startB: false },
      log: [], status: 'running', time: 60,
    });
    assert.deepStrictEqual(P.inertStop, [['rt-stop']], 'stop(): no abort ends, no second record');
    assert.deepStrictEqual(P.inertFresh.log, [
      ['rt-start', 0],
      ['rt-step-began', 'A', 0, 'plan'],
      ['rt-step-began', 'B', 0, 'plan'],
      ['rt-step-ended', 'B', 50, 'timer'],
      ['rt-step-began', 'C', 50, 'plan'],
    ]);
    assert.strictEqual(P.inertFresh.time, 60);
    // Dropped while paused: seek() and start() are ignored too (no rt-seek).
    assert.deepStrictEqual(P.inertPaused, { log: [], status: 'paused', time: 10 });

    // Paused at 60, sought back to 20, program replaced: A (began 0) ends at
    // 20, C (began 50) at its own begin, not before it.
    assert.deepStrictEqual(P.droppedAfterSeekBack, [
      ['rt-step-ended', 'A', 20, 'dropped'],
      ['rt-step-ended', 'C', 50, 'dropped'],
      ['rt-run-record', 'abandoned'],
      ['rt-load'],
    ]);

    // An await between remove() and the re-insert is a removal for good.
    assert.deepStrictEqual(P.awaitThenReinsert, {
      log: [
        ['rt-step-ended', 'A', 10, 'dropped'],
        ['rt-step-ended', 'B', 10, 'dropped'],
        ['rt-run-record', 'abandoned'],
      ],
      status: 'running', time: 10, timer: false,
    });
  });

// ---------------------------------------------------------------------
// Translatable labels and accessible buttons (issue #7)
// ---------------------------------------------------------------------

test('the player translates its text through the labels property',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const l = out.labels;

    // English stays exactly as before; the glyph is aria-hidden and the
    // button's aria-label is the text alone.
    assert.deepStrictEqual(l.defaultStart, ['▶ Start', 'Start', '▶']);
    assert.deepStrictEqual(l.defaultStop, ['■ Stop', 'Stop', '■']);
    assert.deepStrictEqual(l.defaultPause, ['❚❚ Pause', 'Pause', '❚❚']);
    assert.deepStrictEqual(l.defaultResume, ['▶ Resume', 'Resume', '▶']);
    assert.strictEqual(l.defaultStatus, 'stopped');
    assert.match(l.defaultStepStart[0], /^▶ Start: \S/);
    assert.strictEqual(l.defaultStepStart[1], l.defaultStepStart[0].slice(2));
    assert.strictEqual(l.defaultStepStart[2], '▶');
    assert.match(l.defaultStepDone[0], /^✓ Done: \S/);
    assert.strictEqual(l.defaultStepDone[2], '✓');
    assert.deepStrictEqual(l.defaultFormStart, ['▶ Start', 'Start', '▶']);
    assert.strictEqual(l.emptyDefault,
      'No program loaded. Set the <code>program</code> property or a <code>src</code> URL.');
    assert.ok(l.defaultKeys >= 20, 'labels getter returns the whole table');

    // Overrides: plain strings, {0} placeholders and functions.
    assert.deepStrictEqual(l.frResume, ['▶ Reprendre', 'Reprendre', '▶']);
    assert.deepStrictEqual(l.frStop, ['■ Arrêter', 'Arrêter', '■']);
    assert.match(l.frStepStart[0], /^▶ Démarrer : \S/);
    assert.strictEqual(l.frStepStart[1], l.frStepStart[0].slice(2));
    assert.match(l.frStepDone[0], /^✓ Terminé : \S/);
    assert.strictEqual(l.frSpeed, 'Vitesse ');
    assert.deepStrictEqual(l.frStatus, ['en pause', 'paused']);
    assert.strictEqual(l.frHintEscaped, '<b>not markup</b>', 'label text is escaped, never parsed as HTML');
    assert.deepStrictEqual(l.ignoredKeys, [true, true], 'unknown keys and non-string values are ignored');
    assert.deepStrictEqual(l.untranslatedPause, ['❚❚ Pause', 'Pause', '❚❚'], 'keys left out stay English');
    assert.strictEqual(l.throwingFallsBack, true);
    assert.deepStrictEqual(l.cleared, ['❚❚ Pause', 'Pause', '❚❚']);

    // The variance-factor form.
    assert.strictEqual(l.formTitle, 'Avant de commencer');
    assert.deepStrictEqual(l.formStart, ['▶ Commencer', 'Commencer', '▶']);
    assert.strictEqual(l.formSkip, '— passer —');
    assert.strictEqual(l.formError, "« lourd » n'est pas un nombre");
    assert.strictEqual(l.emptyFr, 'Aucun programme : propriété <code>program</code> ou URL <code>src</code>.');
    assert.strictEqual(l.emptyFn, 'Kein Programm: PROGRAM / src &lt;b&gt;',
      'a noProgram function gets the plain words and its text is escaped');

    // Relabelling an open factor form keeps the typed answers and errors.
    assert.deepStrictEqual(l.typedKept, ['6.5', 'gas', 'Avant']);
    assert.deepStrictEqual(l.errorBefore, ["'heavy' is not a number", false]);
    assert.deepStrictEqual(l.errorAfter, ['heavy', 'pas un nombre : heavy', false, 'stopped']);

    // The chart: English unchanged, translated keys drawn.
    assert.strictEqual(l.chartDefaultSame, true, 'untranslated chart is the renderer default byte for byte');
    assert.ok(l.chartDefault.some((t) => /^\d+ tracks · \S+ total$/.test(t)));
    assert.ok(l.chartDefault.includes('dependency'));
    assert.ok(l.chartFr.some((t) => /^\d+ pistes · \S+ · \d+ s$/.test(t)), JSON.stringify(l.chartFr));
    const enSub = l.chartDefault.find((t) => / tracks · /.test(t)).match(/^(\d+) tracks · (\S+) total$/);
    const frSub = l.chartFr.find((t) => / pistes · /.test(t)).match(/^(\d+) pistes · (\S+) · /);
    assert.deepStrictEqual(frSub.slice(1), enSub.slice(1), 'same track count and total as the renderer');
    assert.ok(l.chartFr.includes('dépendance'));
    assert.ok(l.chartFr.includes('manuel'));
    assert.ok(!l.chartFr.includes('dependency'));
    assert.ok(!l.chartFr.some((t) => / tracks · /.test(t)));

    // Locale formatting is opt-in.
    const loc = l.loc;
    assert.strictEqual(loc.plainSeconds, '45s');
    assert.strictEqual(loc.plainMinutes, '02:05');
    assert.strictEqual(loc.plainSpeed, '0.5×');
    assert.strictEqual(loc.attr, 'de');
    assert.strictEqual(loc.deMinutes, '02:05');
    assert.strictEqual(loc.deSpeed, '0,5×');
    assert.strictEqual(loc.deSeconds, loc.intlSeconds);
    assert.notStrictEqual(loc.arMinutes, '02:05', 'native digits in ar-EG');
    assert.match(loc.enClock, /^01:05:09\sPM$/);
    assert.strictEqual(loc.badClock, '13:05:09', 'an invalid locale falls back to the fixed format');
    assert.deepStrictEqual(loc.cleared, [false, '13:05:09']);
  });

test('the labels attribute translates declaratively, last setter wins',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const a = out.labels.attr;
    // Present before upgrade (innerHTML), together with locale.
    assert.strictEqual(a.upgraded, true);
    assert.deepStrictEqual(a.declarativeLocale, ['de', '02:05']);
    assert.deepStrictEqual(a.declStop, ['■ Arrêter', 'Arrêter', '■']);
    assert.strictEqual(a.declSpeed, '0,5 fois', '{1} placeholder from the attribute, formatted in the locale');
    assert.deepStrictEqual(a.declGetter, ['Arrêter', 'Démarrer : {0}', 'Pause', 'Start'],
      'non-string values are dropped; the getter returns the whole table in effect');
    assert.match(a.declStepStart[0], /^▶ Démarrer : \S/, '{0} placeholder from the attribute');
    assert.strictEqual(a.declStepStart[1], a.declStepStart[0].slice(2));
    assert.strictEqual(a.warningsAfterDecl, 0);
    // A change replaces the table rather than merging into it.
    assert.deepStrictEqual(a.changedResume, ['▶ Reprendre', 'Reprendre', '▶']);
    assert.deepStrictEqual(a.changedStop, ['■ Stop', 'Stop', '■']);
    // Invalid values: one warning each, previous labels kept.
    assert.strictEqual(a.invalidWarnings, 1);
    assert.deepStrictEqual(a.invalidKept, ['▶ Reprendre', 'Reprendre', '▶']);
    assert.strictEqual(a.arrayWarnings, 2);
    assert.strictEqual(a.arrayKept, 'Reprendre');
    // Property after attribute wins; the attribute is not rewritten.
    assert.deepStrictEqual(a.propertyWins, ['▶ Weiter', 'Weiter', '▶']);
    assert.strictEqual(a.propertyAttrUntouched, '["stop"]');
    assert.deepStrictEqual(a.removeKeepsProperty, ['▶ Weiter', 'Weiter', '▶'],
      'removing the attribute leaves labels the property supplied');
    // Attribute after property wins; removing it clears what it supplied.
    assert.deepStrictEqual(a.attributeWins, [['▶ Continuer', 'Continuer', '▶'], 'Continuer']);
    assert.deepStrictEqual(a.removed, [['▶ Resume', 'Resume', '▶'], 'Resume']);
    assert.deepStrictEqual(a.empty, [['■ Stop', 'Stop', '■'], 2], 'an empty attribute is no labels, no warning');
    assert.deepStrictEqual(a.invalidDecl, ['Stop', 3]);
    assert.strictEqual(a.warnings.length, 3);
    assert.ok(a.warnings.every((w) => /^rhylthyme-timeline: the labels attribute is not a JSON object/.test(w)));
    // Re-setting the attribute to its current value after the property took
    // over is still the last set: the attribute's labels come back.
    assert.deepStrictEqual(a.sameValueAfterProperty, ['AttrStop', ['■ AttrStop', 'AttrStop', '■']]);
    assert.strictEqual(a.sameValueThenRemoved, 'Stop');
  });

test('properties set before the element is defined go through its setters',
  { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
    const out = await harnessOutput();
    assert.deepStrictEqual(out.errors, []);
    const p = out.labels.preUpgrade;
    assert.deepStrictEqual(p.attachedOwn, [false, false], 'no own property hides the accessors after upgrade');
    assert.deepStrictEqual(p.attachedMode, ['static', 'static'], 'an attribute-backed property set before upgrade is applied');
    assert.deepStrictEqual(p.attachedLabels, ['PropStop', 'Start', ['■ PropStop', 'PropStop', '■']],
      'the property set before upgrade wins over the attribute present at upgrade, and the getter reports the whole table');
    assert.strictEqual(p.attachedAttrKept, '{"stop":"AttrStop"}', 'the attribute is not rewritten');
    assert.deepStrictEqual(p.attachedAttrAfter, ['AttrStop', ['■ AttrStop', 'AttrStop', '■']]);
    assert.strictEqual(p.detachedBefore, true);
    assert.strictEqual(p.detachedOwn, false);
    assert.deepStrictEqual(p.detachedLabels, ['PropStop', 'PropStop'], 'getter and rendered table agree');
    assert.deepStrictEqual(p.propOnly, [false, 'Los', 'Stop']);
  });
