import { isLaunchable, type CatalogGame, type InterfaceStyle } from '@rogue-archive/catalog';

export interface LibraryFilters {
  query: string;
  interfaceStyle: InterfaceStyle | 'any';
  touchOnly: boolean;
}

export const EMPTY_FILTERS: LibraryFilters = { query: '', interfaceStyle: 'any', touchOnly: false };

function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesFilters(game: CatalogGame, filters: LibraryFilters): boolean {
  if (filters.interfaceStyle !== 'any' && !game.interface.includes(filters.interfaceStyle)) return false;
  if (filters.touchOnly && !(isLaunchable(game) && game.input.touch)) return false;
  const query = normalize(filters.query.trim());
  if (!query) return true;
  const haystack = normalize(
    [game.title, game.subtitle, game.description, game.authors, ...game.tags].join(' '),
  );
  return query.split(/\s+/).every((term) => haystack.includes(term));
}

export interface LibrarySections {
  playable: CatalogGame[];
  roadmap: CatalogGame[];
  watchlist: CatalogGame[];
}

/** Splits the catalog into launchable games, the roadmap and the watchlist, each in priority order. */
export function librarySections(games: readonly CatalogGame[], filters: LibraryFilters): LibrarySections {
  const sorted = games
    .filter((game) => matchesFilters(game, filters))
    .sort((a, b) => a.priority - b.priority);
  return {
    playable: sorted.filter((game) => isLaunchable(game)),
    roadmap: sorted.filter((game) => !isLaunchable(game) && game.status !== 'blocked'),
    watchlist: sorted.filter((game) => game.status === 'blocked'),
  };
}
