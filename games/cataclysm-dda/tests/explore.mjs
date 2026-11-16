/* global window, document */
// Exploratory browser run (not a test): opens the game in headless Chromium,
// logs the console, the debug snapshot and timings, and saves screenshots.
// Usage: node explore.mjs <base URL> <out dir> [keys...]
import { chromium } from '@playwright/test';

const [base, out, ...keys] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const t0 = Date.now();
const log = (...args) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args);
page.on('console', (m) => log('console', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => log('pageerror', e.message));
const debug = () =>
  page.evaluate(() => {
    const d = window.__rogueArchive?.adapter?.debug;
    if (!d) return null;
    const m = performance.memory;
    return {
      context: d.context,
      input: d.inputContext,
      inGame: d.inGame,
      mainMenu: d.mainMenu,
      waiting: d.waiting,
      player: d.player,
      imgui: d.state?.imgui,
      registers: d.state?.registers,
      heap: m ? Math.round(m.usedJSHeapSize / 1048576) : null,
    };
  });
await page.goto(`${base}?debug=1#/play/cataclysm-dda`);
let last = '';
for (let i = 0; i < 240; i++) {
  const d = await debug().catch(() => null);
  const s = JSON.stringify(d);
  if (s !== last) {
    log('state', s);
    last = s;
  }
  if (d?.context === 'title') break;
  await page.waitForTimeout(1000);
}
await page.screenshot({ path: `${out}/title.png` });
const screen = () =>
  page.evaluate(() => window.__rogueArchive?.adapter?.debug?.screenText() ?? '(no adapter)');
log('screen\n' + (await screen()));
await page.locator('canvas.cdda-canvas').focus();
for (const key of keys) {
  if (key.startsWith('wait=')) {
    await page.waitForTimeout(Number(key.slice(5)));
  } else if (key === 'probe') {
    log(
      'probe',
      JSON.stringify(
        await page.evaluate(() => {
          const c = document.querySelector('canvas.cdda-canvas');
          const out = {};
          out.canvases = [...document.querySelectorAll('canvas')].map(
            (e) => e.id + '.' + e.className + ':' + e.width + 'x' + e.height,
          );
          for (const t of ['webgl', 'webgl2', '2d']) {
            const g = c.getContext(t);
            out[t] = g ? (g.getContextAttributes ? g.getContextAttributes() : 'yes') : null;
          }
          const k = document.createElement('canvas');
          k.width = c.width;
          k.height = c.height;
          const x = k.getContext('2d');
          x.drawImage(c, 0, 0);
          const d = x.getImageData(0, 0, k.width, k.height).data;
          let lit = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++;
          out.lit = lit;
          return out;
        }),
      ),
    );
  } else if (key === 'canvas') {
    log(
      'canvas',
      JSON.stringify(
        await page.evaluate(() => {
          const c = document.querySelector('canvas.cdda-canvas');
          const r = c.getBoundingClientRect();
          return {
            w: c.width,
            h: c.height,
            cssW: r.width,
            cssH: r.height,
            top: r.top,
            style: c.getAttribute('style'),
          };
        }),
      ),
    );
  } else if (key.startsWith('shot=')) {
    await page.screenshot({ path: `${out}/${key.slice(5)}.png` });
    log('screen\n' + (await screen()));
  } else {
    await page.keyboard.press(key);
    await page.waitForTimeout(1500);
  }
  log('after', key, JSON.stringify(await debug()));
}
const cdp = await page.context().newCDPSession(page);
const metrics = await cdp.send('Performance.getMetrics').catch(() => null);
await cdp.send('Performance.enable');
const m2 = await cdp.send('Performance.getMetrics');
log(
  'metrics',
  JSON.stringify(m2.metrics.filter((x) => /Heap|Nodes|Documents/.test(x.name))),
  metrics ? '' : '',
);
// Peak resident memory of each Chromium process (Linux /proc): the game's
// renderer is the largest.
const { execSync } = await import('node:child_process');
const peaks = execSync(
  "for p in $(pgrep -f 'chrom.*--type=renderer'); do awk -v p=$p '/VmHWM|VmRSS/ {printf \"%s %s=%s \", p, $1, $2}' /proc/$p/status; echo; done",
)
  .toString()
  .trim();
log('renderer memory (kB)\n' + peaks);
await browser.close();
