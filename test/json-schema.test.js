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

test('the bundled schemas are byte-for-byte copies of rhylthyme-spec', { skip: !fs.existsSync(SPEC) && 'no rhylthyme-spec checkout' }, () => {
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
  assert.equal(f.fix, 'Add "maxSeconds" to tracks[0].steps[0].duration.');
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
  assert.deepEqual([f.code, f.where, f.fix], ['schema_required', 'tracks[0]', 'Add "name" to tracks[0].']);

  const q = program();
  q.tracks[0].steps[0].duration.type = 'fixd';
  assert.deepEqual(codes(q), ['schema_oneOf', 'bad_duration_type']);
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

test('the authored program is checked, so expansion cannot hide a missing name', () => {
  const p = program();
  delete p.tracks[0].steps[0].name;
  p.tracks[0].steps[0].replicates = { count: 2, mode: 'serial' };
  const [f] = S.validateProgram(p).errors;
  assert.deepEqual([f.code, f.where], ['schema_required', 'tracks[0].steps[0]']);
});

test('formatValidation lists schema findings with their fixes', () => {
  const p = program();
  p.resourceConstraints[0].maxConcurrent = '1';
  const text = S.formatValidation(S.validateProgram(p));
  assert.match(text, /\*\*schema_type\*\* resourceConstraints\[0\]\.maxConcurrent is "1"/);
  assert.match(text, /↳ Write 1 as a number/);
});
