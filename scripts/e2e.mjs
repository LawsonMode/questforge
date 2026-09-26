#!/usr/bin/env node
// Questforge e2e harness: starts a Vite dev server on a free port, drives the
// system Chrome/Edge headless via playwright-core, runs scenario modules from
// e2e/<name>.mjs, saves screenshots + a report to e2e-out/<name>/.
//
//   node scripts/e2e.mjs smoke            run e2e/smoke.mjs
//   node scripts/e2e.mjs smoke player     run several
//   node scripts/e2e.mjs --all            run every e2e/*.mjs
//   flags: --headed  --slowmo=50  --keep-open
//
// Scenario module:  export default async function (t) { ... }
//   t.page                 Playwright Page
//   t.goto(hash)           navigate to '#/...' and wait for window.__qf.ready
//   t.shot(name)           screenshot of the page -> e2e-out/<scenario>/<n>-<name>.png (returns path)
//   t.shotCanvas(name)     screenshot of the first <canvas> only
//   t.press(key, ms=60)    key down, wait ms, key up (Playwright key names: 'KeyZ', 'ArrowUp', 'Enter', ...)
//   t.hold(keys, ms)       hold several keys together for ms
//   t.wait(ms)
//   t.until(fn, arg?, timeoutMs=5000)   wait until page function returns truthy
//   t.eval(fn, arg?)       page.evaluate
//   t.assert(cond, msg)    record a failure (scenario continues)
//   t.log(...args)
//   t.allowConsole(regex)  don't count matching console errors as failures
// Exit code 1 if any assert failed, the scenario threw, or unexpected console errors/page errors occurred.

import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]));
const slowmo = Number((args.find((a) => a.startsWith('--slowmo=')) ?? '=0').split('=')[1]) || 0;
let names = args.filter((a) => !a.startsWith('--'));
if (flags.has('--all') || names.length === 0) {
  names = readdirSync(join(ROOT, 'e2e')).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''));
}

const BROWSERS = [
  process.env.QF_BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = BROWSERS.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge found. Set QF_BROWSER to a Chromium-based browser executable.');
  process.exit(2);
}

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  // hmr:false: a source save while a scenario runs must not reload the page mid-test.
  server: { port: 0, strictPort: false, host: '127.0.0.1', hmr: false },
  clearScreen: false,
});
await server.listen();
const base = (server.resolvedUrls?.local?.[0] ?? `http://127.0.0.1:${server.config.server.port}/`).replace(/\/$/, '');

const browser = await chromium.launch({
  executablePath,
  headless: !flags.has('--headed'),
  slowMo: slowmo,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});

const summary = [];
let failed = false;

for (const name of names) {
  const file = join(ROOT, 'e2e', `${name}.mjs`);
  const outDir = join(ROOT, 'e2e-out', name);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const report = { scenario: name, passed: true, failures: [], consoleErrors: [], pageErrors: [], logs: [], screenshots: [], durationMs: 0 };
  const started = performance.now();
  const context = await browser.newContext({ viewport: { width: 1024, height: 896 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const allowed = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      if (!allowed.some((r) => r.test(text))) report.consoleErrors.push(text);
    } else if (msg.type() === 'warning' || msg.type() === 'log' || msg.type() === 'info') {
      if (report.logs.length < 400) report.logs.push(`[${msg.type()}] ${text}`);
    }
  });
  page.on('pageerror', (err) => report.pageErrors.push(`${err.message}\n${err.stack ?? ''}`));
  let shotN = 0;
  const t = {
    page,
    base,
    outDir,
    async goto(hash, opts = {}) {
      await page.goto(`${base}/${hash.startsWith('#') ? hash : `#${hash}`}`);
      await page.waitForFunction(() => window.__qf && (window.__qf.ready || window.__qf.error), null, { timeout: opts.timeout ?? 15000 });
      const err = await page.evaluate(() => window.__qf.error);
      if (err) t.assert(false, `view error on ${hash}: ${err.split('\n')[0]}`);
      await page.waitForTimeout(opts.settle ?? 300);
    },
    async shot(label) {
      const p = join(outDir, `${String(++shotN).padStart(2, '0')}-${label}.png`);
      await page.screenshot({ path: p });
      report.screenshots.push(p);
      return p;
    },
    async shotCanvas(label) {
      const p = join(outDir, `${String(++shotN).padStart(2, '0')}-${label}.png`);
      const c = page.locator('canvas').first();
      if ((await c.count()) === 0) {
        t.assert(false, `shotCanvas(${label}): no <canvas> on the page`);
        await page.screenshot({ path: p });
      } else {
        await c.screenshot({ path: p, timeout: 5000 });
      }
      report.screenshots.push(p);
      return p;
    },
    async press(key, ms = 60) {
      await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
    },
    async hold(keys, ms) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) await page.keyboard.down(k);
      await page.waitForTimeout(ms);
      for (const k of [...list].reverse()) await page.keyboard.up(k);
    },
    wait: (ms) => page.waitForTimeout(ms),
    async until(fn, arg, timeout = 5000) {
      try {
        await page.waitForFunction(fn, arg, { timeout });
        return true;
      } catch {
        t.assert(false, `timed out waiting for: ${String(fn).slice(0, 160)}`);
        return false;
      }
    },
    eval: (fn, arg) => page.evaluate(fn, arg),
    assert(cond, msg) {
      if (!cond) {
        report.passed = false;
        report.failures.push(msg);
        console.log(`  ✗ ${msg}`);
      }
    },
    log: (...a) => {
      const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
      report.logs.push(`[scenario] ${line}`);
      console.log(`  · ${line}`);
    },
    allowConsole(re) {
      allowed.push(re);
    },
  };

  console.log(`▶ ${name}`);
  try {
    if (!existsSync(file)) throw new Error(`scenario file not found: e2e/${name}.mjs`);
    const mod = await import(pathToFileURL(file).href + `?t=${Date.now()}`);
    await mod.default(t);
  } catch (err) {
    report.passed = false;
    report.failures.push(`scenario threw: ${err instanceof Error ? err.stack : String(err)}`);
    try { await t.shot('crash'); } catch { /* ignore */ }
  }
  if (report.consoleErrors.length) report.passed = false;
  if (report.pageErrors.length) report.passed = false;
  report.durationMs = Math.round(performance.now() - started);
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  if (!flags.has('--keep-open')) await context.close();
  failed ||= !report.passed;
  summary.push(report);
  const mark = report.passed ? 'PASS' : 'FAIL';
  console.log(`${mark} ${name} (${report.durationMs} ms) — ${report.screenshots.length} screenshots in e2e-out/${name}/`);
  for (const f of report.failures) console.log(`   failure: ${f.split('\n')[0]}`);
  for (const e of report.consoleErrors.slice(0, 10)) console.log(`   console.error: ${e.split('\n')[0]}`);
  for (const e of report.pageErrors.slice(0, 10)) console.log(`   pageerror: ${e.split('\n')[0]}`);
}

if (!flags.has('--keep-open')) {
  await browser.close();
  await server.close();
}
console.log(`\n${summary.filter((r) => r.passed).length}/${summary.length} scenarios passed`);
process.exit(failed ? 1 : 0);
