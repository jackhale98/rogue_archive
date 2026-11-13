// Validates games/catalog.json against the schema and checks that referenced
// files exist. Run with: node --experimental-strip-types tools/validate-catalog.ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLaunchable } from '../packages/catalog/src/index.ts';
import { Catalog } from '../packages/catalog/src/schema.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw: unknown = JSON.parse(readFileSync(join(root, 'games/catalog.json'), 'utf8'));
const result = Catalog.safeParse(raw);
if (!result.success) {
  for (const issue of result.error.issues) console.error(`✗ ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const problems: string[] = [];
for (const game of result.data.games) {
  if (game.license.report && !existsSync(join(root, game.license.report))) {
    problems.push(`${game.id}: license report ${game.license.report} does not exist`);
  }
  if (game.cover && !existsSync(join(root, 'apps/web/public', game.cover.src))) {
    problems.push(`${game.id}: cover ${game.cover.src} does not exist`);
  }
  if (isLaunchable(game)) {
    const gameDir = join(root, 'games', game.id);
    for (const doc of ['BUILDING.md', 'PORTING.md', 'LICENSES.md']) {
      if (!existsSync(join(gameDir, doc))) problems.push(`${game.id}: missing games/${game.id}/${doc}`);
    }
    if (!existsSync(join(root, 'docs/games', `${game.id}-feasibility.md`))) {
      problems.push(`${game.id}: missing docs/games/${game.id}-feasibility.md`);
    }
  }
}
if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log(`✓ catalog: ${result.data.games.length} games valid`);
