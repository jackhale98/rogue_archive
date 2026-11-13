/**
 * The `.roguearchive` save export format (version 1).
 *
 * A UTF-8 JSON document holding the original save files byte-for-byte
 * (base64), a SHA-256 checksum per file, and provenance metadata. Imported
 * content is only ever written back into the game's save area as data; it is
 * never executed. See docs/architecture/storage.md.
 */
import type { SaveFile } from '@rogue-archive/game-api';

export const SAVE_ARCHIVE_FORMAT = 'rogue-archive-saves';
export const SAVE_ARCHIVE_FORMAT_VERSION = 1;
export const SAVE_ARCHIVE_EXTENSION = '.roguearchive';
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 512;

export interface SaveArchiveMeta {
  gameId: string;
  gameVersion: string;
  sourceRevision: string;
  portBuildId: string;
}

export interface SaveArchive extends SaveArchiveMeta {
  exportedAt: string;
  files: SaveFile[];
}

interface EncodedFile {
  path: string;
  size: number;
  sha256: string;
  modifiedAt: number;
  data: string;
}

export class SaveArchiveError extends Error {
  override name = 'SaveArchiveError';
}

/** Save paths are plain relative names: no traversal, no absolute paths, no control characters. */
export function isSafeSavePath(path: string): boolean {
  if (!path || path.length > 255) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(path)) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encodeSaveArchive(
  meta: SaveArchiveMeta,
  files: SaveFile[],
  now = new Date(),
): Promise<Uint8Array> {
  const encoded: EncodedFile[] = [];
  for (const file of files) {
    if (!isSafeSavePath(file.path))
      throw new SaveArchiveError(`Refusing to export unsafe path: ${file.path}`);
    encoded.push({
      path: file.path,
      size: file.bytes.length,
      sha256: await sha256Hex(file.bytes),
      modifiedAt: file.modifiedAt,
      data: toBase64(file.bytes),
    });
  }
  const doc = {
    format: SAVE_ARCHIVE_FORMAT,
    formatVersion: SAVE_ARCHIVE_FORMAT_VERSION,
    ...meta,
    exportedAt: now.toISOString(),
    files: encoded,
  };
  return new TextEncoder().encode(JSON.stringify(doc, null, 1));
}

function req<T>(value: unknown, check: (v: unknown) => v is T, field: string): T {
  if (!check(value)) throw new SaveArchiveError(`Invalid or missing field: ${field}`);
  return value;
}
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parses and fully validates an archive before anything is written. */
export async function decodeSaveArchive(bytes: Uint8Array, expectedGameId: string): Promise<SaveArchive> {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new SaveArchiveError('Archive is too large.');
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Record<string, unknown>;
  } catch {
    throw new SaveArchiveError('This file is not a Rogue Archive save export.');
  }
  if (typeof doc !== 'object' || doc === null || doc.format !== SAVE_ARCHIVE_FORMAT) {
    throw new SaveArchiveError('This file is not a Rogue Archive save export.');
  }
  if (doc.formatVersion !== SAVE_ARCHIVE_FORMAT_VERSION) {
    throw new SaveArchiveError(`Unsupported save export version: ${String(doc.formatVersion)}`);
  }
  const gameId = req(doc.gameId, isString, 'gameId');
  if (gameId !== expectedGameId) {
    throw new SaveArchiveError(`These saves belong to "${gameId}", not "${expectedGameId}".`);
  }
  const rawFiles = req(doc.files, Array.isArray, 'files') as unknown[];
  if (rawFiles.length > MAX_FILES) throw new SaveArchiveError('Archive contains too many files.');

  const seen = new Set<string>();
  const files: SaveFile[] = [];
  for (const raw of rawFiles) {
    const entry = raw as Record<string, unknown>;
    const path = req(entry.path, isString, 'files[].path');
    if (!isSafeSavePath(path)) throw new SaveArchiveError(`Unsafe file path in archive: ${path}`);
    if (seen.has(path)) throw new SaveArchiveError(`Duplicate file in archive: ${path}`);
    seen.add(path);
    const data = fromBase64(req(entry.data, isString, 'files[].data'));
    if (data.length !== req(entry.size, isNumber, 'files[].size')) {
      throw new SaveArchiveError(`Size mismatch for ${path}`);
    }
    if ((await sha256Hex(data)) !== req(entry.sha256, isString, 'files[].sha256')) {
      throw new SaveArchiveError(`Checksum mismatch for ${path}; the file may be corrupt.`);
    }
    files.push({ path, bytes: data, modifiedAt: req(entry.modifiedAt, isNumber, 'files[].modifiedAt') });
  }

  return {
    gameId,
    gameVersion: req(doc.gameVersion, isString, 'gameVersion'),
    sourceRevision: req(doc.sourceRevision, isString, 'sourceRevision'),
    portBuildId: req(doc.portBuildId, isString, 'portBuildId'),
    exportedAt: req(doc.exportedAt, isString, 'exportedAt'),
    files,
  };
}
