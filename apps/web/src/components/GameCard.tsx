import { isLaunchable, type CatalogGame } from '@rogue-archive/catalog';
import { href } from '../app/router.ts';
import { OfflineButton } from '../features/offline/OfflineControls.tsx';
import { GameCover } from './GameCover.tsx';
import { StatusBadge } from './StatusBadge.tsx';

const INTERFACE_LABELS = { ascii: 'Text', tiles: 'Tiles', graphical: 'Graphical' } as const;

/** A game in the library: cover, what it is, and Play / Details. */
export function GameCard({ game }: { game: CatalogGame }) {
  const details = href(`/games/${game.id}`);
  return (
    <article className="game-card">
      <a className="game-card__art" href={details} tabIndex={-1} aria-hidden="true">
        <GameCover game={game} className="game-card__cover" />
      </a>
      <div className="game-card__body">
        <div className="game-card__meta">
          <StatusBadge status={game.status} />
          {game.firstReleased ? <span>{game.firstReleased}</span> : null}
        </div>
        <h3 className="game-card__title">
          <a href={details}>{game.title}</a>
        </h3>
        <p className="game-card__subtitle">{game.subtitle}</p>
        <p className="game-card__description">{game.description}</p>
        <ul className="tag-list" aria-label="Interface and input">
          {game.interface.map((style) => (
            <li key={style}>{INTERFACE_LABELS[style]}</li>
          ))}
          {isLaunchable(game) && game.input.touch ? <li>Touch</li> : null}
        </ul>
        {isLaunchable(game) ? (
          <div className="game-card__actions">
            <a className="button button--primary button--small" href={href(`/play/${game.id}`)}>
              Play<span className="visually-hidden"> {game.title}</span>
            </a>
            <a className="button button--quiet button--small" href={details}>
              Details<span className="visually-hidden"> about {game.title}</span>
            </a>
            <OfflineButton game={game} />
          </div>
        ) : null}
      </div>
    </article>
  );
}
