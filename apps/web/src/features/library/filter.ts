import { isLaunchable, type CatalogGame, type InterfaceStyle } from '@rogue-archive/catalog';

/** How the playable games are ordered (A–Z by default). */
export const LIBRARY_SORTS = ['title', 'newest', 'oldest'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export interface LibraryFilters {
  query: string;
  interfaceStyle: InterfaceStyle | 'any';
  touchOnly: boolean;
  sort: LibrarySort;
}

export const EMPTY_FILTERS: LibraryFilters = {
  query: '',
  interfaceStyle: 'any',
  touchOnly: false,
  sort: 'title',
};

/** Whether anything narrows the list (the sort only orders it). */
export function isFiltering(filters: LibraryFilters): boolean {
  return filters.query.trim() !== '' || filters.interfaceStyle !== 'any' || filters.touchOnly;
}

function normalize(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesFilters(game: CatalogGame, filters: LibraryFilters): boolean {
  if (filters.interfaceStyle !== 'any' && !game.interface.includes(filters.interfaceStyle)) return false;
  if (filters.touchOnly && !(isLaunchable(game) && game.input.touch)) return false;
  const query = normalize(filters.query.trim());
  if (!query) return true;
  const haystack = normalize(
    [
      game.title,
      game.subtitle,
      game.description,
      game.authors,
      String(game.firstReleased ?? ''),
      ...game.tags,
    ].join(' '),
  );
  return query.split(/\s+/).every((term) => haystack.includes(term));
}

/** A title as it sorts: without a leading article. */
const sortTitle = (game: CatalogGame) => normalize(game.title).replace(/^(the|a|an) /, '');

function compare(sort: LibrarySort): (a: CatalogGame, b: CatalogGame) => number {
  const year = (game: CatalogGame) => game.firstReleased ?? Number.NaN;
  const byTitle = (a: CatalogGame, b: CatalogGame) => sortTitle(a).localeCompare(sortTitle(b));
  // Games without a release year go last in either direction.
  const byYear = (direction: 1 | -1) => (a: CatalogGame, b: CatalogGame) => {
    const [ya, yb] = [year(a), year(b)];
    if (Number.isNaN(ya) !== Number.isNaN(yb)) return Number.isNaN(ya) ? 1 : -1;
    return (ya - yb) * direction || byTitle(a, b);
  };
  switch (sort) {
    case 'newest':
      return byYear(-1);
    case 'oldest':
      return byYear(1);
    default:
      return byTitle;
  }
}

export interface LibrarySections {
  playable: CatalogGame[];
  roadmap: CatalogGame[];
  watchlist: CatalogGame[];
}

/**
 * Splits the catalog into launchable games (in the chosen order), the roadmap
 * and the watchlist (in the order they are planned: the catalog's priority).
 */
export function librarySections(games: readonly CatalogGame[], filters: LibraryFilters): LibrarySections {
  const matching = games.filter((game) => matchesFilters(game, filters));
  const planned = [...matching].sort((a, b) => a.priority - b.priority);
  return {
    playable: matching.filter((game) => isLaunchable(game)).sort(compare(filters.sort)),
    roadmap: planned.filter((game) => !isLaunchable(game) && game.status !== 'blocked'),
    watchlist: planned.filter((game) => game.status === 'blocked'),
  };
}
