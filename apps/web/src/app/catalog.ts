import { withDefaults, type CatalogGame } from '@rogue-archive/catalog';
import rawCatalog from '../../../../games/catalog.json';

/**
 * The catalog from games/catalog.json. It is schema-validated in CI
 * (pnpm validate:catalog and unit tests), so the browser only applies defaults.
 */
export const catalog = withDefaults(rawCatalog as Parameters<typeof withDefaults>[0]);

export const gamesById: ReadonlyMap<string, CatalogGame> = new Map(
  catalog.games.map((game) => [game.id, game]),
);

/** Resolves a site-relative path (e.g. "covers/x.webp") against the deployment base. */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
