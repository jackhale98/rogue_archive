import { INTERFACE_STYLES, type CatalogGame, type InterfaceStyle } from '@rogue-archive/catalog';
import { useEffect, useMemo, useState } from 'react';
import { catalog, gamesById } from '../app/catalog.ts';
import { repositoryFileUrl } from '../app/config.ts';
import { href } from '../app/router.ts';
import { getStore } from '../app/store.ts';
import { GameCard } from '../components/GameCard.tsx';
import { GameCover } from '../components/GameCover.tsx';
import { StatusBadge } from '../components/StatusBadge.tsx';
import { EMPTY_FILTERS, librarySections, type LibraryFilters } from '../features/library/filter.ts';

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

function useRecentGames(): CatalogGame[] {
  const [recent, setRecent] = useState<CatalogGame[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getStore().then(async (store) => {
      const entries = (await store?.listRecentGames()) ?? [];
      if (!cancelled)
        setRecent(entries.map((entry) => gamesById.get(entry.gameId)).filter((game) => game !== undefined));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return recent;
}

function Featured({ game }: { game: CatalogGame }) {
  return (
    <section className="featured" aria-labelledby="featured-title">
      <div className="featured__art">
        <GameCover game={game} eager />
      </div>
      <div className="featured__copy">
        <p className="eyebrow">Featured · play now</p>
        <h2 id="featured-title" className="featured__title">
          {game.title} <span className="featured__subtitle">{game.subtitle}</span>
        </h2>
        <p className="featured__description">{game.description}</p>
        <div className="featured__actions">
          <a className="button button--primary" href={href(`/play/${game.id}`)}>
            Play {game.title}
          </a>
          <a className="button button--quiet" href={href(`/games/${game.id}`)}>
            Details & controls
          </a>
        </div>
        <StatusBadge status={game.status} />
      </div>
    </section>
  );
}

export function LibraryPage() {
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const sections = useMemo(() => librarySections(catalog.games, filters), [filters]);
  const featured = useMemo(() => librarySections(catalog.games, EMPTY_FILTERS).playable[0], []);
  const recent = useRecentGames();
  const filtered = filters.query.trim() !== '' || filters.interfaceStyle !== 'any' || filters.touchOnly;
  const resultCount = sections.playable.length + sections.roadmap.length + sections.watchlist.length;

  return (
    <div className="page library">
      <section className="hero">
        <h1 className="hero__title">Classic roguelikes, playable in your browser.</h1>
        <p className="hero__lede">
          A curated archive of the genre's landmark games, built from their original source. No account, no
          installs. Your saves stay on your device.
        </p>
      </section>

      {featured ? <Featured game={featured} /> : null}

      {recent.length > 0 ? (
        <section className="library-section" aria-labelledby="recent-title">
          <h2 id="recent-title" className="section-title">
            Continue playing
          </h2>
          <ul className="recent-list">
            {recent.map((game) => (
              <li key={game.id}>
                <a className="recent-chip" href={href(`/play/${game.id}`)}>
                  <span aria-hidden="true" className="recent-chip__glyph">
                    {game.glyph}
                  </span>
                  {game.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="library-section" aria-labelledby="browse-title">
        <div className="section-heading">
          <h2 id="browse-title" className="section-title">
            The archive
          </h2>
          <p className="section-note" aria-live="polite">
            {filtered
              ? `${resultCount} ${resultCount === 1 ? 'game matches' : 'games match'}`
              : `${catalog.games.length} games catalogued`}
          </p>
        </div>
        <form className="filters" role="search" onSubmit={(event) => event.preventDefault()}>
          <label className="filters__search">
            <span className="visually-hidden">Search games</span>
            <input
              type="search"
              placeholder="Search by title, author or style"
              value={filters.query}
              onChange={(event) => setFilters({ ...filters, query: event.target.value })}
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
                  onChange={() => setFilters({ ...filters, interfaceStyle: style })}
                />
                <span>{style === 'any' ? 'All styles' : INTERFACE_LABELS[style]}</span>
              </label>
            ))}
            <label className="chip">
              <input
                type="checkbox"
                checked={filters.touchOnly}
                onChange={(event) => setFilters({ ...filters, touchOnly: event.target.checked })}
              />
              <span>Touch controls</span>
            </label>
          </fieldset>
        </form>

        <h3 className="subsection-title">Play now</h3>
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

      {sections.roadmap.length > 0 ? (
        <section className="library-section" aria-labelledby="roadmap-title">
          <div className="section-heading">
            <h2 id="roadmap-title" className="section-title">
              On the roadmap
            </h2>
            <p className="section-note">
              Not playable yet. Each game is added only when it runs completely and its licensing is clear.
            </p>
          </div>
          <ol className="roadmap">
            {sections.roadmap.map((game) => (
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
        </section>
      ) : null}

      {sections.watchlist.length > 0 ? (
        <section className="library-section" aria-labelledby="watchlist-title">
          <div className="section-heading">
            <h2 id="watchlist-title" className="section-title">
              Watchlist
            </h2>
            <p className="section-note">
              Games we would like to include once their redistribution rights are resolved.
            </p>
          </div>
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
        </section>
      ) : null}

      {resultCount === 0 ? <p className="empty-state">No games match these filters.</p> : null}

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
