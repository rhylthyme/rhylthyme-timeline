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
 *   data-factors preset answers to the program's declared variance factors, either JSON
 *                ('{"turkeyKg":6.4,"oven":"gas"}') or "turkeyKg=6.4,oven=gas"
 *   no-factor-prompt  present: never show the variance-factor form (presets still recorded)
 *   data-predictions  JSON object of history-based duration predictions, the same shape
 *                as the `predictions` property below
 *
 * Methods
 *   start() pause() stop() toggle() seek(seconds)
 *   startStep(stepId)     the executor begins a manual gate / negative-offset hand-off
 *   completeStep(stepId)  the executor ends an indefinite or triggerable variable step
 *   tick()                advance from the clock (called automatically while running)
 *   setClock(fn, wallFn)  replace the millisecond monotonic clock and, optionally, the
 *                         wall clock used for pause accounting (tests); wallFn defaults to fn
 *   reconcileClock()      compare wall and monotonic clocks now (called on visibilitychange)
 *   askFactors()          open the variance-factor form now (see below); returns false when
 *                         the program declares none
 *
 * Read-only
 *   currentTime, status ("stopped"|"running"|"paused"|"completed"), timings, stepStates, groups
 *   declaredFactors       the program's metadata.varianceFactors, normalised ([] when none)
 *   offsetsUse            "planned" (default) | "predicted", from metadata.offsetsUse
 *   predictedAnchors      {stepId: seconds} — the steps whose negative offset is
 *                         currently being resolved against a PREDICTED anchor end
 *                         rather than the anchor's authored defaultSeconds
 *   runRecord             the run record of the last finished run, or a live snapshot
 *                         (outcome "abandoned") while a run is in progress; null before any run
 *
 * Read/write
 *   factors               the answers to the declared factors, {key: value}. Setting it
 *                         coerces each value against its declared type and silently drops
 *                         the ones that do not fit (and keys the program does not declare),
 *                         exactly as rhylthyme_cli_runner.history.factors.preset_answers does
 *   predictions           history-based duration predictions, {stepId: {seconds, low,
 *                         high, basis}} exactly as predict_durations / analyze_schedule
 *                         return them. They change nothing unless the program sets
 *                         metadata.offsetsUse to "predicted" — see below
 *
 * Events (bubbling, composed; detail carries time and step ids)
 *   rt-start rt-pause rt-stop rt-tick rt-step-start rt-step-complete rt-complete rt-load
 *   rt-factors            detail {factors, skipped, source}: the variance-factor answers,
 *                         once the form is submitted ("prompt") or set programmatically
 *                         ("property" / "attribute"); `skipped` lists the declared keys left
 *                         unanswered
 *   rt-run-record         detail {record, outcome}: a run record (runs schema 0.1.0-alpha)
 *                         emitted once per run, on rt-complete ("completed"), on stop()
 *                         ("aborted") and when the element is removed mid-run ("abandoned")
 *
 * Variance factors: when the program declares metadata.varianceFactors (program schema
 * 0.3.0-alpha), the first start() of a run opens a small form in the shadow DOM instead of
 * starting — one field per factor (number/integer input with its unit, a <select> for enum,
 * text otherwise), every field optional, and a Start button that validates the answers and
 * then starts the run. Answers land in the run record's context.userTags. Skip the form
 * entirely by answering every factor up front (`el.factors = {...}` or data-factors) or with
 * the no-factor-prompt attribute; open it on demand with askFactors(). A program that
 * declares no factors behaves exactly as before.
 *
 * Run records: planned timings are frozen at start() from computeStepTimings(program);
 * actual start/end per step come from the player's wall clock; endedBy is "executor"
 * for completeStep(), "timer" for a variable step's maxSeconds or a fixed duration,
 * "trigger" when a negative-offset hand-off capped the step, "abort" on stop().
 * pausedSeconds per step counts explicit pause() time and wall-clock time the page
 * spent suspended (the wall clock advanced more than the monotonic clock by > 1 s,
 * typically a phone asleep) while the step was running. programVersion is the
 * canonical SHA-256 of the program as set (before replicate expansion), the same
 * hash as tools/hash-program.js and rhylthyme_cli_runner.history.hash.
 *
 * Predicted offsets (metadata.offsetsUse: "predicted", program schema 0.3.0-alpha):
 * a NEGATIVE offset ("peel the potatoes 45 min before the roast is done") has to be
 * resolved against the anchor's PROJECTED end, since nothing can see a future end. The
 * projection is normally the anchor's own defaultSeconds; with offsetsUse "predicted" it
 * is instead `predictions[stepId].seconds`, but only for an INDEFINITE anchor, only when
 * a prediction exists (`basis` other than "none") and only when the prediction is sharper
 * than the guess (high - low < defaultSeconds). It is applied by resolving a program COPY
 * carrying the predicted defaultSeconds, so the plan — frozen into the run record and
 * drawn as the ghost bar — still comes from the program as authored. The run record says
 * which numbers were used: context.offsetsUse, and predictedAnchorSeconds on each gated
 * step. Nothing happens without the flag, whatever is in `predictions`.
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
  var R = root.Rhylthyme;
  if (!R || !R.computeStepTimings) {
    if (typeof customElements === 'undefined') return;
    throw new Error('rhylthyme-timeline element: load src/index.js (the engine) first');
  }

  // ---- canonical program hash --------------------------------------------
  // Twin of tools/hash-program.js and rhylthyme_cli_runner/history/hash.py:
  // keys sorted by code point, no whitespace, UTF-8, integral numbers without
  // a fractional part; "sha256:" + hex digest. Attached to the engine object
  // even where customElements is missing (Node) so parity can be tested.
  function compareCodePoints(a, b) {
    var ia = a[Symbol.iterator](), ib = b[Symbol.iterator]();
    for (;;) {
      var na = ia.next(), nb = ib.next();
      if (na.done && nb.done) return 0;
      if (na.done) return -1;
      if (nb.done) return 1;
      var ca = na.value.codePointAt(0), cb = nb.value.codePointAt(0);
      if (ca !== cb) return ca < cb ? -1 : 1;
    }
  }
  function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    var keys = Object.keys(value).sort(compareCodePoints);
    return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + canonicalJson(value[k]); }).join(',') + '}';
  }
  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.codePointAt(i);
      if (c > 0xffff) i++;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function sha256Hex(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var len = bytes.length, bitLen = len * 8;
    var padLen = ((len + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(padLen);
    buf.set(bytes); buf[len] = 0x80;
    var hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    buf[padLen - 8] = (hi >>> 24) & 255; buf[padLen - 7] = (hi >>> 16) & 255; buf[padLen - 6] = (hi >>> 8) & 255; buf[padLen - 5] = hi & 255;
    buf[padLen - 4] = (lo >>> 24) & 255; buf[padLen - 3] = (lo >>> 16) & 255; buf[padLen - 2] = (lo >>> 8) & 255; buf[padLen - 1] = lo & 255;
    var W = new Uint32Array(64), i;
    for (var off = 0; off < padLen; off += 64) {
      for (i = 0; i < 16; i++) W[i] = (buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) | (buf[off + i * 4 + 2] << 8) | buf[off + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var w15 = W[i - 15], w2 = W[i - 2];
        var s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        var s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + SHA_K[i] + W[i]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }
  function programVersion(program) { return 'sha256:' + sha256Hex(utf8Bytes(canonicalJson(program))); }
  if (!R.programVersion) { R.canonicalJson = canonicalJson; R.programVersion = programVersion; }

  if (typeof customElements === 'undefined') return;
  if (customElements.get('rhylthyme-timeline')) return;

  var RUNS_SCHEMA_VERSION = '0.1.0-alpha';
  var REPLICATE_SUFFIX = /^(.+)-r(\d+)$/;

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
    '.actions .rt-group{width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '.actions .rt-group-label{font-size:12px;font-weight:700;color:var(--rt-muted);letter-spacing:.02em}',
    '.empty{padding:24px;text-align:center;color:var(--rt-muted);font-size:14px}',
    // Variance-factor form: what this run's numbers were, asked once at start.
    '.factors{border:1px solid var(--rt-border);border-radius:10px;background:var(--rt-panel);padding:10px 12px;margin-bottom:8px}',
    '.factors[hidden]{display:none}',
    '.factors h3{margin:0 0 2px;font-size:14px}',
    '.factors .factors-hint{margin:0 0 8px;font-size:12px;color:var(--rt-muted)}',
    '.factors .factor{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:8px}',
    '.factors .factor > span.label{font-size:13px;min-width:180px}',
    '.factors .factor > span.unit{font-size:12px;color:var(--rt-muted)}',
    '.factors input,.factors select{font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--rt-border);background:var(--rt-bg);color:var(--rt-fg);min-height:36px;max-width:220px}',
    '.factors .factor-error{font-size:12px;color:var(--rt-danger);flex-basis:100%}',
    '.factors .factor-error[hidden]{display:none}',
    '.factors button{font:inherit;font-size:14px;font-weight:600;padding:6px 12px;border-radius:8px;border:1px solid var(--rt-accent);background:var(--rt-accent);color:#fff;cursor:pointer;min-height:36px}',
    '@media (max-width:480px){.controls{gap:6px;padding:6px}.controls button{padding:6px 10px;font-size:13px}.clock .time{font-size:17px}.factors .factor > span.label{min-width:0;flex-basis:100%}}'
  ].join('');

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function r3(n) { return Math.round(n * 1000) / 1000; }
  function isoUtc(ms, seconds) {
    var iso = new Date(ms).toISOString();
    return seconds ? iso.replace(/\.\d{3}Z$/, 'Z') : iso;
  }
  function hex4() {
    var n;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) { var u = new Uint16Array(1); crypto.getRandomValues(u); n = u[0]; }
    else n = Math.floor(Math.random() * 65536);
    return ('0000' + n.toString(16)).slice(-4);
  }
  function durationKind(d) {
    if (!d || typeof d !== 'object') return 'fixed';
    if (d.type === 'manual') return 'indefinite';
    return (d.type === 'variable' || d.type === 'indefinite') ? d.type : 'fixed';
  }
  // Predecessors whose end gates the step's start trigger (afterStep / afterStepWithBuffer, compound included).
  function waitedOn(step) {
    var found = [];
    (function visit(t) {
      if (!t || typeof t !== 'object') return;
      if (Array.isArray(t.triggers)) { t.triggers.forEach(visit); return; }
      if ((t.type === 'afterStep' || t.type === 'afterStepWithBuffer') && t.stepId && found.indexOf(t.stepId) < 0) found.push(t.stepId);
    }(step.startTrigger));
    return found;
  }

  // ---- declared variance factors -----------------------------------------
  // Twin of rhylthyme_cli_runner/history/factors.py: the program's
  // metadata.varianceFactors, normalised and deduplicated, and the same
  // type coercion, so the CLI runner and the player record the same values
  // for the same answers.
  var FACTOR_TYPES = ['number', 'integer', 'enum', 'string'];
  function declaredFactors(program) {
    if (!program || typeof program !== 'object') return [];
    var meta = program.metadata;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
    var raw = meta.varianceFactors;
    if (!Array.isArray(raw)) return [];
    var out = [], seen = {};
    raw.forEach(function (item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      var key = item.key;
      if (!key || typeof key !== 'string' || seen[key]) return;
      var kind = FACTOR_TYPES.indexOf(item.type) >= 0 ? item.type : 'string';
      var factor = { key: key, label: String(item.label || key), type: kind };
      if (kind === 'enum') {
        var values = (Array.isArray(item.values) ? item.values : []).map(String);
        if (!values.length) return;
        factor.values = values;
      }
      if (item.unit) factor.unit = String(item.unit);
      out.push(factor);
      seen[key] = true;
    });
    return out;
  }
  // (ok, value, message) — value is what goes into context.userTags.
  function coerceFactor(factor, raw) {
    var kind = (factor && factor.type) || 'string';
    var text = raw === null || raw === undefined ? '' : String(raw).trim();
    if (text === '') return [false, null, 'empty'];
    if (kind === 'number') {
      var num = Number(text);
      if (text === '' || !isFinite(num)) return [false, null, "'" + text + "' is not a number"];
      return [true, num, ''];
    }
    if (kind === 'integer') {
      if (!/^[+-]?\d+$/.test(text)) return [false, null, "'" + text + "' is not an integer"];
      return [true, parseInt(text, 10), ''];
    }
    if (kind === 'enum') {
      var values = factor.values || [];
      for (var i = 0; i < values.length; i++) {
        if (text.toLowerCase() === String(values[i]).toLowerCase()) return [true, values[i], ''];
      }
      return [false, null, "'" + text + "' is not one of " + values.join(', ')];
    }
    return [true, text, ''];
  }
  // ---- predicted offsets (metadata.offsetsUse) ---------------------------
  // Twin of rhylthyme_cli_runner.program_runner.ProgramRunner's
  // _eligible_prediction: a NEGATIVE offset ("peel the potatoes 45 min before
  // the roast is done") has to be resolved against the anchor's PROJECTED end,
  // because nothing can see a future end. The projection is the author's
  // defaultSeconds unless the program opts in with
  // metadata.offsetsUse: "predicted" AND a prediction for that step exists AND
  // the prediction is sharper than the guess (its 80% interval is narrower
  // than defaultSeconds). Nothing else in the drawing changes.
  function offsetsUse(program) {
    var meta = program && program.metadata;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 'planned';
    return meta.offsetsUse === 'predicted' ? 'predicted' : 'planned';
  }
  function finiteNumber(value) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
    var n = Number(value);
    return isFinite(n) ? n : null;
  }
  // {stepId: {seconds, low, high, basis, n}} as predict_durations returns it,
  // with anything unusable dropped rather than half-kept.
  function normalisePredictions(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    var out = {};
    Object.keys(raw).forEach(function (key) {
      var p = raw[key];
      if (!p || typeof p !== 'object' || Array.isArray(p)) return;
      var entry = {
        seconds: finiteNumber(p.seconds),
        low: finiteNumber(p.low),
        high: finiteNumber(p.high),
        basis: typeof p.basis === 'string' ? p.basis : null
      };
      if (p.n !== undefined) entry.n = finiteNumber(p.n);
      out[key] = entry;
    });
    return out;
  }
  // data-predictions: a JSON object, the same shape as the property.
  function parsePredictionsAttribute(text) {
    if (!text) return {};
    try {
      var parsed = JSON.parse(String(text));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (e) { /* an unparseable attribute means no predictions */ }
    return {};
  }

  // data-factors: JSON object, or "turkeyKg=6.4,oven=gas" (as RHYLTHYME_FACTORS).
  function parseFactorAttribute(text) {
    if (!text) return {};
    var trimmed = String(text).trim();
    if (!trimmed) return {};
    if (trimmed.charAt(0) === '{') {
      try {
        var parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
      } catch (e) { /* fall through to key=value */ }
    }
    var out = {};
    trimmed.split(/[,;]/).forEach(function (pair) {
      var at = pair.indexOf('=');
      if (at < 0) return;
      var key = pair.slice(0, at).trim();
      if (key) out[key] = pair.slice(at + 1).trim();
    });
    return out;
  }

  // expandReplicates names instances "Bake tray (2 of 3)"; the player shows
  // the base name once on the group row and "[2 of 3]" on each instance.
  var INSTANCE_NAME = /^(.*?)\s*\((\d+) of (\d+)\)$/;
  function baseName(step) {
    var n = (step && (step.name || step.stepId)) || '';
    var m = step && step.instanceOf ? INSTANCE_NAME.exec(n) : null;
    return m ? m[1] : n;
  }
  function instanceLabel(step, count) {
    if (!step || !step.instanceOf) return '';
    var i = step.instanceIndex;
    if (!i) { var m = INSTANCE_NAME.exec(step.name || ''); if (m) i = +m[2]; }
    if (!i) return '';
    return '[' + i + ' of ' + (count || '?') + ']';
  }
  function instanceName(step, count) {
    var label = instanceLabel(step, count);
    return label ? baseName(step) + ' ' + label : (step && (step.name || step.stepId)) || '';
  }

  class RhylthymeTimeline extends HTMLElement {
    static get observedAttributes() { return ['src', 'mode', 'speed', 'time-format', 'start-at', 'theme', 'view', 'data-factors', 'no-factor-prompt', 'data-predictions']; }
    constructor() {
      super();
      this._program = null;
      this._expanded = null;
      this._steps = {};
      this._order = [];
      this._groupOf = {};
      this._groupOrder = [];
      this._groupMembers = {};
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
      this._wall = function () { return Date.now(); };
      this._lastTickClock = null;
      this._lastTickWall = null;
      this._programVersion = null;
      this._sourceIds = {};
      this._run = null;
      this._runRecord = null;
      this._factorRaw = {};        // answers as supplied (attribute, property, form)
      this._factorAnswers = {};    // ...coerced against the declared factors
      this._factorsAsked = false;  // the form has been shown (and submitted) for this run
      this._factorsOpen = false;   // the form is on screen right now
      this._predictions = {};      // {authored stepId: {seconds, low, high, basis}}
      this._projected = null;      // program copy with predicted defaultSeconds
      this._predictedAnchors = {}; // {gated stepId: seconds used for its anchor}
      this._onVisibility = this._onVisibility.bind(this);
      this._root = this.attachShadow({ mode: 'open' });
      // The factor form lives outside .wrap: render() replaces .wrap wholesale
      // on every tick and would otherwise throw away what the executor typed.
      this._root.innerHTML = '<style>' + CSS + '</style><div class="factors" part="factors" hidden></div><div class="wrap"></div>';
      this._factorsHost = this._root.querySelector('.factors');
      this._wrap = this._root.querySelector('.wrap');
      this._root.addEventListener('click', this._onClick.bind(this));
      this._root.addEventListener('change', this._onChange.bind(this));
    }
  }

    var proto = RhylthymeTimeline.prototype;

    proto.connectedCallback = function () {
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVisibility);
      if (typeof window !== 'undefined') {
        window.addEventListener('pageshow', this._onVisibility);
        window.addEventListener('pagehide', this._onVisibility);
      }
      if (this.hasAttribute('src') && !this._program) this._fetch(this.getAttribute('src'));
      this.render();
    };
    proto.disconnectedCallback = function () {
      this._stopTimer();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pageshow', this._onVisibility);
        window.removeEventListener('pagehide', this._onVisibility);
      }
      if (this._runActive()) this._emitRunRecord('abandoned');
    };
    // Going away (hidden / pagehide) takes a last tick so the sleep gap is
    // measured from the moment the page stopped being awake; coming back
    // (visible / pageshow) reconciles the wall clock against the monotonic one.
    proto._onVisibility = function () { this.reconcileClock(); };
    proto.attributeChangedCallback = function (name, oldV, newV) {
      if (oldV === newV) return;
      if (name === 'src' && newV) this._fetch(newV);
      else if (name === 'data-factors') { this._applyFactors(parseFactorAttribute(newV), 'attribute'); return; }
      else if (name === 'data-predictions') { this.predictions = parsePredictionsAttribute(newV); return; }
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
        if (this._runActive()) this._emitRunRecord('abandoned');
        this._program = p || null;
        this._programVersion = p ? programVersion(p) : null;
        this._sourceIds = {};
        var self = this;
        if (p) {
          (p.tracks || []).forEach(function (t) {
            (t.steps || []).forEach(function (s) { if (s && s.stepId) self._sourceIds[s.stepId] = true; });
          });
        }
        this._expanded = p ? R.expandReplicates(p) : null;
        this._steps = {}; this._order = []; this._groupOf = {}; this._groupOrder = []; this._groupMembers = {};
        if (this._expanded) {
          (this._expanded.tracks || []).forEach(function (t) {
            (t.steps || []).forEach(function (s) {
              if (!s || !s.stepId) return;
              self._steps[s.stepId] = s;
              self._order.push(s.stepId);
              // Replicate instances (stamped by expandReplicates) group under
              // the step they are instances of, so the player shows
              // "Cool on rack ×3" rather than three identical rows.
              var g = s.instanceOf;
              if (!g) return;
              self._groupOf[s.stepId] = g;
              if (!self._groupMembers[g]) { self._groupMembers[g] = []; self._groupOrder.push(g); }
              self._groupMembers[g].push(s.stepId);
            });
          });
          // A group of one is just a step.
          this._groupOrder = this._groupOrder.filter(function (g) {
            if (self._groupMembers[g].length > 1) return true;
            self._groupMembers[g].forEach(function (id) { delete self._groupOf[id]; });
            delete self._groupMembers[g];
            return false;
          });
        }
        this._reset();
        // A new program declares its own factors: re-coerce whatever was
        // supplied against them, so presets survive a program swap and
        // answers to factors this program does not declare fall away.
        this._factorAnswers = this._coerceSupplied(this._factorRaw)[0];
        this._rebuildProjection();
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
    Object.defineProperty(proto, 'groups', { get: function () { return this._groups(this._states(this._timings())); } });
    Object.defineProperty(proto, 'runRecord', {
      get: function () { return this._runActive() ? this._buildRunRecord('abandoned') : this._runRecord; }
    });
    Object.defineProperty(proto, 'declaredFactors', {
      get: function () { return declaredFactors(this._program); }
    });
    Object.defineProperty(proto, 'predictions', {
      get: function () {
        var out = {}, src = this._predictions;
        Object.keys(src).forEach(function (k) {
          var p = src[k], copy = {};
          Object.keys(p).forEach(function (f) { copy[f] = p[f]; });
          out[k] = copy;
        });
        return out;
      },
      set: function (v) {
        this._predictions = normalisePredictions(v);
        this._rebuildProjection();
        this.render();
      }
    });
    // {gated stepId: seconds} — which predicted durations a negative offset
    // is actually being resolved against right now (read-only, for the record
    // and for tests).
    Object.defineProperty(proto, 'predictedAnchors', {
      get: function () {
        var out = {}, src = this._predictedAnchors;
        Object.keys(src).forEach(function (k) { out[k] = src[k]; });
        return out;
      }
    });
    Object.defineProperty(proto, 'offsetsUse', {
      get: function () { return offsetsUse(this._program); }
    });
    Object.defineProperty(proto, 'factors', {
      get: function () {
        var out = {}, src = this._factorAnswers;
        Object.keys(src).forEach(function (k) { out[k] = src[k]; });
        return out;
      },
      set: function (v) { this._applyFactors(v, 'property'); }
    });

    // ---- declared variance factors ----------------------------------------
    // Coerce a {key: raw} map against the program's declared factors; keys the
    // program does not declare, and values that do not fit their type, are
    // dropped (with a reason) rather than recorded, so context.userTags only
    // ever holds answers the author asked for.
    proto._coerceSupplied = function (supplied) {
      var factors = this.declaredFactors, byKey = {}, answers = {}, problems = [];
      factors.forEach(function (f) { byKey[f.key] = f; });
      Object.keys(supplied || {}).forEach(function (key) {
        var factor = byKey[key];
        if (!factor) { problems.push(key + ': not declared by this program, ignored'); return; }
        var res = coerceFactor(factor, supplied[key]);
        if (res[0]) answers[key] = res[1];
        else problems.push(key + ': ' + res[2] + ', ignored');
      });
      return [answers, problems];
    };
    proto._applyFactors = function (supplied, source) {
      var raw = {}, self = this;
      Object.keys(supplied || {}).forEach(function (k) { raw[k] = supplied[k]; });
      this._factorRaw = raw;
      var coerced = this._coerceSupplied(raw);
      this._factorAnswers = coerced[0];
      if (this._run) this._run.userTags = this.factors;
      this._renderFactorForm();
      var skipped = this.declaredFactors
        .map(function (f) { return f.key; })
        .filter(function (k) { return self._factorAnswers[k] === undefined; });
      this._emit('rt-factors', { factors: this.factors, skipped: skipped, source: source || 'property' });
      return this.factors;
    };
    /** Open the variance-factor form. Returns false when there is nothing to ask. */
    proto.askFactors = function () {
      if (!this.declaredFactors.length) return false;
      this._factorsOpen = true;
      this._renderFactorForm();
      return true;
    };
    proto._needsFactorPrompt = function () {
      if (this.mode === 'static' || this._factorsAsked) return false;
      if (this.hasAttribute('no-factor-prompt')) return false;
      var answers = this._factorAnswers;
      return this.declaredFactors.some(function (f) { return answers[f.key] === undefined; });
    };
    proto._renderFactorForm = function () {
      var host = this._factorsHost;
      if (!host) return;
      var factors = this.declaredFactors;
      if (!this._factorsOpen || !factors.length) { host.hidden = true; host.innerHTML = ''; return; }
      var answers = this._factorAnswers, raw = this._factorRaw, html = [];
      html.push('<h3>Before you start</h3>');
      html.push('<p class="factors-hint">This program asks what is different about this run, so the times it records can be compared with others. Leave anything blank to skip it.</p>');
      factors.forEach(function (f) {
        var value = answers[f.key] !== undefined ? answers[f.key] : (raw[f.key] !== undefined ? raw[f.key] : '');
        html.push('<label class="factor" data-factor-row="' + esc(f.key) + '">');
        html.push('<span class="label">' + esc(f.label || f.key) + '</span>');
        if (f.type === 'enum') {
          html.push('<select data-factor="' + esc(f.key) + '"><option value="">— skip —</option>');
          (f.values || []).forEach(function (v) {
            html.push('<option value="' + esc(v) + '"' + (String(value) === String(v) ? ' selected' : '') + '>' + esc(v) + '</option>');
          });
          html.push('</select>');
        } else {
          // Numbers use a text input with a numeric keypad rather than
          // type="number": the browser silently discards anything it cannot
          // parse, which would turn a mistyped answer into a skipped factor
          // with nothing said. Our own check names what was wrong instead.
          var numeric = f.type === 'number' || f.type === 'integer';
          html.push('<input type="text" autocomplete="off"' +
            (numeric ? ' inputmode="' + (f.type === 'integer' ? 'numeric' : 'decimal') + '"' : '') +
            ' data-factor="' + esc(f.key) + '" value="' + esc(value) + '">');
          if (f.unit) html.push('<span class="unit">' + esc(f.unit) + '</span>');
        }
        html.push('<span class="factor-error" data-factor-error="' + esc(f.key) + '" hidden></span>');
        html.push('</label>');
      });
      html.push('<button data-act="factors-start">▶ Start</button>');
      host.innerHTML = html.join('');
      host.hidden = false;
    };
    // The form's Start button: validate what was typed, record it, run.
    proto._submitFactors = function () {
      var host = this._factorsHost;
      if (!host) return false;
      var supplied = {}, fields = host.querySelectorAll('[data-factor]');
      Array.prototype.forEach.call(fields, function (field) {
        var text = String(field.value == null ? '' : field.value).trim();
        if (text !== '') supplied[field.getAttribute('data-factor')] = text;
      });
      var byKey = {};
      this.declaredFactors.forEach(function (f) { byKey[f.key] = f; });
      // Clear last attempt's messages, including on fields since cleared.
      Array.prototype.forEach.call(host.querySelectorAll('[data-factor-error]'), function (slot) {
        slot.textContent = ''; slot.hidden = true;
      });
      var answers = {}, bad = 0;
      Object.keys(supplied).forEach(function (key) {
        var res = coerceFactor(byKey[key], supplied[key]);
        var slot = host.querySelector('[data-factor-error="' + key + '"]');
        if (res[0]) {
          answers[key] = res[1];
          if (slot) { slot.textContent = ''; slot.hidden = true; }
        } else {
          bad++;
          if (slot) { slot.textContent = res[2]; slot.hidden = false; }
        }
      });
      if (bad) return false;   // stay open; the executor fixes or clears the field
      this._factorRaw = supplied;
      this._factorAnswers = answers;
      this._factorsAsked = true;
      this._factorsOpen = false;
      this._renderFactorForm();
      var skipped = this.declaredFactors
        .map(function (f) { return f.key; })
        .filter(function (k) { return answers[k] === undefined; });
      this._emit('rt-factors', { factors: this.factors, skipped: skipped, source: 'prompt' });
      this.start();
      return true;
    };

    proto.setClock = function (fn, wallFn) {
      this._clock = fn;
      this._wall = wallFn || fn;
      this._lastTickClock = null; this._lastTickWall = null;
      this._reanchor();
    };

    // ---- transport --------------------------------------------------------
    proto.start = function () {
      if (!this._program || this._status === 'running' || this.mode === 'static') return;
      if (this._status === 'stopped' || this._status === 'completed') {
        // A program that declares variance factors asks for them once, here,
        // instead of starting; the form's Start button calls back into start().
        if (this._needsFactorPrompt()) { this.askFactors(); return; }
        if (this._status === 'completed') this._reset();
        this._executionStart = new Date();
        this._beginRun();
      } else if (this._status === 'paused') {
        this._settlePause();
      }
      this._status = 'running';
      this._lastTickClock = null; this._lastTickWall = null;
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
      if (this._run) { this._run.pauseWall = this._wall(); this._run.pausedRunning = this._activeIds(); }
      this.render();
      this._emit('rt-pause', { time: this._time });
    };
    proto.stop = function () {
      if (this._status === 'stopped') return;
      this._stopTimer();
      if (this._runActive()) this._emitRunRecord('aborted');
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
      this._completedAt = null; this._executionStart = null; this._run = null;
      // Answers stay as presets for the next run; the question is asked again.
      this._factorsAsked = false; this._factorsOpen = false;
      this._renderFactorForm();
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
      var c = this._clock(), w = this._wall();
      this._time = this._anchorTime + Math.max(0, (c - this._anchorWall) / 1000) * this.speed;
      // Wall vs monotonic reconciliation: while a phone sleeps the monotonic
      // clock (and so program time) stands still but the wall clock does not.
      // The difference is a pause of every step that was running.
      if (this._run && this._lastTickClock !== null) {
        var gap = (w - this._lastTickWall) / 1000 - (c - this._lastTickClock) / 1000;
        if (gap > 1) { this._attributePause(gap, this._activeIds()); this._reanchor(); }
      }
      this._lastTickClock = c; this._lastTickWall = w;
      if (this._run && this._run.speeds.indexOf(this.speed) < 0) this._run.speeds.push(this.speed);
      this._settle();
      this.render();
      this._emit('rt-tick', { time: this._time });
    };
    /** Compare the wall and monotonic clocks now (visibilitychange / pageshow); a tick while running. */
    proto.reconcileClock = function () { if (this._status === 'running') this.tick(); };

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
            self._noteTrigger(id, t.start);
          }
          if (a.start !== undefined && a.end === undefined) {
            var d = step.duration || {};
            if (d.type === 'variable' && d.maxSeconds !== undefined && now >= a.start + R.parseSeconds(d.maxSeconds)) {
              self._finish(id, a.start + R.parseSeconds(d.maxSeconds), true, 'timer'); changed = true;
            } else if (self._caps[id] !== undefined && now >= self._caps[id]) {
              self._finish(id, self._caps[id], true, 'trigger'); changed = true;
            }
          }
        });
      }
      var states = this._states(this._timings());
      if (this._run) {
        // A manual gate's trigger fires when its predecessors are done, not when the executor starts it.
        var unfloated = null;
        this._order.forEach(function (id) {
          if (states[id] !== 'waiting' || (self._run.meta[id] && self._run.meta[id].triggerFiredAt !== undefined)) return;
          if (!unfloated) unfloated = R.computeStepTimings(self._resolved(), { actual: self._actual });
          if (unfloated[id]) self._noteTrigger(id, Math.min(unfloated[id].start, now));
        });
      }
      var allDone = this._order.length > 0 && this._order.every(function (id) { return states[id] === 'done'; });
      if (allDone) {
        if (this._completedAt === null) this._completedAt = now;
        if (this._status === 'running' && now >= this._completedAt + 3) {
          this._status = 'completed';
          this._stopTimer();
          this._emit('rt-complete', { time: this._completedAt });
          if (this._runActive()) this._emitRunRecord('completed');
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
      this._noteTrigger(id, now);
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
      this._finish(id, this._time, false, 'executor');
      this._settle();
      this.render();
      return true;
    };
    proto._finish = function (id, at, automatic, endedBy) {
      var a = this._actual[id] || {};
      if (a.start === undefined) { a.start = this._timings()[id].start; this._noteTrigger(id, a.start); }
      a.end = Math.max(a.start, at);
      this._actual[id] = a;
      if (this._run) { var m = this._run.meta[id] || (this._run.meta[id] = {}); m.endedBy = endedBy || (automatic ? 'timer' : 'executor'); }
      this._emit('rt-step-complete', { stepId: id, time: a.end, automatic: !!automatic });
    };

    // ---- run records --------------------------------------------------------
    proto._runActive = function () { return !!(this._run && !this._run.recorded && this._executionStart); };
    proto._beginRun = function () {
      var wall = this._wall();
      this._run = {
        startedWall: wall,
        runId: isoUtc(wall, true) + '-' + hex4(),
        planned: this._freezePlanned(),
        meta: {}, paused: {}, pauseWall: null, pausedRunning: [],
        speeds: [this.speed], recorded: false,
        // Answers to the declared variance factors, frozen for this run and
        // merged into the record's context by _context().
        userTags: this.factors,
        // Which durations negative offsets resolve against for this run, and
        // the predicted seconds each gated step used (Phase 7).
        offsetsUse: offsetsUse(this._program),
        predictedAnchors: this.predictedAnchors
      };
    };
    proto._freezePlanned = function () {
      var T = R.computeStepTimings(this._expanded), planned = {}, self = this;
      this._order.forEach(function (id) {
        var step = self._steps[id], d = step.duration, t = T[id];
        if (!t) return;
        var kind = durationKind(d);
        var p = { start: r3(t.start), end: r3(t.end), durationType: kind };
        if (kind === 'fixed') p.seconds = r3(t.end - t.start);
        if (d && typeof d === 'object') {
          ['minSeconds', 'maxSeconds', 'defaultSeconds'].forEach(function (k) {
            if (d[k] !== undefined && d[k] !== null) p[k] = r3(R.parseSeconds(d[k]));
          });
        }
        planned[id] = p;
      });
      return planned;
    };
    proto._noteTrigger = function (id, at) {
      if (!this._run) return;
      var m = this._run.meta[id] || (this._run.meta[id] = {});
      if (m.triggerFiredAt === undefined) m.triggerFiredAt = at;
    };
    proto._activeIds = function () {
      var st = this._states(this._timings());
      return this._order.filter(function (id) { return st[id] === 'active'; });
    };
    proto._attributePause = function (seconds, ids) {
      if (!this._run || !(seconds > 0)) return;
      var paused = this._run.paused;
      ids.forEach(function (id) { paused[id] = (paused[id] || 0) + seconds; });
    };
    proto._settlePause = function () {
      if (!this._run || this._run.pauseWall === null) return;
      this._attributePause((this._wall() - this._run.pauseWall) / 1000, this._run.pausedRunning);
      this._run.pauseWall = null; this._run.pausedRunning = [];
    };
    proto._identity = function (step) {
      if (step.instanceOf && step.instanceIndex !== undefined && step.instanceIndex !== null) {
        var n = parseInt(step.instanceIndex, 10);
        if (isFinite(n) && n >= 1) return [String(step.instanceOf), n];
      }
      var m = REPLICATE_SUFFIX.exec(step.stepId);
      if (m && this._sourceIds[m[1]] && !this._sourceIds[step.stepId]) return [m[1], parseInt(m[2], 10)];
      return [step.stepId, 1];
    };
    proto._context = function () {
      var p = this._program || {}, ctx = {};
      if (p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata)) {
        try { ctx = JSON.parse(JSON.stringify(p.metadata)); } catch (e) { ctx = {}; }
      }
      if (p.environmentType && ctx.environmentType === undefined) ctx.environmentType = p.environmentType;
      if (p.sourceUrl && ctx.sourceUrl === undefined) ctx.sourceUrl = p.sourceUrl;
      var tags = {};
      if (ctx.userTags && typeof ctx.userTags === 'object' && !Array.isArray(ctx.userTags)) {
        Object.keys(ctx.userTags).forEach(function (k) {
          var v = ctx.userTags[k];
          if (v === null || ['string', 'number', 'boolean'].indexOf(typeof v) >= 0) tags[k] = v;
        });
      }
      // This run's answers to the declared variance factors win over anything
      // the author happened to leave in metadata.userTags.
      var answered = (this._run && this._run.userTags) || {};
      Object.keys(answered).forEach(function (k) { tags[k] = answered[k]; });
      ctx.userTags = tags;
      ctx.offsetsUse = (this._run && this._run.offsetsUse) || offsetsUse(this._program);
      return ctx;
    };
    proto._buildRunRecord = function (outcome) {
      var run = this._run, self = this, now = this._time;
      if (!run) return null;
      var T = R.computeStepTimings(this._resolved(), { actual: this._actual, now: now });
      var pending = run.pauseWall !== null ? Math.max(0, (this._wall() - run.pauseWall) / 1000) : 0;
      var steps = this._order.map(function (id) {
        var step = self._steps[id], ident = self._identity(step), meta = run.meta[id] || {};
        var entry = { stepId: ident[0], instance: ident[1], planned: run.planned[id] || { start: 0, end: 0, durationType: durationKind(step.duration) } };
        var w = waitedOn(step);
        if (w.length) entry.waitedOn = w;
        var paused = run.paused[id] || 0;
        if (run.pausedRunning.indexOf(id) >= 0) paused += pending;
        entry.pausedSeconds = r3(paused);
        // Which number this step's negative offset actually fired from, when
        // it was a prediction rather than the anchor's authored defaultSeconds.
        if (run.predictedAnchors && run.predictedAnchors[id] !== undefined) {
          entry.predictedAnchorSeconds = r3(run.predictedAnchors[id]);
        }
        var a = self._actual[id], actual = null, endedBy = meta.endedBy, t = T[id];
        if (a && a.start !== undefined) {
          actual = { start: a.start };
          if (a.end !== undefined) { actual.end = a.end; endedBy = endedBy || 'executor'; }
        } else if (t && !R.stepNeedsStart(step) && !R.stepNeedsFinish(step) && t.start <= now) {
          // Engine-driven step (fixed, or variable without a trigger): it ran on the timer.
          actual = { start: t.start };
          if (t.end <= now) { actual.end = t.end; endedBy = 'timer'; }
        }
        if (actual && actual.end === undefined && outcome === 'aborted') { actual.end = Math.max(actual.start, now); endedBy = 'abort'; }
        if (actual) {
          entry.actual = { start: r3(Math.max(0, actual.start)) };
          if (actual.end !== undefined) { entry.actual.end = r3(Math.max(entry.actual.start, actual.end)); entry.endedBy = endedBy; }
          var fired = meta.triggerFiredAt !== undefined ? meta.triggerFiredAt : actual.start;
          entry.triggerFiredAt = r3(Math.max(0, Math.min(fired, actual.start)));
        }
        return entry;
      });
      var p = this._program || {};
      var speeds = run.speeds.slice(); if (speeds.indexOf(this.speed) < 0) speeds.push(this.speed);
      return {
        schemaVersion: RUNS_SCHEMA_VERSION,
        runId: run.runId,
        programId: String(p.programId || p.name || 'program'),
        programVersion: this._programVersion,
        runtime: { kind: 'web', version: String(R.version || 'unknown'), clockMode: 'wall', speed: Math.max.apply(null, speeds) },
        environmentId: typeof p.environment === 'string' ? p.environment : null,
        startedAt: isoUtc(run.startedWall),
        endedAt: isoUtc(this._wall()),
        outcome: outcome,
        context: this._context(),
        steps: steps
      };
    };
    proto._emitRunRecord = function (outcome) {
      var record = this._buildRunRecord(outcome);
      if (!record) return null;
      this._run.recorded = true;
      this._runRecord = record;
      this._emit('rt-run-record', { record: record, outcome: outcome });
      return record;
    };

    // ---- predicted offsets ------------------------------------------------
    // The engine has no notion of a prediction: it projects an unfinished
    // step's end as start + defaultSeconds. So a program COPY carrying the
    // predicted defaultSeconds is what gets resolved, and the plan
    // (_freezePlanned, and the ghost bars a page draws from
    // computeStepTimings(program)) still comes from the program as authored.
    proto._rebuildProjection = function () {
      this._projected = null;
      this._predictedAnchors = {};
      if (!this._expanded || offsetsUse(this._program) !== 'predicted') return;
      var self = this, predictions = this._predictions, gatedBy = {};
      // Which steps a negative offset hangs off, and what it gates.
      this._order.forEach(function (id) {
        var step = self._steps[id], trig = (step && step.startTrigger) || {};
        var list = (trig.logic && Array.isArray(trig.triggers)) ? trig.triggers : [trig];
        list.forEach(function (t) {
          if (!t || !t.stepId) return;
          if (t.type !== 'afterStep' && t.type !== 'afterStepWithBuffer') return;
          if (R.parseSeconds(t.offsetSeconds) >= 0) return;
          (gatedBy[t.stepId] || (gatedBy[t.stepId] = [])).push(id);
        });
      });
      var substitutions = {}, any = false;
      Object.keys(gatedBy).forEach(function (anchorId) {
        var anchor = self._steps[anchorId];
        if (!anchor) return;
        var d = anchor.duration;
        if (!d || typeof d !== 'object' || d.type !== 'indefinite') return;
        var planned = d.defaultSeconds === undefined || d.defaultSeconds === null
          ? null : R.parseSeconds(d.defaultSeconds);
        if (!planned) return;
        var authored = anchor.instanceOf || anchorId;
        var p = predictions[authored] || predictions[anchorId];
        if (!p || !p.basis || p.basis === 'none') return;
        if (p.seconds === null || !(p.seconds > 0)) return;
        if (p.low === null || p.high === null) return;
        if (!((p.high - p.low) < planned)) return;
        substitutions[anchorId] = p.seconds;
        any = true;
        gatedBy[anchorId].forEach(function (gid) { self._predictedAnchors[gid] = p.seconds; });
      });
      if (!any) return;
      var copy = JSON.parse(JSON.stringify(this._expanded));
      (copy.tracks || []).forEach(function (t) {
        (t.steps || []).forEach(function (step) {
          if (!step || substitutions[step.stepId] === undefined) return;
          if (!step.duration || typeof step.duration !== 'object') return;
          step.duration.defaultSeconds = substitutions[step.stepId];
        });
      });
      this._projected = copy;
    };
    // The program the resolver sees: the projection when predicted offsets are
    // on and a prediction qualified, the expanded program otherwise.
    proto._resolved = function () { return this._projected || this._expanded; };

    // ---- derived state ----------------------------------------------------
    proto._timings = function () {
      if (!this._expanded) return {};
      return R.computeStepTimings(this._resolved(), { actual: this._actual, now: this.mode === 'player' ? this._time : undefined });
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

    // Replicate-instance groups: one entry per replicated step, with the
    // status tally a step list needs to draw "Cool on rack ×3 — 1 done".
    proto._groups = function (states) {
      var self = this;
      return this._groupOrder.map(function (id) {
        var members = self._groupMembers[id];
        var tally = { done: 0, running: 0, waiting: 0, pending: 0 };
        members.forEach(function (sid) {
          var st = states[sid];
          if (st === 'done') tally.done++;
          else if (st === 'active') tally.running++;
          else if (st === 'waiting') tally.waiting++;
          else tally.pending++;
        });
        return {
          instanceOf: id,
          name: baseName(self._steps[members[0]]),
          count: members.length,
          done: tally.done,
          running: tally.running,
          waiting: tally.waiting,
          pending: tally.pending,
          stepIds: members.slice()
        };
      });
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
        // Actions are grouped by instanceOf so three trays read as one
        // "Cool on rack ×3" row with an instance-labelled button each.
        var groups = this._groups(states), byId = {}, self = this;
        groups.forEach(function (g) { byId[g.instanceOf] = g; });
        var actions = [], open = null, count = 0;
        var flush = function () { if (open) { actions.push('</div>'); open = null; } };
        this._order.forEach(function (id) {
          var step = self._steps[id], g = self._groupOf[id];
          var name = g ? instanceName(step, byId[g].count) : (step.name || id);
          var button = null;
          if (states[id] === 'waiting') button = '<button class="start" data-step-start="' + esc(id) + '">▶ Start: ' + esc(name) + '</button>';
          else if (states[id] === 'active' && R.stepNeedsFinish(step) && !(self._actual[id] && self._actual[id].end !== undefined)) {
            button = '<button class="done" data-step-done="' + esc(id) + '">✓ Done: ' + esc(name) + '</button>';
          }
          if (!button) return;
          if (g !== open) {
            flush();
            if (g) {
              var grp = byId[g];
              open = g;
              actions.push('<div class="rt-group" data-group="' + esc(g) + '"><span class="rt-group-label">' + esc(grp.name) + ' ×' + grp.count + ' — ' + grp.done + ' done</span>');
            }
          }
          actions.push(button);
          count++;
        });
        flush();
        html.push('<div class="actions" part="actions">' + actions.join('') + (count ? '<span class="hint">Red-dashed bars wait for you to start them; hatched bars run until you mark them done.</span>' : '') + '</div>');
      }
      this._wrap.innerHTML = html.join('');
    };

    proto._onClick = function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      if (b.dataset.act === 'factors-start') this._submitFactors();
      else if (b.dataset.act === 'start') this.start();
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
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this)));
