# Rogue Archive

**Classic roguelikes, playable in your browser.** A curated, static, local-first library of the genre's landmark games, built from their original source. No account, no installs, no backend. Games run on your device, and saves stay in your browser unless you export them.

| Game | Status | Notes |
|---|---|---|
| [Brogue: Community Edition](games/brogue-ce/PORTING.md) 1.15.1 | **Playable** | Text, tiles and hybrid display; keyboard, mouse and touch; local saves with export/import; offline. Played on a physical iPhone; Android not yet tested. |
| [Dungeon Crawl Stone Soup](games/dcss/PORTING.md) 0.34.1 | **Playable** | The official WebTiles interface (tiles or text); keyboard, mouse and touch with a phone layout; local saves with export/import; offline. Played on a physical iPhone; Android not yet tested. |
| [Sil-Q](games/sil-q/PORTING.md) 1.5.0 | **Playable** | Sil's own 80×24 text interface; keyboard and touch with a phone layout (map around the player, item prompts and lists as buttons); local saves with export/import; offline. Played on a physical iPhone; Android not yet tested. |
| [HyperRogue](games/hyperrogue/PORTING.md) 13.1p | **Playable** | Upstream's own web version with saving switched on; the hyperbolic plane drawn with WebGL; keyboard, mouse and touch modelled on its mobile version; score file export/import; offline. Played on a physical iPhone; Android not yet tested. |
| [Rogue](games/rogue/PORTING.md) 5.4.4 | **Playable** | The 1980 original's BSD-licensed 5.4.4 release on its own 80×24 screen; keyboard and touch with a phone layout; local saves with export/import; offline. Played on a physical iPhone; Android not yet tested. |
| [NetHack](games/nethack/PORTING.md) 5.0.0 | **Experimental** | Upstream's own WebAssembly build; NetHack's terminal interface as tty draws it, the map in text or NetHack's own tiles; keyboard, mouse and touch with a phone layout (menus as sheets); local saves with export/import; offline. Touch controls are a first version. |
| Angband, DRL, Cataclysm: DDA, Shattered Pixel Dungeon, IVAN, Infra Arcana | Planned | In this order; see [ROADMAP.md](ROADMAP.md). |

## How it works

- Each game is an independent package in `games/<id>/` that builds a **pinned upstream source** to WebAssembly and implements a small adapter contract (`packages/game-api`).
- The shared web app (`apps/web`, React + Vite) provides the library, launcher, in-game shell, touch controls, settings, save export/import and offline caching. It contains no game-specific logic.
- The library is generated from [`games/catalog.json`](games/catalog.json), which is schema-validated in CI.
- The site is plain static files, deployed to GitHub Pages.

Read [docs/architecture/overview.md](docs/architecture/overview.md) for the details, and [docs/plan/implementation-plan.md](docs/plan/implementation-plan.md) for the full plan.

## Development

Requirements: Node ≥ 22.12, pnpm 10, git and python3 (for the Emscripten SDK, which the build installs into `~/.cache/rogue-archive`).

```sh
pnpm install
pnpm build:brogue        # build the Brogue CE WebAssembly runtime (≈1 min)
pnpm build:dcss          # build the DCSS WebAssembly runtime (≈15–20 min the first time; needs python3-yaml, libpng-dev)
pnpm build:sil           # build the Sil-Q WebAssembly runtime (<1 min)
pnpm build:rogue         # build the Rogue WebAssembly runtime (<1 min)
pnpm build:hyperrogue    # build the HyperRogue WebAssembly runtime (≈3 min the first time, then seconds)
pnpm stage:runtimes      # make built runtimes available to the web app
pnpm dev                 # http://localhost:5173
```

| Command | What it does |
|---|---|
| `pnpm build` | Validate the catalog, stage runtimes, production build into `apps/web/dist` |
| `pnpm preview` | Serve the production build |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | Static checks |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm e2e` | End-to-end tests (Playwright) against a production build at the Pages base path. Build first with `ROGUE_ARCHIVE_BASE=/rogue_archive/ pnpm build`. |

## Deployment

`.github/workflows/deploy.yml` publishes `main` to GitHub Pages after CI has passed for that commit. Each game's WebAssembly runtime is cached in CI under a hash of its directory and the toolchain, so a push rebuilds (and re-runs the engine conformance of) only the games it changed; deploy reuses those runtimes. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. See [docs/architecture/deployment.md](docs/architecture/deployment.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [porting playbook](docs/contributing/porting-playbook.md). Coding agents should start with [AGENTS.md](AGENTS.md).

## Licenses

Rogue Archive's platform code is [MIT](LICENSE). Every game keeps its own license; for example, the Brogue CE port is AGPL-3.0-or-later and its tile sheet is CC BY-SA 4.0. See each game's `LICENSES.md` and [licenses/THIRD_PARTY_NOTICES.md](licenses/THIRD_PARTY_NOTICES.md).
