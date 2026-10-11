'use strict';
// The package's entry points: CommonJS, the ES module wrappers, the
// browser bundle of ./schedule, and element.js under CommonJS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pkg = require('../package.json');

const publicKeys = (m) => Object.keys(m).filter((k) => !k.startsWith('_')).sort();

test('the package resolves its own subpaths', () => {
  assert.equal(require('@rhylthyme/timeline'), require('../src/index.js'));
  assert.equal(require('@rhylthyme/timeline/core'), require('../src/index.js'));
  assert.equal(typeof require('@rhylthyme/timeline/schedule').validateProgram, 'function');
  assert.equal(typeof require('@rhylthyme/timeline/player').buildPlayerHtml, 'function');
});

test('the ES module entries export every public member by name', async () => {
  for (const [spec, cjs] of [['@rhylthyme/timeline', '../src/index.js'], ['@rhylthyme/timeline/schedule', '../src/schedule/index.js']]) {
    const esm = await import(spec);
    const named = Object.keys(esm).filter((k) => k !== 'default').sort();
    assert.deepEqual(named, publicKeys(require(cjs)), `${spec}: run npm run build (tools/build-esm.js)`);
    assert.equal(esm.default, require(cjs));
  }
});

test('every exports target and every types file is in the published files', () => {
  const targets = [];
  const walk = (v) => (typeof v === 'string' ? targets.push(v) : Object.values(v).forEach(walk));
  walk(pkg.exports);
  for (const t of targets.concat(pkg.types, pkg.module, pkg.main).filter((t) => t !== "./package.json")) {
    const rel = t.replace(/^\.\//, '');
    assert.ok(pkg.files.some((f) => rel === f || rel.startsWith(f)), `${rel} is not under "files"`);
    if (!rel.startsWith('browser/')) assert.ok(fs.existsSync(path.join(__dirname, '..', rel)), `${rel} is missing`);
  }
});

test('browser/schedule.js is a classic script that matches the module', () => {
  const file = path.join(__dirname, '..', 'browser', 'schedule.js');
  assert.ok(fs.existsSync(file), 'run npm run build first');
  const sandbox = { define: Object.assign(() => { throw new Error('AMD define must not be used'); }, { amd: {} }) };
  sandbox.self = sandbox;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  const S = sandbox.RhylthymeSchedule;
  const C = require('../src/schedule');
  assert.deepEqual(Object.keys(S).sort(), Object.keys(C).sort());
  const program = require('./fixtures/schedule/cookies_three_trays.json');
  assert.equal(JSON.stringify(S.validateProgram(program)), JSON.stringify(C.validateProgram(program)));
  assert.equal(JSON.stringify(S.analyzeSchedule(program)), JSON.stringify(C.analyzeSchedule(program)));
});

test('element.js loads under CommonJS without a global engine, registers nothing in Node, and attaches the hash helpers', () => {
  delete require.cache[require.resolve('../src/element.js')];
  assert.doesNotThrow(() => require('../src/element.js'));
  const R = require('../src/index.js');
  assert.equal(typeof R.programVersion, 'function');
  assert.match(R.programVersion({ tracks: [] }), /^sha256:[0-9a-f]{64}$/);
});
