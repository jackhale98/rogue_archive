// Each game's runtime cache key in CI (and deploy) must cover every adapter
// file its engine conformance tests import, or a change to one could reuse a
// runtime whose checks never ran against it. The keys in ci.yml and
// deploy.yml must match, so deploy reuses what CI built and verified.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const keys = (workflow: string) => [
  ...read(workflow).matchAll(
    /key: (runtime-[a-z-]+)-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\(([^)]*)\) \}\}/g,
  ),
];

/** Adapter files a game's conformance tests import, directly or through other adapter files. */
function adapterClosure(game: string): string[] {
  const conformance = join(root, 'games', game, 'tests', 'conformance');
  const todo: string[] = [];
  for (const file of readdirSync(conformance)) {
    const source = readFileSync(join(conformance, file), 'utf8');
    for (const match of source.matchAll(/['"](\.\.\/\.\.\/adapter\/[\w-]+\.ts)['"]/g))
      todo.push(normalize(join(conformance, match[1]!)));
  }
  const seen = new Set<string>();
  while (todo.length) {
    const file = todo.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/from\s+['"](\.\/[\w-]+\.ts)['"]/g))
      todo.push(normalize(join(dirname(file), match[1]!)));
  }
  return [...seen].map((file) => relative(root, file)).sort();
}

describe('CI runtime cache keys', () => {
  const ci = keys('.github/workflows/ci.yml');

  it('are the same in ci.yml and deploy.yml', () => {
    expect(keys('.github/workflows/deploy.yml').map((m) => m[0])).toEqual(ci.map((m) => m[0]));
  });

  it("cover every adapter file each game's engine conformance imports", () => {
    expect(ci.length).toBeGreaterThan(0);
    for (const [, name, patterns] of ci) {
      const game = name!.replace(/^runtime-/, '');
      for (const file of adapterClosure(game))
        expect(patterns, `${name} should hash ${file}`).toContain(`'${file}'`);
    }
  });
});
