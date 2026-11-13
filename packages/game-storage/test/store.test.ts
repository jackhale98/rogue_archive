import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openArchiveStore } from '../src/index.ts';

describe('ArchiveStore', () => {
  it('namespaces settings so scopes never collide', async () => {
    const store = await openArchiveStore('test-settings');
    await store.setSetting('platform', 'theme', 'dark');
    await store.setSetting('game:brogue-ce', 'theme', 'tiles');
    await store.setSetting('game:brogue-ce', 'tapMode', 'preview');
    expect(await store.getSetting('platform', 'theme')).toBe('dark');
    expect(await store.getSettings('game:brogue-ce')).toEqual({ theme: 'tiles', tapMode: 'preview' });
    expect(await store.getSettings('game:brogue')).toEqual({});
    store.close();
  });

  it('lists recently played games newest first', async () => {
    const store = await openArchiveStore('test-recent');
    await store.recordRecentGame('a', 1);
    await store.recordRecentGame('b', 3);
    await store.recordRecentGame('c', 2);
    await store.recordRecentGame('a', 4);
    expect((await store.listRecentGames(2)).map((g) => g.gameId)).toEqual(['a', 'b']);
    store.close();
  });
});
