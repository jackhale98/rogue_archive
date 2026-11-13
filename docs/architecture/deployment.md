# Deployment (GitHub Pages)

## Pipeline

`.github/workflows/deploy.yml` runs when CI has passed for a push to `main` (and manually), on that commit:

1. Install pinned dependencies (`pnpm install --frozen-lockfile`).
2. Restore each game runtime CI built and verified for these inputs. Runtimes are cached under `runtime-<game>-<hash>`, the hash covering the game's directory (minus docs and build output) and the toolchain files, so CI rebuilds and re-verifies only the games a push changed. On a cache miss deploy builds from pinned source with the pinned Emscripten SDK.
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

- The service worker precaches the whole app shell on install: the page, every script and stylesheet chunk (all games' adapters included), fonts, covers and icons. The build writes that list and a build id into `sw.js` (`serviceWorkerPrecache` in `apps/web/vite.config.ts`), so every deploy changes `sw.js`, browsers install the new worker, and it caches the new shell (`ra-shell-<build id>`; older shell caches are deleted on activation). Without the precache list the page's own entry script, loaded before the worker controls the page, would never be cached and the site would open blank offline.
- Hashed assets and immutable runtime files are served cache-first; cache lookups ignore `Vary` (preview servers and Pages send `Vary: Origin` or `Accept-Encoding`, which would otherwise stop a script requested by the page from matching the copy cached on install).
- A game is available offline after it has been launched once, or after it is downloaded: the download button on its library card, **Download all for offline** (library and Settings), or **Download for offline play** on its page. All of these share `apps/web/src/features/offline/offline-store.ts`, which reads each game's status from Cache Storage alone (the cached runtime manifest and its files, so the library never downloads anything to show it) and runs downloads one at a time. `e2e/offline.spec.ts` checks this end to end: one visit, download from the card, network off, reload, play; and Download all.
- Installed to the Home Screen (iPhone, iPad) or as an app (Chrome, Edge), the site works the same; on Apple devices the installed app has its own storage and caches, separate from Safari's, so games are downloaded (or played once) from inside the app.
