import type { CatalogGame } from '@rogue-archive/catalog';
import { assetUrl } from '../app/catalog.ts';

interface Props {
  game: CatalogGame;
  eager?: boolean;
  className?: string;
}

/** Artwork when the catalog has it; otherwise a typographic cover built from the game's glyph. */
export function GameCover({ game, eager = false, className = '' }: Props) {
  if (game.cover) {
    return (
      <img
        className={`game-cover ${className}`}
        src={assetUrl(game.cover.src)}
        alt={game.cover.alt}
        width={game.cover.width}
        height={game.cover.height}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
      />
    );
  }
  return (
    <div className={`game-cover game-cover--glyph ${className}`} aria-hidden="true">
      <span className="game-cover__glyph">{game.glyph}</span>
      <span className="game-cover__title">{game.title}</span>
    </div>
  );
}
