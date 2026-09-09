#!/usr/bin/env node
/**
 * Build the interactive Rhylthyme visualizer page for one program.
 *
 * This is the page rhylthyme.com serves in its player iframe (timeline with
 * live cursor and play/pause/stop, itinerary, DAG, resources, editor...).
 * `template.html` is exported verbatim from rhylthyme-server's
 * web_visualizer.py by tools/export_player_template.py; this file ports the
 * Python that fills its slots (extract_step_dependencies,
 * calculate_timeline_data and the scalar fields of generate_dag_html) so the
 * output is byte-identical to what the server produces. test/player.test.js
 * checks that against fingerprints written by the Python side.
 *
 *   node player/build.js program.json [out.html] [--environment env.json]
 *
 * With no output path the HTML goes to stdout.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { expandReplicates } = require('../src/index.js');

const HERE = __dirname;

// ---------------------------------------------------------------------------
// Python-compatible helpers. The Python code uses dict.get(key, default),
// truthiness, str() and json.dumps(indent=2); each has a counterpart here so
// the port can follow the original line by line.

function get(obj, key, dflt) {
  if (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  return dflt === undefined ? null : dflt;
}

function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/**
 * A number that Python would hold as a float. JSON.parse cannot tell 30.0
 * from 30, and Python's replicate expansion produces floats (delay * i), so
 * the port tracks float-ness explicitly: json.dumps writes 30.0 for these,
 * and arithmetic with them stays float, as in Python.
 */
class PyFloat {
  constructor(v) { this.v = v; }
  valueOf() { return this.v; }
}
const isF = (x) => x instanceof PyFloat;
const num = (r, f) => (f ? new PyFloat(r) : r);
const pyAdd = (a, b) => num(+a + +b, isF(a) || isF(b));
const pySub = (a, b) => num(+a - +b, isF(a) || isF(b));
const pyNeg = (a) => num(-a, isF(a));
const pyAbs = (a) => num(Math.abs(+a), isF(a));
const pyMax = (a, b) => (+b > +a ? b : a); // max(a, b): first maximal wins
const pyMin = (a, b) => (+b < +a ? b : a);

/** JSON.parse that keeps float literals (1.0, 2.5e3) as PyFloat. */
function parsePyJson(text) {
  const FLOAT = /-?\d+(?:\.\d+(?:[eE][+-]?\d+)?|[eE][+-]?\d+)/y;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') j++; j++; }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      FLOAT.lastIndex = i;
      const m = FLOAT.exec(text);
      if (m) { out += `{"__pyfloat__":"${m[0]}"}`; i += m[0].length; }
      else { out += ch; i++; }
    } else { out += ch; i++; }
  }
  return JSON.parse(out, (key, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && '__pyfloat__' in value) {
      return new PyFloat(Number(value.__pyfloat__));
    }
    return value;
  });
}

function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (isF(v)) return pyFloatRepr(v.v);
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return pyNumber(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function pyFloatRepr(v) {
  if (Number.isInteger(v)) return Math.abs(v) < 1e16 ? v + '.0' : pyNumber(v);
  return pyNumber(v);
}

function pyNumber(n) {
  if (isF(n)) return pyFloatRepr(n.v);
  if (Number.isInteger(n)) return Math.abs(n) < 1e21 ? String(n) : n.toExponential().replace(/e\+?(-?)(\d)$/, 'e$1$2');
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : n < 0 ? '-Infinity' : 'NaN';
  let s = String(n);
  // Python repr uses e-05 / e+16 with at least two exponent digits.
  const m = /^(-?[\d.]+)e([+-])(\d+)$/.exec(s);
  if (m) s = m[1] + 'e' + m[2] + (m[3].length < 2 ? '0' + m[3] : m[3]);
  return s;
}

function pyInt(s) {
  const m = /^\s*([+-]?)(\d[\d_]*)\s*$/.exec(s);
  if (!m) throw new Error(`invalid literal for int(): '${s}'`);
  return parseInt(m[1] + m[2].replace(/_/g, ''), 10);
}

function pyStrLen(s) {
  return Array.from(String(s)).length;
}

/** json.dumps(value, indent=2) with ensure_ascii=True. */
function pyJson(value, indent) {
  indent = indent || '';
  const inner = indent + '  ';
  if (value === null || value === undefined) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number' || isF(value)) return pyNumber(value);
  if (typeof value === 'string') return pyJsonString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[\n' + value.map((v) => inner + pyJson(v, inner)).join(',\n') + '\n' + indent + ']';
  }
  const keys = Object.keys(value);
  if (keys.length === 0) return '{}';
  return '{\n' + keys.map((k) => inner + pyJsonString(k) + ': ' + pyJson(value[k], inner)).join(',\n') + '\n' + indent + '}';
}

function pyJsonString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const ch = s[i];
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20 || c > 0x7e) out += '\\u' + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

// ---------------------------------------------------------------------------
// Port of web_visualizer.parse_duration_string

function parseDurationString(durationStr) {
  if (!truthy(durationStr)) return 0;
  if (typeof durationStr === 'number' && Number.isInteger(durationStr)) return durationStr;
  if (durationStr === true) return 1;
  // floats (PyFloat or non-integers) fall through to the str() path, as in Python
  let s = pyStr(durationStr).trim().toLowerCase();
  if (s.endsWith(')')) s = s.slice(0, -1);
  if (s.endsWith('s')) return pyInt(s.slice(0, -1));
  if (s.endsWith('m')) return pyInt(s.slice(0, -1)) * 60;
  if (s.endsWith('h')) return pyInt(s.slice(0, -1)) * 3600;
  const m = /\d+/.exec(s);
  return m ? parseInt(m[0], 10) : 0;
}

// ---------------------------------------------------------------------------
// Port of web_visualizer.extract_step_dependencies / extract_dependencies_from_trigger

function extractStepDependencies(program) {
  const nodes = [];
  const edges = [];

  nodes.push({
    id: 'program_start',
    name: 'Program Start',
    track: 'system',
    type: 'start',
    description: 'Program initialization',
  });

  for (const track of get(program, 'tracks', [])) {
    const trackId = get(track, 'trackId', 'unknown');
    const trackName = get(track, 'name', 'Unknown Track');

    let prevStepId = null;
    for (const step of get(track, 'steps', [])) {
      const stepId = get(step, 'stepId');
      const stepName = get(step, 'name', stepId);
      const stepDescription = get(step, 'description', '');
      let task = get(step, 'task', get(step, 'tasks', ['']));
      if (Array.isArray(task)) task = task.length ? task.join(', ') : '';

      // Normalize old "trigger" format to "startTrigger" (mutates the step, as Python does)
      if ('trigger' in step && !('startTrigger' in step)) {
        const old = step.trigger;
        if (old && typeof old === 'object' && !Array.isArray(old)) {
          if (get(old, 'type') === 'programStart') step.startTrigger = { type: 'programStart' };
          else if (get(old, 'type') === 'manual') step.startTrigger = { type: 'manual', triggerName: get(old, 'triggerName', 'manual') };
          else if (['afterStep', 'stepComplete'].includes(get(old, 'type'))) step.startTrigger = { type: 'afterStep', stepId: get(old, 'stepId') };
          else if ('on' in old) step.startTrigger = { type: 'afterStep', stepId: old.on };
          else step.startTrigger = old;
        }
      }

      const duration = get(step, 'duration', {});
      let durationInfo = null;
      let isIndefinite = false;
      let hasDurationTrigger = false;
      if (truthy(duration)) {
        const durationType = get(duration, 'type');
        if (durationType === 'fixed') {
          durationInfo = `${pyStr(get(duration, 'seconds', 0))}s`;
        } else if (durationType === 'variable') {
          const minSec = get(duration, 'minSeconds', 0);
          const maxSec = get(duration, 'maxSeconds', 0);
          const defaultSec = get(duration, 'defaultSeconds', 0);
          durationInfo = `${pyStr(minSec)}-${pyStr(maxSec)}s (default: ${pyStr(defaultSec)}s)`;
          if (truthy(get(duration, 'triggerName'))) hasDurationTrigger = true;
        } else if (durationType === 'indefinite') {
          const defaultSec = get(duration, 'defaultSeconds', 60);
          durationInfo = `indefinite (default: ${pyStr(defaultSec)}s)`;
          isIndefinite = true;
          if (truthy(get(duration, 'triggerName'))) hasDurationTrigger = true;
        }
      }

      const preBuffer = get(step, 'preBuffer', {});
      const postBuffer = get(step, 'postBuffer', {});

      const startTrigger = get(step, 'startTrigger', {});
      let isManual = get(startTrigger, 'type') === 'manual' || hasDurationTrigger;

      const triggerTypeRaw = get(startTrigger, 'type');
      let afterStepId = null;
      if (triggerTypeRaw === 'afterStep' || triggerTypeRaw === 'afterStepWithBuffer') afterStepId = get(startTrigger, 'stepId');
      else if (triggerTypeRaw === 'manual' && truthy(prevStepId)) afterStepId = prevStepId;
      else if (triggerTypeRaw === 'previousStepComplete' && truthy(prevStepId)) afterStepId = prevStepId;

      let offsetVal = get(startTrigger, 'offsetSeconds', 0);
      if (typeof offsetVal === 'string') offsetVal = parseDurationString(offsetVal);
      const hasNegativeOffset = (triggerTypeRaw === 'afterStep' || triggerTypeRaw === 'afterStepWithBuffer')
        && offsetVal !== null && offsetVal < 0;
      const isManualStart = get(startTrigger, 'type') === 'manual' || hasNegativeOffset;
      if (hasNegativeOffset) isManual = true;

      const choiceData = get(step, 'choice', null);

      let triggerChoiceId = get(startTrigger, 'choiceId', null);
      if (!truthy(triggerChoiceId) && truthy(get(startTrigger, 'logic'))) {
        for (const subT of get(startTrigger, 'triggers', [])) {
          if (truthy(get(subT, 'choiceId'))) { triggerChoiceId = subT.choiceId; break; }
        }
      }

      const isVariable = truthy(duration) && get(duration, 'type') === 'variable';
      const nodeData = {
        id: stepId,
        name: stepName,
        track: trackId,
        track_name: trackName,
        type: 'step',
        description: stepDescription,
        task: task,
        duration: durationInfo,
        preBuffer: preBuffer,
        postBuffer: postBuffer,
        flex: get(step, 'flex', { enabled: false }),
        isManual: isManual,
        isIndefinite: isIndefinite,
        hasDurationTrigger: hasDurationTrigger,
        isManualStart: isManualStart,
        minSeconds: isVariable ? get(duration, 'minSeconds') : null,
        maxSeconds: isVariable ? get(duration, 'maxSeconds') : null,
        afterStepId: afterStepId,
        negativeOffsetSeconds: hasNegativeOffset ? pyAbs(offsetVal) : null,
        negativeOffsetRefStepId: hasNegativeOffset ? afterStepId : null,
        priority: get(step, 'priority', 100),
        durationType: truthy(duration) ? get(duration, 'type', 'fixed') : 'fixed',
        choice: choiceData,
        choiceId: triggerChoiceId,
      };

      if (truthy(get(step, 'media'))) nodeData.media = step.media;
      else {
        const stepMetadata = get(step, 'metadata', {});
        if (truthy(get(stepMetadata, 'media'))) nodeData.media = stepMetadata.media;
      }

      nodes.push(nodeData);

      const triggerType = get(startTrigger, 'type');
      if (triggerType === 'manual' && truthy(prevStepId)) {
        edges.push({ source: prevStepId, target: stepId, type: 'afterStep' });
      } else if (triggerType === 'previousStepComplete' && truthy(prevStepId)) {
        const offset = get(startTrigger, 'offsetSeconds', 0);
        if (truthy(offset)) edges.push({ source: prevStepId, target: stepId, type: 'afterStepWithBuffer', buffer: offset });
        else edges.push({ source: prevStepId, target: stepId, type: 'afterStep' });
      } else {
        edges.push(...extractDependenciesFromTrigger(startTrigger, stepId));
      }

      prevStepId = stepId;
    }
  }
  return [nodes, edges];
}

function extractDependenciesFromTrigger(trigger, targetStep) {
  const edges = [];
  const triggerType = get(trigger, 'type');

  if (triggerType === 'programStart') {
    const offset = get(trigger, 'offsetSeconds', 0);
    if (truthy(offset)) edges.push({ source: 'program_start', target: targetStep, type: 'programStartOffset', offset: offset });
    else edges.push({ source: 'program_start', target: targetStep, type: 'programStart' });
  } else if (triggerType === 'afterStep' || triggerType === 'stepComplete') {
    const sourceStep = get(trigger, 'stepId');
    let offset = get(trigger, 'offsetSeconds', 0);
    const choiceId = get(trigger, 'choiceId');
    if (typeof offset === 'string') offset = parseDurationString(offset);
    if (truthy(sourceStep)) {
      const edge = { source: sourceStep, target: targetStep };
      if (truthy(choiceId)) edge.choiceId = choiceId;
      if (truthy(offset) && offset < 0) edge.type = 'afterStep';
      else if (truthy(offset) && offset > 0) { edge.type = 'afterStepWithBuffer'; edge.buffer = offset; }
      else edge.type = 'afterStep';
      edges.push(edge);
    }
  } else if (triggerType === 'afterStepWithBuffer') {
    const sourceStep = get(trigger, 'stepId');
    const bufferSeconds = get(trigger, 'bufferSeconds', get(trigger, 'offsetSeconds', 0));
    if (truthy(sourceStep)) edges.push({ source: sourceStep, target: targetStep, type: 'afterStepWithBuffer', buffer: bufferSeconds });
  } else if (triggerType === 'programStartOffset') {
    edges.push({ source: 'program_start', target: targetStep, type: 'programStartOffset', offset: get(trigger, 'offsetSeconds', 0) });
  } else if (triggerType === 'manual') {
    // no dependencies
  } else if (truthy(get(trigger, 'logic'))) {
    for (const sub of get(trigger, 'triggers', [])) edges.push(...extractDependenciesFromTrigger(sub, targetStep));
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Port of web_visualizer.calculate_timeline_data

function calculateTimelineData(nodes, edges) {
  const stepDependencies = new Map();
  const stepOffsets = new Map();
  const edgeBuffers = new Map();
  const pairKey = (a, b) => `${a} ${b}`;

  for (const edge of edges) {
    const target = edge.target;
    if (!stepDependencies.has(target)) stepDependencies.set(target, []);
    if (edge.type === 'programStartOffset') stepOffsets.set(target, get(edge, 'offset', 0));
    else if (edge.type === 'afterStepWithBuffer') edgeBuffers.set(pairKey(edge.source, target), get(edge, 'buffer', 0));
    if (edge.source !== 'program_start') stepDependencies.get(target).push(edge.source);
  }

  const stepStartTimes = new Map([['program_start', 0]]);
  const stepDurations = new Map();
  const stepBuffers = new Map();

  const manualSteps = new Set();
  const indefiniteSteps = new Set();
  const durationTriggerSteps = new Set();
  const manualStartSteps = new Set();
  const negativeOffsetSteps = new Map();

  for (const node of nodes) {
    if (node.type !== 'step') continue;
    if (truthy(get(node, 'isManual'))) manualSteps.add(node.id);
    if (truthy(get(node, 'isIndefinite'))) indefiniteSteps.add(node.id);
    if (truthy(get(node, 'hasDurationTrigger'))) durationTriggerSteps.add(node.id);
    if (truthy(get(node, 'isManualStart'))) manualStartSteps.add(node.id);
    if (truthy(get(node, 'negativeOffsetRefStepId'))) negativeOffsetSteps.set(node.id, node.negativeOffsetRefStepId);

    const durationStr = get(node, 'duration', '0s');
    if (truthy(durationStr)) {
      let duration;
      if (durationStr === 'indefinite' || durationStr.startsWith('indefinite')) {
        if (durationStr.includes('default:')) {
          const defaultPart = durationStr.split('default:')[1].trim().replace(/\)+$/, '');
          duration = parseDurationString(defaultPart);
        } else duration = 60;
      } else if (durationStr.includes('default:')) {
        duration = parseDurationString(durationStr.split('default:')[1].trim());
      } else {
        duration = parseDurationString(durationStr);
      }
      stepDurations.set(node.id, duration);
    }
    stepBuffers.set(node.id, { preBuffer: get(node, 'preBuffer', {}), postBuffer: get(node, 'postBuffer', {}) });
  }

  const visited = new Set();
  const tempVisited = new Set();

  function calculateStartTime(stepId) {
    if (tempVisited.has(stepId)) return 0;
    if (visited.has(stepId)) return stepStartTimes.has(stepId) ? stepStartTimes.get(stepId) : 0;
    tempVisited.add(stepId);

    if (negativeOffsetSteps.has(stepId)) {
      const refStart = calculateStartTime(negativeOffsetSteps.get(stepId));
      stepStartTimes.set(stepId, refStart);
      tempVisited.delete(stepId);
      visited.add(stepId);
      return refStart;
    }

    let maxPredecessorEnd = 0;
    if (stepOffsets.has(stepId)) maxPredecessorEnd = stepOffsets.get(stepId);

    const ownBuffers = stepBuffers.get(stepId) || {};
    const ownPreBuffer = get(ownBuffers, 'preBuffer', {});
    const ownPreDuration = parseDurationString(get(ownPreBuffer, 'duration', ''));

    for (const predecessor of stepDependencies.get(stepId) || []) {
      const predStart = calculateStartTime(predecessor);
      const predDuration = stepDurations.has(predecessor) ? stepDurations.get(predecessor) : 0;
      let predEnd = pyAdd(predStart, predDuration);

      const predBuffers = stepBuffers.get(predecessor) || {};
      const predPostBuffer = get(predBuffers, 'postBuffer', {});
      const predPostDuration = parseDurationString(get(predPostBuffer, 'duration', ''));
      if (predPostDuration > 0) predEnd = pyAdd(predEnd, predPostDuration);

      const buffer = edgeBuffers.has(pairKey(predecessor, stepId)) ? edgeBuffers.get(pairKey(predecessor, stepId)) : 0;
      predEnd = pyAdd(predEnd, buffer);

      if (ownPreDuration > 0) predEnd = pyAdd(predEnd, ownPreDuration);

      maxPredecessorEnd = pyMax(maxPredecessorEnd, predEnd);
    }

    stepStartTimes.set(stepId, maxPredecessorEnd);
    tempVisited.delete(stepId);
    visited.add(stepId);
    return maxPredecessorEnd;
  }

  for (const node of nodes) if (node.type === 'step') calculateStartTime(node.id);

  const tracks = new Map();
  for (const node of nodes) {
    if (node.type !== 'step') continue;
    const trackId = node.track;
    if (!tracks.has(trackId)) tracks.set(trackId, { trackId: trackId, name: node.track_name, steps: [] });

    const startTime = stepStartTimes.has(node.id) ? stepStartTimes.get(node.id) : 0;
    const duration = stepDurations.has(node.id) ? stepDurations.get(node.id) : 0;

    const buffers = stepBuffers.get(node.id) || {};
    const preBuffer = get(buffers, 'preBuffer', {});
    const postBuffer = get(buffers, 'postBuffer', {});
    const preBufferDuration = parseDurationString(get(preBuffer, 'duration', ''));
    const postBufferDuration = parseDurationString(get(postBuffer, 'duration', ''));
    const preBufferStart = preBufferDuration > 0 ? pySub(startTime, preBufferDuration) : null;
    const postBufferStart = postBufferDuration > 0 ? pyAdd(startTime, duration) : null;

    const stepData = {
      stepId: node.id,
      name: node.name,
      startTime: startTime,
      duration: duration,
      endTime: pyAdd(startTime, duration),
      description: get(node, 'description', ''),
      task: get(node, 'task', ''),
      flex: get(node, 'flex', { enabled: false }),
      isManual: manualSteps.has(node.id),
      isIndefinite: indefiniteSteps.has(node.id),
      hasDurationTrigger: durationTriggerSteps.has(node.id),
      isManualStart: manualStartSteps.has(node.id),
      minSeconds: get(node, 'minSeconds'),
      maxSeconds: get(node, 'maxSeconds'),
      afterStepId: get(node, 'afterStepId'),
      negativeOffsetSeconds: get(node, 'negativeOffsetSeconds'),
      negativeOffsetRefStepId: get(node, 'negativeOffsetRefStepId'),
      priority: get(node, 'priority', 100),
      durationType: get(node, 'durationType', 'fixed'),
      choice: get(node, 'choice'),
      choiceId: get(node, 'choiceId'),
    };
    if (truthy(get(node, 'media'))) stepData.media = node.media;

    if (preBufferDuration > 0) {
      stepData.preBuffer = {
        startTime: preBufferStart,
        duration: preBufferDuration,
        endTime: startTime,
        description: get(preBuffer, 'description', ''),
        tasks: get(preBuffer, 'tasks', []),
      };
    }
    if (postBufferDuration > 0) {
      stepData.postBuffer = {
        startTime: postBufferStart,
        duration: postBufferDuration,
        endTime: pyAdd(postBufferStart, postBufferDuration),
        description: get(postBuffer, 'description', ''),
        tasks: get(postBuffer, 'tasks', []),
      };
    }
    tracks.get(trackId).steps.push(stepData);
  }

  let maxEndTime = 0;
  let minStartTime = 0;
  for (const trackData of tracks.values()) {
    for (const step of trackData.steps) {
      if ('preBuffer' in step) minStartTime = pyMin(minStartTime, step.preBuffer.startTime);
      maxEndTime = pyMax(maxEndTime, step.endTime);
      if ('postBuffer' in step) maxEndTime = pyMax(maxEndTime, step.postBuffer.endTime);
    }
  }
  const timeOffset = minStartTime < 0 ? pyNeg(minStartTime) : 0;
  if (timeOffset > 0) {
    for (const trackData of tracks.values()) {
      for (const step of trackData.steps) {
        step.startTime = pyAdd(step.startTime, timeOffset);
        step.endTime = pyAdd(step.endTime, timeOffset);
        if ('preBuffer' in step) { step.preBuffer.startTime = pyAdd(step.preBuffer.startTime, timeOffset); step.preBuffer.endTime = pyAdd(step.preBuffer.endTime, timeOffset); }
        if ('postBuffer' in step) { step.postBuffer.startTime = pyAdd(step.postBuffer.startTime, timeOffset); step.postBuffer.endTime = pyAdd(step.postBuffer.endTime, timeOffset); }
      }
    }
  }
  const totalDuration = pyAdd(maxEndTime, timeOffset);

  let hasBuffers = false;
  for (const trackData of tracks.values()) {
    for (const step of trackData.steps) if ('preBuffer' in step || 'postBuffer' in step) hasBuffers = true;
  }

  return { tracks: Array.from(tracks.values()), totalDuration: totalDuration, timeScale: 'seconds', hasBuffers: hasBuffers };
}

// ---------------------------------------------------------------------------
// Port of rhylthyme.environment_icons.get_environment_icon

const ENVIRONMENT_ICONS = {
  kitchen: 'fa-utensils', home: 'fa-house', restaurant: 'fa-utensils', 'commercial-kitchen': 'fa-fire-burner',
  laboratory: 'fa-flask', lab: 'fa-flask', research: 'fa-microscope', biotech: 'fa-dna', pharma: 'fa-pills', medical: 'fa-user-doctor',
  bakery: 'fa-bread-slice', artisan: 'fa-wheat-awn', pastry: 'fa-cake-candles',
  airport: 'fa-plane', aviation: 'fa-plane-departure', runway: 'fa-plane-arrival', terminal: 'fa-building',
  event: 'fa-calendar-days', theater: 'fa-masks-theater', concert: 'fa-music', conference: 'fa-users', ceremony: 'fa-award',
  manufacturing: 'fa-industry', warehouse: 'fa-warehouse', office: 'fa-building', hospital: 'fa-hospital', school: 'fa-graduation-cap',
  retail: 'fa-store', farm: 'fa-tractor', datacenter: 'fa-server', factory: 'fa-gear', workshop: 'fa-screwdriver-wrench', garage: 'fa-car',
  gym: 'fa-dumbbell', studio: 'fa-microphone', library: 'fa-book', garden: 'fa-seedling', greenhouse: 'fa-leaf', clinic: 'fa-stethoscope',
  spa: 'fa-spa', hotel: 'fa-bed',
};
const DEFAULT_ENVIRONMENT_ICON = 'fa-building';

function getEnvironmentIcon(environmentType) {
  if (!truthy(environmentType)) return DEFAULT_ENVIRONMENT_ICON;
  const normalized = pyStr(environmentType).toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(ENVIRONMENT_ICONS, normalized)) return ENVIRONMENT_ICONS[normalized];
  for (const [envType, icon] of Object.entries(ENVIRONMENT_ICONS)) {
    if (normalized.includes(envType) || envType.includes(normalized)) return icon;
  }
  return DEFAULT_ENVIRONMENT_ICON;
}

// ---------------------------------------------------------------------------
// Port of the scalar computations in generate_dag_html, and the slot table.

/** Python's f"{x:.1f}": correctly rounded from the binary value, ties to even. */
function pyFixed1(x) {
  const neg = x < 0;
  const s = Math.abs(x).toFixed(20);
  const [intPart, frac] = s.split('.');
  let d = frac.charCodeAt(0) - 48;
  const rest = frac.slice(1);
  const up = rest[0] > '5' || (rest[0] === '5' && (/[1-9]/.test(rest.slice(1)) || d % 2 === 1));
  let n = BigInt(intPart) * 10n + BigInt(d) + (up ? 1n : 0n);
  const t = n.toString().padStart(2, '0');
  return (neg ? '-' : '') + t.slice(0, -1) + '.' + t.slice(-1);
}

function formatDuration(seconds) {
  seconds = +seconds;
  if (seconds >= 3600) {
    const hours = seconds / 3600;
    return hours !== Math.trunc(hours) ? `${pyFixed1(hours)} hours` : `${Math.trunc(hours)} hours`;
  }
  if (seconds >= 60) {
    const minutes = seconds / 60;
    return minutes !== Math.trunc(minutes) ? `${pyFixed1(minutes)} minutes` : `${Math.trunc(minutes)} minutes`;
  }
  return `${Math.trunc(seconds)} seconds`;
}

function computeSlots(nodes, edges, programData, environmentData, resourceConstraints) {
  const programName = get(programData, 'name', 'Unknown Program');
  const programDescription = get(programData, 'description', '');
  const programVersion = get(programData, 'version', 'N/A');
  const environmentType = get(programData, 'environmentType', 'N/A');

  const environmentIcon = environmentType !== 'N/A' ? getEnvironmentIcon(environmentType) : 'fa-building';

  let environmentName = 'N/A';
  let environmentDescription = '';
  if (truthy(environmentData)) {
    environmentName = get(environmentData, 'name', get(environmentData, 'environmentId', 'N/A'));
    environmentDescription = get(environmentData, 'description', '');
  } else if (truthy(get(programData, 'environment'))) {
    environmentName = get(programData, 'environment');
  } else if (truthy(get(programData, 'resourceConstraints'))) {
    environmentName = '(inline)';
  }

  const envFriendly = {
    kitchen: ['Kitchen', 'Load your home kitchen'],
    laboratory: ['Lab', 'Load your lab'],
    lab: ['Lab', 'Load your lab'],
    gym: ['Gym', 'Load your gym'],
    event: ['Venue', 'Load your venue'],
  };
  const envKey = (truthy(environmentType) ? pyStr(environmentType) : '').toLowerCase();
  const [envTypeLabel, envLoadCta] = Object.prototype.hasOwnProperty.call(envFriendly, envKey)
    ? envFriendly[envKey] : ['Setup', 'Load your saved setup'];
  const envUsingInline = ['(inline)', 'N/A', ''].includes(environmentName);

  const nodesJson = pyJson(nodes);
  const edgesJson = pyJson(edges);
  const timelineData = calculateTimelineData(nodes, edges);
  const timelineJson = pyJson(timelineData);
  const programJson = pyJson(programData);
  const environmentJson = pyJson(truthy(environmentData) ? environmentData : {});

  const transformed = [];
  for (const c of resourceConstraints || []) {
    if ('name' in c && 'capacity' in c) transformed.push({ task: c.name, maxConcurrent: c.capacity, description: get(c, 'description', '') });
    else if ('task' in c && 'maxConcurrent' in c) transformed.push(c);
  }
  const resourceConstraintsJson = pyJson(transformed);

  let maxTrackNameLength = 0;
  for (const track of timelineData.tracks) maxTrackNameLength = Math.max(maxTrackNameLength, pyStrLen(get(track, 'name', '')));
  const dynamicLeftMargin = Math.min(Math.max(80, maxTrackNameLength * 7 + 20), 300);

  const totalDuration = timelineData.totalDuration;
  const formattedDuration = formatDuration(totalDuration);

  const numTracks = timelineData.tracks.length;
  const timelineHeight = numTracks < 7
    ? `height: ${Math.max(130, numTracks * 48 + 60)}px;`
    : 'height: clamp(300px, 45vh, 500px);';

  let programDurationText = '';
  if (truthy(get(programData, 'duration'))) {
    const dc = programData.duration;
    if (get(dc, 'type') === 'fixed') {
      if (truthy(get(dc, 'seconds'))) programDurationText = formatDuration(dc.seconds);
      else if (truthy(get(dc, 'timeString'))) programDurationText = dc.timeString;
    }
  }

  let targetDurationSeconds = 0;
  let targetDurationText = '';
  const td = get(programData, 'targetDuration');
  if (truthy(td)) {
    if ((typeof td === 'number' || typeof td === 'boolean') && td > 0) {
      targetDurationSeconds = Math.trunc(td);
      targetDurationText = formatDuration(targetDurationSeconds);
    } else if (td && typeof td === 'object' && !Array.isArray(td)) {
      const secs = get(td, 'seconds', 0);
      if (truthy(secs) && secs > 0) {
        targetDurationSeconds = Math.trunc(secs);
        targetDurationText = formatDuration(targetDurationSeconds);
      }
    }
  }

  const presetButtonsHtml = '';

  const envBlock = envUsingInline
    ? '<button onclick="window.parent.postMessage({type:\'rhylthyme-change-environment\',currentType:\'' + pyStr(environmentType) + "',currentEnvId:'" + pyStr(environmentName) + '\'}, \'*\')" style="background:none;border:1px solid var(--brand-primary, #6B9E7D);color:var(--brand-primary, #6B9E7D);border-radius:9999px;padding:3px 12px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.15s;" onmouseover="this.style.background=\'var(--brand-primary, #6B9E7D)\';this.style.color=\'white\';" onmouseout="this.style.background=\'none\';this.style.color=\'var(--brand-primary, #6B9E7D)\';">' + envLoadCta + '</button>'
    : '<div style="display:flex;align-items:center;gap:6px;"><span class="font-semibold text-sm" style="color:var(--text-primary);" title="' + pyStr(environmentDescription) + '">' + pyStr(environmentName) + '</span><button onclick="window.parent.postMessage({type:\'rhylthyme-change-environment\',currentType:\'' + pyStr(environmentType) + "',currentEnvId:'" + pyStr(environmentName) + '\'}, \'*\')" style="background:none;border:1px solid #d1d5db;border-radius:4px;padding:1px 8px;cursor:pointer;font-size:10px;color:#6b7280;" title="Switch ' + envTypeLabel.toLowerCase() + '">Switch</button></div>';

  return {
    '_TAILWIND_CSS': fs.readFileSync(path.join(HERE, 'tailwind.min.css'), 'utf8'),
    'nodes_json': nodesJson,
    'edges_json': edgesJson,
    'timeline_json': timelineJson,
    'environment_json': environmentJson,
    'resource_constraints_json': resourceConstraintsJson,
    'program_json': programJson,
    'program_name': pyStr(programName),
    'program_description': pyStr(programDescription),
    'program_version': pyStr(programVersion),
    'environment_type': pyStr(environmentType),
    'environment_icon': environmentIcon,
    'env_type_label': envTypeLabel,
    'target_duration_text': targetDurationText,
    'timeline_height': timelineHeight,
    'preset_buttons_html': presetButtonsHtml,
    'str(dynamic_left_margin)': String(dynamicLeftMargin),
    'len(resource_constraints or [])': String((resourceConstraints || []).length),
    "str(target_duration_seconds) if target_duration_seconds else 'null'": truthy(targetDurationSeconds) ? String(targetDurationSeconds) : 'null',
    "'inline' if target_duration_seconds and total_duration > target_duration_seconds else 'none'": truthy(targetDurationSeconds) && totalDuration > targetDurationSeconds ? 'inline' : 'none',
    "'inline-flex' if target_duration_text else 'none'": truthy(targetDurationText) ? 'inline-flex' : 'none',
    "f'<span class=\"text-blue-600 font-semibold\">· {program_duration_text}</span>' if program_duration_text else ''": truthy(programDurationText) ? `<span class="text-blue-600 font-semibold">· ${programDurationText}</span>` : '',
    "f'Est. {formatted_duration}' if program_duration_text else formatted_duration": truthy(programDurationText) ? `Est. ${formattedDuration}` : formattedDuration,
    __env_block__: envBlock,
  };
}

// ---------------------------------------------------------------------------

let templateCache = null;
function loadTemplate() {
  if (!templateCache) templateCache = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8');
  return templateCache;
}

/** Merge program constraints with an environment's, as EnvironmentLoader.merge_constraints does. */
function mergeConstraints(programConstraints, environmentData) {
  if (!environmentData) return programConstraints;
  const envConstraints = get(environmentData, 'resourceConstraints', []);
  const programMap = new Map(programConstraints.map((c) => [c.task, c]));
  const merged = [];
  for (const env of envConstraints) {
    if (programMap.has(env.task)) { merged.push(programMap.get(env.task)); programMap.delete(env.task); }
    else merged.push(env);
  }
  merged.push(...programMap.values());
  return merged;
}

/**
 * Build the visualizer HTML for a program (deep-copied; the input is not mutated).
 * `environment` is the optional environment JSON the program's `environment`
 * id refers to; its constraints are merged as the server merges them.
 */
/**
 * Python's expand_replicates computes staggered offsets as floats
 * (_parse_delay returns float), so every offsetSeconds it created or changed
 * is a float there. Find those by comparing against the unexpanded steps.
 */
function markStaggerFloats(original, expanded) {
  const origSteps = new Map();
  for (const t of get(original, 'tracks', [])) for (const st of get(t, 'steps', [])) origSteps.set(st.stepId, st);
  for (const t of get(expanded, 'tracks', [])) {
    for (const st of get(t, 'steps', [])) {
      let base = st.stepId;
      while (!origSteps.has(base) && /-r\d+$/.test(base)) base = base.replace(/-r\d+$/, '');
      const orig = origSteps.get(base);
      const trig = get(st, 'startTrigger', {});
      if (!orig || !trig || typeof trig !== 'object' || !('offsetSeconds' in trig)) continue;
      const origTrig = get(orig, 'startTrigger', {});
      const before = origTrig && typeof origTrig === 'object' && 'offsetSeconds' in origTrig ? origTrig.offsetSeconds : undefined;
      if (before === undefined || +before !== +trig.offsetSeconds || typeof before === 'string') {
        if (typeof trig.offsetSeconds === 'number') trig.offsetSeconds = new PyFloat(trig.offsetSeconds);
      }
    }
  }
  return expanded;
}

/** Deep clone keeping PyFloat instances (JSON round-trips would flatten them). */
function pyClone(x) {
  if (isF(x)) return new PyFloat(x.v);
  if (Array.isArray(x)) return x.map(pyClone);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = pyClone(x[k]);
    return o;
  }
  return x;
}

/** Deep clone with PyFloat replaced by plain numbers, for the engine. */
function toPlain(x) {
  if (isF(x)) return x.v;
  if (Array.isArray(x)) return x.map(toPlain);
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = toPlain(x[k]);
    return o;
  }
  return x;
}

/**
 * After replicate expansion (which ran on plain numbers), put the input's
 * float literals back wherever the expanded copy still carries the same value.
 */
function reattachFloats(orig, exp) {
  if (isF(orig)) return typeof exp === 'number' && exp === orig.v ? new PyFloat(exp) : exp;
  if (Array.isArray(orig) && Array.isArray(exp)) return exp.map((v, i) => (i < orig.length ? reattachFloats(orig[i], v) : v));
  if (orig && exp && typeof orig === 'object' && typeof exp === 'object' && !Array.isArray(exp)) {
    const o = {};
    for (const k of Object.keys(exp)) o[k] = k in orig ? reattachFloats(orig[k], exp[k]) : exp[k];
    return o;
  }
  return exp;
}

function reattachProgramFloats(original, expanded) {
  const origTracks = new Map();
  const origSteps = new Map();
  for (const t of get(original, 'tracks', [])) {
    origTracks.set(t.trackId, t);
    for (const st of get(t, 'steps', [])) origSteps.set(st.stepId, st);
  }
  const baseOf = (id, map) => {
    let base = String(id);
    while (!map.has(base) && /-r\d+$/.test(base)) base = base.replace(/-r\d+$/, '');
    if (!map.has(base) && base.includes('--')) base = base.split('--')[0];
    return map.get(base);
  };
  const out = {};
  for (const k of Object.keys(expanded)) {
    if (k === 'tracks') out.tracks = reattachTracks(expanded.tracks);
    else out[k] = k in original ? reattachFloats(original[k], expanded[k]) : expanded[k];
  }
  return out;

  function reattachTracks(tracks) { return tracks.map((t) => {
    const ot = baseOf(t.trackId, origTracks);
    const nt = {};
    for (const k of Object.keys(t)) {
      if (k === 'steps') continue;
      nt[k] = ot && k in ot ? reattachFloats(ot[k], t[k]) : t[k];
    }
    nt.steps = get(t, 'steps', []).map((st) => {
      const os = baseOf(st.stepId, origSteps);
      return os ? reattachFloats(os, st) : st;
    });
    return nt;
  }); }
}

function buildPlayerHtml(program, environment) {
  const plain = toPlain(program);
  const expanded = expandReplicates(plain);
  let programData;
  if (expanded === plain) programData = pyClone(program);
  else programData = markStaggerFloats(program, reattachProgramFloats(program, expanded));
  const environmentData = environment || null;
  const resourceConstraints = mergeConstraints(get(programData, 'resourceConstraints', []), environmentData);
  const [nodes, edges] = extractStepDependencies(programData);
  const slots = computeSlots(nodes, edges, programData, environmentData, resourceConstraints);

  let html = loadTemplate();
  const markers = html.match(/<%=[\s\S]*?%>/g) || [];
  for (const marker of new Set(markers)) {
    const expr = marker.slice(3, -2);
    const key = expr.startsWith("'<button onclick=") ? '__env_block__' : expr;
    if (!(key in slots)) throw new Error(`template slot not implemented: ${expr.slice(0, 80)}`);
    html = html.split(marker).join(slots[key]);
  }
  return html;
}

module.exports = {
  buildPlayerHtml,
  parsePyJson,
  PyFloat,
  extractStepDependencies,
  calculateTimelineData,
  parseDurationString,
  pyJson,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  let envPath = null;
  const envIdx = args.indexOf('--environment');
  if (envIdx !== -1) { envPath = args[envIdx + 1]; args.splice(envIdx, 2); }
  const [programPath, outPath] = args;
  if (!programPath) {
    console.error('usage: node player/build.js program.json [out.html] [--environment env.json]');
    process.exit(2);
  }
  const program = parsePyJson(fs.readFileSync(programPath, 'utf8'));
  const environment = envPath ? JSON.parse(fs.readFileSync(envPath, 'utf8')) : null;
  const html = buildPlayerHtml(program, environment);
  if (outPath) {
    fs.writeFileSync(outPath, html);
    console.error(`wrote ${outPath} (${html.length} chars)`);
  } else {
    process.stdout.write(html);
  }
}
