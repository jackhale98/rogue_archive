import type { GameModule } from '@rogue-archive/game-api';

/**
 * Lazy registry of game adapter packages. Each entry is a separate chunk, so
 * the library page never downloads adapter code (let alone game runtimes)
 * until a player opens a game.
 */
const ADAPTERS: Record<string, () => Promise<GameModule>> = {
  'brogue-ce': () => import('@rogue-archive/game-brogue-ce').then((m) => m.default),
};

export function loadAdapterModule(adapterId: string): Promise<GameModule> {
  const load = ADAPTERS[adapterId];
  if (!load) return Promise.reject(new Error(`No adapter is registered for "${adapterId}".`));
  return load();
}

export function hasAdapter(adapterId: string | undefined): boolean {
  return adapterId !== undefined && adapterId in ADAPTERS;
}
