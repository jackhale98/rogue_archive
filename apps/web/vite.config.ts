import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// GitHub Pages serves project sites from /<repository>/. CI sets
// ROGUE_ARCHIVE_BASE; local development and previews use '/'.
const base = process.env.ROGUE_ARCHIVE_BASE ?? '/';

/**
 * Content Security Policy for production builds. GitHub Pages cannot send
 * headers, so it is delivered as a meta tag. Game glue code is verified
 * against the runtime manifest and imported from a blob: URL; WebAssembly
 * compilation needs 'wasm-unsafe-eval' (not 'unsafe-eval').
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'rogue-archive-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

/** Every file under `dir`, as paths relative to `root`. */
function listFiles(root: string, dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(root, join(dir, entry.name))
      : [
          relative(root, join(root, dir, entry.name))
            .split('\\')
            .join('/'),
        ],
  );
}

/**
 * Offline: writes the app shell's files (scripts, styles, fonts, covers,
 * icons; not game runtimes or source maps) and a build id into sw.js, which
 * precaches them on install. The page's first load happens before the
 * service worker controls it, so without this its own script would never be
 * cached; and as sw.js changes with every build, browsers install the new
 * worker, which caches the new shell.
 */
function serviceWorkerPrecache(): Plugin {
  let outDir = '';
  return {
    name: 'rogue-archive-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir.startsWith('/')
        ? config.build.outDir
        : join(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = [
        'manifest.webmanifest',
        ...['assets', 'covers', 'icons'].flatMap((dir) => listFiles(outDir, dir)),
      ]
        .filter((file) => !file.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const file of ['index.html', ...files]) hash.update(file).update(readFileSync(join(outDir, file)));
      const build = hash.digest('hex').slice(0, 16);
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      const placeholder = "const BUILD = 'dev';\nconst PRECACHE = [];";
      if (!sw.includes(placeholder)) throw new Error('sw.js: precache placeholder not found');
      writeFileSync(
        swPath,
        sw.replace(placeholder, `const BUILD = '${build}';\nconst PRECACHE = ${JSON.stringify(files)};`),
      );
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), contentSecurityPolicy(), serviceWorkerPrecache()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    assetsInlineLimit: 0,
  },
  server: {
    fs: { allow: ['../..'] },
  },
});
