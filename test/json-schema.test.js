'use strict';
// src/schedule/json-schema.js: the bundled program schemas, the
// zero-dependency Draft 7 checker, and the schema_<keyword> findings that
// validateProgram reports. test/parity.test.js checks the verdicts against
// Python's jsonschema; these pin the semantics that matter on their own.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const J = require('../src/schedule/json-schema.js');
const S = require('../src/schedule');

const SPEC = path.join(__dirname, '..', '..', 'rhylthyme-spec', 'src', 'rhylthyme_spec', 'schemas');

function program(extra) {
  return Object.assign({
    programId: 'p', name: 'P', schemaVersion: '0.3.0-alpha',
    tracks: [{ trackId: 't', name: 'T', steps: [
      { stepId: 'a', name: 'A', task: 'prep', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'programStart' } },
    ] }],
    resourceConstraints: [{ task: 'prep', maxConcurrent: 1 }],
  }, extra || {});
}
const codes = (p) => S.validateProgram(p).errors.map((e) => e.code);

test('the checker implements every keyword the bundled schemas use', () => {
  for (const v of J.SCHEMA_VERSIONS) assert.deepEqual(J.unsupportedKeywords(J.programSchema(v)), [], v);
  assert.equal(J.programSchema('0.3.0-alpha').$schema, 'http://json-schema.org/draft-07/schema#');
});

// CI's parity job checks out rhylthyme-spec and sets this, so the copy
// check fails there instead of skipping.
const noSpec = !fs.existsSync(SPEC) && `no rhylthyme-spec checkout at ${SPEC}`;
if (noSpec && process.env.RHYLTHYME_PARITY_REQUIRED) throw new Error(noSpec);

test('the bundled schemas are byte-for-byte copies of rhylthyme-spec', { skip: noSpec }, () => {
  for (const v of J.SCHEMA_VERSIONS) {
    const name = `program_schema_${v}.json`;
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'src', 'schedule', 'schemas', name)).equals(fs.readFileSync(path.join(SPEC, name))), name);
  }
});

test('schemaVersion selects the schema as rhylthyme-examples does', () => {
  const v3 = J.programSchema('0.3.0-alpha');
  const v2 = J.programSchema('0.2.0-alpha');
  assert.notEqual(v2, v3);
  assert.equal(J.programSchema('0.3.1'), v3);
  assert.equal(J.programSchema('0.3'), v3);
  for (const v of ['0.1.0', '0.2.0', '0.2.0-alpha', undefined, null, '0.30.0', 'junk']) assert.equal(J.programSchema(v), v2, String(v));
});

test('a valid program has no schema findings', () => {
  assert.deepEqual(J.schemaFindings(program()), []);
  assert.deepEqual(J.schemaFindings(program({ schemaVersion: '0.2.0-alpha' })), []);
  assert.equal(S.validateProgram(program()).valid, true);
});

test('type: integer accepts whole numbers only, number takes any, booleans are neither', () => {
  const s = { type: 'integer' };
  assert.deepEqual(J.checkJsonSchema(2, s), []);
  assert.deepEqual(J.checkJsonSchema(2.0, s), []);
  assert.equal(J.checkJsonSchema(2.5, s)[0].keyword, 'type');
  assert.equal(J.checkJsonSchema('2', s)[0].keyword, 'type');
  assert.equal(J.checkJsonSchema(true, s)[0].keyword, 'type');
  assert.equal(J.checkJsonSchema(true, { type: 'number' }).length, 1);
  assert.deepEqual(J.checkJsonSchema(2.5, { type: ['number', 'string'] }), []);

  const p = program();
  p.resourceConstraints[0].maxConcurrent = '2';
  const [f] = S.validateProgram(p).errors;
  assert.deepEqual([f.code, f.where], ['schema_type', 'resourceConstraints[0].maxConcurrent']);
  assert.match(f.fix, /Write 2 as a number/);
  p.resourceConstraints[0].maxConcurrent = 1.5;
  assert.deepEqual(codes(p), ['schema_type']);
  assert.deepEqual(codes(program({ actors: 2.0 })), []);
});

test('oneOf means exactly one: no match and two matches both fail', () => {
  const s = { oneOf: [{ required: ['a'] }, { required: ['b'] }] };
  assert.deepEqual(J.checkJsonSchema({ a: 1 }, s), []);
  assert.equal(J.checkJsonSchema({}, s)[0].keyword, 'oneOf');
  const [two] = J.checkJsonSchema({ a: 1, b: 2 }, s);
  assert.equal(two.keyword, 'oneOf');
  assert.match(two.message, /matches 2 of the 2/);
  // anyOf is satisfied by either or both.
  assert.deepEqual(J.checkJsonSchema({ a: 1, b: 2 }, { anyOf: s.oneOf }), []);

  // A program duration with both seconds and timeString fits two shapes.
  assert.deepEqual(codes(program({ duration: { type: 'fixed', seconds: 60, timeString: '1m' } })), ['schema_oneOf']);
  assert.deepEqual(codes(program({ duration: { type: 'fixed', seconds: 60 } })), []);
});

test('a failed oneOf explains itself with the closest shape', () => {
  const p = program();
  p.tracks[0].steps[0].duration = { type: 'variable', minSeconds: 60 };
  const [f] = S.validateProgram(p).errors;
  assert.equal(f.code, 'schema_oneOf');
  assert.equal(f.where, 'tracks[0].steps[0].duration');
  assert.match(f.message, /closest: .*"maxSeconds"/);
  assert.equal(f.fix, 'Add "maxSeconds" to tracks[0].steps[0].duration. Seconds are a number or a time string such as "5m" or "1h30m".');
  // Several missing keys of the closest shape are all named.
  p.tracks[0].steps[0].duration = { type: 'variable' };
  assert.equal(S.validateProgram(p).errors[0].fix, 'Add "minSeconds", "maxSeconds" to tracks[0].steps[0].duration. Seconds are a number or a time string such as "5m" or "1h30m".');
});

test('additionalProperties: false rejects unknown keys and lists the allowed ones', () => {
  const p = program();
  p.tracks[0].steps[0].alerts = [{ event: 'end', sound: 'chime' }];
  const f = S.validateProgram(p).errors.find((e) => e.code === 'schema_additionalProperties');
  assert.equal(f.where, 'tracks[0].steps[0].alerts[0]');
  assert.match(f.message, /"sound"/);
  assert.match(f.fix, /allowed here: event, offsetSeconds, message, level/);
  // Without additionalProperties, unknown keys are fine (the top level and
  // the trigger shapes leave it open).
  assert.deepEqual(codes(program({ colour: 'red' })), []);
  const q = program();
  q.tracks[0].steps[0].startTrigger.delay = 5;
  assert.deepEqual(codes(q), []);
});

test('required, enum, minimum, minItems, minLength and pattern', () => {
  const p = program();
  delete p.tracks[0].name;
  const f = S.validateProgram(p).errors[0];
  assert.deepEqual([f.code, f.where, f.fix], ['schema_required', 'tracks[0]', 'Add a short display name to tracks[0]; without one the viewer shows a generic label.']);
  assert.equal(f.message, 'tracks[0] (track "t") is missing the required property "name".');

  // A value no shape's discriminator allows names every allowed value.
  const q = program();
  q.tracks[0].steps[0].duration.type = 'fixd';
  assert.deepEqual(codes(q), ['schema_oneOf']);
  assert.equal(S.validateProgram(q).errors[0].message, 'tracks[0].steps[0].duration.type (step "a") is "fixd", not one of "fixed", "variable", "indefinite".');
  assert.deepEqual(J.checkJsonSchema('x', { enum: ['a', 'b'] })[0].fix, 'Use one of: "a", "b".');
  assert.deepEqual(J.checkJsonSchema(1, { enum: [true] }).length, 1);
  assert.deepEqual(J.checkJsonSchema({ a: [1] }, { const: { a: [1] } }), []);

  assert.deepEqual(codes(program({ actors: 0 })), ['schema_minimum']);
  assert.equal(J.checkJsonSchema(0, { exclusiveMinimum: 0 })[0].keyword, 'exclusiveMinimum');
  assert.equal(J.checkJsonSchema([], { minItems: 1 })[0].keyword, 'minItems');
  // Lengths count code points, as Python does.
  assert.deepEqual(J.checkJsonSchema('\u{1F600}', { maxLength: 1 }), []);
  assert.equal(J.checkJsonSchema('', { minLength: 1 })[0].keyword, 'minLength');
  assert.deepEqual(J.checkJsonSchema('abc', { pattern: '^a' }), []);
  assert.equal(J.checkJsonSchema('xabc', { pattern: '^a' })[0].keyword, 'pattern');
  // pattern is a search, not a full match.
  assert.deepEqual(J.checkJsonSchema('xabc', { pattern: 'a' }), []);
});

test('format is not checked, as in Python jsonschema without a format checker', () => {
  assert.deepEqual(J.checkJsonSchema('not a date', { type: 'string', format: 'date-time' }), []);
  assert.deepEqual(codes(program({ startTrigger: { type: 'absolute', time: 'not a date' } })), []);
});

test('not, if/then and $ref (siblings of $ref are ignored, as in Draft 7)', () => {
  assert.equal(J.checkJsonSchema({ a: 1, b: 1 }, { not: { required: ['a', 'b'] } })[0].keyword, 'not');
  const s = { if: { properties: { type: { const: 'enum' } }, required: ['type'] }, then: { required: ['values'] } };
  assert.deepEqual(J.checkJsonSchema({ type: 'number' }, s), []);
  assert.equal(J.checkJsonSchema({ type: 'enum' }, s)[0].keyword, 'required');
  const root = { definitions: { n: { type: 'number' } }, properties: { x: { $ref: '#/definitions/n', type: 'string' } } };
  assert.deepEqual(J.checkJsonSchema({ x: 1 }, root), []);
  assert.equal(J.checkJsonSchema({ x: 'a' }, root)[0].keyword, 'type');
  assert.equal(J.checkJsonSchema(1, false)[0].keyword, 'false');
});

test('a program needs resourceConstraints, an environment or an environmentType', () => {
  const p = program();
  delete p.resourceConstraints;
  delete p.tracks[0].steps[0].task;
  const [f] = S.validateProgram(p).errors;
  assert.equal(f.code, 'schema_anyOf');
  assert.equal(f.fix, 'Add "resourceConstraints", "environment" or "environmentType" to program.');
  assert.equal(S.validateProgram(program({ resourceConstraints: [] , tracks: p.tracks })).valid, true);
});

test('indefinite steps need defaultSeconds', () => {
  const p = program();
  p.tracks[0].steps[0].duration = { type: 'indefinite' };
  assert.deepEqual(codes(p), ['schema_oneOf']);
  p.tracks[0].steps[0].duration.defaultSeconds = '5m';
  assert.deepEqual(codes(p), []);
});

test('time strings are read as seconds first, the way the Python validator reads them', () => {
  assert.deepEqual(J.normalizeTimeFields({ seconds: '1h30m', alerts: [{ offsetSeconds: '-2m' }], x: { bufferSeconds: '90' } }),
    { seconds: 5400, alerts: [{ offsetSeconds: '-2m' }], x: { bufferSeconds: 90 } });
  // Python drops the sign and unreadable strings become 0, so "-5m" passes minimum: 0.
  assert.deepEqual(J.normalizeTimeFields({ seconds: '-5m', minSeconds: 'soon', maxSeconds: '' }), { seconds: 300, minSeconds: 0, maxSeconds: 0 });
  // Properties set to undefined are absent, as in JSON.
  assert.deepEqual(J.normalizeTimeFields({ a: undefined, b: [undefined] }), { b: [null] });
});

test('a replicated step with no name cannot be expanded, so it is checked as written', () => {
  // Python's expander raises on it; JS's would invent "undefined (1 of 2)".
  const p = program();
  delete p.tracks[0].steps[0].name;
  p.tracks[0].steps[0].replicates = { count: 2, mode: 'serial' };
  assert.deepEqual(S.validateProgram(p).errors.map((e) => [e.code, e.where]), [['schema_required', 'tracks[0].steps[0]']]);
  // Likewise a replicated step with no stepId, and a track with no trackId.
  const q = program();
  delete q.tracks[0].steps[0].stepId;
  q.tracks[0].steps[0].replicates = { count: 2 };
  assert.deepEqual(S.validateProgram(q).errors.map((e) => [e.code, e.where]), [['schema_required', 'tracks[0].steps[0]']]);
  const r = program();
  delete r.tracks[0].trackId;
  assert.deepEqual(S.validateProgram(r).errors.map((e) => [e.code, e.where]), [['schema_required', 'tracks[0]']]);
});

test('a replicate count or batch_size that is not a whole number, or an unknown replicated step mode, is checked as written', () => {
  // Python's expander raises on these (range(2.5), "2" <= 1) or, for an
  // unknown mode on a replicated step, silently drops the step; the
  // expanded program no longer has the key, so it is checked as written.
  const two = () => {
    const p = program();
    p.tracks[0].steps.push({ stepId: 'b', name: 'B', task: 'prep', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'afterStep', stepId: 'a' } });
    return p;
  };
  const at = (p) => S.validateProgram(p).errors.map((e) => [e.code, e.where]);
  const cases = [
    [(p) => { p.tracks[0].steps[0].replicates = { count: 2.5 }; }, ['schema_type', 'tracks[0].steps[0].replicates.count']],
    [(p) => { p.tracks[0].steps[0].replicates = { count: 1.5 }; }, ['schema_type', 'tracks[0].steps[0].replicates.count']],
    [(p) => { p.tracks[0].replicates = { count: 2.5 }; }, ['schema_type', 'tracks[0].replicates.count']],
    [(p) => { p.tracks[0].replicates = { count: 1.5, mode: 'serial' }; }, ['schema_type', 'tracks[0].replicates.count']],
    [(p) => { p.tracks[0].batch_size = '2'; }, ['schema_type', 'tracks[0].batch_size']],
    [(p) => { p.tracks[0].batch_size = 2.5; }, ['schema_type', 'tracks[0].batch_size']],
    [(p) => { p.tracks[0].steps[0].replicates = { count: 2, mode: 'foo' }; }, ['schema_enum', 'tracks[0].steps[0].replicates.mode']],
  ];
  for (const [edit, want] of cases) {
    const p = two();
    edit(p);
    assert.deepEqual(at(p), [want], JSON.stringify(p.tracks[0]));
  }
  // Controls: a count Python treats as 1 or less, and whole numbers.
  for (const edit of [
    (p) => { p.tracks[0].steps[0].replicates = { count: 0.5 }; },
    (p) => { p.tracks[0].steps[0].replicates = { count: 2.0 }; },
    (p) => { p.tracks[0].steps[0].replicates = { count: 1, mode: 'foo' }; },
    (p) => { p.tracks[0].batch_size = 2; },
  ]) {
    const p = two();
    edit(p);
    assert.deepEqual(at(p), [], JSON.stringify(p.tracks[0]));
  }
});

test('a replicates Python treats as absent (null, [], {}) is accepted', () => {
  for (const rep of [null, [], {}, false, 0]) {
    const p = program();
    p.tracks[0].replicates = rep;
    assert.deepEqual(codes(p), [], `track replicates ${JSON.stringify(rep)}`);
    const q = program();
    q.tracks[0].steps[0].replicates = rep;
    assert.deepEqual(codes(q), [], `step replicates ${JSON.stringify(rep)}`);
  }
  // A non-empty array or a string is not a replicates object.
  const r = program();
  r.tracks[0].replicates = [2];
  assert.deepEqual(codes(r), ['schema_type']);
});

test('the fix for a missing startTrigger on a replicated step names the authored step before it', () => {
  const two = () => program({ tracks: [{ trackId: 't', name: 'T', steps: [
    { stepId: 'a', name: 'A', task: 'prep', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'programStart' } },
    { stepId: 'b', name: 'B', task: 'prep', duration: { type: 'fixed', seconds: 60 } },
  ] }] });
  const want = 'Add a startTrigger to tracks[0].steps[1], e.g. {"type": "afterStep", "stepId": "a"} to chain it after the step before it. The path is the authored step that replicates copies.';
  // In a replicated track the expanded step before b is "a-r1"; for a
  // replicated b, its copy heads a sub-track. Either way the authored
  // predecessor is "a".
  const track = two();
  track.tracks[0].replicates = { count: 2 };
  const step = two();
  step.tracks[0].steps[1].replicates = { count: 2 };
  for (const p of [track, step]) {
    const v = S.validateProgram(p);
    assert.deepEqual(v.errors.map((e) => [e.code, e.where, e.fix]), [['schema_required', 'tracks[0].steps[1]', want]]);
    // Following the advice gives a valid program whose copies chain
    // within each copy (b-r2 after a-r2, not after a-r1).
    p.tracks[0].steps[1].startTrigger = { type: 'afterStep', stepId: 'a' };
    assert.deepEqual(codes(p), []);
  }
  const ex = S.expandReplicates(track);
  const b2 = ex.tracks.flatMap((t) => t.steps).find((s) => s.stepId === 'b-r2');
  assert.deepEqual(b2.startTrigger, { type: 'afterStep', stepId: 'a-r2' });
});

test('the expanded program is checked, as in Python: an authored shape expansion resolves is accepted', () => {
  // A number as a replicated step's name becomes "42 (1 of 2)"; a count of
  // 0 is no replicate at all; a track without steps is left out (with a
  // warning).
  const p = program();
  p.tracks[0].steps[0].name = 42;
  p.tracks[0].steps[0].replicates = { count: 2 };
  assert.ok(J.schemaFindings(p).length, 'the authored program breaks the schema');
  assert.deepEqual(codes(p), []);
  const q = program();
  q.tracks[0].steps[0].replicates = { count: 0 };
  assert.deepEqual(codes(q), []);
  const r = program();
  r.tracks.push({ trackId: 'idle', name: 'Idle', steps: [] });
  const v = S.validateProgram(r);
  assert.deepEqual([v.valid, v.warnings.map((w) => [w.code, w.where])], [true, [['empty_track', 'tracks[1]']]]);
});

test('schema paths on the expanded program point back at the authored program', () => {
  const p = program();
  p.tracks[0].steps.push({ stepId: 'b', name: 'B', task: 'prep', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'afterStep', stepId: 'a' } });
  p.tracks[0].steps[0].replicates = { count: 3 };
  p.tracks[0].steps[0].priority = 1.5;
  p.tracks.push({ trackId: 'u', name: 'U', steps: [
    { stepId: 'c', name: 'C', task: 'prep', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'programStart' }, priority: 2.5 },
  ] });
  const errors = S.validateProgram(p).errors;
  // Three copies of "a" (in sub-tracks after tracks[0]), one finding, at the
  // authored step; "u" is tracks[4] once expanded, tracks[1] as written.
  assert.deepEqual(errors.map((e) => [e.code, e.where]), [
    ['schema_type', 'tracks[0].steps[0].priority'],
    ['schema_type', 'tracks[1].steps[0].priority'],
  ]);
  assert.match(errors[0].message, /^tracks\[0\]\.steps\[0\]\.priority \(step "a", in its copy "a-r1"\) is 1\.5/);
  assert.match(errors[0].fix, /The path is the authored step that replicates copies\.$/);
  assert.equal(errors[1].message, 'tracks[1].steps[0].priority (step "c") is 2.5 (number), not of type integer.');
});

test('a problem the schema reports is reported once, with the old fix advice', () => {
  const p = program({ tracks: [{ trackId: 't', name: 'T', steps: [
    { stepId: 'a', name: 'A', task: 'prep', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'programStart' } },
    { stepId: 'b', task: 'prep', duration: { type: 'fixed', seconds: 60 } },
  ] }] });
  delete p.programId;
  delete p.name;
  const v = S.validateProgram(p);
  assert.deepEqual(v.errors.map((e) => [e.code, e.where, e.fix]), [
    ['schema_required', 'tracks[0].steps[1]', 'Add a short imperative name to tracks[0].steps[1], e.g. "Sear the chicken".'],
    ['schema_required', 'tracks[0].steps[1]', 'Add a startTrigger to tracks[0].steps[1], e.g. {"type": "afterStep", "stepId": "a"} to chain it after the step before it.'],
    ['schema_required', 'program', 'Add a kebab-case programId, e.g. "thanksgiving-dinner".'],
    ['schema_required', 'program', 'Add a name: a human-readable title for the program.'],
  ]);
  assert.deepEqual(v.warnings, []);
  // An empty track list, a constraint with no task: once each.
  assert.deepEqual(codes(program({ tracks: [] })), ['schema_minItems']);
  assert.deepEqual(codes(program({ resourceConstraints: [{ maxConcurrent: 1 }] })).filter((c) => c !== 'task_not_constrained'), ['schema_required']);
});

test('formatValidation lists schema findings with their fixes', () => {
  const p = program();
  p.resourceConstraints[0].maxConcurrent = '1';
  const text = S.formatValidation(S.validateProgram(p));
  assert.match(text, /\*\*schema_type\*\* resourceConstraints\[0\]\.maxConcurrent is "1"/);
  assert.match(text, /↳ Write 1 as a number/);
});

test('pattern reads $, \\A, \\Z and \\d the way Python re.search does', () => {
  const key = { pattern: '^[A-Za-z][A-Za-z0-9_-]*$' };
  // Python's $ also matches before one final newline, not two, not mid-string.
  assert.deepEqual(J.checkJsonSchema('weight\n', key), []);
  assert.equal(J.checkJsonSchema('weight\n\n', key).length, 1);
  assert.equal(J.checkJsonSchema('we\night', key).length, 1);
  // A $ in a character class or escaped is a literal dollar.
  assert.deepEqual(J.checkJsonSchema('a$', { pattern: '^a[$]\\Z' }), []);
  assert.deepEqual(J.checkJsonSchema('a$', { pattern: '^a\\$' }), []);
  // \Z is the very end; \A the start.
  assert.equal(J.checkJsonSchema('ab\n', { pattern: '\\Aab\\Z' }).length, 1);
  assert.deepEqual(J.checkJsonSchema('ab', { pattern: '\\Aab\\Z' }), []);
  // \d is any Unicode digit, inside a class too; []] is a literal ].
  assert.deepEqual(J.checkJsonSchema('\u0663', { pattern: '^\\d$' }), []);
  assert.deepEqual(J.checkJsonSchema('\u0663', { pattern: '^[\\d]$' }), []);
  assert.deepEqual(J.checkJsonSchema(']', { pattern: '^[]]$' }), []);

  const p = program({ metadata: { varianceFactors: [{ key: 'weight\n', type: 'number' }] } });
  assert.deepEqual(codes(p), []);
});

test('a value that is not JSON is a finding, not a thrown error', () => {
  const cyc = { programId: 'p', name: 'n', tracks: [], resourceConstraints: [] };
  cyc.self = cyc;
  const r = S.validateProgram(cyc);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.code === 'not_json'));
  assert.ok(S.validateProgram(program({ actors: 2n })).errors.some((e) => e.code === 'not_json'));
  assert.deepEqual(J.schemaFindings(program({ actors: 2n })).map((f) => f.code), ['not_json']);
  // checkJsonSchema itself names a BigInt rather than throwing.
  assert.match(J.checkJsonSchema(2n, { type: 'integer' })[0].message, /2n/);
});
