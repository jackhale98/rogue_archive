/**
 * Catalog types, constants and helpers. The Zod schema lives in ./schema.ts
 * and runs in CI and tooling; the web app imports only this module, so the
 * validator is never shipped to browsers.
 */
import type { CatalogData, CatalogGame } from './schema.ts';

export type { CatalogData, CatalogGame } from './schema.ts';
export const GAME_STATUSES = [
  'planned',
  'researching',
  'blocked',
  'prototype',
  'experimental',
  'playable',
  'deprecated',
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

/** Statuses that may be launched from the library. */
export const LAUNCHABLE_STATUSES: readonly GameStatus[] = ['experimental', 'playable', 'deprecated'];

export const INTERFACE_STYLES = ['ascii', 'tiles', 'graphical'] as const;
export type InterfaceStyle = (typeof INTERFACE_STYLES)[number];

export const RENDER_MODES = ['terminal-fit', 'tile-map', 'native-canvas', 'custom'] as const;
export const EFFORT_LEVELS = ['low', 'low-medium', 'medium', 'medium-high', 'high'] as const;

export function isLaunchable(game: Pick<CatalogGame, 'status'>): boolean {
  return LAUNCHABLE_STATUSES.includes(game.status);
}

export const STATUS_LABELS: Record<GameStatus, string> = {
  planned: 'Planned',
  researching: 'Researching',
  blocked: 'Blocked',
  prototype: 'Prototype',
  experimental: 'Experimental',
  playable: 'Playable',
  deprecated: 'Deprecated',
};

type RawGame = Partial<CatalogGame> & Pick<CatalogGame, 'id'>;

/**
 * Applies the schema's defaults to catalog JSON that CI has already validated
 * (tools/validate-catalog.ts and the catalog unit test), without Zod.
 */
export function withDefaults(raw: { schemaVersion: 1; games: RawGame[] }): CatalogData {
  return {
    schemaVersion: 1,
    games: raw.games.map(
      (game) =>
        ({
          about: [],
          offline: false,
          tags: [],
          glyph: '@',
          controlsSummary: [],
          knownLimitations: [],
          blockers: [],
          compatibility: [],
          ...game,
        }) as CatalogGame,
    ),
  };
}
