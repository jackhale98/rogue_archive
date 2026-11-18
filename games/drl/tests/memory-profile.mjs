// SPDX-License-Identifier: GPL-2.0-only
/* global window */
// Memory profile of DRL in a headless browser, phase by phase (not a test).
// The same measurements as games/cataclysm-dda/tests/memory-profile.mjs:
// twice a second, from Linux's /proc for the page's process (which runs the
// game's worker too): the resident set (VmRSS), its peak (VmHWM) and its
// anonymous part; from the game: the module's memory (it never shrinks, so
// it is its high-water mark); in Chromium, the page's JS heap.
//
//   node games/drl/tests/memory-profile.mjs <base URL>       (Chromium)
//   RA_BROWSER=webkit node games/drl/tests/memory-profile.mjs <base URL>   (WebKit: Safari's engine)
//
// Opens DRL on a production build (vite preview), goes through its main menu
// to a new game, walks, opens the inventory and the help, then Save & Quit.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium, webkit } from '@playwright/test';

const [base] = process.argv.slice(2);
if (!base) throw new Error('usage: memory-profile.mjs <base URL>');
const MB = 1048576;
const isWebKit = process.env.RA_BROWSER === 'webkit';
const browser = isWebKit
  ? await webkit.launch()
  : await chromium.launch({ args: ['--enable-precise-memory-info'] });
const PAGE_PROCESS = isWebKit ? 'WPEWebProcess' : 'chrom.*--type=renderer';
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
const phases = [];
const enter = (name) => phases.push({ name, at: secs(), max: {} });

const pagePid = () => {
  let best = null;
  let bestRss = -1;
  for (const pid of execSync(`pgrep -f '${PAGE_PROCESS}' || true`)
    .toString()
    .trim()
    .split(/\s+/)
    .filter(Boolean)) {
    try {
      const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0);
      if (rss > bestRss) [best, bestRss] = [pid, rss];
    } catch {
      // Gone.
    }
  }
  return best;
};

const debug = () =>
  page.evaluate(() => {
    const d = window.__rogueArchive?.adapter?.debug;
    return d
      ? {
          context: d.context,
          inGame: d.inGame,
          text: d.screenText(),
          wasm: d.memoryBytes(),
          heap: performance.memory?.usedJSHeapSize ?? 0,
        }
      : null;
  });

let running = true;
const sampler = (async () => {
  while (running) {
    const pid = pagePid();
    const d = await debug().catch(() => null);
    const sample = {};
    if (pid) {
      try {
        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        const kb = (name) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(status)?.[1] ?? 0);
        Object.assign(sample, {
          rss: kb('VmRSS') / 1024,
          hwm: kb('VmHWM') / 1024,
          anon: kb('RssAnon') / 1024,
        });
      } catch {
        // Gone.
      }
    }
    if (d) Object.assign(sample, { wasm: d.wasm / MB, heap: d.heap / MB });
    const max = phases.at(-1)?.max;
    if (max) for (const [k, v] of Object.entries(sample)) max[k] = Math.max(max[k] ?? 0, v);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
})();

const waitFor = async (test, timeout = 120_000) => {
  const until = Date.now() + timeout;
  for (;;) {
    const d = await debug().catch(() => null);
    if (d && test(d)) return d;
    if (Date.now() > until) throw new Error(`timed out (screen: ${d?.text.slice(0, 200)})`);
    await page.waitForTimeout(250);
  }
};
const press = async (key, pause = 400) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(pause);
};

enter('page load and start (to the main menu)');
await page.goto(`${base}?debug=1#/play/drl`);
await waitFor((d) => /Press <Enter> to continue|New game|Continue game/.test(d.text));
await page.locator('canvas.drl-canvas').focus();
while (/Press <Enter> to continue/.test((await debug()).text)) await press('Enter', 600);
await waitFor((d) => /New game/.test(d.text));
enter('new game (menus, the intro) to the map');
for (const key of ['Enter', 'Enter', 'Enter', 'Enter', 'Enter']) await press(key, 600);
await waitFor((d) => /Type a name/.test(d.text));
await page.keyboard.type('Memory');
await press('Enter', 800);
for (let i = 0; i < 8 && (await debug()).context !== 'map'; i++) await press('Escape', 800);
await waitFor((d) => d.context === 'map');
enter('playing (walking, waiting), the inventory, the help');
for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'w', 'w', 'ArrowLeft', 'ArrowUp', 'w'])
  await press(key, 300);
await press('i', 800);
await waitFor((d) => /Inventory/.test(d.text));
await press('Escape', 500);
await waitFor((d) => d.context === 'map');
await press('h', 800);
await press('Escape', 500);
await waitFor((d) => d.context === 'map');
enter('Save & Quit, back to the main menu');
await press('Escape', 600);
await waitFor((d) => /Save & Quit/.test(d.text));
await press('ArrowUp', 300);
await press('Enter', 300);
await waitFor((d) => /Continue game/.test(d.text), 30_000);
await page.waitForTimeout(2000);
running = false;
await sampler;
await browser.close();

console.log(`\n${isWebKit ? 'WebKit (WPE)' : 'Chromium'}: maxima per phase, MB`);
console.log('phase | rss | peak (VmHWM) | anonymous | module memory | JS heap');
for (const { name, max } of phases)
  console.log(
    `${name} | ${[max.rss, max.hwm, max.anon, max.wasm, isWebKit ? null : max.heap]
      .map((v) => (v === null || v === undefined ? '—' : v.toFixed(0)))
      .join(' | ')}`,
  );
