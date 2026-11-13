/**
 * Platform-managed local data in IndexedDB: settings and recently played
 * games. Game save files themselves live in each game's own virtual
 * filesystem store (e.g. Emscripten IDBFS) and are never touched here.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DB_NAME = 'rogue-archive';
const DB_VERSION = 1;

export interface RecentGame {
  gameId: string;
  lastPlayedAt: number;
}

interface ArchiveSchema extends DBSchema {
  settings: { key: string; value: unknown };
  'recent-games': { key: string; value: RecentGame; indexes: { lastPlayedAt: number } };
}

export interface ArchiveStore {
  getSetting<T>(scope: string, key: string): Promise<T | undefined>;
  setSetting(scope: string, key: string, value: unknown): Promise<void>;
  getSettings(scope: string): Promise<Record<string, unknown>>;
  recordRecentGame(gameId: string, at?: number): Promise<void>;
  listRecentGames(limit?: number): Promise<RecentGame[]>;
  close(): void;
}

function settingKey(scope: string, key: string): string {
  if (!scope || scope.includes('\u0000') || key.includes('\u0000')) throw new Error('Invalid setting key');
  return `${scope}\u0000${key}`;
}

export async function openArchiveStore(name = DB_NAME): Promise<ArchiveStore> {
  const db: IDBPDatabase<ArchiveSchema> = await openDB<ArchiveSchema>(name, DB_VERSION, {
    upgrade(database) {
      database.createObjectStore('settings');
      const recent = database.createObjectStore('recent-games', { keyPath: 'gameId' });
      recent.createIndex('lastPlayedAt', 'lastPlayedAt');
    },
  });

  return {
    async getSetting<T>(scope: string, key: string) {
      return (await db.get('settings', settingKey(scope, key))) as T | undefined;
    },
    async setSetting(scope, key, value) {
      await db.put('settings', value, settingKey(scope, key));
    },
    async getSettings(scope) {
      const prefix = settingKey(scope, '');
      const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
      const out: Record<string, unknown> = {};
      let cursor = await db.transaction('settings').store.openCursor(range);
      while (cursor) {
        out[String(cursor.key).slice(prefix.length)] = cursor.value;
        cursor = await cursor.continue();
      }
      return out;
    },
    async recordRecentGame(gameId, at = Date.now()) {
      await db.put('recent-games', { gameId, lastPlayedAt: at });
    },
    async listRecentGames(limit = 6) {
      const all = await db.getAllFromIndex('recent-games', 'lastPlayedAt');
      return all.reverse().slice(0, limit);
    },
    close() {
      db.close();
    },
  };
}
