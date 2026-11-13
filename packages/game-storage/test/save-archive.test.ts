import { describe, expect, it } from 'vitest';
import { SaveArchiveError, decodeSaveArchive, encodeSaveArchive, isSafeSavePath } from '../src/index.ts';

const meta = {
  gameId: 'brogue-ce',
  gameVersion: '1.15.1',
  sourceRevision: 'abc',
  portBuildId: '0123456789abcdef',
};
const files = [
  { path: 'Saved game.broguesave', bytes: new Uint8Array([0, 1, 2, 255]), modifiedAt: 1700000000000 },
  { path: 'BrogueHighScores.txt', bytes: new TextEncoder().encode('scores'), modifiedAt: 1700000000001 },
];

describe('save archive', () => {
  it('round-trips files byte for byte', async () => {
    const bytes = await encodeSaveArchive(meta, files, new Date('2026-01-02T03:04:05Z'));
    const archive = await decodeSaveArchive(bytes, 'brogue-ce');
    expect(archive.exportedAt).toBe('2026-01-02T03:04:05.000Z');
    expect(archive.gameVersion).toBe('1.15.1');
    expect(archive.files.map((f) => f.path)).toEqual(files.map((f) => f.path));
    expect(Array.from(archive.files[0]!.bytes)).toEqual([0, 1, 2, 255]);
  });

  it('rejects saves for another game', async () => {
    const bytes = await encodeSaveArchive(meta, files);
    await expect(decodeSaveArchive(bytes, 'nethack')).rejects.toThrow(/belong to "brogue-ce"/);
  });

  it('detects corruption through checksums', async () => {
    const doc = JSON.parse(new TextDecoder().decode(await encodeSaveArchive(meta, files)));
    doc.files[0].data = btoa('\u0000\u0001\u0002\u0003');
    const tampered = new TextEncoder().encode(JSON.stringify(doc));
    await expect(decodeSaveArchive(tampered, 'brogue-ce')).rejects.toThrow(/Checksum mismatch/);
  });

  it('rejects unsafe paths, duplicates and non-archives', async () => {
    const doc = JSON.parse(new TextDecoder().decode(await encodeSaveArchive(meta, files)));
    doc.files[0].path = '../escape';
    await expect(
      decodeSaveArchive(new TextEncoder().encode(JSON.stringify(doc)), 'brogue-ce'),
    ).rejects.toThrow(/Unsafe/);
    doc.files[0].path = doc.files[1].path;
    await expect(
      decodeSaveArchive(new TextEncoder().encode(JSON.stringify(doc)), 'brogue-ce'),
    ).rejects.toThrow();
    await expect(decodeSaveArchive(new TextEncoder().encode('not json'), 'brogue-ce')).rejects.toBeInstanceOf(
      SaveArchiveError,
    );
  });

  it('refuses to export unsafe paths', async () => {
    await expect(
      encodeSaveArchive(meta, [{ path: '/etc/passwd', bytes: new Uint8Array(), modifiedAt: 0 }]),
    ).rejects.toThrow();
  });

  it('classifies paths', () => {
    expect(isSafeSavePath('LastGame.broguesave')).toBe(true);
    expect(isSafeSavePath('a/b.txt')).toBe(true);
    for (const bad of ['', '/abs', '..', 'a/../b', 'a\\b', 'line\nbreak', 'x'.repeat(300)]) {
      expect(isSafeSavePath(bad)).toBe(false);
    }
  });
});
