'use strict';
// Parity: the JS validator (src/schedule) and the Python one (the
// `rhylthyme` package) must give every program in rhylthyme-examples the
// same verdict, valid or not, and every invalid/<CODE>.json its declared
// code. The Python side runs in a subprocess; the test skips when Python
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

out = {}
for rel in json.load(sys.stdin)["files"]:
    with open(sys.argv[1] + "/" + rel) as fh:
        program = json.load(fh)
    r = validate_program_structured(program, schema_for(program))
    out[rel] = {"valid": r["is_valid"], "codes": sorted({f["code"] for f in r["findings"]}),
                "schemaErrors": [str(e)[:200] for e in r["schema_errors"]]}
json.dump(out, sys.stdout)
`;

function pythonVerdicts(files) {
  const r = spawnSync(PYTHON, ['-W', 'ignore', '-c', PY, EXAMPLES], {
    input: JSON.stringify({ files }), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return { skip: (r.error && r.error.message) || r.stderr.trim().split('\n').pop() };
  return { verdicts: JSON.parse(r.stdout) };
}

const files = programFiles();
const py = files.length ? pythonVerdicts(files) : { skip: `no rhylthyme-examples at ${EXAMPLES}` };
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
