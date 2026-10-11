'use strict';
// src/schedule/finding-codes.json (exported as findingCodes) must list
// every code validateProgram can emit, and nothing else, both ways:
//
//   source -> catalogue  every code literal in src/schedule/*.js and every
//                        JSON Schema keyword json-schema.js reports
//                        (schema_<keyword>) is catalogued;
//   catalogue -> source  every catalogued code is in the source, and each
//                        reachable code's examples, completed into programs,
//                        make validateProgram report it with the declared
//                        severity (which also proves the examples right);
//                        a code marked unreachable is never reported;
//   corpus               every code validateProgram reports on the programs
//                        in test/fixtures, rhylthyme-examples (programs/,
//                        invalid/, gold/) and the parity test's mutations is
//                        catalogued, with a declared severity.
//
// And when Python with `rhylthyme` is available, each code's python field
// is checked against what `rhylthyme validate --json` and
// validate_program_structured report for its examples. The rhylthyme-examples
// and Python parts skip without them, unless RHYLTHYME_PARITY_REQUIRED is
// set (CI's parity job).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const S = require('../src/schedule');
const { findingCodes } = S;
const { EXAMPLES, programFiles, issue8Programs, expandedPassesPrograms, mutations } = require('./helpers/parity-programs.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'schedule');
const CODES = findingCodes.codes;
const SEVERITIES = ['error', 'warning', 'info'];
const BUCKET = { error: 'errors', warning: 'warnings', info: 'info' };
const REQUIRED = !!process.env.RHYLTHYME_PARITY_REQUIRED;

// The browser entry, with no LabMCP catalogue registered (entry: "browser").
function browserSchedule() {
  const file = path.join(ROOT, 'browser', 'schedule.js');
  assert.ok(fs.existsSync(file), 'run npm run build first');
  const sandbox = {};
  sandbox.self = sandbox;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  assert.equal(sandbox.RhylthymeSchedule.labmcp.hasCatalog(), false);
  return sandbox.RhylthymeSchedule;
}

// An example's program, completed as findingCodes.completion describes.
function complete(example) {
  const copy = (v) => JSON.parse(JSON.stringify(v));
  if (example.whole) return copy(example.program);
  const program = Object.assign(copy(findingCodes.baseProgram), copy(example.program));
  (example.omit || []).forEach((k) => delete program[k]);
  if (example.bigint) {
    const at = example.bigint.slice(0, -1).reduce((o, k) => o[k], program);
    const key = example.bigint[example.bigint.length - 1];
    at[key] = BigInt(at[key]);
  }
  return program;
}

const examples = () => Object.entries(CODES).flatMap(([code, entry]) => entry.examples.map((example, i) => ({ code, entry, example, key: `${code}#${i}` })));
const reported = (result) => SEVERITIES.flatMap((sev) => result[BUCKET[sev]].map((f) => ({ code: f.code, severity: sev })));

// ---------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------

const SOURCES = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

// Every way a code reaches a finding in src/schedule/*.js. Each pattern must
// match at least once, so a refactor that changes the shape of the calls
// fails here rather than silently scanning nothing.
const CODE_PATTERNS = {
  'err/warn/note/shapeErr("code", ...)': /\b(?:err|warn|note|shapeErr)\(\s*"([A-Za-z_]+)"/g,
  'push/add("severity", "code", ...)': /\b(?:push|add)\(\s*"(?:error|warning|info)",\s*"([A-Za-z_]+)"/g,
  '{ code: "code" }': /\bcode:\s*"([A-Za-z_]+)"/g,
  '[["code", problem]] tuples': /\[\s*"([A-Za-z_]+)",\s*(?:`|p\]|problem\b)/g,
};
// Literals with these shapes are codes wherever they appear.
const CODE_SHAPES = /"((?:[EWI]_[A-Z][A-Z_]+)|(?:instrument_[a-z_]+))"/g;

function sourceCodes() {
  const found = new Map(); // code -> files
  const hits = {};
  const note = (code, file) => { if (!found.has(code)) found.set(code, new Set()); found.get(code).add(file); };
  for (const file of SOURCES) {
    const text = read(file);
    for (const [name, re] of Object.entries(CODE_PATTERNS)) {
      for (const m of text.matchAll(re)) { note(m[1], file); hits[name] = (hits[name] || 0) + 1; }
    }
    for (const m of text.matchAll(CODE_SHAPES)) note(m[1], file);
  }
  return { found, hits };
}

// The keywords json-schema.js reports findings for (schema_<keyword>).
function reportedKeywords() {
  const text = read('json-schema.js');
  const kws = new Set();
  for (const m of text.matchAll(/\bkeyword:\s*"(\w+)"/g)) kws.add(m[1]);
  for (const m of text.matchAll(/_combinatorErrors\(\s*"(\w+)"/g)) kws.add(m[1]);
  return kws;
}

// Keywords the bundled schemas use where a failure is reported: not inside
// an `if` (a failing `if` picks the else branch, it reports nothing).
function assertingKeywords() {
  const used = new Set();
  const walk = (s) => {
    if (s === false) { used.add('false'); return; }
    if (!s || typeof s !== 'object' || Array.isArray(s)) return;
    for (const [k, v] of Object.entries(s)) {
      if (k === 'if') continue;
      used.add(k);
      if (k === 'properties' || k === 'definitions') Object.values(v).forEach(walk);
      // additionalProperties: false is its own assertion, not a false schema.
      else if (k === 'additionalProperties') { if (v !== false) walk(v); }
      else if (['items', 'not', 'then', 'else'].includes(k)) (Array.isArray(v) ? v : [v]).forEach(walk);
      else if (['oneOf', 'anyOf', 'allOf'].includes(k)) v.forEach(walk);
    }
  };
  const JsonSchema = require('../src/schedule/json-schema.js');
  JsonSchema.SCHEMA_VERSIONS.forEach((v) => walk(JsonSchema.programSchema(v)));
  return used;
}

test('the catalogue is well formed', () => {
  assert.equal(S.findingCodes, require('../src/schedule/finding-codes.json'));
  assert.ok(Object.keys(CODES).length > 60, `${Object.keys(CODES).length} codes`);
  const areas = Object.keys(findingCodes.areas);
  assert.deepEqual(areas, ['schema', 'structure', 'timing', 'resources', 'instances', 'alerts', 'instruments']);
  assert.equal(S.validateProgram(findingCodes.baseProgram).valid, true);
  assert.deepEqual(reported(S.validateProgram(findingCodes.baseProgram)), [], 'the base program has no findings at all');
  for (const [code, e] of Object.entries(CODES)) {
    assert.ok(areas.includes(e.area), `${code}: area ${e.area}`);
    assert.ok(Array.isArray(e.severity) && e.severity.length && e.severity.every((s) => SEVERITIES.includes(s)), `${code}: severity`);
    for (const k of ['summary', 'explanation', 'fix']) assert.ok(typeof e[k] === 'string' && e[k].length > 10, `${code}: ${k}`);
    assert.ok(e.python && 'cli' in e.python && 'library' in e.python, `${code}: python.cli and python.library`);
    if (code.startsWith('schema_')) assert.equal(e.schemaKeyword, code.slice('schema_'.length), `${code}: schemaKeyword`);
    if (e.reachable === false) {
      assert.ok(e.unreachableBecause && e.unreachableBecause.length > 20, `${code}: unreachableBecause`);
      assert.deepEqual(e.examples, [], `${code}: an unreachable code has no example`);
    } else {
      assert.equal(e.reachable, undefined, `${code}: reachable is only ever false`);
      assert.equal(e.unreachableBecause, undefined, code);
      // One example for each severity the code can have, and none other.
      assert.deepEqual([...new Set(e.examples.map((x) => x.severity))].sort(), [...e.severity].sort(), `${code}: one example per severity`);
    }
  }
});

test('source -> catalogue: every code in src/schedule is catalogued', () => {
  const { found, hits } = sourceCodes();
  for (const name of Object.keys(CODE_PATTERNS)) assert.ok(hits[name] > 0, `the pattern for ${name} matched nothing: update CODE_PATTERNS`);
  const missing = [...found.keys()].filter((c) => !CODES[c]).map((c) => `${c} (${[...found.get(c)].join(', ')})`);
  assert.deepEqual(missing, [], 'add these to src/schedule/finding-codes.json');
  // The schema codes are made from the keyword at run time.
  assert.match(read('json-schema.js'), /code: `schema_\$\{e\.keyword\}`/);
  const kws = reportedKeywords();
  assert.ok(kws.size > 15, [...kws].join(' '));
  const missingKw = [...kws].filter((k) => !CODES[`schema_${k}`]);
  assert.deepEqual(missingKw, [], 'add schema_<keyword> entries for these');
});

test('catalogue -> source: every catalogued code is one the source can emit', () => {
  const { found } = sourceCodes();
  const kws = reportedKeywords();
  const stale = Object.keys(CODES).filter((c) => (c.startsWith('schema_') ? !kws.has(c.slice(7)) : !found.has(c)));
  assert.deepEqual(stale, [], 'these are in finding-codes.json but nowhere in src/schedule');
});

test('a schema_<keyword> code is reachable exactly when a bundled schema asserts the keyword', () => {
  const used = assertingKeywords();
  for (const [code, e] of Object.entries(CODES)) {
    if (!e.schemaKeyword) continue;
    if (e.reachable === false) {
      assert.ok(!used.has(e.schemaKeyword), `${code}: a bundled schema now uses "${e.schemaKeyword}"; add an example and drop reachable: false`);
    } else {
      assert.ok(used.has(e.schemaKeyword), `${code}: no bundled schema uses "${e.schemaKeyword}" any more; mark it reachable: false`);
    }
  }
});

test('every example makes validateProgram report its code with its severity', () => {
  const B = browserSchedule();
  let n = 0;
  for (const { code, example, key } of examples()) {
    const result = (example.entry === 'browser' ? B : S).validateProgram(complete(example));
    const got = reported(result);
    const all = got.map((f) => `${f.code}:${f.severity}`).join(', ');
    assert.ok(got.some((f) => f.code === code && f.severity === example.severity), `${key}: expected ${code} as ${example.severity}, got ${all || 'nothing'}`);
    for (const f of got) {
      assert.ok(CODES[f.code], `${key}: reported ${f.code}, which is not catalogued`);
      assert.ok(CODES[f.code].severity.includes(f.severity), `${key}: ${f.code} reported as ${f.severity}, catalogued as ${CODES[f.code].severity}`);
    }
    assert.equal(result.valid, !result.errors.length);
    if (example.severity === 'error') assert.equal(result.valid, false, key);
    n++;
  }
  assert.ok(n >= Object.values(CODES).filter((e) => e.reachable !== false).length);
});

// ---------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------

function corpus() {
  const out = {};
  const fixtures = path.join(__dirname, 'fixtures');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (d.name.endsWith('.json')) {
      const v = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v.tracks)) out[path.relative(__dirname, p)] = v;
    }
  });
  walk(fixtures);
  const files = programFiles();
  for (const rel of files) {
    const program = JSON.parse(fs.readFileSync(path.join(EXAMPLES, rel), 'utf8'));
    out[`rhylthyme-examples/${rel}`] = program;
    if (!rel.startsWith('invalid/')) Object.assign(out, mutations(rel, program));
  }
  Object.assign(out, issue8Programs(), expandedPassesPrograms());
  return { programs: out, examples: files.length };
}

test('every code validateProgram reports on the program corpus is catalogued', (t) => {
  const { programs, examples: n } = corpus();
  if (!n && REQUIRED) throw new Error(`no rhylthyme-examples at ${EXAMPLES}`);
  const seen = new Map();
  for (const [key, program] of Object.entries(programs)) {
    for (const f of reported(S.validateProgram(program))) {
      assert.ok(CODES[f.code], `${key}: ${f.code} is not catalogued`);
      assert.ok(CODES[f.code].severity.includes(f.severity), `${key}: ${f.code} reported as ${f.severity}, catalogued as ${CODES[f.code].severity}`);
      assert.notEqual(CODES[f.code].reachable, false, `${key}: ${f.code} is catalogued as unreachable`);
      seen.set(f.code, (seen.get(f.code) || 0) + 1);
    }
  }
  t.diagnostic(`${Object.keys(programs).length} programs (${n} from rhylthyme-examples), ${seen.size} distinct codes reported`);
  // invalid/<CODE>.json declares the code it shows; it is catalogued too.
  for (const rel of programFiles().filter((f) => f.startsWith('invalid/'))) {
    const { code, severity } = JSON.parse(fs.readFileSync(path.join(EXAMPLES, rel), 'utf8')).metadata.expectedFinding;
    assert.ok(CODES[code] && CODES[code].severity.includes(severity), `${rel}: ${code} (${severity})`);
  }
});

// ---------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------

const PY = `
import importlib.util, json, os, sys, tempfile
from rhylthyme import validate_program_structured
from rhylthyme.validate_program import validate_program_file_structured
from rhylthyme_spec import get_program_schema_path

def schema_path(program):
    v = "0.3.0-alpha" if isinstance(program, dict) and str(program.get("schemaVersion", "")).startswith("0.3") else "0.2.0-alpha"
    return get_program_schema_path(v)

def codes(findings):
    return sorted({f["code"] + ":" + f["severity"] for f in findings})

out = {"packages": {name: importlib.util.find_spec(name.replace("-", "_")) is not None
                    for name in ("rhylthyme-galago", "rhylthyme-labmcp")}, "results": {}}
for key, program in json.load(sys.stdin).items():
    r = {}
    try:
        with open(schema_path(program)) as fh:
            schema = json.load(fh)
        r["library"] = codes(validate_program_structured(program, schema)["findings"])
    except Exception as e:
        r["library"] = []
        r["libraryRaised"] = f"{type(e).__name__}: {e}"[:200]
    fd, path = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w") as fh:
        json.dump(program, fh)
    try:
        r["cli"] = codes(validate_program_file_structured(path, schema_path(program))["findings"])
    except Exception as e:
        r["cli"] = []
        r["cliRaised"] = f"{type(e).__name__}: {e}"[:200]
    finally:
        os.unlink(path)
    out["results"][key] = r
json.dump(out, sys.stdout)
`;

function pythonResults() {
  const programs = {};
  for (const { example, key } of examples()) {
    // not_json's BigInt cannot reach Python: it gets the JSON program.
    programs[key] = complete(Object.assign({}, example, { bigint: undefined }));
  }
  const r = spawnSync(process.env.PYTHON || 'python3', ['-W', 'ignore', '-c', PY], {
    input: JSON.stringify(programs), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return { skip: (r.error && r.error.message) || r.stderr.trim().split('\n').pop() };
  return JSON.parse(r.stdout);
}

const py = pythonResults();
const pySkip = py.skip ? `needs Python with rhylthyme: ${py.skip}` : false;
if (pySkip && REQUIRED) throw new Error(pySkip);

test('python.cli and python.library say what Python reports for each example', { skip: pySkip }, (t) => {
  const skipped = [];
  let checked = 0;
  for (const { code, entry, example, key } of examples()) {
    const missing = (entry.python.requires || []).filter((p) => !py.packages[p]);
    if (missing.length) { skipped.push(`${key} (needs ${missing.join(', ')})`); continue; }
    const r = py.results[key];
    for (const api of ['cli', 'library']) {
      const want = entry.python[api];
      const got = r[api];
      if (want === null) {
        // Python has no finding of its own for it.
        assert.ok(!got.some((c) => c.startsWith(`${code}:`)), `${key}: Python ${api} reported ${code}: ${got}`);
        continue;
      }
      // logic_error is always an error: a JS warning the library would call
      // logic_error is one it does not report.
      if (want === 'logic_error' && example.severity !== 'error') {
        assert.ok(!got.some((c) => c.startsWith('logic_error:')), `${key}: Python ${api}: ${got}`);
        continue;
      }
      const sev = want === 'logic_error' ? 'error' : (entry.python.severity || example.severity);
      assert.ok(got.includes(`${want}:${sev}`), `${key}: Python ${api} should report ${want}:${sev}, got ${got.join(', ') || 'nothing'}${r[`${api}Raised`] ? ` (raised ${r[`${api}Raised`]})` : ''}`);
    }
    checked++;
  }
  t.diagnostic(`${checked} examples checked against Python${skipped.length ? `; skipped ${skipped.join('; ')}` : ''}`);
  if (REQUIRED) assert.ok(checked > 50);
});
