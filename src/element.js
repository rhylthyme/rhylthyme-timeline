/*
 * <rhylthyme-timeline> — interactive player Web Component.
 * Part of @rhylthyme/timeline. Apache-2.0.
 *
 * Load after src/index.js (the engine); this file registers the element
 * on the global Rhylthyme object's engine:
 *
 *   <script src="https://cdn.jsdelivr.net/npm/@rhylthyme/timeline@2/src/index.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@rhylthyme/timeline@2/src/element.js"></script>
 *   <rhylthyme-timeline src="program.json" mode="player" speed="1"></rhylthyme-timeline>
 *
 * Attributes / properties
 *   program      (property) program JSON object
 *   src          URL of a program JSON to fetch
 *   mode         "static" (Gantt only) | "player" (default: controls, cursor, manual actions)
 *   speed        playback multiplier (default 1)
 *   time-format  "minutes" (mm:ss, default) | "seconds" | "hours" (h:mm:ss) | "clock" (HH:MM wall time)
 *   start-at     ISO 8601 wall-clock time the program starts; used by time-format="clock"
 *   theme        "light" (default) | "dark" | "cookbook"; or set the --rt-* custom properties
 *   view         "timeline" (only view in this release)
 *
 * Methods
 *   start() pause() stop() toggle() seek(seconds)
 *   startStep(stepId)     the executor begins a manual gate / negative-offset hand-off
 *   completeStep(stepId)  the executor ends an indefinite or triggerable variable step
 *   tick()                advance from the clock (called automatically while running)
 *   setClock(fn)          replace the millisecond clock (tests)
 *
 * Read-only
 *   currentTime, status ("stopped"|"running"|"paused"|"completed"), timings, stepStates
 *
 * Events (bubbling, composed; detail carries time and step ids)
 *   rt-start rt-pause rt-stop rt-tick rt-step-start rt-step-complete rt-complete rt-load
 *
 * Timing semantics come from the engine: computeStepTimings(program, { actual, now }).
 * Manual gates and negative-offset hand-offs wait for startStep() and float
 * forward until then; indefinite steps and variable steps with a triggerName
 * stretch until completeStep() (variable ones auto-complete at maxSeconds);
 * starting a negative-offset step caps the step it refers to at now + |offset|,
 * as the rhylthyme.com player does.
 */
(function (root) {
  'use strict';
  if (typeof customElements === 'undefined') return;
  var R = root.Rhylthyme;
  if (!R || !R.computeStepTimings) {
    throw new Error('rhylthyme-timeline element: load src/index.js (the engine) first');
  }
  if (customElements.get('rhylthyme-timeline')) return;

  var CSS = [
    ':host{display:block;box-sizing:border-box;',
    '--rt-bg:#ffffff;--rt-fg:#111827;--rt-muted:#6b7280;--rt-border:#e5e7eb;--rt-accent:#16a34a;',
    '--rt-panel:#f9fafb;--rt-danger:#dc2626;--rt-warn:#b45309;--rt-font:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'font-family:var(--rt-font);color:var(--rt-fg);background:var(--rt-bg)}',
    ':host([theme="dark"]){--rt-bg:#0f172a;--rt-fg:#e5e7eb;--rt-muted:#94a3b8;--rt-border:#334155;--rt-panel:#1e293b}',
    ':host([theme="dark"]) .chart svg{filter:invert(0.92) hue-rotate(180deg)}',
    ':host([theme="cookbook"]){--rt-bg:#fbf7ef;--rt-fg:#3b2f2f;--rt-muted:#8a7f72;--rt-border:#e6dccb;--rt-panel:#f4ecdd;--rt-accent:#6b9e7d}',
    '*{box-sizing:border-box}',
    '.controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--rt-border);border-radius:10px;background:var(--rt-panel);margin-bottom:8px}',
    '.controls button{font:inherit;font-size:14px;font-weight:600;padding:6px 12px;border-radius:8px;border:1px solid var(--rt-border);background:var(--rt-bg);color:var(--rt-fg);cursor:pointer;min-height:36px}',
    '.controls button[disabled]{opacity:.45;cursor:default}',
    '.controls button.primary{background:var(--rt-accent);border-color:var(--rt-accent);color:#fff}',
    '.controls button.stop{color:var(--rt-danger)}',
    '.controls select{font:inherit;font-size:13px;padding:5px 6px;border-radius:8px;border:1px solid var(--rt-border);background:var(--rt-bg);color:var(--rt-fg);min-height:36px}',
    '.clock{margin-left:auto;display:flex;align-items:baseline;gap:10px}',
    '.clock .time{font-variant-numeric:tabular-nums;font-size:20px;font-weight:700}',
    '.clock .status{font-size:12px;color:var(--rt-muted);text-transform:capitalize}',
    '.chart{border:1px solid var(--rt-border);border-radius:10px;overflow:hidden;background:#fafafa}',
    '.chart svg{display:block;width:100%;height:auto}',
    '.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}',
    '.actions:empty{display:none}',
    '.actions button{font:inherit;font-size:13px;font-weight:600;padding:8px 12px;border-radius:999px;border:1px solid var(--rt-border);background:var(--rt-bg);color:var(--rt-fg);cursor:pointer;min-height:40px}',
    '.actions button.start{border-color:var(--rt-danger);color:var(--rt-danger)}',
    '.actions button.done{border-color:var(--rt-accent);color:var(--rt-accent)}',
    '.actions .hint{width:100%;font-size:12px;color:var(--rt-muted)}',
    '.empty{padding:24px;text-align:center;color:var(--rt-muted);font-size:14px}',
    '@media (max-width:480px){.controls{gap:6px;padding:6px}.controls button{padding:6px 10px;font-size:13px}.clock .time{font-size:17px}}'
  ].join('');

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  class RhylthymeTimeline extends HTMLElement {
    static get observedAttributes() { return ['src', 'mode', 'speed', 'time-format', 'start-at', 'theme', 'view']; }
    constructor() {
      super();
      this._program = null;
      this._expanded = null;
      this._steps = {};
      this._order = [];
      this._time = 0;
      this._status = 'stopped';
      this._actual = {};
      this._caps = {};
      this._anchorWall = 0;
      this._anchorTime = 0;
      this._timer = null;
      this._completedAt = null;
      this._executionStart = null;
      this._clock = function () { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); };
      this._root = this.attachShadow({ mode: 'open' });
      this._root.innerHTML = '<style>' + CSS + '</style><div class="wrap"></div>';
      this._wrap = this._root.querySelector('.wrap');
      this._root.addEventListener('click', this._onClick.bind(this));
      this._root.addEventListener('change', this._onChange.bind(this));
    }
  }

    var proto = RhylthymeTimeline.prototype;

    proto.connectedCallback = function () {
      if (this.hasAttribute('src') && !this._program) this._fetch(this.getAttribute('src'));
      this.render();
    };
    proto.disconnectedCallback = function () { this._stopTimer(); };
    proto.attributeChangedCallback = function (name, oldV, newV) {
      if (oldV === newV) return;
      if (name === 'src' && newV) this._fetch(newV);
      else if (name === 'speed' && this._status === 'running') { this._reanchor(); }
      else if (name === 'view' && newV && newV !== 'timeline') {
        console.warn('rhylthyme-timeline: view="' + newV + '" is not available yet; showing the timeline');
      }
      if (this.isConnected) this.render();
    };

    // ---- program ----------------------------------------------------------
    Object.defineProperty(proto, 'program', {
      get: function () { return this._program; },
      set: function (p) {
        this._stopTimer();
        this._program = p || null;
        this._expanded = p ? R.expandReplicates(p) : null;
        this._steps = {}; this._order = [];
        var self = this;
        if (this._expanded) {
          (this._expanded.tracks || []).forEach(function (t) {
            (t.steps || []).forEach(function (s) { if (s && s.stepId) { self._steps[s.stepId] = s; self._order.push(s.stepId); } });
          });
        }
        this._reset();
        this.render();
        this._emit('rt-load', { program: this._program });
      }
    });
    proto._fetch = function (url) {
      var self = this;
      if (typeof fetch !== 'function') return;
      fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + r.statusText); return r.json(); })
        .then(function (json) { self.program = json; })
        .catch(function (err) { self._wrap.innerHTML = '<div class="empty">Could not load ' + esc(url) + ': ' + esc(err.message) + '</div>'; });
    };

    // ---- attribute-backed settings ---------------------------------------
    Object.defineProperty(proto, 'mode', {
      get: function () { return this.getAttribute('mode') === 'static' ? 'static' : 'player'; },
      set: function (v) { this.setAttribute('mode', v); }
    });
    Object.defineProperty(proto, 'speed', {
      get: function () { var v = parseFloat(this.getAttribute('speed')); return (isFinite(v) && v > 0) ? v : 1; },
      set: function (v) { this.setAttribute('speed', String(v)); }
    });
    Object.defineProperty(proto, 'timeFormat', {
      get: function () { return this.getAttribute('time-format') || 'minutes'; },
      set: function (v) { this.setAttribute('time-format', v); }
    });
    Object.defineProperty(proto, 'startAt', {
      get: function () { var v = this.getAttribute('start-at'); if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? null : d; },
      set: function (v) { if (v) this.setAttribute('start-at', v instanceof Date ? v.toISOString() : String(v)); else this.removeAttribute('start-at'); }
    });
    Object.defineProperty(proto, 'currentTime', { get: function () { return this._time; } });
    Object.defineProperty(proto, 'status', { get: function () { return this._status; } });
    Object.defineProperty(proto, 'timings', { get: function () { return this._timings(); } });
    Object.defineProperty(proto, 'stepStates', { get: function () { return this._states(this._timings()); } });

    proto.setClock = function (fn) { this._clock = fn; this._reanchor(); };

    // ---- transport --------------------------------------------------------
    proto.start = function () {
      if (!this._program || this._status === 'running' || this.mode === 'static') return;
      if (this._status === 'stopped' || this._status === 'completed') {
        if (this._status === 'completed') this._reset();
        this._executionStart = new Date();
      }
      this._status = 'running';
      this._reanchor();
      this._startTimer();
      this.render();
      this._emit('rt-start', { time: this._time });
    };
    proto.pause = function () {
      if (this._status !== 'running') return;
      this.tick();
      this._status = 'paused';
      this._stopTimer();
      this.render();
      this._emit('rt-pause', { time: this._time });
    };
    proto.stop = function () {
      if (this._status === 'stopped') return;
      this._stopTimer();
      this._reset();
      this.render();
      this._emit('rt-stop', {});
    };
    proto.toggle = function () { if (this._status === 'running') this.pause(); else this.start(); };
    proto.seek = function (seconds) {
      if (this._status === 'running') return;
      this._time = Math.max(0, +seconds || 0);
      if (this._status === 'stopped' && this._time > 0) this._status = 'paused';
      this._settle();
      this.render();
    };

    proto._reset = function () {
      this._time = 0; this._status = 'stopped'; this._actual = {}; this._caps = {};
      this._completedAt = null; this._executionStart = null;
    };
    proto._reanchor = function () { this._anchorWall = this._clock(); this._anchorTime = this._time; };
    proto._startTimer = function () {
      var self = this;
      this._stopTimer();
      if (typeof setInterval === 'function') this._timer = setInterval(function () { self.tick(); }, 200);
    };
    proto._stopTimer = function () { if (this._timer) { clearInterval(this._timer); this._timer = null; } };

    /** Advance program time from the clock, apply automatic transitions, re-render. */
    proto.tick = function () {
      if (this._status !== 'running') return;
      this._time = this._anchorTime + Math.max(0, (this._clock() - this._anchorWall) / 1000) * this.speed;
      this._settle();
      this.render();
      this._emit('rt-tick', { time: this._time });
    };

    // Automatic transitions at the current time: record starts of steps
    // that begin on their own, auto-complete capped and maxed-out steps,
    // detect completion.
    proto._settle = function () {
      var now = this._time, self = this, changed = true, guard = 0;
      while (changed && guard++ < 10) {
        changed = false;
        var T = this._timings();
        this._order.forEach(function (id) {
          var step = self._steps[id], a = self._actual[id] || {};
          var t = T[id]; if (!t) return;
          if (a.start === undefined && !R.stepNeedsStart(step) && t.start <= now && R.stepNeedsFinish(step)) {
            self._actual[id] = { start: t.start }; changed = true; a = self._actual[id];
          }
          if (a.start !== undefined && a.end === undefined) {
            var d = step.duration || {};
            if (d.type === 'variable' && d.maxSeconds !== undefined && now >= a.start + R.parseSeconds(d.maxSeconds)) {
              self._finish(id, a.start + R.parseSeconds(d.maxSeconds), true); changed = true;
            } else if (self._caps[id] !== undefined && now >= self._caps[id]) {
              self._finish(id, self._caps[id], true); changed = true;
            }
          }
        });
      }
      var states = this._states(this._timings());
      var allDone = this._order.length > 0 && this._order.every(function (id) { return states[id] === 'done'; });
      if (allDone) {
        if (this._completedAt === null) this._completedAt = now;
        if (this._status === 'running' && now >= this._completedAt + 3) {
          this._status = 'completed';
          this._stopTimer();
          this._emit('rt-complete', { time: this._completedAt });
        }
      } else {
        this._completedAt = null;
      }
    };

    // ---- executor actions -------------------------------------------------
    proto.startStep = function (id) {
      var step = this._steps[id];
      if (!step || (this._actual[id] && this._actual[id].start !== undefined)) return false;
      var now = this._time;
      this._actual[id] = { start: now };
      var self = this;
      // A negative-offset hand-off caps the step it refers to.
      var trig = step.startTrigger || {};
      var list = (trig.logic && Array.isArray(trig.triggers)) ? trig.triggers : [trig];
      list.forEach(function (t) {
        if (!t || !t.stepId) return;
        var off = R.parseSeconds(t.offsetSeconds);
        if ((t.type === 'afterStep' || t.type === 'afterStepWithBuffer') && off < 0) {
          var cap = now + Math.abs(off);
          self._caps[t.stepId] = self._caps[t.stepId] === undefined ? cap : Math.min(self._caps[t.stepId], cap);
        }
      });
      this._emit('rt-step-start', { stepId: id, time: now });
      if (this._status === 'paused') this.start(); else { this._settle(); this.render(); }
      return true;
    };
    proto.completeStep = function (id) {
      var step = this._steps[id];
      if (!step) return false;
      var a = this._actual[id] || {};
      if (a.end !== undefined) return false;
      var start = a.start !== undefined ? a.start : this._timings()[id].start;
      var d = step.duration || {};
      if (d.type === 'variable' && d.minSeconds !== undefined && this._time - start < R.parseSeconds(d.minSeconds)) return false;
      this._finish(id, this._time, false);
      this._settle();
      this.render();
      return true;
    };
    proto._finish = function (id, at, automatic) {
      var a = this._actual[id] || {};
      if (a.start === undefined) a.start = this._timings()[id].start;
      a.end = Math.max(a.start, at);
      this._actual[id] = a;
      this._emit('rt-step-complete', { stepId: id, time: a.end, automatic: !!automatic });
    };

    // ---- derived state ----------------------------------------------------
    proto._timings = function () {
      if (!this._expanded) return {};
      return R.computeStepTimings(this._expanded, { actual: this._actual, now: this.mode === 'player' ? this._time : undefined });
    };
    proto._states = function (T) {
      var now = this._time, out = {}, self = this;
      this._order.forEach(function (id) {
        var step = self._steps[id], a = self._actual[id] || {}, t = T[id];
        if (!t) return;
        var needsStart = R.stepNeedsStart(step), needsFinish = R.stepNeedsFinish(step);
        if (a.end !== undefined && a.end <= now) { out[id] = 'done'; return; }
        if (a.start === undefined && needsStart) { out[id] = t.start <= now ? 'waiting' : 'pending'; return; }
        if (now < t.start) { out[id] = 'pending'; return; }
        if (needsFinish && a.end === undefined) { out[id] = 'active'; return; }
        out[id] = now >= t.end ? 'done' : 'active';
      });
      return out;
    };

    // ---- rendering --------------------------------------------------------
    proto.formatTime = function (seconds) {
      var s = Math.max(0, Math.floor(seconds)), f = this.timeFormat;
      if (f === 'seconds') return s + 's';
      if (f === 'hours') return Math.floor(s / 3600) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60);
      if (f === 'clock') {
        var base = this.startAt || this._executionStart || new Date();
        var d = new Date(base.getTime() + s * 1000);
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      }
      return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
    };

    proto.render = function () {
      if (!this._wrap) return;
      if (!this._expanded) {
        this._wrap.innerHTML = '<div class="empty">' + (this.hasAttribute('src') ? 'Loading…' : 'No program loaded. Set the <code>program</code> property or a <code>src</code> URL.') + '</div>';
        return;
      }
      var player = this.mode === 'player';
      var T = this._timings();
      var states = player ? this._states(T) : {};
      var width = Math.max(820, this.clientWidth || 0);
      var svg = R.renderTimelineSvg(this._expanded, {
        timings: T, now: player ? this._time : undefined, states: states, width: width
      });
      var html = [];
      if (player) {
        var st = this._status, running = st === 'running';
        html.push('<div class="controls" part="controls">');
        html.push('<button class="' + (running ? '' : 'primary') + '" data-act="' + (running ? 'pause' : 'start') + '">' + (running ? '❚❚ Pause' : (st === 'paused' ? '▶ Resume' : '▶ Start')) + '</button>');
        html.push('<button class="stop" data-act="stop"' + (st === 'stopped' ? ' disabled' : '') + '>■ Stop</button>');
        html.push('<label>Speed <select data-set="speed">' + [0.5, 1, 2, 5, 10, 30, 60].map(function (v) {
          return '<option value="' + v + '"' + (v === this.speed ? ' selected' : '') + '>' + v + '×</option>';
        }, this).join('') + '</select></label>');
        html.push('<div class="clock"><span class="time" part="time">' + esc(this.formatTime(this._time)) + '</span><span class="status" part="status">' + esc(st) + '</span></div>');
        html.push('</div>');
      }
      html.push('<div class="chart" part="chart">' + svg + '</div>');
      if (player) {
        var actions = [], self = this;
        this._order.forEach(function (id) {
          var step = self._steps[id], name = step.name || id;
          if (states[id] === 'waiting') actions.push('<button class="start" data-step-start="' + esc(id) + '">▶ Start: ' + esc(name) + '</button>');
          else if (states[id] === 'active' && R.stepNeedsFinish(step) && !(self._actual[id] && self._actual[id].end !== undefined)) {
            actions.push('<button class="done" data-step-done="' + esc(id) + '">✓ Done: ' + esc(name) + '</button>');
          }
        });
        html.push('<div class="actions" part="actions">' + actions.join('') + (actions.length ? '<span class="hint">Red-dashed bars wait for you to start them; hatched bars run until you mark them done.</span>' : '') + '</div>');
      }
      this._wrap.innerHTML = html.join('');
    };

    proto._onClick = function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      if (b.dataset.act === 'start') this.start();
      else if (b.dataset.act === 'pause') this.pause();
      else if (b.dataset.act === 'stop') this.stop();
      else if (b.dataset.stepStart) this.startStep(b.dataset.stepStart);
      else if (b.dataset.stepDone) this.completeStep(b.dataset.stepDone);
    };
    proto._onChange = function (e) {
      var s = e.target;
      if (s && s.dataset && s.dataset.set === 'speed') this.speed = parseFloat(s.value);
    };
    proto._emit = function (name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail: detail || {}, bubbles: true, composed: true }));
    };

  customElements.define('rhylthyme-timeline', RhylthymeTimeline);
  R.RhylthymeTimeline = RhylthymeTimeline;
}(typeof self !== 'undefined' ? self : this));
