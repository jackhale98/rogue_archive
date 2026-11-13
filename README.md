# Rogue Archive

**Classic roguelikes, playable in your browser.** A curated, static, local-first library of the genre's landmark games, built from their original source. No account, no installs, no backend. Games run on your device, and saves stay in your browser unless you export them.

| Game | Status | Notes |
|---|---|---|
| [Brogue: Community Edition](games/brogue-ce/PORTING.md) 1.15.1 | **Experimental** | Text, tiles and hybrid display; keyboard, mouse and touch; local saves with export/import; offline. Not yet verified on physical phones. |
| Dungeon Crawl Stone Soup | Researching | Next port. |
| Sil-Q, Rogue 5.4.4, HyperRogue, NetHack 5.0.0, Angband, DRL, Allure of the Stars, Cataclysm: DDA, Shattered Pixel Dungeon, IVAN, Infra Arcana | Planned | In this order; see [ROADMAP.md](ROADMAP.md). |

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

`.github/workflows/deploy.yml` builds everything from source on pushes to `main` and publishes to GitHub Pages. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**. See [docs/architecture/deployment.md](docs/architecture/deployment.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/contributing/adding-a-game.md](docs/contributing/adding-a-game.md). Coding agents should start with [AGENTS.md](AGENTS.md).

## Licenses

Rogue Archive's platform code is [MIT](LICENSE). Every game keeps its own license; for example, the Brogue CE port is AGPL-3.0-or-later and its tile sheet is CC BY-SA 4.0. See each game's `LICENSES.md` and [licenses/THIRD_PARTY_NOTICES.md](licenses/THIRD_PARTY_NOTICES.md).
