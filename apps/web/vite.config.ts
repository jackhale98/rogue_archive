import react from '@vitejs/plugin-react';
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

export default defineConfig({
  base,
  plugins: [react(), contentSecurityPolicy()],
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
