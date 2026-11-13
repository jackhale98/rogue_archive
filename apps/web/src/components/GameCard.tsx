import { isLaunchable, type CatalogGame } from '@rogue-archive/catalog';
import { href } from '../app/router.ts';
import { GameCover } from './GameCover.tsx';
import { StatusBadge } from './StatusBadge.tsx';

const INTERFACE_LABELS = { ascii: 'Text', tiles: 'Tiles', graphical: 'Graphical' } as const;

export function GameCard({ game }: { game: CatalogGame }) {
  return (
    <article className="game-card">
      <a className="game-card__link" href={href(`/games/${game.id}`)}>
        <GameCover game={game} className="game-card__cover" />
        <div className="game-card__body">
          <div className="game-card__meta">
            <StatusBadge status={game.status} />
            {game.firstReleased ? <span className="game-card__year">{game.firstReleased}</span> : null}
          </div>
          <h3 className="game-card__title">{game.title}</h3>
          <p className="game-card__subtitle">{game.subtitle}</p>
          <p className="game-card__description">{game.description}</p>
          <ul className="tag-list" aria-label="Interface and input">
            {game.interface.map((style) => (
              <li key={style}>{INTERFACE_LABELS[style]}</li>
            ))}
            {isLaunchable(game) && game.input.touch ? <li>Touch</li> : null}
          </ul>
        </div>
      </a>
    </article>
  );
}
