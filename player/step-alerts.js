/*!
 * rhylthyme step alerts — the pure part of the player's alert engine.
 *
 * A step may carry `alerts: [{event: "start"|"end", offsetSeconds, message,
 * level}]` (program schema 0.2.3-alpha). This module decides WHEN each alert
 * fires and WHAT it says; the page (web_visualizer.py's generate_dag_html)
 * owns presentation (banner, chime, vibration, browser notification) and the
 * native bridge posts. The rules follow the cross-platform alert contract:
 *
 *   - fire time = anchor (the step's start or end) + offsetSeconds; anchors
 *     are actual once the step has started/ended, projected before that, and
 *     are re-read on every evaluation because projections move;
 *   - unpredictable anchors are never projected (before-start on a manual
 *     step, before-end on an indefinite step);
 *   - overtaken alerts (before-start once started, before-end once ended) are
 *     dropped; steps on an unchosen choice branch never alert;
 *   - a clock jump of more than JUMP_SECONDS fires crossed alerts late on the
 *     plain web (if at most LATE_MAX_SECONDS overdue) and silently marks them
 *     fired inside a native app, whose OS notifications already delivered them.
 *
 * The page hands evaluate()/buildSchedule() one snapshot per step that has
 * alerts:
 *   { stepId, name, alerts, manualStart, indefinite, skipped,
 *     started, ended, start, end }
 * where `start`/`end` are program seconds (actual once started/ended,
 * otherwise projected) or null when unknown.
 *
 * The file is inlined into the player page verbatim (the `_STEP_ALERTS_JS`
 * template slot), so it must stay dependency-free: no require(), no fetch.
 * Tested by rhylthyme-server/tests/js/step-alerts.test.js (npm test).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RhylthymeStepAlerts = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var JUMP_SECONDS = 5;
  var LATE_MAX_SECONDS = 300;
  var MAX_SCHEDULED = 64;

  // English fallbacks, used when no translator is passed (Node tests) or the
  // page's translator has no entry for a key.
  var EN = {
    'alerts.startingNow': 'Starting now',
    'alerts.startsIn': 'Starts in {d}',
    'alerts.startedAgo': 'Started {d} ago',
    'alerts.endsIn': 'Ends in {d}',
    'alerts.done': 'Done',
    'alerts.endedAgo': 'Ended {d} ago',
    'alerts.unitHours': '{n} h',
    'alerts.unitMinutes': '{n} min',
    'alerts.unitSeconds': '{n} s'
  };

  function fill(template, params) {
    var s = String(template);
    Object.keys(params || {}).forEach(function (k) {
      s = s.split('{' + k + '}').join(String(params[k]));
    });
    return s;
  }

  /** A translator that falls back to English when `t` is missing or echoes the key. */
  function translator(t) {
    return function (key, params) {
      var s = typeof t === 'function' ? t(key, params) : undefined;
      if (typeof s !== 'string' || s === key) s = fill(EN[key] || key, params);
      return s;
    };
  }

  var TIME_PART = /(\d+(?:\.\d+)?)\s*([hms]?)/g;

  /**
   * Seconds from a number or a signed time string ("-2m", "30s", "1h30m").
   * The server normalises time strings before they reach the page; this is
   * the same parse for alerts edited in the page. Unparseable values are 0.
   */
  function toSeconds(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    if (typeof value !== 'string') return 0;
    var text = value.trim().toLowerCase();
    if (!text) return 0;
    var sign = text.charAt(0) === '-' ? -1 : 1;
    text = text.replace(/^[+-]\s*/, '').replace(/\s+/g, '');
    var total = 0;
    var consumed = '';
    var m;
    TIME_PART.lastIndex = 0;
    while ((m = TIME_PART.exec(text)) !== null) {
      if (!m[0]) { TIME_PART.lastIndex++; continue; }
      consumed += m[0];
      total += parseFloat(m[1]) * ({ h: 3600, m: 60, s: 1, '': 1 })[m[2]];
    }
    if (!consumed || consumed !== text) return 0;
    return sign * total;
  }

  function alertId(stepId, index) {
    return stepId + '#' + index;
  }

  /** Compact duration: "45 s", "2 min", "1 min 30 s", "1 h 5 min". */
  function formatDuration(seconds, t) {
    var tr = translator(t);
    var s = Math.round(Math.abs(seconds));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    var parts = [];
    if (h) {
      parts.push(tr('alerts.unitHours', { n: h }));
      if (m) parts.push(tr('alerts.unitMinutes', { n: m }));
    } else if (m) {
      parts.push(tr('alerts.unitMinutes', { n: m }));
      if (r) parts.push(tr('alerts.unitSeconds', { n: r }));
    } else {
      parts.push(tr('alerts.unitSeconds', { n: r }));
    }
    return parts.join(' ');
  }

  /** The localized body used when an alert has no `message`. */
  function defaultBody(alert, t) {
    var tr = translator(t);
    var off = toSeconds(alert && alert.offsetSeconds);
    var d = formatDuration(off, t);
    if (alert && alert.event === 'end') {
      if (off < 0) return tr('alerts.endsIn', { d: d });
      if (off > 0) return tr('alerts.endedAgo', { d: d });
      return tr('alerts.done');
    }
    if (off < 0) return tr('alerts.startsIn', { d: d });
    if (off > 0) return tr('alerts.startedAgo', { d: d });
    return tr('alerts.startingNow');
  }

  /** Title and body shown to the person: plain text, never HTML. */
  function alertText(step, alert, t) {
    var message = alert && typeof alert.message === 'string' && alert.message.trim() ? alert.message : null;
    return { title: String((step && step.name) || (step && step.stepId) || ''), body: message || defaultBody(alert, t) };
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  /**
   * Where one alert stands for a step snapshot:
   *   {status: 'skip'}     never fires (unpredictable anchor, or bad event)
   *   {status: 'drop', fireAt?}  overtaken; mark it fired without presenting
   *                        it (fireAt = the actual anchor + offset, when known)
   *   {status: 'unknown'}  fire time not known yet
   *   {status: 'known', fireAt, confirmed}  `confirmed` = the anchor is actual,
   *                        so the alert may fire once the clock reaches fireAt
   */
  function fireTime(step, alert) {
    var off = toSeconds(alert && alert.offsetSeconds);
    var event = alert && alert.event;
    if (event === 'start') {
      if (off < 0) {
        if (step.manualStart) return { status: 'skip' };
        if (step.started) return isNum(step.start) ? { status: 'drop', fireAt: step.start + off } : { status: 'drop' };
        if (!isNum(step.start)) return { status: 'unknown' };
        return { status: 'known', fireAt: step.start + off, confirmed: true };
      }
      if (!isNum(step.start)) return { status: 'unknown' };
      if (step.manualStart && !step.started) return { status: 'unknown' };
      return { status: 'known', fireAt: step.start + off, confirmed: !!step.started };
    }
    if (event === 'end') {
      if (off < 0) {
        if (step.indefinite) return { status: 'skip' };
        if (step.ended) return isNum(step.end) ? { status: 'drop', fireAt: step.end + off } : { status: 'drop' };
        if (!isNum(step.end)) return { status: 'unknown' };
        return { status: 'known', fireAt: step.end + off, confirmed: true };
      }
      if (!isNum(step.end)) return { status: 'unknown' };
      if (step.ended) return { status: 'known', fireAt: step.end + off, confirmed: true };
      if (step.indefinite) return { status: 'unknown' };
      return { status: 'known', fireAt: step.end + off, confirmed: false };
    }
    return { status: 'skip' };
  }

  function createState() {
    return { done: new Set(), lastClock: null };
  }

  /** Stop: every alert may fire again in the next run. */
  function reset(state) {
    state.done.clear();
    state.lastClock = null;
  }

  function levelOf(alert) {
    return alert && alert.level === 'alarm' ? 'alarm' : 'notice';
  }

  /**
   * Advance the engine to program time `now`. Marks fired/dropped alerts in
   * `state.done` and returns
   *   { fire: [entry], silent: [entry], dropped: [id], jumped }
   * where an entry is {id, stepId, title, body, level, fireAt, late}. `fire`
   * is what the page presents now; `silent` was crossed by a clock jump and
   * is only marked fired.
   * options: { native: bool (inside an app), t: translator,
   *            jumpSeconds: the jump threshold (default JUMP_SECONDS; the page
   *            raises it to one wall second of program time at high speeds so
   *            a regular 100 ms tick at 50x is not mistaken for a jump) }
   *
   * An alert whose anchor was overtaken in this very update (its fire time
   * lies between the previous and the current clock reading, e.g. a 5 s tick
   * at 50x or a throttled tab crossing both the fire time and the step's
   * start) came due before it was overtaken, so it fires (subject to the
   * jump rules) instead of being dropped.
   */
  function evaluate(state, steps, now, options) {
    var opts = options || {};
    var prev = state.lastClock === null || state.lastClock === undefined ? 0 : state.lastClock;
    var threshold = isNum(opts.jumpSeconds) && opts.jumpSeconds > JUMP_SECONDS ? opts.jumpSeconds : JUMP_SECONDS;
    var jumped = now - prev > threshold;
    state.lastClock = now;
    var out = { fire: [], silent: [], dropped: [], jumped: jumped };
    (steps || []).forEach(function (step) {
      if (!step || step.skipped || !Array.isArray(step.alerts)) return;
      step.alerts.forEach(function (alert, index) {
        var id = alertId(step.stepId, index);
        if (state.done.has(id)) return;
        var ft = fireTime(step, alert);
        if (ft.status === 'drop' && isNum(ft.fireAt) && ft.fireAt > prev && ft.fireAt <= now) {
          ft = { status: 'known', fireAt: ft.fireAt, confirmed: true };
        }
        if (ft.status === 'drop') {
          state.done.add(id);
          out.dropped.push(id);
          return;
        }
        if (ft.status !== 'known' || !ft.confirmed || now < ft.fireAt) return;
        state.done.add(id);
        var text = alertText(step, alert, opts.t);
        var entry = {
          id: id, stepId: step.stepId, title: text.title, body: text.body,
          level: levelOf(alert), fireAt: ft.fireAt, late: false
        };
        if (jumped) {
          if (opts.native || now - ft.fireAt > LATE_MAX_SECONDS) { out.silent.push(entry); return; }
          entry.late = true;
        }
        out.fire.push(entry);
      });
    });
    out.fire.sort(function (a, b) { return a.fireAt - b.fireAt; });
    return out;
  }

  /**
   * The `rhylthymeAlertSchedule` payload: every pending alert whose fire time
   * is known and not yet past, soonest first, capped at MAX_SCHEDULED.
   * exec: { state: 'running'|'paused'|'stopped', currentTime, speed, enabled }
   * (`enabled: false` sends an empty list, as on stop).
   */
  function buildSchedule(state, steps, exec, t) {
    var e = exec || {};
    var now = isNum(e.currentTime) ? e.currentTime : 0;
    var alerts = [];
    if (e.state !== 'stopped' && e.enabled !== false) {
      (steps || []).forEach(function (step) {
        if (!step || step.skipped || !Array.isArray(step.alerts)) return;
        step.alerts.forEach(function (alert, index) {
          var id = alertId(step.stepId, index);
          if (state.done.has(id)) return;
          var ft = fireTime(step, alert);
          if (ft.status !== 'known') return;
          var fireAt = Math.round(ft.fireAt);
          if (fireAt < now) return;
          var text = alertText(step, alert, t);
          alerts.push({ id: id, stepId: step.stepId, fireAt: fireAt, title: text.title, body: text.body, level: levelOf(alert) });
        });
      });
      alerts.sort(function (a, b) { return a.fireAt - b.fireAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
      alerts = alerts.slice(0, MAX_SCHEDULED);
    }
    return {
      running: e.state === 'running',
      currentTime: Math.round(now * 10) / 10,
      speed: isNum(e.speed) ? e.speed : 1,
      alerts: alerts
    };
  }

  /** Dedupe key for schedule posts: the payload without `currentTime`. */
  function scheduleKey(payload) {
    return JSON.stringify([payload.running, payload.speed, payload.alerts]);
  }

  return {
    JUMP_SECONDS: JUMP_SECONDS,
    LATE_MAX_SECONDS: LATE_MAX_SECONDS,
    MAX_SCHEDULED: MAX_SCHEDULED,
    toSeconds: toSeconds,
    alertId: alertId,
    formatDuration: formatDuration,
    defaultBody: defaultBody,
    alertText: alertText,
    fireTime: fireTime,
    createState: createState,
    reset: reset,
    evaluate: evaluate,
    buildSchedule: buildSchedule,
    scheduleKey: scheduleKey
  };
}));
