import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isLaunchable, withDefaults } from '../src/index.ts';
import { Catalog, parseCatalog } from '../src/schema.ts';

const raw = JSON.parse(readFileSync(new URL('../../../games/catalog.json', import.meta.url), 'utf8'));

describe('games/catalog.json', () => {
  it('is valid', () => {
    expect(() => parseCatalog(raw)).not.toThrow();
  });

  it('matches what the web app derives without Zod', () => {
    expect(withDefaults(raw)).toEqual(parseCatalog(raw));
  });

  it('keeps Brogue CE first and DCSS second', () => {
    const order = parseCatalog(raw)
      .games.sort((a, b) => a.priority - b.priority)
      .map((g) => g.id);
    expect(order.slice(0, 2)).toEqual(['brogue-ce', 'dcss']);
  });

  it('never lists watchlist games as launchable', () => {
    for (const id of ['tome', 'gearhead']) {
      const game = parseCatalog(raw).games.find((g) => g.id === id)!;
      expect(game.status).toBe('blocked');
      expect(isLaunchable(game)).toBe(false);
    }
  });
});

describe('catalog schema rules', () => {
  const game = {
    id: 'example',
    title: 'Example',
    subtitle: 'x',
    description: 'x',
    status: 'planned',
    priority: 1,
    authors: 'x',
    upstream: { name: 'x' },
    license: { code: 'x', assets: 'x' },
    interface: ['ascii'],
    input: { keyboard: true, mouse: false, touch: false },
  };

  it('requires build provenance before a game can be launched', () => {
    const result = Catalog.safeParse({ schemaVersion: 1, games: [{ ...game, status: 'playable' }] });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining(['games.0.adapter', 'games.0.sourceRevision', 'games.0.license.report']),
    );
  });

  it('requires blocked games to name a blocker', () => {
    expect(Catalog.safeParse({ schemaVersion: 1, games: [{ ...game, status: 'blocked' }] }).success).toBe(
      false,
    );
  });

  it('rejects duplicate ids and bad ids', () => {
    expect(Catalog.safeParse({ schemaVersion: 1, games: [game, game] }).success).toBe(false);
    expect(Catalog.safeParse({ schemaVersion: 1, games: [{ ...game, id: 'Bad Id' }] }).success).toBe(false);
  });
});
