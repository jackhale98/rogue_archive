import { describe, expect, it } from 'vitest';
import { mergeLog } from './useGameSession.ts';

const entry = (id: number, text: string) => ({ id, runs: [{ text }] });

describe('mergeLog', () => {
  it('appends new entries and replaces updated ones in place', () => {
    const first = mergeLog([], false, [entry(1, 'a'), entry(2, 'b')]);
    const next = mergeLog(first, false, [entry(2, 'b (x2)'), entry(3, 'c')]);
    expect(next.map((e) => e.runs[0]!.text)).toEqual(['a', 'b (x2)', 'c']);
  });

  it('starts over on reset and keeps only the most recent entries', () => {
    expect(mergeLog([entry(1, 'old')], true, [entry(9, 'new')]).map((e) => e.id)).toEqual([9]);
    const many = Array.from({ length: 1200 }, (_, i) => entry(i + 1, String(i)));
    const capped = mergeLog([], false, many);
    expect(capped).toHaveLength(1000);
    expect(capped[0]!.id).toBe(201);
  });
});
