/* global window, document, indexedDB */
// Memory profile of the game in headless Chromium, phase by phase (not a test).
//
//   node games/cataclysm-dda/tests/memory-profile.mjs <base URL> [out.json] [options JSON]
//
// The optional options JSON ({"NAME": "value"}) is written as the game's
// config/options.json (in its IndexedDB store) before it starts, as if the
// player had set those options.
//
// Opens the game on a production build (vite preview), goes through New Game →
// Play Now! to the map, walks a few turns and opens the inventory. Twice a
// second it samples, from Linux's /proc for the page's renderer process: the
// resident set (VmRSS) and its peak (VmHWM), and from /proc/<pid>/smaps how
// much of it is the WebAssembly linear memory (the mapping as large as the
// module's memory) and executable code (compiled WebAssembly and JS). From the
// page: the module's linear memory size (memory.buffer.byteLength, which never
// shrinks), the JS heap (performance.memory) and V8's ArrayBuffer backing
// stores (CDP Runtime.getHeapUsage). Prints a table of each phase's maxima.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const [base, outFile, optionsJson] = process.argv.slice(2);
if (!base) throw new Error('usage: memory-profile.mjs <base URL> [out.json]');
const MB = 1048576;
// RA_SHOT=<dir> saves screenshots of the main menu and the map; RA_JS_FLAGS passes V8 flags (to attribute memory to a compiler tier, for example).
const browser = await chromium.launch({
  args: [
    '--enable-precise-memory-info',
    ...(process.env.RA_JS_FLAGS ? [`--js-flags=${process.env.RA_JS_FLAGS}`] : []),
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
// Keep the module's memory reachable for the sampler (whichever way the glue
// instantiates the module).
await page.addInitScript(() => {
  const keep = (instance) => {
    for (const value of Object.values(instance.exports))
      if (value instanceof WebAssembly.Memory) window.__raWasmMemory = value;
  };
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async function (...args) {
    const result = await instantiate.apply(this, args);
    keep(result.instance ?? result);
    return result;
  };
  const streaming = WebAssembly.instantiateStreaming;
  if (streaming)
    WebAssembly.instantiateStreaming = async function (...args) {
      const result = await streaming.apply(this, args);
      keep(result.instance);
      return result;
    };
});
const cdp = await page.context().newCDPSession(page);

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
let phase = 'page load';
const phases = [];
const enter = (name) => {
  phase = name;
  phases.push({ name, at: secs(), max: {} });
  console.log(`[${secs()}s] phase: ${name}`);
};
enter('page load');
const record = (sample) => {
  const max = phases.at(-1).max;
  for (const [key, value] of Object.entries(sample))
    if (typeof value === 'number') max[key] = Math.max(max[key] ?? 0, value);
};

// The renderer of the page: Chromium's largest renderer process.
const rendererPid = () => {
  const pids = execSync("pgrep -f 'chrom.*--type=renderer' || true").toString().trim().split(/\s+/);
  let best = null;
  let bestRss = -1;
  for (const pid of pids.filter(Boolean)) {
    try {
      const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0);
      if (rss > bestRss) [best, bestRss] = [pid, rss];
    } catch {
      // Gone.
    }
  }
  return best;
};

let wasmBytes = 0;
const procSample = () => {
  const pid = rendererPid();
  if (!pid) return null;
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const kb = (name) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(status)?.[1] ?? 0);
    const smaps = readFileSync(`/proc/${pid}/smaps`, 'utf8');
    let linear = 0;
    let code = 0;
    let header = null;
    for (const line of smaps.split('\n')) {
      const m = /^([0-9a-f]+)-([0-9a-f]+) (\S+) \S+ \S+ \S+\s*(.*)$/.exec(line);
      if (m) {
        header = { size: (parseInt(m[2], 16) - parseInt(m[1], 16)) / 1024, perms: m[3], anonymous: !m[4] };
        continue;
      }
      const rss = /^Rss:\s+(\d+) kB/.exec(line);
      if (rss && header) {
        // The linear memory is one read-write mapping exactly its size.
        if (wasmBytes && header.size === wasmBytes / 1024 && header.perms.startsWith('rw'))
          linear += Number(rss[1]);
        // Compiled code: anonymous executable mappings (not the browser itself).
        if (header.anonymous && header.perms.includes('x')) code += Number(rss[1]);
      }
    }
    // The GPU process (WebGL textures live there).
    let gpu = 0;
    for (const gpuPid of execSync("pgrep -f 'chrom.*--type=gpu-process' || true")
      .toString()
      .trim()
      .split(/\s+/))
      try {
        if (gpuPid)
          gpu += Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${gpuPid}/status`, 'utf8'))?.[1] ?? 0);
      } catch {
        // Not a process any more (pgrep's own shell, for one).
      }
    return {
      rss: kb('VmRSS') / 1024,
      hwm: kb('VmHWM') / 1024,
      shmem: kb('RssShmem') / 1024,
      linearRss: linear / 1024,
      codeRss: code / 1024,
      gpuRss: gpu / 1024,
    };
  } catch {
    return null;
  }
};

const pageSample = async () => {
  const s = await page.evaluate(() => {
    const d = window.__rogueArchive?.adapter?.debug;
    const m = performance.memory;
    return {
      wasm: d?.memoryBytes?.() || (window.__raWasmMemory?.buffer.byteLength ?? 0),
      // What the game shows (its loading messages), to place the samples.
      screen: [...(d?.state?.imgui ?? []), ...(d?.screenText?.() ?? '').split('\n')]
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' / ')
        .slice(0, 120),
      heap: m ? m.usedJSHeapSize : 0,
      context: d?.context ?? null,
      inputContext: d?.inputContext ?? '',
      inGame: !!d?.inGame,
      waiting: !!d?.waiting,
    };
  });
  const usage = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  return { ...s, backing: usage?.backingStorageSize ?? 0 };
};

let last = {};
let running = true;
const series = [];
const sampler = (async () => {
  while (running) {
    const p = await Promise.race([
      pageSample().catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (p) {
      if (p.screen !== last.screen) console.log(`[${secs()}s] screen: ${p.screen}`);
      last = p;
      wasmBytes = p.wasm;
    }
    const proc = procSample();
    const sample = {
      t: Number(secs()),
      phase,
      ...(proc ?? {}),
      wasmMB: wasmBytes / MB,
      heapMB: (last.heap ?? 0) / MB,
      backingMB: (last.backing ?? 0) / MB,
      screen: last.screen,
    };
    series.push(sample);
    record(sample);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
})();

const debug = () =>
  page.evaluate(() => {
    const d = window.__rogueArchive?.adapter?.debug;
    return d
      ? { context: d.context, inputContext: d.inputContext, waiting: d.waiting, inGame: d.inGame }
      : null;
  });
const until = async (check, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    const d = await debug().catch(() => null);
    if (await check(d)) return d;
    if (Date.now() > end) throw new Error(`timed out: ${what} (${JSON.stringify(d)})`);
    await page.waitForTimeout(500);
  }
};

page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('crash', () => console.log('page crashed'));
if (optionsJson) {
  await page.goto(base);
  const options = Object.entries(JSON.parse(optionsJson)).map(([name, value]) => ({ name, value }));
  await page.evaluate(
    (options) =>
      new Promise((resolve, reject) => {
        // Emscripten's IDBFS layout: one store keyed by path, directories and files.
        const home = '/home/web_user/.cataclysm-dda';
        const open = indexedDB.open(home, 21);
        open.onupgradeneeded = () => {
          const store = open.result.createObjectStore('FILE_DATA');
          store.createIndex('timestamp', 'timestamp', { unique: false });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction(['FILE_DATA'], 'readwrite');
          const store = tx.objectStore('FILE_DATA');
          const now = new Date();
          store.put({ timestamp: now, mode: 0o40777 }, `${home}/config`);
          store.put(
            { timestamp: now, mode: 0o100666, contents: new TextEncoder().encode(JSON.stringify(options)) },
            `${home}/config/options.json`,
          );
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    options,
  );
  console.log('options', JSON.stringify(options));
}
await page.goto(`${base}?debug=1#/play/cataclysm-dda`);
enter('download, inflate, module start');
await until(() => last.wasm > 0, 240_000, 'module instantiated');
enter('data load (Loading…)');
await until((d) => d?.context === 'title', 240_000, 'main menu');
enter('main menu');
if (process.env.RA_SHOT)
  await page.waitForTimeout(2000).then(() => page.screenshot({ path: `${process.env.RA_SHOT}/menu.png` }));
await page.waitForTimeout(3000);
// RA_STOP_AT_MENU=1: start-up only.
if (!process.env.RA_STOP_AT_MENU) {
  await page.locator('canvas.cdda-canvas').focus();
  enter('Play Now! (world and character generation)');
  await page.keyboard.press('n');
  await page.waitForTimeout(400);
  await page.keyboard.press('d');
  await until(
    async (d) => {
      if (d?.context === 'map') return true;
      if (d?.waiting && d.inGame) await page.keyboard.press('Escape');
      return false;
    },
    600_000,
    'the map',
  );
  enter('first map');
  await page.waitForTimeout(5000);
  if (process.env.RA_SHOT) await page.screenshot({ path: `${process.env.RA_SHOT}/map.png` });
  enter('a few turns, inventory');
  for (const key of ['h', 'l', 'k', 'j', '.', '.', '.', '.', 'i', 'Escape']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(3000);
}
if (process.env.RA_SMAPS) {
  // The largest resident mappings of the renderer at the end.
  const pid = rendererPid();
  const maps = [];
  let current = null;
  for (const line of readFileSync(`/proc/${pid}/smaps`, 'utf8').split('\n')) {
    const m = /^([0-9a-f]+)-([0-9a-f]+) (\S+) \S+ \S+ \S+\s*(.*)$/.exec(line);
    if (m) {
      current = { size: (parseInt(m[2], 16) - parseInt(m[1], 16)) / MB, perms: m[3], name: m[4], rss: 0 };
      maps.push(current);
    } else if (current && /^Rss:/.test(line)) current.rss = Number(/(\d+)/.exec(line)[1]) / 1024;
  }
  maps.sort((a, b) => b.rss - a.rss);
  for (const m of maps.slice(0, 15))
    console.log(`smaps rss ${m.rss.toFixed(0)} MB size ${m.size.toFixed(0)} MB ${m.perms} ${m.name}`);
}
running = false;
await sampler;
console.log(
  'canvas context:',
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas.cdda-canvas');
    if (!canvas) return 'none';
    for (const type of ['webgl2', 'webgl', '2d']) if (canvas.getContext(type)) return type;
    return 'unknown';
  }),
);

const fmt = (v) => (v === undefined ? '' : Math.round(v).toString());
console.log(
  '\n| Phase | from (s) | renderer RSS max (MB) | VmHWM (MB) | linear memory size (MB) | linear memory resident (MB) | code resident (MB) | JS heap (MB) | ArrayBuffers (MB) | renderer shared memory (MB) | GPU process RSS (MB) |',
);
console.log('|---|---|---|---|---|---|---|---|---|---|---|');
for (const p of phases)
  console.log(
    `| ${p.name} | ${p.at} | ${fmt(p.max.rss)} | ${fmt(p.max.hwm)} | ${fmt(p.max.wasmMB)} | ${fmt(p.max.linearRss)} | ${fmt(p.max.codeRss)} | ${fmt(p.max.heapMB)} | ${fmt(p.max.backingMB)} | ${fmt(p.max.shmem)} | ${fmt(p.max.gpuRss)} |`,
  );
if (outFile) writeFileSync(outFile, JSON.stringify({ phases, series }, null, 1));
await browser.close();
