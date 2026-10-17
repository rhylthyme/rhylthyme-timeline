/*!
 * rhylthyme floating toolbars — tear-away palettes for the web shell's
 * action bar (#program-actions in app.py) and the player's view bar
 * (#view-toggle-bar in web_visualizer.py).
 *
 * Behaviour (drag engine version 2):
 *   - one Pointer Events path for mouse, pen and touch; the pressed element
 *     captures the pointer, and every iframe in the document stops taking
 *     pointer events while a drag runs, so moves over an embedded player
 *     keep arriving. Release always ends the drag (pointerup, pointercancel,
 *     lostpointercapture, window blur, a buttonless mouse move); Escape
 *     cancels and returns the bar to where it started;
 *   - a press becomes a drag after THRESHOLD px, so clicks stay clicks. The
 *     grip and the bar's empty padding drag; buttons inside never do;
 *   - the bar moves with transform: translate3d() from a requestAnimationFrame
 *     loop (no layout per move) and is committed to CSS edge offsets on
 *     release, "lifted" (scale 1.01 and a deeper shadow) while held;
 *   - magnetic SNAP px to the viewport edges (inset GAP) and to the other
 *     bars, including bars in a parent page or child frame (rects are
 *     converted through the iframe's position); release eases into place
 *     over SETTLE_MS unless prefers-reduced-motion asks for none;
 *   - the position is an anchor {h:'left'|'right', x, v:'top'|'bottom', y}:
 *     the offset from the nearest viewport edges. A bar keeps that edge
 *     through window and bar resizes; one that no longer fits is clamped
 *     on screen without losing the saved anchor. The old {left, top} format
 *     is read and converted;
 *   - with `vertical: true` the bar turns vertical (class is-vertical) when
 *     docked to the left or right edge and not to the top or bottom;
 *   - double-clicking the grip animates back to the CSS default.
 *
 * Embedders get window.rhylthymeToolbars = {version, reset(name),
 * setVisible(name, bool), rects(), get(name)} and data-rhylthyme-drag="2"
 * on each bar, so a host that injects its own drag engine can stand down.
 *
 * The file is inlined verbatim into the player page (the
 * `_FLOATING_TOOLBARS_JS` template slot) and into the shell, so it must stay
 * dependency-free. The pure geometry is exported for
 * rhylthyme-server/tests/js/floating-toolbars.test.js (npm test).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RhylthymeFloatingToolbars = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 2;
  var GAP = 8;          // inset of the edge snap lines; offsets <= GAP are "docked"
  var SNAP = 10;        // magnetic radius, px
  var THRESHOLD = 3;    // px of travel before a press becomes a drag
  var PAD = 4;          // minimum on-screen inset when clamping
  var SETTLE_MS = 120;  // release ease
  var RESET_MS = 220;   // double-click / Escape return
  var LIFT_SCALE = 1.01;
  var NARROW_QUERY = '(max-width: 768px)';
  var INTERACTIVE = 'button, a, input, select, textarea, label, summary, [role="button"], [contenteditable=""], [contenteditable="true"]';

  // ---------------------------------------------------------------------
  // Pure geometry (unit-tested in Node)

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function clamp(v, lo, hi) {
    if (hi < lo) return lo;
    return v < lo ? lo : v > hi ? hi : v;
  }

  /** Keep a w x h box at least PAD px inside a vw x vh viewport. */
  function clampPosition(left, top, w, h, vw, vh, pad) {
    var p = isNum(pad) ? pad : PAD;
    return { left: clamp(left, p, vw - w - p), top: clamp(top, p, vh - h - p) };
  }

  function nearest(value, candidates, dist) {
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var d = Math.abs(candidates[i].v - value);
      if (d <= dist && (!best || d < best.d)) best = { v: candidates[i].v, kind: candidates[i].kind, d: d };
    }
    return best;
  }

  /**
   * Magnetic snap of a w x h box whose top-left is (left, top). Snap lines
   * are the viewport edges (GAP inset) and each peer rect's edges: aligned
   * with it, or GAP away beside it when the two overlap on the other axis.
   * Returns {left, top, x, y}; x/y name the line that won ('left', 'right',
   * 'top', 'bottom', 'peer') or are null when that axis is free.
   */
  function snapPosition(left, top, w, h, vw, vh, peers, options) {
    var o = options || {};
    var gap = isNum(o.gap) ? o.gap : GAP;
    var dist = isNum(o.snap) ? o.snap : SNAP;
    var xs = [{ v: gap, kind: 'left' }, { v: vw - w - gap, kind: 'right' }];
    var ys = [{ v: gap, kind: 'top' }, { v: vh - h - gap, kind: 'bottom' }];
    (peers || []).forEach(function (p) {
      if (!p || !(p.right > p.left) || !(p.bottom > p.top)) return;
      var overlapY = top < p.bottom + gap + dist && top + h > p.top - gap - dist;
      var overlapX = left < p.right + gap + dist && left + w > p.left - gap - dist;
      if (overlapY) {
        xs.push({ v: p.left, kind: 'peer' }, { v: p.right - w, kind: 'peer' },
          { v: p.right + gap, kind: 'peer' }, { v: p.left - gap - w, kind: 'peer' });
      }
      if (overlapX) {
        ys.push({ v: p.top, kind: 'peer' }, { v: p.bottom - h, kind: 'peer' },
          { v: p.bottom + gap, kind: 'peer' }, { v: p.top - gap - h, kind: 'peer' });
      }
    });
    var bx = nearest(left, xs, dist);
    var by = nearest(top, ys, dist);
    return { left: bx ? bx.v : left, top: by ? by.v : top, x: bx ? bx.kind : null, y: by ? by.kind : null };
  }

  /** The anchor (nearest edges + offsets) for a box at (left, top). */
  function anchorFor(left, top, w, h, vw, vh) {
    var hEdge = left + w / 2 <= vw / 2 ? 'left' : 'right';
    var vEdge = top + h / 2 <= vh / 2 ? 'top' : 'bottom';
    return {
      h: hEdge,
      x: Math.round(hEdge === 'left' ? left : vw - left - w),
      v: vEdge,
      y: Math.round(vEdge === 'top' ? top : vh - top - h)
    };
  }

  function isAnchor(a) {
    return !!a && (a.h === 'left' || a.h === 'right') && (a.v === 'top' || a.v === 'bottom') && isNum(a.x) && isNum(a.y);
  }

  /** Unclamped top-left of a w x h box placed by an anchor. */
  function positionFor(anchor, w, h, vw, vh) {
    return {
      left: anchor.h === 'left' ? anchor.x : vw - w - anchor.x,
      top: anchor.v === 'top' ? anchor.y : vh - h - anchor.y
    };
  }

  /**
   * Read a saved position in any format: an anchor (kept), the pre-v2
   * {left, top} viewport pixels (converted against the current viewport),
   * or anything else (null = CSS default).
   */
  function normalizeSaved(saved, w, h, vw, vh) {
    if (!saved || typeof saved !== 'object') return null;
    if (isAnchor(saved)) return { h: saved.h, x: saved.x, v: saved.v, y: saved.y };
    if (isNum(saved.left) && isNum(saved.top)) {
      var c = clampPosition(saved.left, saved.top, w, h, vw, vh);
      return anchorFor(c.left, c.top, w, h, vw, vh);
    }
    return null;
  }

  function dockedH(anchor, gap) { return !!anchor && anchor.x <= (isNum(gap) ? gap : GAP) + 0.5; }
  function dockedV(anchor, gap) { return !!anchor && anchor.y <= (isNum(gap) ? gap : GAP) + 0.5; }

  /** 'vertical' when docked to a side edge but not into a corner. */
  function orientationFor(anchor, gap) {
    return dockedH(anchor, gap) && !dockedV(anchor, gap) ? 'vertical' : 'horizontal';
  }

  /**
   * Where an anchored bar is drawn: the anchor's offsets, reduced only as
   * far as needed to keep the bar on screen. Returns CSS edge offsets.
   */
  function placeAnchor(anchor, w, h, vw, vh, pad) {
    var p = isNum(pad) ? pad : PAD;
    return {
      h: anchor.h, x: clamp(anchor.x, p, vw - w - p),
      v: anchor.v, y: clamp(anchor.y, p, vh - h - p)
    };
  }

  function offsetRect(r, dx, dy) {
    return { left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy, width: r.right - r.left, height: r.bottom - r.top, name: r.name };
  }

  function percentile(values, q) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  }

  // ---------------------------------------------------------------------
  // Registry: window.rhylthymeToolbars

  function childFrames(win) {
    var out = [];
    try {
      var frames = win.document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) out.push(frames[i]);
    } catch (e) { /* ignore */ }
    return out;
  }

  function frameApi(frame) {
    try {
      var api = frame.contentWindow && frame.contentWindow.rhylthymeToolbars;
      return api && api.version >= 2 ? api : null;
    } catch (e) { return null; } // cross-origin
  }

  function registry(win) {
    var api = win.rhylthymeToolbars;
    if (api && api._bars) return api;
    var bars = {};
    var forward = function (method, args) {
      childFrames(win).forEach(function (f) {
        var a = frameApi(f);
        if (a && typeof a[method] === 'function') {
          try { a[method].apply(a, args); } catch (e) { /* ignore */ }
        }
      });
    };
    api = {
      version: VERSION,
      _bars: bars,
      /** Return one bar (or every bar when name is omitted) to its default spot. */
      reset: function (name) {
        var found = false;
        Object.keys(bars).forEach(function (n) {
          if (!name || n === name) { found = true; bars[n].reset(); }
        });
        if (!name || !found) forward('reset', [name]);
        return found;
      },
      /** Force a bar hidden (false) or back under the page's own control (true). */
      setVisible: function (name, visible) {
        if (bars[name]) { bars[name].setVisible(visible); return true; }
        forward('setVisible', [name, visible]);
        return false;
      },
      /** Rects of this document's visible bars, in its viewport coordinates. */
      rects: function () {
        var out = [];
        Object.keys(bars).forEach(function (n) {
          var r = bars[n].rect();
          if (r) out.push(r);
        });
        return out;
      },
      get: function (name) { return bars[name] || null; },
      names: function () { return Object.keys(bars); }
    };
    try { win.rhylthymeToolbars = api; } catch (e) { /* ignore */ }
    return api;
  }

  /** Bars in other documents (child frames, parent page), in win's viewport. */
  function foreignRects(win) {
    var out = [];
    childFrames(win).forEach(function (f) {
      var a = frameApi(f);
      if (!a || typeof a.rects !== 'function') return;
      try {
        var fr = f.getBoundingClientRect();
        a.rects().forEach(function (r) { out.push(offsetRect(r, fr.left + f.clientLeft, fr.top + f.clientTop)); });
      } catch (e) { /* ignore */ }
    });
    try {
      var fe = win.frameElement;
      var pa = win.parent && win.parent !== win ? win.parent.rhylthymeToolbars : null;
      if (fe && pa && pa.version >= 2 && typeof pa.rects === 'function') {
        var r0 = fe.getBoundingClientRect();
        pa.rects().forEach(function (r) { out.push(offsetRect(r, -(r0.left + fe.clientLeft), -(r0.top + fe.clientTop))); });
      }
    } catch (e) { /* cross-origin parent, or standalone */ }
    return out;
  }

  // ---------------------------------------------------------------------
  // DOM controller

  var STYLE_ID = 'rhylthyme-floating-toolbars-style';
  var CSS = [
    '@media (min-width:769px){.rhy-floating{touch-action:none;}}',
    '.rhy-floating.rhy-lifted{box-shadow:0 22px 48px -12px rgba(15,23,42,.40),0 8px 20px rgba(15,23,42,.18)!important;}',
    'html.dark .rhy-floating.rhy-lifted{box-shadow:0 22px 48px -10px rgba(0,0,0,.75),0 8px 20px rgba(0,0,0,.50)!important;}',
    'html.cookbook .rhy-floating.rhy-lifted,html.cookbook-mode .rhy-floating.rhy-lifted{box-shadow:0 22px 48px -12px rgba(74,52,30,.42),0 8px 20px rgba(74,52,30,.20)!important;}',
    'html.rhy-toolbar-dragging,html.rhy-toolbar-dragging *{-webkit-user-select:none!important;user-select:none!important;cursor:grabbing!important;}',
    '[data-rhylthyme-hidden]{display:none!important;}'
  ].join('\n');

  function injectStyle(doc) {
    if (doc.getElementById(STYLE_ID)) return;
    var s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function matches(el, sel) {
    var fn = el && (el.matches || el.webkitMatchesSelector || el.msMatchesSelector);
    return !!fn && fn.call(el, sel);
  }

  /**
   * Make `bar` a floating palette.
   *   name           registry key ('actions', 'view', ...)
   *   handle         the grip element (drags; double-click resets)
   *   defaultAnchor  where the page's CSS puts the bar, as an anchor
   *   load()         the saved position (any format) or null
   *   save(anchor)   persist an anchor, or null after a reset
   *   vertical       turn vertical when docked to a side edge
   *   verticalClass  class toggled for that (default 'is-vertical')
   *   onOrientation(o) called after the orientation changes
   */
  function attach(bar, options) {
    var opts = options || {};
    var doc = bar.ownerDocument;
    var win = doc.defaultView;
    var name = opts.name || bar.id || 'toolbar';
    var handle = opts.handle || null;
    var defaultAnchor = isAnchor(opts.defaultAnchor) ? opts.defaultAnchor : null;
    var verticalClass = opts.verticalClass || 'is-vertical';
    var api = registry(win);
    var narrowMq = win.matchMedia ? win.matchMedia(NARROW_QUERY) : null;
    var motionMq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;

    var anchor = null;        // saved anchor (null = CSS default)
    var pending = null;       // pre-v2 {left, top} waiting for the bar to have a size
    var orientation = 'horizontal';
    var drag = null;
    var anim = null;
    var resizeRaf = 0;

    injectStyle(doc);
    bar.setAttribute('data-rhylthyme-drag', String(VERSION));
    bar.classList.add('rhy-floating');

    function narrow() { return !!(narrowMq && narrowMq.matches); }
    function reducedMotion() { return !!(motionMq && motionMq.matches); }
    function viewport() {
      var de = doc.documentElement;
      return { w: de.clientWidth || win.innerWidth, h: de.clientHeight || win.innerHeight };
    }

    function setOrientation(o) {
      var next = opts.vertical ? o : 'horizontal';
      if (next === orientation) return false;
      orientation = next;
      bar.classList.toggle(verticalClass, next === 'vertical');
      if (typeof opts.onOrientation === 'function') {
        try { opts.onOrientation(next); } catch (e) { /* ignore */ }
      }
      return true;
    }

    function clearInline() {
      bar.style.left = '';
      bar.style.top = '';
      bar.style.right = '';
      bar.style.bottom = '';
    }

    /** Draw the bar at the saved anchor (clamped on screen) or the CSS default. */
    function apply() {
      if (drag && drag.started) return;
      stopAnim();
      if (pending && bar.offsetWidth && bar.offsetHeight) {
        var vp0 = viewport();
        anchor = normalizeSaved(pending, bar.offsetWidth, bar.offsetHeight, vp0.w, vp0.h);
        pending = null;
      }
      if (narrow() || !anchor) {
        setOrientation('horizontal');
        clearInline();
        return;
      }
      setOrientation(orientationFor(anchor));
      var vp = viewport();
      var w = bar.offsetWidth, h = bar.offsetHeight;
      var p = w && h ? placeAnchor(anchor, w, h, vp.w, vp.h) : anchor;
      bar.style[p.h] = p.x + 'px';
      bar.style[p.h === 'left' ? 'right' : 'left'] = 'auto';
      bar.style[p.v] = p.y + 'px';
      bar.style[p.v === 'top' ? 'bottom' : 'top'] = 'auto';
    }

    function setAnchor(saved) {
      pending = null;
      if (saved && !isAnchor(saved) && !(bar.offsetWidth && bar.offsetHeight)) {
        // An old {left, top} can only be converted once the bar has a size
        // (it may still be display:none); the ResizeObserver brings it back.
        anchor = null;
        pending = saved;
      } else {
        var vp = viewport();
        anchor = normalizeSaved(saved, bar.offsetWidth, bar.offsetHeight, vp.w, vp.h);
      }
      apply();
    }

    function stopAnim() {
      if (!anim) return;
      var a = anim;
      anim = null;
      win.clearTimeout(a.timer);
      bar.removeEventListener('transitionend', a.onEnd);
      a.done();
    }

    /** Ease the transform to (dx, dy) at scale 1, then run done(). */
    function animate(dx, dy, ms, done) {
      stopAnim();
      var finish = function () {
        bar.style.transition = '';
        bar.style.transform = '';
        bar.style.willChange = '';
        done();
      };
      if (!ms || reducedMotion()) { finish(); return; }
      var a = { done: finish, timer: 0, onEnd: null };
      a.onEnd = function (e) { if (e.target === bar && e.propertyName === 'transform') stopAnim(); };
      anim = a;
      bar.style.willChange = 'transform';
      bar.style.transition = 'transform ' + ms + 'ms cubic-bezier(.2,.8,.2,1), box-shadow ' + ms + 'ms ease';
      bar.addEventListener('transitionend', a.onEnd);
      a.timer = win.setTimeout(stopAnim, ms + 80);
      // Force the start state to be painted before the end state is set.
      void bar.offsetWidth;
      bar.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
    }

    // ---- pointer handling -------------------------------------------------

    function isDragSurface(target) {
      if (!target || !bar.contains(target)) return false;
      if (handle && handle.contains(target)) return true;
      for (var el = target; el && el !== bar; el = el.parentElement) {
        if (matches(el, INTERACTIVE)) return false;
      }
      return true;
    }

    function shieldFrames() {
      var saved = [];
      childFrames(win).forEach(function (f) {
        saved.push([f, f.style.pointerEvents]);
        f.style.pointerEvents = 'none';
      });
      return saved;
    }

    function keyTargets() {
      var out = [win];
      try { if (win.parent && win.parent !== win && win.parent.document) out.push(win.parent); } catch (e) { /* ignore */ }
      childFrames(win).forEach(function (f) {
        try { if (f.contentWindow && f.contentWindow.document) out.push(f.contentWindow); } catch (e) { /* ignore */ }
      });
      return out;
    }

    function onDown(e) {
      if (drag || narrow()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!isDragSurface(e.target)) return;
      e.preventDefault(); // no text selection, no focus change, no scroll
      var capEl = handle && handle.contains(e.target) ? handle : bar;
      drag = {
        id: e.pointerId, capEl: capEl, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
        started: false, raf: 0, keyWins: keyTargets()
      };
      try { capEl.setPointerCapture(e.pointerId); } catch (err) { /* synthetic event */ }
      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onUp, true);
      capEl.addEventListener('lostpointercapture', onLost);
      win.addEventListener('blur', onBlur);
      doc.addEventListener('visibilitychange', onBlur);
      drag.keyWins.forEach(function (w) { w.addEventListener('keydown', onKey, true); });
    }

    function begin() {
      var d = drag;
      stopAnim();
      bar.style.transform = '';
      var r = bar.getBoundingClientRect();
      var vp = viewport();
      d.started = true;
      d.startAnchor = anchor;
      d.startOrientation = orientation;
      d.vw = vp.w; d.vh = vp.h;
      d.baseL = r.left; d.baseT = r.top;
      d.left = r.left; d.top = r.top;
      d.w = r.width; d.h = r.height;
      d.gx = d.x0 - r.left; d.gy = d.y0 - r.top;
      d.peers = foreignRects(win).concat(api.rects().filter(function (p) { return p.name !== name; }));
      d.shield = shieldFrames();
      doc.documentElement.classList.add('rhy-toolbar-dragging');
      bar.style.left = r.left + 'px';
      bar.style.top = r.top + 'px';
      bar.style.right = 'auto';
      bar.style.bottom = 'auto';
      bar.style.transition = 'none';
      bar.style.willChange = 'transform';
      bar.classList.add('is-dragging', 'rhy-lifted');
    }

    function onMove(e) {
      var d = drag;
      if (!d || e.pointerId !== d.id) return;
      if (e.pointerType === 'mouse' && e.buttons === 0) { finish(true); return; }
      d.x = e.clientX; d.y = e.clientY;
      if (!d.started) {
        if (Math.abs(d.x - d.x0) < THRESHOLD && Math.abs(d.y - d.y0) < THRESHOLD) return;
        begin();
      }
      e.preventDefault();
      if (!d.raf) d.raf = win.requestAnimationFrame(frame);
    }

    /** Clamp, then snap (pushing past an edge docks to it), then clamp. */
    function place(d) {
      var c = clampPosition(d.x - d.gx, d.y - d.gy, d.w, d.h, d.vw, d.vh);
      var s = snapPosition(c.left, c.top, d.w, d.h, d.vw, d.vh, d.peers);
      return clampPosition(s.left, s.top, d.w, d.h, d.vw, d.vh);
    }

    /** Place the held bar under the pointer: snap, clamp, maybe reorient. */
    function step(d) {
      var p = place(d);
      if (opts.vertical) {
        var o = orientationFor(anchorFor(p.left, p.top, d.w, d.h, d.vw, d.vh));
        if (setOrientation(o)) {
          d.w = bar.offsetWidth; d.h = bar.offsetHeight;
          // Keep the grab point inside the reshaped bar, for the rest of the drag.
          d.gx = Math.min(d.gx, Math.max(4, d.w - 4));
          d.gy = Math.min(d.gy, Math.max(4, d.h - 4));
          p = place(d);
        }
      }
      d.left = p.left; d.top = p.top;
      bar.style.transform = 'translate3d(' + (p.left - d.baseL) + 'px,' + (p.top - d.baseT) + 'px,0) scale(' + LIFT_SCALE + ')';
    }

    function frame() {
      var d = drag;
      if (!d || !d.started) return;
      d.raf = 0;
      step(d);
    }

    function onUp(e) { if (drag && e.pointerId === drag.id) finish(true); }
    function onLost(e) { if (drag && e.pointerId === drag.id) finish(true); }
    function onBlur() { if (drag) finish(true); }
    function onKey(e) {
      if (drag && (e.key === 'Escape' || e.key === 'Esc')) {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      }
    }

    /** End the drag: commit (release) or cancel (Escape). Idempotent. */
    function finish(commit) {
      var d = drag;
      if (!d) return;
      drag = null;
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('pointercancel', onUp, true);
      d.capEl.removeEventListener('lostpointercapture', onLost);
      win.removeEventListener('blur', onBlur);
      doc.removeEventListener('visibilitychange', onBlur);
      d.keyWins.forEach(function (w) { try { w.removeEventListener('keydown', onKey, true); } catch (e) { /* ignore */ } });
      try { if (d.capEl.hasPointerCapture && d.capEl.hasPointerCapture(d.id)) d.capEl.releasePointerCapture(d.id); } catch (e) { /* ignore */ }
      if (!d.started) return; // a click: nothing moved
      if (d.raf) { win.cancelAnimationFrame(d.raf); d.raf = 0; }
      (d.shield || []).forEach(function (pair) { pair[0].style.pointerEvents = pair[1]; });
      doc.documentElement.classList.remove('rhy-toolbar-dragging');
      bar.classList.remove('is-dragging', 'rhy-lifted');

      if (commit) {
        step(d); // land on the latest pointer position
        var next = anchorFor(d.left, d.top, d.w, d.h, d.vw, d.vh);
        anchor = next;
        animate(d.left - d.baseL, d.top - d.baseT, SETTLE_MS, function () {
          bar.style.transform = '';
          apply();
        });
        if (typeof opts.save === 'function') {
          try { opts.save({ h: next.h, x: next.x, v: next.v, y: next.y }); } catch (e) { /* ignore */ }
        }
      } else {
        anchor = d.startAnchor;
        setOrientation(d.startOrientation);
        animate(0, 0, RESET_MS, apply);
      }
    }

    /** Animate back to the CSS default and forget the saved position. */
    function reset() {
      if (drag) finish(false);
      var from = bar.getBoundingClientRect();
      anchor = null;
      pending = null;
      if (typeof opts.save === 'function') {
        try { opts.save(null); } catch (e) { /* ignore */ }
      }
      if (narrow() || !defaultAnchor || !from.width || reducedMotion()) { apply(); return; }
      setOrientation('horizontal');
      var vp = viewport();
      var w = bar.offsetWidth, h = bar.offsetHeight;
      var to = positionFor(placeAnchor(defaultAnchor, w, h, vp.w, vp.h), w, h, vp.w, vp.h);
      bar.style.left = from.left + 'px';
      bar.style.top = from.top + 'px';
      bar.style.right = 'auto';
      bar.style.bottom = 'auto';
      bar.style.transition = 'none';
      animate(to.left - from.left, to.top - from.top, RESET_MS, function () {
        clearInline();
        apply();
      });
    }

    function setVisible(visible) {
      if (visible === false) bar.setAttribute('data-rhylthyme-hidden', '');
      else bar.removeAttribute('data-rhylthyme-hidden');
    }

    function rect() {
      var r = bar.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { name: name, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    }

    function onResize() {
      if (resizeRaf) return;
      resizeRaf = win.requestAnimationFrame(function () {
        resizeRaf = 0;
        if (!drag && !anim) apply();
      });
    }

    bar.addEventListener('pointerdown', onDown);
    if (handle) {
      handle.addEventListener('dblclick', function (e) {
        if (narrow()) return;
        e.preventDefault();
        reset();
      });
    }
    win.addEventListener('resize', onResize);
    if (narrowMq) {
      if (narrowMq.addEventListener) narrowMq.addEventListener('change', onResize);
      else if (narrowMq.addListener) narrowMq.addListener(onResize);
    }
    if (typeof win.ResizeObserver === 'function') {
      try { new win.ResizeObserver(onResize).observe(bar); } catch (e) { /* ignore */ }
    }

    var controller = {
      name: name,
      element: bar,
      apply: apply,
      setAnchor: setAnchor,
      getAnchor: function () { return anchor ? { h: anchor.h, x: anchor.x, v: anchor.v, y: anchor.y } : null; },
      orientation: function () { return orientation; },
      isDragging: function () { return !!(drag && drag.started); },
      reset: reset,
      setVisible: setVisible,
      rect: rect
    };
    api._bars[name] = controller;
    setAnchor(typeof opts.load === 'function' ? opts.load() : null);
    return controller;
  }

  return {
    VERSION: VERSION,
    GAP: GAP,
    SNAP: SNAP,
    THRESHOLD: THRESHOLD,
    PAD: PAD,
    SETTLE_MS: SETTLE_MS,
    clamp: clamp,
    clampPosition: clampPosition,
    snapPosition: snapPosition,
    anchorFor: anchorFor,
    isAnchor: isAnchor,
    positionFor: positionFor,
    normalizeSaved: normalizeSaved,
    dockedH: dockedH,
    dockedV: dockedV,
    orientationFor: orientationFor,
    placeAnchor: placeAnchor,
    offsetRect: offsetRect,
    percentile: percentile,
    registry: registry,
    foreignRects: foreignRects,
    attach: attach
  };
}));
