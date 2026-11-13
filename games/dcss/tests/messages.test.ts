import { describe, expect, it } from 'vitest';
import { formattedToRuns, MessageLog, PALETTE, plainText } from '../adapter/messages.ts';

describe('DCSS formatted strings', () => {
  it('turns colour tags into coloured runs', () => {
    expect(formattedToRuns('You hit the <lightred>jackal</lightred>!')).toEqual([
      { text: 'You hit the ' },
      { text: 'jackal', color: PALETTE[12] },
      { text: '!' },
    ]);
  });

  it('keeps unclosed tags open, restores the outer colour after a close, and drops backgrounds', () => {
    expect(formattedToRuns('<yellow>a<blue>b</blue>c<bg:red>d')).toEqual([
      { text: 'a', color: PALETTE[14] },
      { text: 'b', color: PALETTE[1] },
      { text: 'cd', color: PALETTE[14] },
    ]);
  });

  it('treats << as a literal < and leaves unknown tags as text', () => {
    expect(plainText('a <<b> <notacolour> c > d')).toBe('a <b> <notacolour> c > d');
  });
});

describe('DCSS message log', () => {
  it('appends messages with turn groups and repeat counts', () => {
    const log = new MessageLog();
    const update = log.apply({
      messages: [
        { text: '<yellow>Welcome.</yellow>', turn: 0 },
        { text: 'You hit it.', turn: 3, repeats: 2 },
        { text: '   ' },
      ],
    });
    expect(update?.reset).toBe(false);
    expect(update?.entries.map((entry) => entry.runs.map((run) => run.text).join(''))).toEqual([
      'Welcome.',
      'You hit it. x2',
    ]);
    expect(update?.entries[1]?.group).toBe('turn 3');
  });

  it('applies rollbacks by resending the whole log', () => {
    const log = new MessageLog();
    log.apply({ messages: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] });
    const update = log.apply({ rollback: 1, messages: [{ text: 'three x2' }] });
    expect(update?.reset).toBe(true);
    expect(update?.entries.map((entry) => entry.runs[0]?.text)).toEqual(['one', 'two', 'three x2']);
    // Ids keep increasing, so the shell can merge.
    const ids = update!.entries.map((entry) => entry.id);
    expect(ids[2]).toBeGreaterThan(ids[1]!);
  });
});
