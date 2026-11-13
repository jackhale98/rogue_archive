/**
 * Zod schema for games/catalog.json, the single source of truth for the
 * library. Cards, detail pages, filters and the roadmap are generated from it.
 */
import { z } from 'zod';
import {
  EFFORT_LEVELS,
  GAME_STATUSES,
  INTERFACE_STYLES,
  LAUNCHABLE_STATUSES,
  RENDER_MODES,
} from './index.ts';

const url = z.url({ protocol: /^https$/ });
const nonEmpty = z.string().trim().min(1);

const GameEntry = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are lowercase kebab-case'),
    title: nonEmpty,
    subtitle: nonEmpty,
    description: nonEmpty.max(280),
    about: z.array(nonEmpty).default([]),
    status: z.enum(GAME_STATUSES),
    /** Position in the post-launch expansion order (lower first). */
    priority: z.number().int().nonnegative(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    rationale: z.string().optional(),
    firstReleased: z.number().int().min(1970).max(2100).optional(),
    authors: nonEmpty,
    upstream: z.object({
      name: nonEmpty,
      website: url.optional(),
      repository: url.optional(),
    }),
    version: z.string().optional(),
    sourceRevision: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .optional(),
    license: z.object({
      code: nonEmpty,
      assets: nonEmpty,
      report: z.string().optional(),
    }),
    interface: z.array(z.enum(INTERFACE_STYLES)).min(1),
    renderMode: z.enum(RENDER_MODES).optional(),
    input: z.object({ keyboard: z.boolean(), mouse: z.boolean(), touch: z.boolean() }),
    saves: z.object({ local: z.boolean(), export: z.boolean() }).optional(),
    offline: z.boolean().default(false),
    tags: z.array(nonEmpty).default([]),
    adapter: z.string().optional(),
    runtimeManifest: z.string().optional(),
    /** A characteristic glyph used for the typographic cover when there is no artwork. */
    glyph: z.string().min(1).max(2).default('@'),
    cover: z
      .object({ src: nonEmpty, alt: nonEmpty, width: z.number().int(), height: z.number().int() })
      .optional(),
    controlsSummary: z.array(z.object({ keys: nonEmpty, action: nonEmpty })).default([]),
    knownLimitations: z.array(nonEmpty).default([]),
    blockers: z.array(nonEmpty).default([]),
    compatibility: z
      .array(
        z.object({
          environment: nonEmpty,
          result: z.enum(['pass', 'partial', 'fail', 'untested']),
          notes: z.string().optional(),
        }),
      )
      .default([]),
  })
  .superRefine((game, ctx) => {
    const launchable = LAUNCHABLE_STATUSES.includes(game.status) || game.status === 'prototype';
    if (launchable) {
      for (const field of ['adapter', 'runtimeManifest', 'sourceRevision', 'version'] as const) {
        if (!game[field])
          ctx.addIssue({ code: 'custom', message: `${game.status} games require ${field}`, path: [field] });
      }
      if (!game.license.report) {
        ctx.addIssue({
          code: 'custom',
          message: 'launchable games require a license report',
          path: ['license', 'report'],
        });
      }
      if (!game.saves)
        ctx.addIssue({
          code: 'custom',
          message: 'launchable games must declare save support',
          path: ['saves'],
        });
    }
    if (game.status === 'blocked' && game.blockers.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'blocked games must name their blockers', path: ['blockers'] });
    }
  });

export const Catalog = z
  .object({
    schemaVersion: z.literal(1),
    games: z.array(GameEntry).min(1),
  })
  .superRefine((catalog, ctx) => {
    const ids = new Set<string>();
    catalog.games.forEach((game, index) => {
      if (ids.has(game.id))
        ctx.addIssue({ code: 'custom', message: `duplicate id ${game.id}`, path: ['games', index, 'id'] });
      ids.add(game.id);
    });
  });

export type CatalogData = z.infer<typeof Catalog>;
export type CatalogGame = z.infer<typeof GameEntry>;

export function parseCatalog(data: unknown): CatalogData {
  return Catalog.parse(data);
}
