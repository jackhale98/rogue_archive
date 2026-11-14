import {
  INTERFACE_STYLES,
  isLaunchable,
  type CatalogGame,
  type InterfaceStyle,
} from '@rogue-archive/catalog';
import { useEffect, useMemo, useRef, useState } from 'react';
import { catalog, gamesById } from '../app/catalog.ts';
import { repositoryFileUrl } from '../app/config.ts';
import { href } from '../app/router.ts';
import { getStore } from '../app/store.ts';
import { GameCard } from '../components/GameCard.tsx';
import { GameCover } from '../components/GameCover.tsx';
import {
  EMPTY_FILTERS,
  isFiltering,
  librarySections,
  LIBRARY_SORTS,
  type LibraryFilters,
  type LibrarySort,
} from '../features/library/filter.ts';
import { DownloadAll } from '../features/offline/OfflineControls.tsx';
import { leadAuthor } from '../lib/authors.ts';
import { relativeTime } from '../lib/relative-time.ts';

const INTERFACE_LABELS: Record<InterfaceStyle, string> = {
  ascii: 'Text',
  tiles: 'Tiles',
  graphical: 'Graphical',
};
const SORT_LABELS: Record<LibrarySort, string> = {
  featured: 'Featured',
  title: 'A–Z',
  newest: 'Newest first',
  oldest: 'Oldest first',
};
/** Roadmap entries shown before "the full roadmap". */
const NEXT_UP = 3;

interface RecentEntry {
  game: CatalogGame;
  lastPlayedAt: number;
}

function useRecentGames(): RecentEntry[] {
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getStore().then(async (store) => {
      const entries = (await store?.listRecentGames(3)) ?? [];
      if (cancelled) return;
      setRecent(
        entries.flatMap((entry) => {
          const game = gamesById.get(entry.gameId);
          return game && isLaunchable(game) ? [{ game, lastPlayedAt: entry.lastPlayedAt }] : [];
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return recent;
}

function ContinuePlaying({ recent }: { recent: RecentEntry[] }) {
  return (
    <section className="library-section" aria-labelledby="recent-title">
      <h2 id="recent-title" className="section-title">
        Continue playing
      </h2>
      <ul className="resume-list">
        {recent.map(({ game, lastPlayedAt }) => (
          <li key={game.id}>
            <a className="resume-card" href={href(`/play/${game.id}`)}>
              <GameCover game={game} className="resume-card__cover" />
              <span className="resume-card__text">
                <span className="resume-card__title">{game.title}</span>
                <span className="resume-card__when">Played {relativeTime(lastPlayedAt)}</span>
              </span>
              <span className="resume-card__go" aria-hidden="true">
                Continue →
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SearchIcon() {
  return (
    <svg className="library-search__icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.75" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="m13 13 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Search, filters and order: one quiet bar above the games. */
function LibraryToolbar({
  filters,
  onChange,
  total,
}: {
  filters: LibraryFilters;
  onChange: (filters: LibraryFilters) => void;
  total: number;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  // "/" jumps to the search field, as on many sites.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form className="library-toolbar" role="search" onSubmit={(event) => event.preventDefault()}>
      <label className="library-search">
        <SearchIcon />
        <span className="visually-hidden">Search games</span>
        <input
          ref={searchRef}
          type="search"
          placeholder={`Search ${total} games`}
          title="Search by title, author, year or style"
          value={filters.query}
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filters.query) {
              event.preventDefault();
              onChange({ ...filters, query: '' });
            }
          }}
        />
        <kbd className="library-search__hint" aria-hidden="true">
          /
        </kbd>
      </label>
      <div className="library-toolbar__row">
        <fieldset className="chip-group library-chips">
          <legend className="visually-hidden">Interface style</legend>
          {(['any', ...INTERFACE_STYLES] as const).map((style) => (
            <label key={style} className="chip">
              <input
                type="radio"
                name="interface"
                value={style}
                checked={filters.interfaceStyle === style}
                onChange={() => onChange({ ...filters, interfaceStyle: style })}
              />
              <span>{style === 'any' ? 'All' : INTERFACE_LABELS[style]}</span>
            </label>
          ))}
          <span className="library-chips__rule" aria-hidden="true" />
          <label className="chip">
            <input
              type="checkbox"
              checked={filters.touchOnly}
              onChange={(event) => onChange({ ...filters, touchOnly: event.target.checked })}
            />
            <span>Touch controls</span>
          </label>
        </fieldset>
        <label className="library-sort">
          <span className="library-sort__label">Sort</span>
          <select
            value={filters.sort}
            onChange={(event) => onChange({ ...filters, sort: event.target.value as LibrarySort })}
          >
            {LIBRARY_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </form>
  );
}

function RoadmapList({ games }: { games: CatalogGame[] }) {
  return (
    <ol className="roadmap">
      {games.map((game) => (
        <li key={game.id} className="roadmap__item">
          <a href={href(`/games/${game.id}`)} className="roadmap__link">
            <span className="roadmap__glyph" aria-hidden="true">
              {game.glyph}
            </span>
            <span className="roadmap__text">
              <span className="roadmap__title">{game.title}</span>
              <span className="roadmap__rationale">{game.description}</span>
            </span>
            <span className="roadmap__meta">
              {game.firstReleased ? <span>{game.firstReleased}</span> : null}
              <span className="roadmap__author">{leadAuthor(game.authors)}</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export function LibraryPage() {
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const all = useMemo(() => librarySections(catalog.games, EMPTY_FILTERS), []);
  const sections = useMemo(() => librarySections(catalog.games, filters), [filters]);
  const recent = useRecentGames();
  const filtered = isFiltering(filters);
  const nextUp = filtered ? sections.roadmap : sections.roadmap.slice(0, NEXT_UP);
  const later = filtered ? [] : sections.roadmap.slice(NEXT_UP);
  const clear = () => setFilters({ ...EMPTY_FILTERS, sort: filters.sort });

  return (
    <div className="page library">
      <section className="hero">
        <h1 className="hero__title">Classic roguelikes, playable in your browser.</h1>
        <p className="hero__lede">
          Landmark games of the genre, built from their original source. No account, no installs; your saves
          stay on your device, and games you have opened work offline.
        </p>
      </section>

      {recent.length > 0 ? <ContinuePlaying recent={recent} /> : null}

      <section className="library-section" aria-labelledby="play-title">
        <div className="section-heading">
          <h2 id="play-title" className="section-title">
            Play now
          </h2>
          <div className="library-offline">
            <DownloadAll games={all.playable} />
          </div>
        </div>
        <LibraryToolbar filters={filters} onChange={setFilters} total={all.playable.length} />
        <p className="library-results" aria-live="polite">
          {filtered ? (
            <>
              {sections.playable.length} of {all.playable.length} games
              <button type="button" className="link-button" onClick={clear}>
                Clear filters
              </button>
            </>
          ) : (
            `${all.playable.length} games${filters.sort === 'featured' ? '' : `, ${SORT_LABELS[filters.sort].toLowerCase()}`}`
          )}
        </p>
        {sections.playable.length > 0 ? (
          <div className="game-grid">
            {sections.playable.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No games match{filters.query.trim() ? ` “${filters.query.trim()}”` : ' these filters'}.</p>
            <button type="button" className="button button--quiet button--small" onClick={clear}>
              Clear filters
            </button>
          </div>
        )}
      </section>

      {nextUp.length > 0 || later.length > 0 || sections.watchlist.length > 0 ? (
        <section className="library-section" aria-labelledby="roadmap-title">
          <div className="section-heading">
            <h2 id="roadmap-title" className="section-title">
              Coming next
            </h2>
            <p className="section-note">
              Not playable yet. A game is added only when it runs completely and its licensing is clear.
            </p>
          </div>
          {nextUp.length > 0 ? <RoadmapList games={nextUp} /> : null}
          {later.length > 0 || sections.watchlist.length > 0 ? (
            <details className="roadmap-more" open={filtered}>
              <summary>
                The full roadmap
                {later.length > 0 ? ` (${later.length} more)` : ''}
                {sections.watchlist.length > 0 ? ' and the watchlist' : ''}
              </summary>
              {later.length > 0 ? <RoadmapList games={later} /> : null}
              {sections.watchlist.length > 0 ? (
                <>
                  <h3 className="subsection-title">Watchlist</h3>
                  <p className="section-note">
                    Games we would like to include once their redistribution rights are resolved.
                  </p>
                  <ul className="watchlist">
                    {sections.watchlist.map((game) => (
                      <li key={game.id}>
                        <a href={href(`/games/${game.id}`)}>
                          <strong>{game.title}</strong>
                        </a>
                        <span> — {game.blockers[0]}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="library-section about-strip">
        <h2 className="section-title">How this archive works</h2>
        <div className="about-strip__grid">
          <p>
            <strong>Original games, faithfully built.</strong> Each game is compiled from its pinned upstream
            source. Rules, balance and permadeath are untouched.
          </p>
          <p>
            <strong>Local-first.</strong> Everything runs on your device. There is no server, account or
            telemetry, and you can export your saves at any time.
          </p>
          <p>
            <strong>Tested before it ships.</strong> A game joins the library once it builds from source and
            passes its tests; anything not yet working is listed on its page.{' '}
            <a href={repositoryFileUrl('CONTRIBUTING.md')}>Help port the next one.</a>
          </p>
        </div>
      </section>
    </div>
  );
}
