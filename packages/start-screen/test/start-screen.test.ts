import { describe, expect, it } from 'vitest';
import { randomName } from '../src/index.ts';

describe('randomName', () => {
  it('makes a name every start screen accepts', () => {
    for (let i = 0; i < 50; i++) expect(randomName()).toMatch(/^[A-Z][a-z]{1,8}$/);
    expect(randomName(() => 0)).toBe('Ala');
    expect(randomName(() => 0.999)).toBe('Zanys');
  });
});
