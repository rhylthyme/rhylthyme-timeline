'use strict';
// The programs the parity test (test/parity.test.js) compares the JS and
// Python validators on, shared with test/finding-codes.test.js: every
// program in rhylthyme-examples (programs/, invalid/, gold/), the issue #8
// programs, programs whose expanded form passes the schema, and schema
// mutations of each example. Not a test file itself.
const fs = require('fs');
const path = require('path');

const EXAMPLES = process.env.RHYLTHYME_EXAMPLES || path.join(__dirname, '..', '..', '..', 'rhylthyme-examples');

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
  // Python's expander treats a falsy `replicates` as absent.
  add('track replicates null', (p) => { p.tracks[0].replicates = null; });
  add('track replicates []', (p) => { p.tracks[0].replicates = []; });
  add('step replicates null', (p) => { p.tracks[0].steps[0].replicates = null; });
  add('step replicates {}', (p) => { p.tracks[0].steps[0].replicates = {}; });
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
  // The replicates object itself (and legacy batch_size): on the first
  // replicated track/step if there is one, else made on the first track
  // and on a step another step waits for (Python's expander drops a
  // replicated step with an unknown mode, so only a reference to it shows).
  // A track made replicated is one no other track waits for: its copies
  // rename its steps, and Python does not check the step ids inside a
  // compound trigger, so a dangling reference there is a JS-only finding.
  const refsInto = (p, t) => {
    const ids = new Set(t.steps.map((x) => x && x.stepId));
    return p.tracks.some((o) => o !== t && o && Array.isArray(o.steps) && o.steps.some((x) => x && [...JSON.stringify(x.startTrigger || {}).matchAll(/"stepId":"([^"]*)"/g)].some((m) => ids.has(m[1]))));
  };
  const firstTrack = (p) => (Array.isArray(p.tracks) && (p.tracks.find((t) => t && t.replicates) || p.tracks.find((t) => t && Array.isArray(t.steps) && t.steps.length && !refsInto(p, t)))) || null;
  const referenced = (p) => {
    const all = (Array.isArray(p.tracks) ? p.tracks : []).flatMap((t) => (t && Array.isArray(t.steps) ? t.steps : []));
    const refs = new Set(all.map((x) => x && x.startTrigger && x.startTrigger.type === 'afterStep' && x.startTrigger.stepId).filter(Boolean));
    return all.find((x) => x && x.replicates && refs.has(x.stepId)) || all.find((x) => x && !x.replicates && refs.has(x.stepId) && typeof x.name === 'string') || null;
  };
  const trackRep = (p) => { const t = firstTrack(p); if (!t) return null; if (!t.replicates || typeof t.replicates !== 'object') t.replicates = { count: 2 }; return t.replicates; };
  const stepRep = (p) => { const s = referenced(p); if (!s) return null; if (!s.replicates || typeof s.replicates !== 'object') s.replicates = { count: 2 }; return s.replicates; };
  add('replicated step count is a fraction above 1', (p) => { const r = stepRep(p); if (!r) return false; r.count = 2.5; });
  add('replicated step count is a fraction below 2', (p) => { const r = stepRep(p); if (!r) return false; r.count = 1.5; });
  add('replicated step count is a fraction below 1 (control)', (p) => { const r = stepRep(p); if (!r) return false; r.count = 0.5; });
  add('replicated step count is a string', (p) => { const r = stepRep(p); if (!r) return false; r.count = '2'; });
  add('replicated step mode is unknown', (p) => { const r = stepRep(p); if (!r) return false; r.count = Math.max(2, r.count | 0); r.mode = 'foo'; });
  add('replicated track count is a fraction', (p) => { const r = trackRep(p); if (!r) return false; r.count = 2.5; });
  add('replicated track count is a fraction below 2, serial', (p) => { const r = trackRep(p); if (!r) return false; r.count = 1.5; r.mode = 'serial'; });
  add('replicated track count is a string', (p) => { const r = trackRep(p); if (!r) return false; r.count = '2'; });
  add('replicated track mode is unknown', (p) => { const r = trackRep(p); if (!r) return false; r.mode = 'foo'; });
  add('track replicates null', (p) => { const t = firstTrack(p); if (!t) return false; t.replicates = null; });
  add('track replicates []', (p) => { const t = firstTrack(p); if (!t) return false; t.replicates = []; });
  add('step replicates null', (p) => { const s = referenced(p); if (!s) return false; s.replicates = null; });
  add('track batch_size is a string', (p) => { const t = firstTrack(p); if (!t) return false; delete t.replicates; t.batch_size = '2'; });
  add('track batch_size is a fraction', (p) => { const t = firstTrack(p); if (!t) return false; delete t.replicates; t.batch_size = 2.5; });
  add('track batch_size 2 (control)', (p) => { const t = firstTrack(p); if (!t) return false; delete t.replicates; t.batch_size = 2; });
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


module.exports = { EXAMPLES, programFiles, issue8Programs, expandedPassesPrograms, mutations };
