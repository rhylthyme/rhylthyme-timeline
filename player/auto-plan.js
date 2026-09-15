/*!
 * rhylthyme auto-plan — the four browser planning strategies and the
 * post-optimisation conflict sweep, as pure functions.
 *
 * These were embedded in the visualizer page (web_visualizer.py's
 * generate_dag_html) and closed over template globals (targetDurationSeconds,
 * resourceConstraints, originalProgram). They are extracted here so they can
 * be unit-tested in Node (rhylthyme-timeline/test/auto-plan.test.js) while the
 * page keeps thin wrappers that supply those globals as options.
 *
 * The file is inlined into the player page verbatim (the `_AUTO_PLAN_JS`
 * template slot), so it must stay dependency-free: no require(), no fetch.
 * That is why the in-flight helpers below (inFlightGroups, inFlightWindows,
 * inFlightConflicts, _sweep) are DUPLICATED from
 * rhylthyme-server/mcp-api/schedule.js rather than imported. They carry the
 * same names and produce the same shapes; schedule.js remains the source of
 * truth and any change there must be mirrored here.
 *
 * Instance awareness is opt-in and inert unless the expanded program actually
 * contains replicate instances: pass `options.program` (an EXPANDED program,
 * i.e. the output of expandReplicates) and, when it has steps carrying
 * `instanceOf`, the planners
 *   - read dependencies from the program's real triggers, so `all` barriers
 *     and synthetic `maxInFlight` gates are honoured rather than collapsed to
 *     "the previous step in the track";
 *   - re-check every plan against the in-flight caps and push late instances
 *     out until no cap is exceeded;
 *   - drop whole instance chains (an instance plus its paired `"each"`
 *     descendants) in fit_to_time, re-deriving barriers over what is left.
 * With no `options.program`, or a program without instances, every function
 * behaves exactly as the in-page originals did.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RhylthymeAutoPlan = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ---------------------------------------------------------------------------
// In-flight helpers — duplicated from rhylthyme-server/mcp-api/schedule.js.
// Keep the names and the output shapes identical to that file.

const SYNTHETIC_IN_FLIGHT = 'inFlight';

function _isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// Synthetic in-flight atoms sit at the top level of the outer compound,
// never nested deeper, so a non-recursive scan is exact.
function _inFlightAtoms(step) {
  const trig = step && step.startTrigger;
  if (!_isObj(trig)) return [];
  const atoms = Array.isArray(trig.triggers) ? trig.triggers : [trig];
  return atoms.filter((a) => _isObj(a) && a._synthetic === SYNTHETIC_IN_FLIGHT && a.stepId);
}

function _instanceIndexOf(step) {
  const n = Number(step && step.instanceIndex);
  return Number.isFinite(n) ? n : null;
}

// Group the synthetic gates of an EXPANDED program by the authored step
// whose instances they cap.
//   [{ inFlightOf, maxInFlight, count, task, leafTasks[], leafSteps[],
//      gatedSteps[], instances: [{ instanceIndex, stepId, leafStepIds[] }] }]
function inFlightGroups(program) {
  const tracks = Array.isArray(program && program.tracks) ? program.tracks : [];
  const all = [];
  tracks.forEach((t) => (t.steps || []).forEach((s) => { if (_isObj(s) && s.stepId) all.push(s); }));
  const byId = {};
  all.forEach((s) => { byId[s.stepId] = s; });

  // authored stepId -> instanceIndex -> expanded stepId
  const instances = {};
  all.forEach((s) => {
    const i = _instanceIndexOf(s);
    if (s.instanceOf && i !== null) (instances[s.instanceOf] = instances[s.instanceOf] || {})[i] = s.stepId;
  });

  const groups = {};
  all.forEach((s) => {
    _inFlightAtoms(s).forEach((a) => {
      const rootId = a.inFlightOf || s.instanceOf;
      if (!rootId) return;
      const g = groups[rootId] || (groups[rootId] = { inFlightOf: rootId, maxInFlight: null, leafSteps: [], gatedSteps: [] });
      const k = Number(a.inFlightLimit);
      if (g.maxInFlight === null && Number.isFinite(k)) g.maxInFlight = k;
      const leaf = byId[a.stepId];
      const leafRoot = (leaf && leaf.instanceOf) || a.stepId;
      if (g.leafSteps.indexOf(leafRoot) === -1) g.leafSteps.push(leafRoot);
      if (g.gatedSteps.indexOf(s.stepId) === -1) g.gatedSteps.push(s.stepId);
    });
  });

  return Object.keys(groups).sort().map((rootId) => {
    const g = groups[rootId];
    const idx = instances[rootId] || {};
    const order = Object.keys(idx).map(Number).sort((a, b) => a - b);
    const leafTasks = [];
    g.leafSteps.forEach((L) => {
      const first = byId[(instances[L] || {})[order[0]]];
      const task = first && first.task;
      if (task && leafTasks.indexOf(task) === -1) leafTasks.push(task);
    });
    return {
      inFlightOf: rootId,
      maxInFlight: g.maxInFlight,
      count: order.length,
      task: leafTasks[0] || rootId,
      leafTasks,
      leafSteps: g.leafSteps.slice(),
      gatedSteps: g.gatedSteps.slice(),
      instances: order.map((i) => ({
        instanceIndex: i,
        stepId: idx[i],
        leafStepIds: g.leafSteps.map((L) => (instances[L] || {})[i]).filter(Boolean),
      })),
    };
  });
}

// Sorted start/end events; an end at time t precedes a start at time t,
// so instance i+k starting exactly as instance i leaves flight is not
// counted as an overlap.
function _sweep(items) {
  const ev = [];
  items.forEach((w) => { ev.push([w.startSeconds, 1, w]); ev.push([w.endSeconds, -1, w]); });
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return ev;
}

// Same groups, with each instance's in-flight interval resolved against
// `timings` ({ stepId: { start, end } }) from the same expanded program.
function inFlightWindows(program, timings) {
  timings = timings || {};
  return inFlightGroups(program).map((g) => {
    const windows = g.instances.map((inst) => {
      const rt = timings[inst.stepId];
      if (!rt) return null;
      let end = rt.end;
      inst.leafStepIds.forEach((L) => { const lt = timings[L]; if (lt && lt.end > end) end = lt.end; });
      return {
        instanceIndex: inst.instanceIndex, stepId: inst.stepId,
        leafStepIds: inst.leafStepIds.slice(),
        startSeconds: rt.start, endSeconds: end,
      };
    }).filter(Boolean);
    let load = 0, peak = 0, peakAt = 0;
    _sweep(windows).forEach(([time, delta]) => {
      load += delta;
      if (load > peak) { peak = load; peakAt = time; }
    });
    return Object.assign({}, g, { windows, peakInFlight: peak, peakAtSeconds: peakAt });
  });
}

// Over-subscription of an in-flight cap, in the analyzer's resourceConflicts
// shape. The `resourceType` / `time` / `conflictingSteps` / `overutilization`
// / `maxConcurrent` aliases let the page's existing maxConcurrent reporting
// render these items without a second code path.
function inFlightConflicts(program, timings) {
  const out = [];
  inFlightWindows(program, timings).forEach((g) => {
    const cap = g.maxInFlight;
    if (!cap) return;
    let load = 0;
    const active = new Set();
    let windowStart = null, windowSteps = null;
    _sweep(g.windows).forEach(([time, delta, w]) => {
      if (delta > 0) active.add(w); else active.delete(w);
      load += delta;
      if (load > cap && windowStart === null) { windowStart = time; windowSteps = new Set(active); }
      else if (load > cap) { active.forEach((x) => windowSteps.add(x)); }
      else if (windowStart !== null) {
        const ws = Array.from(windowSteps).sort((a, b) => a.instanceIndex - b.instanceIndex);
        out.push({
          kind: SYNTHETIC_IN_FLIGHT,
          task: g.task,
          inFlightOf: g.inFlightOf,
          maxInFlight: cap,
          demand: ws.length,
          startSeconds: windowStart,
          endSeconds: time,
          steps: ws.map((x) => x.stepId),
          fix: `${ws.length} instances of "${g.inFlightOf}" are in flight at once (started but not yet through "${g.task}") where maxInFlight is ${cap}. Raise replicates.maxInFlight on "${g.inFlightOf}" to ${ws.length}, or hold the later instances until an earlier one clears.`,
          // aliases for the page's maxConcurrent conflict rendering
          resourceType: g.task,
          time: windowStart,
          overutilization: ws.length - cap,
          conflictingSteps: ws.map((x) => x.stepId),
        });
        windowStart = null; windowSteps = null;
      }
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Program helpers

const STEP_REF_TYPES = { afterStep: 1, afterStepWithBuffer: 1 };

function _programSteps(program) {
  const out = [];
  ((program && program.tracks) || []).forEach((t) => {
    (t.steps || []).forEach((s) => { if (_isObj(s) && s.stepId) out.push(s); });
  });
  return out;
}

/** True when the expanded program actually carries replicate instances. */
function hasInstances(program) {
  return _programSteps(program).some((s) => !!s.instanceOf);
}

/**
 * stepId -> [stepId, ...] read from the EXPANDED program's real triggers.
 * `all` compounds contribute every atom (so `instances: "all"` barriers and
 * the synthetic `maxInFlight` gates both become predecessors); `any`
 * compounds contribute nothing, leaving the caller's previous-step fallback
 * in place, because a first-to-finish join is not a conjunction of ends.
 */
function triggerDependencies(program) {
  const deps = {};
  _programSteps(program).forEach((s) => {
    const out = [];
    (function walk(trig) {
      if (!_isObj(trig)) return;
      if (Array.isArray(trig.triggers)) {
        if (trig.logic === 'any') return;
        trig.triggers.forEach(walk);
        return;
      }
      if (STEP_REF_TYPES[trig.type] && trig.stepId && out.indexOf(trig.stepId) === -1) out.push(trig.stepId);
    }(s.startTrigger));
    deps[s.stepId] = out;
  });
  return deps;
}

/**
 * A copy of `program` with `omitted` instances removed and every `all`/`any`
 * compound trigger list rebuilt over the steps that remain — the barrier
 * re-derivation fit_to_time needs after it drops instances of a replicated
 * step. Triggers that lose every atom fall back to programStart.
 */
function rebuildBarriers(program, omittedStepIds) {
  const drop = {};
  (omittedStepIds || []).forEach((id) => { drop[id] = true; });
  const prune = (trig) => {
    if (!_isObj(trig)) return trig;
    if (Array.isArray(trig.triggers)) {
      const kept = trig.triggers.map(prune).filter(Boolean);
      if (!kept.length) return null;
      if (kept.length === 1) return kept[0];
      return Object.assign({}, trig, { triggers: kept });
    }
    if (STEP_REF_TYPES[trig.type] && drop[trig.stepId]) return null;
    return trig;
  };
  return Object.assign({}, program, {
    tracks: ((program && program.tracks) || []).map((t) => Object.assign({}, t, {
      steps: (t.steps || []).filter((s) => !drop[s.stepId]).map((s) => {
        const next = prune(s.startTrigger);
        return Object.assign({}, s, { startTrigger: next || { type: 'programStart' } });
      }),
    })),
  });
}

// ---------------------------------------------------------------------------
// Planner core

function calculateStepDependencies(programData, options) {
  options = options || {};
  const program = options.program || null;
  const fromTriggers = program && hasInstances(program) ? triggerDependencies(program) : null;
  const known = {};
  if (fromTriggers) {
    (programData.tracks || []).forEach((track) => {
      (track.steps || []).forEach((step) => { known[step.stepId] = true; });
    });
  }
  const dependencies = {};

  (programData.tracks || []).forEach((track) => {
    (track.steps || []).forEach((step, index) => {
      dependencies[step.stepId] = [];

      if (fromTriggers) {
        const real = (fromTriggers[step.stepId] || []).filter((id) => known[id]);
        if (real.length) { dependencies[step.stepId] = real.slice(); return; }
      }

      // Cross-track dependency from startTrigger
      const trigger = step.startTrigger || {};
      if (trigger.type === 'afterStep' && trigger.stepId) {
        dependencies[step.stepId].push(trigger.stepId);
      }
      // Within-track: depend on previous step (if not already covered by afterStep)
      else if (index > 0) {
        dependencies[step.stepId].push(track.steps[index - 1].stepId);
      }
    });
  });

  return dependencies;
}

function calculateEarliestStartTimes(dependencies, programData) {
  const times = {};
  const stepDurations = {};

  // Build step durations map
  (programData.tracks || []).forEach((track) => {
    (track.steps || []).forEach((step) => {
      stepDurations[step.stepId] = step.duration.seconds || 0;
    });
  });

  function getEarliestTime(stepId, visited) {
    visited = visited || new Set();
    if (visited.has(stepId)) return 0; // Cycle prevention
    if (times[stepId] !== undefined) return times[stepId];

    visited.add(stepId);

    let maxPredecessorEnd = 0;
    (dependencies[stepId] || []).forEach((depStepId) => {
      const depStart = getEarliestTime(depStepId, new Set(visited));
      const depDuration = stepDurations[depStepId] || 0;
      maxPredecessorEnd = Math.max(maxPredecessorEnd, depStart + depDuration);
    });

    times[stepId] = maxPredecessorEnd;
    return maxPredecessorEnd;
  }

  // Calculate for all steps
  (programData.tracks || []).forEach((track) => {
    (track.steps || []).forEach((step) => {
      getEarliestTime(step.stepId);
    });
  });

  return times;
}

function applySynchronizedFinish(earliestTimes, programData) {
  const stepTimings = [];

  // Calculate track end times at earliest schedule
  const trackEndTimes = {};
  programData.tracks.forEach((track) => {
    let trackEnd = 0;
    track.steps.forEach((step) => {
      const startTime = earliestTimes[step.stepId] || 0;
      const duration = step.duration.seconds || 0;
      trackEnd = Math.max(trackEnd, startTime + duration);
    });
    trackEndTimes[track.trackId] = trackEnd;
  });

  // Find maximum end time
  const maxEndTime = Math.max.apply(null, Object.keys(trackEndTimes).map((k) => trackEndTimes[k]));

  // Delay shorter tracks to synchronize finish
  programData.tracks.forEach((track) => {
    const trackDelay = maxEndTime - trackEndTimes[track.trackId];

    track.steps.forEach((step) => {
      const originalStart = earliestTimes[step.stepId] || 0;
      const newStart = originalStart + trackDelay;
      const duration = step.duration.seconds || 0;

      stepTimings.push({
        stepId: step.stepId,
        trackId: track.trackId,
        startTime: newStart,
        duration: duration,
        endTime: newStart + duration
      });
    });
  });

  return stepTimings;
}

function applyCoverStrategy(earliestTimes, programData) {
  const stepTimings = [];
  let currentTime = 0;
  let lastScheduledTrack = null;
  let lastScheduledStep = null;

  // Prepare all steps with metadata
  const allSteps = [];
  programData.tracks.forEach((track) => {
    track.steps.forEach((step) => {
      allSteps.push(Object.assign({}, step, {
        trackId: track.trackId,
        trackName: track.name,
        trackPriority: track.priority || 100,
        earliestTime: earliestTimes[step.stepId] || 0,
        isCommercial: track.trackId === 'commercial-breaks',
        scheduled: false
      }));
    });
  });

  // Keep scheduling until all steps are placed
  while (stepTimings.length < allSteps.length) {
    const availableSteps = allSteps.filter((step) =>
      !step.scheduled && step.earliestTime <= currentTime
    );

    if (availableSteps.length === 0) {
      // No steps available yet, advance time to next earliest step
      const nextSteps = allSteps.filter((step) => !step.scheduled);
      if (nextSteps.length === 0) break;

      const nextEarliestTime = Math.min.apply(null, nextSteps.map((s) => s.earliestTime));
      currentTime = nextEarliestTime;
      continue;
    }

    // Choose the best next step using priority rules
    let bestStep = null;

    // Rule 1: Avoid consecutive commercials at all costs
    const nonCommercialSteps = availableSteps.filter((s) => !s.isCommercial);
    if (lastScheduledStep && lastScheduledStep.isCommercial && nonCommercialSteps.length > 0) {
      bestStep = chooseBestStep(nonCommercialSteps, lastScheduledTrack);
    } else {
      // Rule 2: Prefer different tracks to create variety
      const differentTrackSteps = availableSteps.filter((s) => s.trackId !== lastScheduledTrack);
      if (differentTrackSteps.length > 0) {
        // Among different tracks, prefer non-commercials
        const nonCommercialDifferentTrack = differentTrackSteps.filter((s) => !s.isCommercial);
        if (nonCommercialDifferentTrack.length > 0) {
          bestStep = chooseBestStep(nonCommercialDifferentTrack, lastScheduledTrack);
        } else {
          bestStep = chooseBestStep(differentTrackSteps, lastScheduledTrack);
        }
      } else {
        // Rule 3: If no different track available, use same track but avoid consecutive commercials
        bestStep = chooseBestStep(availableSteps, lastScheduledTrack);
      }
    }

    if (!bestStep) {
      // Fallback: just pick the first available step
      bestStep = availableSteps[0];
    }

    // Schedule the chosen step
    const duration = bestStep.duration.seconds || 0;
    const endTime = currentTime + duration;

    stepTimings.push({
      stepId: bestStep.stepId,
      trackId: bestStep.trackId,
      startTime: currentTime,
      duration: duration,
      endTime: endTime
    });

    // Update tracking variables
    bestStep.scheduled = true;
    currentTime = endTime;
    lastScheduledTrack = bestStep.trackId;
    lastScheduledStep = bestStep;
  }

  return stepTimings;
}

function chooseBestStep(candidateSteps, lastTrackId) {
  if (candidateSteps.length === 0) return null;
  if (candidateSteps.length === 1) return candidateSteps[0];

  // Sort by priority (lower number = higher priority), then by earliest time
  candidateSteps.sort((a, b) => {
    if (a.trackPriority !== b.trackPriority) {
      return a.trackPriority - b.trackPriority;
    }
    return a.earliestTime - b.earliestTime;
  });

  return candidateSteps[0];
}

function applyMinimizeLength(earliestTimes, programData) {
  const stepTimings = [];

  // Use earliest times and minimum durations
  programData.tracks.forEach((track) => {
    track.steps.forEach((step) => {
      const startTime = earliestTimes[step.stepId] || 0;
      const duration = step.duration.seconds || 0;

      stepTimings.push({
        stepId: step.stepId,
        trackId: track.trackId,
        startTime: startTime,
        duration: duration,
        endTime: startTime + duration
      });
    });
  });

  return stepTimings;
}

/**
 * Instance chains eligible to be dropped as a unit: an instance of a
 * replicated step that does not itself hang off another instance with the
 * same index (a chain root), plus every same-index step that depends on it
 * transitively — the paired `"each"` descendants.
 */
function instanceChains(allSteps, dependencies) {
  const byId = {};
  allSteps.forEach((s) => { byId[s.stepId] = s; });
  const dependents = {};
  allSteps.forEach((s) => {
    (dependencies[s.stepId] || []).forEach((d) => {
      (dependents[d] = dependents[d] || []).push(s.stepId);
    });
  });

  const chains = [];
  allSteps.forEach((s) => {
    if (!s.instanceOf || s.instanceIndex === null || s.instanceIndex === undefined) return;
    const sameIndexDep = (dependencies[s.stepId] || []).some((d) => byId[d] && byId[d].instanceIndex === s.instanceIndex);
    if (sameIndexDep) return; // not a chain root
    const members = [];
    const seen = {};
    (function walk(id) {
      if (seen[id]) return;
      seen[id] = true;
      members.push(id);
      (dependents[id] || []).forEach((d) => {
        if (byId[d] && byId[d].instanceIndex === s.instanceIndex) walk(d);
      });
    }(s.stepId));
    chains.push({
      rootStepId: s.stepId,
      instanceOf: s.instanceOf,
      instanceIndex: s.instanceIndex,
      priority: s.priority || 100,
      memberIds: members,
      cost: members.reduce((sum, id) => sum + (byId[id].duration || 0), 0)
    });
  });
  return chains;
}

function applyFitToTime(earliestTimes, programData, targetSeconds, options) {
  options = options || {};
  const program = options.program || null;
  const instanceAware = !!program && hasInstances(program);
  let dependencies = options.dependencies || null;
  if (!instanceAware) dependencies = null;

  // Instance identity comes from the expanded program when it is available,
  // because the page's programData is rebuilt from the rendered timeline and
  // need not carry it.
  const identity = {};
  if (program) _programSteps(program).forEach((s) => { identity[s.stepId] = s; });

  // Build a working copy of step data with full info
  const allSteps = [];
  programData.tracks.forEach((track) => {
    track.steps.forEach((step, idx) => {
      const trigger = step.startTrigger || {};
      const ident = identity[step.stepId] || step;
      allSteps.push({
        stepId: step.stepId,
        trackId: track.trackId,
        trackIndex: programData.tracks.indexOf(track),
        indexInTrack: idx,
        afterStepId: trigger.type === 'afterStep' ? trigger.stepId : null,
        duration: step.duration.seconds || 0,
        originalDuration: step.duration.seconds || 0,
        durationType: step.duration.type || 'fixed',
        minSeconds: step.duration.minSeconds || null,
        maxSeconds: step.duration.maxSeconds || null,
        priority: step.priority || 100,
        instanceOf: ident.instanceOf === undefined ? null : ident.instanceOf,
        instanceIndex: ident.instanceIndex === undefined ? null : ident.instanceIndex,
        omitted: false,
        inJeopardy: false
      });
    });
  });

  // Build lookup for quick access
  const stepMap = {};
  allSteps.forEach((s) => { stepMap[s.stepId] = s; });

  function depsOf(s) {
    if (!dependencies) return s.afterStepId ? [s.afterStepId] : [];
    const ds = dependencies[s.stepId] || [];
    // A dropped instance keeps its own (zero-length) place in the chain so it
    // still renders where it would have run; live steps ignore dropped ones.
    if (s.omitted) return ds.slice();
    return ds.filter((id) => !stepMap[id] || !stepMap[id].omitted);
  }

  // Helper: recalculate schedule respecting all afterStep dependencies
  function recalculate() {
    const times = {};
    const endTimes = {};

    // Topological ordering: process steps whose dependencies are resolved
    const resolved = new Set();
    const pending = allSteps.map((s) => s.stepId);
    let safety = pending.length * 2;

    while (pending.length > 0 && safety-- > 0) {
      const nextPending = [];
      for (const id of pending) {
        const s = stepMap[id];
        const ds = depsOf(s);
        if (ds.some((d) => !resolved.has(d))) {
          nextPending.push(id);
          continue;
        }
        // Start after the latest dependency ends, or at 0
        let depEnd = 0;
        ds.forEach((d) => { const e = endTimes[d] || 0; if (e > depEnd) depEnd = e; });
        times[id] = depEnd;
        endTimes[id] = depEnd + (s.omitted ? 0 : s.duration);
        resolved.add(id);
      }
      if (nextPending.length === pending.length) break; // cycle guard
      pending.length = 0;
      pending.push.apply(pending, nextPending);
    }

    let maxEnd = 0;
    allSteps.forEach((s) => {
      if (s.omitted) return;
      const end = endTimes[s.stepId] || 0;
      if (end > maxEnd) maxEnd = end;
    });
    return { times: times, totalDuration: maxEnd };
  }

  // Initial calculation
  let calc = recalculate();
  let times = calc.times;
  let totalDuration = calc.totalDuration;

  const buildTimings = () => allSteps.map((s) => ({
    stepId: s.stepId,
    trackId: s.trackId,
    startTime: times[s.stepId] || 0,
    duration: s.duration,
    endTime: (times[s.stepId] || 0) + s.duration,
    omitted: s.omitted || false,
    inJeopardy: s.inJeopardy || false,
    originalDuration: s.originalDuration
  }));

  // Already fits?
  if (totalDuration <= targetSeconds) return buildTimings();

  // PHASE 1: Compress variable durations
  const compressible = allSteps.filter((s) =>
    s.durationType === 'variable' && s.minSeconds != null && s.minSeconds < s.duration
  );
  if (compressible.length > 0) {
    // Sort by priority DESC (lowest priority = highest number compressed first)
    compressible.sort((a, b) => b.priority - a.priority);

    const excess = totalDuration - targetSeconds;
    const totalAvailable = compressible.reduce((sum, s) => sum + (s.duration - s.minSeconds), 0);

    compressible.forEach((s) => {
      const available = s.duration - s.minSeconds;
      // Proportional reduction
      const reduction = Math.min(available, Math.ceil(excess * (available / totalAvailable)));
      s.duration = Math.max(s.minSeconds, s.duration - reduction);
    });

    calc = recalculate();
    times = calc.times;
    totalDuration = calc.totalDuration;
  }

  // PHASE 1b (instance-aware only): drop whole instance chains, trailing
  // instance first. Dropping an instance of a replicated step drops the
  // paired `"each"` descendants with it, and the barrier downstream is
  // re-derived over the instances that remain.
  if (instanceAware && totalDuration > targetSeconds) {
    const omitted = [];
    const chains = instanceChains(allSteps, dependencies)
      .sort((a, b) => (b.priority - a.priority) || (b.instanceIndex - a.instanceIndex));
    for (const chain of chains) {
      if (totalDuration <= targetSeconds) break;
      if (chain.memberIds.some((id) => stepMap[id].omitted)) continue;
      chain.memberIds.forEach((id) => { stepMap[id].omitted = true; omitted.push(id); });
      dependencies = calculateStepDependencies(programData, { program: rebuildBarriers(program, omitted) });
      calc = recalculate();
      times = calc.times;
      totalDuration = calc.totalDuration;
    }
  }

  // PHASE 2: Mark lowest-priority steps as "in jeopardy" (instead of omitting)
  // Steps keep their full duration — they just get a visual warning
  if (totalDuration > targetSeconds) {
    const excess = totalDuration - targetSeconds;
    // Sort candidates by priority DESC (highest number = lowest priority = jeopardy first)
    const candidates = allSteps
      .filter((s) => !s.omitted)
      .sort((a, b) => b.priority - a.priority);

    let savedSoFar = 0;
    for (const candidate of candidates) {
      if (savedSoFar >= excess) break;
      candidate.inJeopardy = true;
      savedSoFar += candidate.originalDuration;
    }
  }

  // Build final step timings (no 4s stubs — keep full durations)
  return buildTimings();
}

/**
 * Push instances out until no in-flight cap is exceeded, re-propagating
 * dependencies after every push. Only ever moves a step later, and returns
 * `stepTimings` untouched when the program declares no in-flight caps.
 */
function enforceInFlight(stepTimings, dependencies, program) {
  const groups = inFlightGroups(program).filter((g) => g.maxInFlight);
  if (!groups.length) return stepTimings;

  const byId = {};
  stepTimings.forEach((t) => { byId[t.stepId] = t; });

  for (let pass = 0; pass < 100; pass++) {
    let moved = false;

    // Dependency propagation (push later only)
    stepTimings.forEach((t) => {
      if (t.omitted) return;
      let required = t.startTime;
      (dependencies[t.stepId] || []).forEach((d) => {
        const dep = byId[d];
        if (dep && !dep.omitted && dep.endTime > required) required = dep.endTime;
      });
      if (required > t.startTime) {
        t.startTime = required;
        t.endTime = required + t.duration;
        moved = true;
      }
    });

    // In-flight caps: instance i + k waits for instance i to leave flight
    groups.forEach((g) => {
      const k = g.maxInFlight;
      const live = g.instances.filter((i) => byId[i.stepId] && !byId[i.stepId].omitted);
      for (let n = k; n < live.length; n++) {
        const prev = live[n - k];
        let clear = byId[prev.stepId].endTime;
        prev.leafStepIds.forEach((L) => {
          const lt = byId[L];
          if (lt && !lt.omitted && lt.endTime > clear) clear = lt.endTime;
        });
        const cur = byId[live[n].stepId];
        if (cur.startTime < clear) {
          cur.startTime = clear;
          cur.endTime = clear + cur.duration;
          moved = true;
        }
      }
    });

    if (!moved) break;
  }

  return stepTimings;
}

/**
 * options:
 *   strategy                 'cover' | 'synchronized_finish' | 'minimize_length' | 'fit_to_time'
 *   targetDurationSeconds    required by fit_to_time
 *   program                  the EXPANDED program, for instance awareness
 */
function applyAutoPlanStrategy(programData, options) {
  options = options || {};
  const strategy = options.strategy;
  const program = options.program || null;
  const targetDurationSeconds = options.targetDurationSeconds;
  const instanceAware = !!program && hasInstances(program);

  try {
    // Simple client-side auto-planning implementation
    const result = {
      success: true,
      plan: {
        strategy: strategy,
        stepTimings: []
      }
    };

    // Calculate step dependencies and earliest start times
    const stepDependencies = calculateStepDependencies(programData, { program: program });
    const earliestTimes = calculateEarliestStartTimes(stepDependencies, programData);

    // Apply strategy-specific logic
    if (strategy === 'synchronized_finish') {
      result.plan.stepTimings = applySynchronizedFinish(earliestTimes, programData);
    } else if (strategy === 'cover') {
      result.plan.stepTimings = applyCoverStrategy(earliestTimes, programData);
    } else if (strategy === 'minimize_length') {
      result.plan.stepTimings = applyMinimizeLength(earliestTimes, programData);
    } else if (strategy === 'fit_to_time') {
      if (!targetDurationSeconds || targetDurationSeconds <= 0) {
        return { success: false, error: 'Set a target duration first' };
      }
      result.plan.stepTimings = applyFitToTime(earliestTimes, programData, targetDurationSeconds, {
        program: program,
        dependencies: stepDependencies
      });
    }

    // Both limits are respected: maxConcurrent is repaired by the page's
    // conflict resolver, maxInFlight here, where the instance structure is
    // still known.
    if (instanceAware) {
      result.plan.stepTimings = enforceInFlight(result.plan.stepTimings, stepDependencies, program);
    }

    return result;

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// ---------------------------------------------------------------------------
// Post-optimisation conflict sweep

function calculateOptimizedResourceUsage(optimizedSteps, resourceConstraints) {
  /**
   * Calculate resource usage timeline for optimized steps
   */
  const resourceUsage = {};

  // Initialize resource usage tracking
  (resourceConstraints || []).forEach((constraint) => {
    resourceUsage[constraint.task] = {
      timeline: []
    };
  });

  // Add events for each optimized step
  Object.keys(optimizedSteps).forEach((key) => {
    const step = optimizedSteps[key];
    if (step.task && resourceUsage[step.task]) {
      const startTime = step.startTime || step.originalStartTime;
      const endTime = startTime + step.duration;

      resourceUsage[step.task].timeline.push(
        { type: 'start', time: startTime, stepId: step.stepId },
        { type: 'end', time: endTime, stepId: step.stepId }
      );
    }
  });

  return resourceUsage;
}

/**
 * Detect conflicts in the optimized schedule using the same logic as
 * findResourceConflicts. Every item carries `kind`: "maxConcurrent" for a
 * task over its instantaneous cap, "inFlight" for more instances between a
 * replicated step and its barrier than `replicates.maxInFlight` allows.
 *
 * options: { resourceConstraints, program }
 */
function detectPostOptimizationConflicts(optimizedSteps, options) {
  options = options || {};
  const resourceConstraints = options.resourceConstraints || [];
  const program = options.program || null;

  const conflicts = [];
  const resourceUsage = calculateOptimizedResourceUsage(optimizedSteps, resourceConstraints);

  Object.keys(resourceUsage).forEach((resourceType) => {
    const constraint = resourceConstraints.find((c) => c.task === resourceType);
    if (!constraint) return;

    const events = resourceUsage[resourceType].timeline.sort((a, b) => {
      // First sort by time
      if (a.time !== b.time) return a.time - b.time;
      // For events at the same time, process 'end' before 'start'
      // This prevents false conflicts when one step ends and another begins simultaneously
      if (a.type === 'end' && b.type === 'start') return -1;
      if (a.type === 'start' && b.type === 'end') return 1;
      return 0;
    });
    let currentUsage = 0;
    let activeSteps = [];

    events.forEach((event) => {
      if (event.type === 'start') {
        currentUsage += 1;
        activeSteps.push(event.stepId);

        // Check for overutilization
        if (currentUsage > constraint.maxConcurrent) {
          conflicts.push({
            kind: 'maxConcurrent',
            resourceType: resourceType,
            time: event.time,
            overutilization: currentUsage - constraint.maxConcurrent,
            maxConcurrent: constraint.maxConcurrent,
            conflictingSteps: activeSteps.slice(),
            triggerStep: event.stepId
          });
        }
      } else {
        currentUsage = Math.max(0, currentUsage - 1);
        activeSteps = activeSteps.filter((id) => id !== event.stepId);
      }
    });
  });

  if (program) {
    const timings = {};
    Object.keys(optimizedSteps).forEach((key) => {
      const step = optimizedSteps[key];
      const start = step.startTime || step.originalStartTime || 0;
      timings[step.stepId] = { start: start, end: start + (step.duration || 0) };
    });
    inFlightConflicts(program, timings).forEach((c) => conflicts.push(c));
  }

  return conflicts;
}

return {
  // in-flight helpers (mirrors of mcp-api/schedule.js)
  inFlightGroups: inFlightGroups,
  inFlightWindows: inFlightWindows,
  inFlightConflicts: inFlightConflicts,
  // program helpers
  hasInstances: hasInstances,
  triggerDependencies: triggerDependencies,
  rebuildBarriers: rebuildBarriers,
  instanceChains: instanceChains,
  // planners
  applyAutoPlanStrategy: applyAutoPlanStrategy,
  calculateStepDependencies: calculateStepDependencies,
  calculateEarliestStartTimes: calculateEarliestStartTimes,
  applySynchronizedFinish: applySynchronizedFinish,
  applyCoverStrategy: applyCoverStrategy,
  chooseBestStep: chooseBestStep,
  applyMinimizeLength: applyMinimizeLength,
  applyFitToTime: applyFitToTime,
  enforceInFlight: enforceInFlight,
  // post-optimisation sweep
  calculateOptimizedResourceUsage: calculateOptimizedResourceUsage,
  detectPostOptimizationConflicts: detectPostOptimizationConflicts
};
}));
