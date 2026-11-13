# Contributing to Rogue Archive

Thank you for helping. The best contributions make one game work completely and honestly rather than adding many games partially.

## Getting started

```sh
pnpm install
pnpm build:brogue && pnpm stage:runtimes
pnpm dev
```

Before opening a pull request:

```sh
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm validate:catalog
ROGUE_ARCHIVE_BASE=/rogue_archive/ pnpm build && pnpm e2e
```

## Kinds of contribution

- **Platform** (`apps/web`, `packages/*`): keep it game-agnostic. If you need to branch on a game, extend the adapter contract or the catalog instead.
- **A new game:** follow [docs/contributing/adding-a-game.md](docs/contributing/adding-a-game.md). Start with the feasibility and license reports, and open an issue first so work isn't duplicated.
- **Updating a game:** follow [docs/contributing/updating-a-game.md](docs/contributing/updating-a-game.md).
- **Device testing:** reports from real phones and tablets are especially valuable. Use the "Compatibility report" issue template.

## Pull requests

Fill in the PR template: what changed and why, affected packages, upstream versions, patches, license/asset impact, **tests actually run**, browsers/devices tested, runtime size change, known limitations, and screenshots for visible changes. Never change game rules, save formats or the game API's semantics silently.

## Upstream projects

Report game bugs that also happen in the native game to the game's own project. Do not submit AI-generated changes to an upstream project unless its contribution policy allows them.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
