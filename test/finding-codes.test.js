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
//                        catalogued, with a declared severity; and again with
//                        an instances error added to each program and each
//                        example, the path on which the schema's findings do
//                        not quiet the checks that follow them.
//
// Every call to a finding helper (err, warn, note, shapeErr, push, add: any
// const arrow function in src/schedule/*.js with a `code` parameter) must
// pass its code as a string literal, or forward f.code, so the source scan
// cannot miss a code built at run time.
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
// Built here when missing, so `node --test` works on a fresh checkout.
function browserSchedule() {
  const file = path.join(ROOT, 'browser', 'schedule.js');
  if (!fs.existsSync(file)) {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-browser.js')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `tools/build-browser.js failed: ${r.stderr}`);
  }
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

// The code argument of every call to a finding helper: a const arrow
// function with a `code` parameter. Returns [{ file, line, helper, arg }].
function skipString(text, i) {
  const q = text[i];
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (q === '`' && text[j] === '$' && text[j + 1] === '{') { j = skipExpr(text, j + 2, '}'); continue; }
    if (text[j] === q) return j;
  }
  throw new Error(`unterminated string at ${i}`);
}
// From i, the index of the first top-level `stop` character.
function skipExpr(text, i, stop) {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '"' || c === "'" || c === '`') { j = skipString(text, j); continue; }
    if (depth === 0 && stop.includes(c)) return j;
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
  }
  throw new Error(`no ${stop} after ${i}`);
}
function helperCalls(text, file = 'source') {
  const helpers = {};
  for (const m of text.matchAll(/\bconst (\w+) = \(([^)]*)\) =>/g)) {
    const at = m[2].split(',').map((p) => p.trim()).indexOf('code');
    if (at >= 0) helpers[m[1]] = at;
  }
  const calls = [];
  for (const [name, at] of Object.entries(helpers)) {
    for (const m of text.matchAll(new RegExp(`(?<![.\\w])${name}\\(`, 'g'))) {
      let i = m.index + m[0].length;
      let arg;
      for (let n = 0; n <= at; n++) {
        const end = skipExpr(text, i, ',)');
        arg = text.slice(i, end).trim();
        if (text[end] === ')' && n < at) { arg = undefined; break; }
        i = end + 1;
      }
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const line = text.slice(lineStart, text.indexOf('\n', m.index) < 0 ? undefined : text.indexOf('\n', m.index));
      calls.push({ file, line: text.slice(0, m.index).split('\n').length, helper: name, arg, source: line.trim() });
    }
  }
  return { helpers, calls };
}
// A code argument the scan can read: a literal, f.code (a finding whose
// producer is scanned), or `code` inside another helper's definition.
function readableCode(call) {
  if (call.arg === undefined) return false;
  if (/^"[A-Za-z_]+"$/.test(call.arg) || call.arg === 'f.code') return true;
  return call.arg === 'code' && /\bconst \w+ = \(([^)]*\bcode\b[^)]*)\) =>/.test(call.source);
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
  // Prose is rendered as Markdown: code spans pair up and do not start or
  // end with a space (a sign of a backtick nested in a span).
  const prose = (v, at) => {
    if (typeof v === 'string') {
      assert.equal((v.match(/`/g) || []).length % 2, 0, `${at}: unpaired backtick`);
      for (const m of v.matchAll(/`([^`]*)`/g)) assert.ok(!/^\s|\s$/.test(m[1]), `${at}: code span \`${m[1]}\``);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (k !== 'program' && k !== 'baseProgram') prose(x, `${at}.${k}`);
    }
  };
  prose(findingCodes, 'findingCodes');
  for (const [code, e] of Object.entries(CODES)) {
    assert.ok(areas.includes(e.area), `${code}: area ${e.area}`);
    assert.ok(Array.isArray(e.severity) && e.severity.length && e.severity.every((s) => SEVERITIES.includes(s)), `${code}: severity`);
    for (const k of ['summary', 'explanation', 'fix']) assert.ok(typeof e[k] === 'string' && e[k].length > 10, `${code}: ${k}`);
    assert.ok(e.python && 'cli' in e.python && 'library' in e.python, `${code}: python.cli and python.library`);
    if ('strict' in e.python) assert.ok(typeof e.python.strict === 'string' && e.python.strict !== e.python.cli, `${code}: python.strict is a code other than python.cli`);
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

test('every finding helper call passes its code as a literal the scan reads', () => {
  const all = SOURCES.flatMap((f) => {
    const { helpers, calls } = helperCalls(read(f), f);
    return calls.map((c) => Object.assign(c, { helpers }));
  });
  const names = new Set(all.map((c) => c.helper));
  for (const h of ['err', 'warn', 'note', 'shapeErr', 'push', 'add']) assert.ok(names.has(h), `no calls to ${h} found: update helperCalls`);
  assert.ok(all.length > 50, `${all.length} helper calls`);
  const unreadable = all.filter((c) => !readableCode(c)).map((c) => `${c.file}:${c.line} ${c.helper}(${c.arg})`);
  assert.deepEqual(unreadable, [], 'pass the code as a string literal so the source scan sees it');
  // The guard itself catches a code built at run time.
  const bad = helperCalls([
    'const err = (code, message) => 1;',
    'const warn = (code, message) => 1;',
    'if (program.title === "x") err(program.title.length > 0 ? "brand_new_code" : "other_new_code", "new");',
    'const lvl = "warning_level_code"; if (program.title === "y") warn(lvl, `new ${f(1, 2)}`);',
    'err("fine_code", "ok");',
  ].join('\n'));
  assert.deepEqual(bad.calls.filter((c) => !readableCode(c)).map((c) => c.arg),
    ['program.title.length > 0 ? "brand_new_code" : "other_new_code"', 'lvl']);
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

// A copy of a program with one more track whose step has an instances
// error (E_INSTANCES_ON_SINGLE). With an instances error validateProgram
// checks the schema on the program as written, and those findings do not
// quiet the checks that follow, so codes that are silent elsewhere speak.
function withInstanceError(program) {
  if (!program || typeof program !== 'object' || Array.isArray(program) || !Array.isArray(program.tracks)) return null;
  const copy = JSON.parse(JSON.stringify(program));
  copy.tracks.push({ trackId: 'zz-instances', name: 'Instances', steps: [
    { stepId: 'zz-mix', name: 'Mix', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'programStart' } },
    { stepId: 'zz-cool', name: 'Cool', duration: { type: 'fixed', seconds: 60 }, startTrigger: { type: 'afterStep', stepId: 'zz-mix', instances: 'each' } },
  ] });
  return copy;
}

test('with an instances error added, every code reported is still catalogued and reachable', (t) => {
  const programs = {};
  for (const { example, key } of examples()) {
    if (example.bigint || example.entry === 'browser') continue;
    programs[`example ${key}`] = complete(example);
  }
  Object.assign(programs, corpus().programs);
  let checked = 0;
  for (const [key, program] of Object.entries(programs)) {
    const p = withInstanceError(program);
    if (!p) continue;
    const got = reported(S.validateProgram(p));
    // The added track's error, unless the program's own shape stops the checks first.
    if (!got.some((f) => f.code === 'E_INSTANCES_ON_SINGLE')) continue;
    for (const f of got) {
      assert.ok(CODES[f.code], `${key} + instances error: ${f.code} is not catalogued`);
      assert.ok(CODES[f.code].severity.includes(f.severity), `${key} + instances error: ${f.code} reported as ${f.severity}, catalogued as ${CODES[f.code].severity}`);
      assert.notEqual(CODES[f.code].reachable, false, `${key} + instances error: ${f.code} is catalogued as unreachable`);
    }
    checked++;
  }
  t.diagnostic(`${checked} programs checked with an instances error added`);
  assert.ok(checked > Object.keys(CODES).length, `${checked} programs`);
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
        r["strict"] = codes(validate_program_file_structured(path, schema_path(program), strict=True)["findings"])
    except Exception as e:
        r["cli"] = r.get("cli", [])
        r["strict"] = []
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
    // --strict: python.strict as an error, or, without it, what the CLI
    // reports for this code.
    if (entry.python.strict) {
      assert.ok(r.strict.includes(`${entry.python.strict}:error`), `${key}: Python --strict should report ${entry.python.strict}:error, got ${r.strict.join(', ') || 'nothing'}`);
    } else {
      const mine = (list) => list.filter((c) => c.startsWith(`${code}:`) || (entry.python.cli && c.startsWith(`${entry.python.cli}:`)));
      assert.deepEqual(mine(r.strict), mine(r.cli), `${key}: Python --strict reports ${code} differently from the CLI: add python.strict`);
    }
    checked++;
  }
  t.diagnostic(`${checked} examples checked against Python${skipped.length ? `; skipped ${skipped.join('; ')}` : ''}`);
  if (REQUIRED) assert.ok(checked > 50);
});
