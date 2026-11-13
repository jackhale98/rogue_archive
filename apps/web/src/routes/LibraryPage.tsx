import {
  INTERFACE_STYLES,
  isLaunchable,
  type CatalogGame,
  type InterfaceStyle,
} from '@rogue-archive/catalog';
import { useEffect, useMemo, useState } from 'react';
import { catalog, gamesById } from '../app/catalog.ts';
import { repositoryFileUrl } from '../app/config.ts';
import { href } from '../app/router.ts';
import { getStore } from '../app/store.ts';
import { GameCard } from '../components/GameCard.tsx';
import { GameCover } from '../components/GameCover.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { EMPTY_FILTERS, librarySections, type LibraryFilters } from '../features/library/filter.ts';
import { DownloadAll } from '../features/offline/OfflineControls.tsx';
import { relativeTime } from '../lib/relative-time.ts';

const INTERFACE_LABELS: Record<InterfaceStyle, string> = {
  ascii: 'Text',
  tiles: 'Tiles',
  graphical: 'Graphical',
};
const EFFORT_LABELS = {
  low: 'Low',
  'low-medium': 'Low–medium',
  medium: 'Medium',
  'medium-high': 'Medium–high',
  high: 'High',
};
/** Search and filters appear once there are enough playable games to need them. */
const FILTERS_FROM = 8;
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

function Filters({
  filters,
  onChange,
}: {
  filters: LibraryFilters;
  onChange: (filters: LibraryFilters) => void;
}) {
  return (
    <form className="filters" role="search" onSubmit={(event) => event.preventDefault()}>
      <label className="filters__search">
        <span className="visually-hidden">Search games</span>
        <input
          type="search"
          placeholder="Search by title, author or style"
          value={filters.query}
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
        />
      </label>
      <fieldset className="chip-group">
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
            <span>{style === 'any' ? 'All styles' : INTERFACE_LABELS[style]}</span>
          </label>
        ))}
        <label className="chip">
          <input
            type="checkbox"
            checked={filters.touchOnly}
            onChange={(event) => onChange({ ...filters, touchOnly: event.target.checked })}
          />
          <span>Touch controls</span>
        </label>
      </fieldset>
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
              <span className="roadmap__rationale">{game.rationale ?? game.description}</span>
            </span>
            <span className="roadmap__meta">
              <StatusBadge status={game.status} />
              {game.effort ? (
                <span className="roadmap__effort">Effort: {EFFORT_LABELS[game.effort]}</span>
              ) : null}
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
  const showFilters = all.playable.length >= FILTERS_FROM;
  const sections = useMemo(
    () => (showFilters ? librarySections(catalog.games, filters) : all),
    [all, filters, showFilters],
  );
  const recent = useRecentGames();
  const filtered =
    showFilters && (filters.query.trim() !== '' || filters.interfaceStyle !== 'any' || filters.touchOnly);
  const resultCount = sections.playable.length + sections.roadmap.length + sections.watchlist.length;
  const nextUp = filtered ? sections.roadmap : sections.roadmap.slice(0, NEXT_UP);
  const later = filtered ? [] : sections.roadmap.slice(NEXT_UP);

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
          <p className="section-note" aria-live="polite">
            {filtered
              ? `${resultCount} ${resultCount === 1 ? 'game matches' : 'games match'}`
              : `${all.playable.length} games ready to play · ${catalog.games.length} catalogued`}
          </p>
        </div>
        <div className="library-offline">
          <DownloadAll games={all.playable} />
        </div>
        {showFilters ? <Filters filters={filters} onChange={setFilters} /> : null}
        {sections.playable.length > 0 ? (
          <div className="game-grid">
            {sections.playable.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        ) : (
          <p className="empty-state">No playable games match these filters.</p>
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

      {filtered && resultCount === 0 ? <p className="empty-state">No games match these filters.</p> : null}

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
            <strong>Honest about status.</strong> Games are marked playable only after they pass their tests;
            known limitations are listed on each game's page.{' '}
            <a href={repositoryFileUrl('CONTRIBUTING.md')}>Help port the next one.</a>
          </p>
        </div>
      </section>
    </div>
  );
}
