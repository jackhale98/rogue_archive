# Deployment (GitHub Pages)

## Pipeline

`.github/workflows/deploy.yml` runs on pushes to `main` (and manually):

1. Install pinned dependencies (`pnpm install --frozen-lockfile`).
2. Build each game runtime from pinned source with the pinned Emscripten SDK (cached between runs).
3. `pnpm build` with `ROGUE_ARCHIVE_BASE=/<repository>/`: validate the catalog, verify and stage runtimes, build the site.
4. Upload `apps/web/dist` with `actions/upload-pages-artifact` and publish with `actions/deploy-pages`. A concurrency group prevents stale deployments from overtaking newer ones.

Enable it once: **Settings → Pages → Build and deployment → Source: GitHub Actions.**

## Paths

- Project Pages are served from `/<repository>/`. Vite's `base` comes from `ROGUE_ARCHIVE_BASE`. The service worker, manifest (`start_url: "./"`) and runtime URLs are all relative to it.
- Routes use the URL hash (`#/games/brogue-ce`), so deep links and refreshes work without a server fallback.

## Headers and limits

- Pages cannot set custom headers, so there is no COOP/COEP (hence no threaded WASM) and the Content Security Policy is a `<meta>` tag injected into production builds.
- Pages has published limits on site size and bandwidth. Runtimes are built in CI and never committed. Each game's download size is on its page and in its feasibility report. Brogue CE is about 1.4 MB.

## Offline

- The service worker precaches the app shell and serves hashed assets and immutable runtime files cache-first.
- A game is available offline after it has been launched once, or after **Download for offline play** on its page.
