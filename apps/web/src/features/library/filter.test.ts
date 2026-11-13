import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { withDefaults } from '@rogue-archive/catalog';
import { parseRoute } from '../../app/router.ts';
import { EMPTY_FILTERS, librarySections } from './filter.ts';

const catalog = withDefaults(
  JSON.parse(readFileSync(new URL('../../../../../games/catalog.json', import.meta.url), 'utf8')),
);

describe('librarySections', () => {
  it('separates playable games, the roadmap and the watchlist in priority order', () => {
    const sections = librarySections(catalog.games, EMPTY_FILTERS);
    expect(sections.playable.map((g) => g.id)).toEqual(['brogue-ce', 'dcss', 'sil-q', 'rogue', 'hyperrogue']);
    expect(sections.roadmap[0]!.id).toBe('nethack');
    expect(sections.roadmap.map((g) => g.priority)).toEqual(
      [...sections.roadmap.map((g) => g.priority)].sort((a, b) => a - b),
    );
    expect(sections.watchlist.map((g) => g.id).sort()).toEqual(['gearhead', 'tome']);
  });

  it('searches titles, authors and tags, ignoring case and accents', () => {
    expect(librarySections(catalog.games, { ...EMPTY_FILTERS, query: 'BROGUE' }).playable).toHaveLength(1);
    expect(
      librarySections(catalog.games, { ...EMPTY_FILTERS, query: 'tornqvist' }).roadmap.map((g) => g.id),
    ).toEqual(['infra-arcana']);
    const none = librarySections(catalog.games, { ...EMPTY_FILTERS, query: 'zzzz' });
    expect(none.playable.length + none.roadmap.length + none.watchlist.length).toBe(0);
  });

  it('filters by interface style and touch support', () => {
    const graphical = librarySections(catalog.games, { ...EMPTY_FILTERS, interfaceStyle: 'graphical' });
    expect(graphical.playable.map((g) => g.id)).toEqual(['hyperrogue']);
    expect(graphical.roadmap.every((g) => g.interface.includes('graphical'))).toBe(true);
    const touch = librarySections(catalog.games, { ...EMPTY_FILTERS, touchOnly: true });
    expect(touch.playable.map((g) => g.id)).toEqual(['brogue-ce', 'dcss', 'sil-q', 'rogue', 'hyperrogue']);
    expect(touch.roadmap).toHaveLength(0);
  });
});

describe('parseRoute', () => {
  it('parses hash routes', () => {
    expect(parseRoute('')).toEqual({ name: 'library' });
    expect(parseRoute('#/')).toEqual({ name: 'library' });
    expect(parseRoute('#/games/brogue-ce')).toEqual({ name: 'game', id: 'brogue-ce' });
    expect(parseRoute('#/play/brogue-ce')).toEqual({ name: 'play', id: 'brogue-ce' });
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('#/games/a/b')).toEqual({ name: 'not-found', path: '/games/a/b' });
  });
});
