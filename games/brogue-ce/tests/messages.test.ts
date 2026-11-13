import { describe, expect, it } from 'vitest';
import { decodeMessage, toLogEntry } from '../adapter/messages.ts';

const bytes = (text: string) => [...text].map((c) => c.charCodeAt(0));
const escape = (r: number, g: number, b: number) => [25, 25 + r, 25 + g, 25 + b];

describe('Brogue message archive entries', () => {
  it('decodes color escapes into colored runs', () => {
    const runs = decodeMessage([
      ...bytes('you hit the '),
      ...escape(100, 50, 0),
      ...bytes('jackal'),
      ...escape(100, 100, 100),
      ...bytes('!'),
    ]);
    expect(runs).toEqual([
      { text: 'you hit the ' },
      { text: 'jackal', color: 'rgb(255,128,0)' },
      { text: '!', color: 'rgb(255,255,255)' },
    ]);
  });

  it('drops a truncated escape at the end', () => {
    expect(decodeMessage([...bytes('ok'), 25, 30])).toEqual([{ text: 'ok' }]);
  });

  it('capitalizes, punctuates and shows repeat counts like Brogue', () => {
    const entry = toLogEntry({
      id: 4,
      turn: 152,
      count: 3,
      foldable: true,
      bytes: bytes('the rough stone wall is firm'),
    });
    expect(entry.id).toBe(4);
    expect(entry.group).toBe('Turn 152');
    expect(entry.runs.map((run) => run.text).join('')).toBe('The rough stone wall is firm. (x3)');
    const many = toLogEntry({ id: 5, turn: 1, count: 100, foldable: false, bytes: bytes('Done!') });
    expect(many.runs.map((run) => run.text).join('')).toBe('Done! (many)');
  });
});
