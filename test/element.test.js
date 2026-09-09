'use strict';
// Runs test/element-harness.html in headless Chrome and asserts on what it
// records. Skipped when no Chrome/Chromium binary is found (set CHROME_BIN).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
}

const chrome = findChrome();

// Chrome does not always exit after --dump-dom (seen on macOS), so read the
// dump from stdout and kill the process once the document has been printed.
function dumpDom(url) {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-chrome-'));
    const child = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--user-data-dir=' + profile,
      '--dump-dom', url,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
      if (err) reject(err); else resolve(out);
    };
    const timer = setTimeout(() => finish(new Error('Chrome produced no DOM dump within 60 s')), 60000);
    child.stdout.on('data', (chunk) => { out += chunk; if (out.includes('</html>')) finish(); });
    child.on('error', finish);
    child.on('exit', () => {
      finish(out.includes('</html>') ? null : new Error('Chrome exited without a DOM dump'));
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch (e) { /* temp dir */ }
    });
  });
}

test('<rhylthyme-timeline> plays a program in headless Chrome', { skip: chrome ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
  const harness = path.join(__dirname, 'element-harness.html');
  const dom = await dumpDom('file://' + harness);
  const m = /<pre id="results">([\s\S]*?)<\/pre>/.exec(dom);
  assert.ok(m, 'harness wrote results');
  const out = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  assert.deepStrictEqual(out.errors, []);
  const c = out.checks;
  assert.strictEqual(c.rendersBars, 13);
  assert.strictEqual(c.hasControls, true);
  assert.strictEqual(c.hasCursorBeforeStart, true);
  assert.strictEqual(c.statusRunning, 'running');
  assert.strictEqual(c.roastState, 'active');
  assert.strictEqual(c.roastDoneButton, true);
  assert.strictEqual(c.timeDisplay, '21:40');
  assert.strictEqual(c.peelState, 'waiting');
  assert.strictEqual(c.peelStartButton, true);
  assert.strictEqual(c.peelFloatsTo, 9000);
  assert.strictEqual(c.peelStateAfterStart, 'active');
  assert.strictEqual(c.roastEnd, 11700);
  assert.strictEqual(c.roastState2, 'done');
  assert.strictEqual(c.restStart, 11700);
  assert.strictEqual(c.finalStatus, 'completed');
  assert.strictEqual(c.allDone, true);
  assert.deepStrictEqual(c.afterStop, ['stopped', 0, 1]); // the first step is active at t = 0
  assert.strictEqual(c.speed10Time, 100);
  assert.strictEqual(c.pausedStatus, 'paused');
  assert.strictEqual(c.staticControls, false);
  assert.strictEqual(c.staticCursor, false);
  assert.strictEqual(c.staticBars, 13);
  assert.strictEqual(c.hoursFormat, '1:02:05');
  assert.strictEqual(c.clockFormat, '14:10:00');
  assert.strictEqual(c.corpusRendered, 6);
  assert.ok(out.events.some((e) => e[0] === 'rt-complete'), 'rt-complete fired');
  assert.ok(out.events.some((e) => e[0] === 'rt-step-complete' && e[1] === 'turkey-roast' && e[2] === 11700), 'roast auto-completed at cap');
});
