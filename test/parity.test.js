'use strict';
// Parity: the JS validator (src/schedule) and the Python one (the
// `rhylthyme` package) must give every program in rhylthyme-examples the
// same verdict, valid or not, and every invalid/<CODE>.json its declared
// code. They must also agree on schema-invalid programs: the three from
// issue #8 and mutations of every example (a required key dropped, a wrong
// type, an unknown key, a float where an integer goes, an ambiguous oneOf),
// on plain and on replicated tracks and steps, plus controls the schema
// accepts (an unparseable date-time, since neither side checks `format`),
// and programs whose authored form breaks the schema but whose expanded
// form, which both sides check, does not. The Python side runs in a subprocess; the test skips when Python
// with `rhylthyme` or the rhylthyme-examples checkout is missing (CI has
// both). Its twin, rhylthyme's tests/test_js_parity.py, runs the same check
// from the Python repository against the published package.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateProgram } = require('../src/schedule');

const EXAMPLES = process.env.RHYLTHYME_EXAMPLES || path.join(__dirname, '..', '..', 'rhylthyme-examples');
const PYTHON = process.env.PYTHON || 'python3';

// Known, deliberate differences, keyed by path under rhylthyme-examples.
// Keep in step with KNOWN_DIFFERENCES in rhylthyme's tests/test_js_parity.py.
const KNOWN_DIFFERENCES = {
  // JS: a task with no resourceConstraint is an error unless the program
  // names an environment or actors. Python: only with --strict.
  'programs/comprehensive_manual_demo.json': 'task_not_constrained policy',
};

// Codes only one validator emits.
const JS_ONLY_CODES = new Set(['I_IMPLICIT_BARRIER']);

function programFiles() {
  const list = (dir, pick) => (fs.existsSync(path.join(EXAMPLES, dir))
    ? fs.readdirSync(path.join(EXAMPLES, dir)).sort().map(pick).filter(Boolean)
    : []);
  return [
    ...list('programs', (f) => (f.endsWith('.json') ? `programs/${f}` : null)),
    ...list('invalid', (f) => (f.endsWith('.json') ? `invalid/${f}` : null)),
    ...list('gold', (d) => (fs.existsSync(path.join(EXAMPLES, 'gold', d, 'program.json')) ? `gold/${d}/program.json` : null)),
  ];
}

const PY = `
import json, sys
from rhylthyme import validate_program_structured
from rhylthyme_spec import get_program_schema_path

schemas = {}
def schema_for(program):
    version = "0.3.0-alpha" if str(program.get("schemaVersion", "")).startswith("0.3") else "0.2.0-alpha"
    if version not in schemas:
        with open(get_program_schema_path(version)) as fh:
            schemas[version] = json.load(fh)
    return schemas[version]

def check(program):
    # The Python logic checks can raise on a schema-invalid program (a step
    # with no name, say). A raise rejects the program, so it counts as
    # invalid here; "crashed" keeps the reason.
    try:
        r = validate_program_structured(program, schema_for(program))
    except Exception as e:
        return {"valid": False, "codes": [], "schemaErrors": [], "crashed": f"{type(e).__name__}: {e}"[:200]}
    return {"valid": r["is_valid"], "codes": sorted({f["code"] for f in r["findings"]}),
            "schemaErrors": [str(e)[:200] for e in r["schema_errors"]]}

data = json.load(sys.stdin)
out = {}
for key, program in data.get("inline", {}).items():
    out[key] = check(program)
for rel in data["files"]:
    with open(sys.argv[1] + "/" + rel) as fh:
        program = json.load(fh)
    r = validate_program_structured(program, schema_for(program))
    out[rel] = {"valid": r["is_valid"], "codes": sorted({f["code"] for f in r["findings"]}),
                "schemaErrors": [str(e)[:200] for e in r["schema_errors"]]}
json.dump(out, sys.stdout)
`;

// The three programs from issue #8. The first two are valid to the logic
// checks and invalid to the schema (the missing track name; an unknown
// startTrigger key alone is allowed, no trigger shape sets
// additionalProperties). The third is valid to both validators: neither
// program schema sets additionalProperties at the top level either.
function issue8Programs() {
  const base = () => ({
    programId: 'issue-8', name: 'Issue 8', schemaVersion: '0.2.0-alpha',
    tracks: [{ trackId: 't', name: 'T', steps: [
      { stepId: 'a', name: 'A', task: 'prep', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'programStart' } },
      { stepId: 'b', name: 'B', task: 'prep', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'afterStep', stepId: 'a' } },
    ] }],
    resourceConstraints: [{ task: 'prep', maxConcurrent: 2 }],
  });
  const noNameExtraKey = base();
  delete noNameExtraKey.tracks[0].name;
  noNameExtraKey.tracks[0].steps[1].startTrigger.delay = 5;
  const stringMax = base();
  stringMax.resourceConstraints[0].maxConcurrent = '2';
  const colour = base();
  colour.colour = 'red';
  return {
    'issue-8/control': base(),
    'issue-8/track-without-name-and-unknown-trigger-key': noNameExtraKey,
    'issue-8/maxConcurrent-string': stringMax,
    'issue-8/unknown-top-level-key': colour,
  };
}

// Programs whose authored form breaks the schema and whose expanded form
// (what both validators check) does not: both accept them.
function expandedPassesPrograms() {
  const base = issue8Programs()['issue-8/control'];
  const out = {};
  const add = (name, edit) => { const p = JSON.parse(JSON.stringify(base)); edit(p); out[`expanded-passes/${name}`] = p; };
  add('replicated step named by a number', (p) => { Object.assign(p.tracks[0].steps[0], { name: 42, replicates: { count: 2 } }); });
  add('replicated track named by a number', (p) => { Object.assign(p.tracks[0], { name: 7, replicates: { count: 2 } }); });
  add('replicate count 0', (p) => { p.tracks[0].steps[0].replicates = { count: 0 }; });
  add('track without steps', (p) => { p.tracks.push({ trackId: 'idle', name: 'Idle', steps: [] }); });
  return out;
}

// Schema mutations of one example program, keyed "<rel> :: <mutation>".
// Each targets a part every example has (or skips), so the set grows with
// rhylthyme-examples. Both validators check the expanded program, so a
// mutation of a replicated track or step (`replicates`, an `instances`
// trigger) is compared like any other: the expander may resolve it (a
// number as a replicated step's name becomes "42 (1 of 2)") or be unable
// to run (a replicated step with no name), and both sides must agree.
function mutations(rel, program) {
  const out = {};
  const add = (name, edit) => {
    const p = JSON.parse(JSON.stringify(program));
    if (edit(p) !== false) out[`${rel} :: ${name}`] = p;
  };
  const replicated = (x) => !!x && (!!x.replicates || /"instances"/.test(JSON.stringify(x.startTrigger || {})));
  const trackReplicated = (t) => replicated(t) || t.batch_size > 1 || (Array.isArray(t.steps) && t.steps.some(replicated));
  const kinds = [
    ['', (t) => !trackReplicated(t), (s) => !replicated(s)],
    ['replicated ', trackReplicated, replicated],
  ];
  const rc = (p) => (Array.isArray(p.resourceConstraints) && p.resourceConstraints[0]) || null;
  add('unknown top-level key', (p) => { p.colour = 'red'; });
  for (const [kind, isTrack, isStep] of kinds) {
    const track = (p) => (Array.isArray(p.tracks) && p.tracks.find((t) => t && isTrack(t) && Array.isArray(t.steps) && t.steps.length)) || null;
    const step = (p) => {
      for (const t of (Array.isArray(p.tracks) ? p.tracks : [])) {
        const s = t && Array.isArray(t.steps) && t.steps.find((x) => x && isStep(x));
        if (s) return s;
      }
      return null;
    };
    add(`${kind}track without name`, (p) => { if (!track(p) || !('name' in track(p))) return false; delete track(p).name; });
    add(`${kind}track name is a number`, (p) => { if (!track(p)) return false; track(p).name = 7; });
    add(`${kind}step without name`, (p) => { if (!step(p)) return false; delete step(p).name; });
    add(`${kind}step name is a number`, (p) => { if (!step(p)) return false; step(p).name = 42; });
    add(`${kind}step without startTrigger`, (p) => { if (!step(p)) return false; delete step(p).startTrigger; });
    add(`${kind}unknown key in a startTrigger (allowed)`, (p) => { if (!step(p) || !step(p).startTrigger) return false; step(p).startTrigger.delay = 5; });
    add(`${kind}unknown duration type`, (p) => { if (!step(p) || !step(p).duration) return false; step(p).duration.type = 'fixd'; });
    add(`${kind}step priority is a fraction`, (p) => { if (!step(p)) return false; step(p).priority = 1.5; });
  }
  add('replicate count is 0', (p) => { const s = (p.tracks || []).flatMap((t) => t.steps || []).find((x) => x && x.replicates); if (!s) return false; s.replicates.count = 0; });
  add('maxConcurrent is a string', (p) => { if (!rc(p)) return false; rc(p).maxConcurrent = String(rc(p).maxConcurrent); });
  add('maxConcurrent is a fraction', (p) => { if (!rc(p)) return false; rc(p).maxConcurrent = 1.5; });
  add('resource constraint without task', (p) => { if (!rc(p)) return false; delete rc(p).task; });
  add('actors is not an integer', (p) => { p.actors = 2.5; });
  add('program duration matching two oneOf shapes', (p) => { p.duration = { type: 'fixed', seconds: 3600, timeString: '1h' }; });
  add('program duration matching one oneOf shape (control)', (p) => { p.duration = { type: 'fixed', seconds: 3600 }; });
  add('absolute start with a bad date-time (control: format is not checked)', (p) => { p.startTrigger = { type: 'absolute', time: 'not a date' }; });
  return out;
}

function pythonVerdicts(files, inline) {
  const r = spawnSync(PYTHON, ['-W', 'ignore', '-c', PY, EXAMPLES], {
    input: JSON.stringify({ files, inline }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return { skip: (r.error && r.error.message) || r.stderr.trim().split('\n').pop() };
  return { verdicts: JSON.parse(r.stdout) };
}

const files = programFiles();
const inline = Object.assign(issue8Programs(), expandedPassesPrograms());
for (const rel of files) {
  if (rel.startsWith('invalid/') || KNOWN_DIFFERENCES[rel]) continue;
  Object.assign(inline, mutations(rel, JSON.parse(fs.readFileSync(path.join(EXAMPLES, rel), 'utf8'))));
}
const py = files.length ? pythonVerdicts(files, inline) : { skip: `no rhylthyme-examples at ${EXAMPLES}` };
const skip = py.skip ? `parity needs Python with rhylthyme and rhylthyme-examples: ${py.skip}` : false;
// CI's parity job sets this so a broken setup fails instead of skipping.
if (skip && process.env.RHYLTHYME_PARITY_REQUIRED) throw new Error(skip);

test('the JS and Python validators agree on every example program', { skip }, () => {
  assert.ok(files.length > 50, `only ${files.length} programs found in ${EXAMPLES}`);
  const disagreements = [];
  for (const rel of files) {
    const program = JSON.parse(fs.readFileSync(path.join(EXAMPLES, rel), 'utf8'));
    const js = validateProgram(program);
    const p = py.verdicts[rel];
    if (js.valid === p.valid) continue;
    if (KNOWN_DIFFERENCES[rel]) continue;
    disagreements.push(`${rel}: JS ${js.valid ? 'valid' : 'invalid ' + js.errors.map((e) => e.code).join(',')}, ` +
      `Python ${p.valid ? 'valid' : 'invalid ' + p.codes.concat(p.schemaErrors).join(',')}`);
  }
  assert.deepEqual(disagreements, []);
});

test('known differences are still differences', { skip }, () => {
  for (const rel of Object.keys(KNOWN_DIFFERENCES)) {
    if (!py.verdicts[rel]) continue;
    const js = validateProgram(JSON.parse(fs.readFileSync(path.join(EXAMPLES, rel), 'utf8')));
    assert.notEqual(js.valid, py.verdicts[rel].valid, `${rel} now agrees: remove it from KNOWN_DIFFERENCES`);
  }
});

test('both validators emit the code each invalid/<CODE>.json declares', { skip }, () => {
  for (const rel of files.filter((f) => f.startsWith('invalid/'))) {
    const program = JSON.parse(fs.readFileSync(path.join(EXAMPLES, rel), 'utf8'));
    const { code } = program.metadata.expectedFinding;
    const js = validateProgram(program);
    const jsCodes = [...js.errors, ...js.warnings, ...js.info].map((f) => f.code);
    assert.ok(jsCodes.includes(code), `${rel}: JS emitted ${jsCodes.join(',') || 'nothing'}`);
    if (!JS_ONLY_CODES.has(code)) {
      assert.ok(py.verdicts[rel].codes.includes(code), `${rel}: Python emitted ${py.verdicts[rel].codes.join(',') || 'nothing'}`);
    }
  }
});

test('both validators give the issue #8 programs the same verdict', { skip }, () => {
  for (const [key, program] of Object.entries(issue8Programs())) {
    const js = validateProgram(program);
    const control = key.endsWith('/control') || key.endsWith('/unknown-top-level-key');
    assert.equal(js.valid, control, `${key}: JS ${JSON.stringify(js.errors)}`);
    assert.equal(py.verdicts[key].valid, control, `${key}: Python ${py.verdicts[key].schemaErrors}`);
    if (!control) assert.ok(js.errors.length && js.errors.every((e) => e.code.startsWith('schema_')), `${key}: ${js.errors.map((e) => e.code)}`);
  }
});

test('the JS and Python validators agree on schema mutations of every example', { skip }, (t) => {
  const keys = Object.keys(inline).filter((k) => k.includes(' :: '));
  assert.ok(keys.length > 500, `only ${keys.length} mutations`);
  const disagreements = [];
  let invalid = 0;
  for (const key of keys) {
    const js = validateProgram(inline[key]);
    const p = py.verdicts[key];
    if (!p.valid) invalid++;
    if (js.valid === p.valid) continue;
    disagreements.push(`${key}: JS ${js.valid ? 'valid' : 'invalid ' + js.errors.map((e) => e.code).join(',')}, ` +
      `Python ${p.valid ? 'valid' : 'invalid ' + p.codes.concat(p.schemaErrors, p.crashed || []).join(',')}`);
  }
  const rep = keys.filter((k) => / :: replicated /.test(k)).length;
  t.diagnostic(`${keys.length} mutations (${rep} of replicated parts), ${invalid} invalid, ${keys.filter((k) => py.verdicts[k].crashed).length} raised in Python`);
  assert.ok(rep > 50, `only ${rep} mutations of replicated parts`);
  assert.deepEqual(disagreements, []);
  // The mutations exercise the schema: most of them are rejected.
  assert.ok(invalid > keys.length / 2, `only ${invalid} of ${keys.length} mutations are invalid`);
});

test('a program whose authored form breaks the schema but whose expanded form passes is accepted by both', { skip }, () => {
  const { schemaFindings } = require('../src/schedule');
  for (const [key, program] of Object.entries(expandedPassesPrograms())) {
    if (key !== 'expanded-passes/track without steps') assert.ok(schemaFindings(program).length, `${key}: the authored form should break the schema`);
    const js = validateProgram(program);
    assert.equal(js.valid, true, `${key}: JS ${JSON.stringify(js.errors)}`);
    assert.equal(py.verdicts[key].valid, true, `${key}: Python ${JSON.stringify(py.verdicts[key])}`);
  }
});
