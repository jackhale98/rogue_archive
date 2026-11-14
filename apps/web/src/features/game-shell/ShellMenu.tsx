import type { CatalogGame } from '@rogue-archive/catalog';
import type { GameAdapter, GameSettingDescriptor, SaveFile } from '@rogue-archive/game-api';
import {
  SAVE_ARCHIVE_EXTENSION,
  decodeSaveArchive,
  encodeSaveArchive,
  isSafeSavePath,
  type SaveArchive,
} from '@rogue-archive/game-storage';
import { useEffect, useRef, useState } from 'react';
import { gameSettingsScope } from '../../app/settings.tsx';
import { getStore } from '../../app/store.ts';
import type { LoadedRuntime } from './runtime.ts';

interface Props {
  open: boolean;
  onClose(): void;
  onExit(): void;
  game: CatalogGame;
  adapter: GameAdapter;
  runtime: LoadedRuntime;
  settings: Record<string, unknown>;
  /** The command list as the game last laid it out (it can change with a setting). */
  palette?: readonly string[];
}

function downloadBytes(bytes: Uint8Array, filename: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ShellMenu({
  open,
  onClose,
  onExit,
  game,
  adapter,
  runtime,
  settings,
  palette: current,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<SaveArchive | null>(null);
  const [pendingIsNative, setPendingIsNative] = useState(false);
  const [saveFiles, setSaveFiles] = useState<SaveFile[] | null>(null);
  const nativeExtensions = adapter.nativeSaveExtensions ?? [];
  const isNativeFile = (name: string) => nativeExtensions.some((ext) => name.toLowerCase().endsWith(ext));
  const [values, setValues] = useState<Record<string, unknown>>(settings);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setMessage(null);
      setPendingImport(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await task();
      setMessage(text ? { text } : null);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    } finally {
      setBusy(false);
    }
  };

  const exportSaves = () =>
    run(async () => {
      if (!adapter.exportSaves) throw new Error('This game does not support save export.');
      const files = await adapter.exportSaves();
      if (files.length === 0) return 'There are no saved files to export yet.';
      const bytes = await encodeSaveArchive(
        {
          gameId: game.id,
          gameVersion: game.version ?? 'unknown',
          sourceRevision: game.sourceRevision ?? 'unknown',
          portBuildId: runtime.manifest.buildId,
        },
        files,
      );
      const date = new Date().toISOString().slice(0, 10);
      downloadBytes(bytes, `${game.id}-saves-${date}${SAVE_ARCHIVE_EXTENSION}`);
      return `Exported ${files.length} ${files.length === 1 ? 'file' : 'files'}.`;
    });

  const listFiles = () =>
    run(async () => {
      if (!adapter.exportSaves) throw new Error('This game does not support save export.');
      const files = (await adapter.exportSaves()).filter((file) => isNativeFile(file.path));
      setSaveFiles(files);
      return files.length === 0 ? 'There are no save files yet.' : '';
    });

  const chooseImport = async (file: File) => {
    setMessage(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isNativeFile(file.name)) {
        // A save file from the desktop game (or downloaded from here), imported byte for byte.
        if (!isSafeSavePath(file.name) || file.name.includes('/'))
          throw new Error(`Unsupported file name: ${file.name}`);
        if (bytes.length > 64 * 1024 * 1024) throw new Error('That file is too large to be a save.');
        setPendingIsNative(true);
        setPendingImport({
          gameId: game.id,
          gameVersion: 'unknown',
          sourceRevision: 'unknown',
          portBuildId: 'unknown',
          exportedAt: new Date(file.lastModified || Date.now()).toISOString(),
          files: [{ path: file.name, bytes, modifiedAt: file.lastModified || Date.now() }],
        });
        return;
      }
      const archive = await decodeSaveArchive(bytes, game.id);
      setPendingIsNative(false);
      setPendingImport(archive);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
    }
  };

  const confirmImport = () =>
    run(async () => {
      if (!pendingImport || !adapter.importSaves) throw new Error('This game does not support save import.');
      await adapter.importSaves(pendingImport.files);
      const count = pendingImport.files.length;
      setPendingImport(null);
      return `Imported ${count} ${count === 1 ? 'file' : 'files'}. Existing files were kept; any name clash was imported under a new name.`;
    });

  const changeSetting = (descriptor: GameSettingDescriptor, raw: string) => {
    const option = descriptor.options.find((candidate) => String(candidate.value) === raw);
    if (!option) return;
    setValues((current) => ({ ...current, [descriptor.key]: option.value }));
    adapter.applySetting?.(descriptor.key, option.value);
    void getStore().then((store) =>
      store?.setSetting(gameSettingsScope(game.id), descriptor.key, option.value),
    );
  };

  const palette = current ?? adapter.touchLayout?.palette ?? [];
  const commands = adapter.commands.filter((command) => palette.includes(command.id));
  const categories = [...new Set(commands.map((command) => command.category ?? 'Commands'))];

  return (
    <dialog ref={dialogRef} className="shell-menu" aria-labelledby="shell-menu-title" onClose={onClose}>
      <div className="shell-menu__header">
        <h2 id="shell-menu-title">{game.title}</h2>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => dialogRef.current?.close()}
          autoFocus
        >
          Back to game
        </button>
      </div>

      {/* Preferences first: the display (text or tiles) is what players look for. */}
      {adapter.settings && adapter.settings.length > 0 ? (
        <section className="shell-menu__section" aria-labelledby="menu-prefs">
          <h3 id="menu-prefs">Preferences</h3>
          <div className="settings-list">
            {adapter.settings.map((descriptor) => (
              <label key={descriptor.key} className="setting">
                <span className="setting__label">{descriptor.label}</span>
                <span className="setting__description">
                  {descriptor.description}
                  {descriptor.appliesOn === 'next-launch' ? ' Takes effect next launch.' : ''}
                </span>
                <select
                  value={String(values[descriptor.key] ?? descriptor.default)}
                  onChange={(event) => changeSetting(descriptor, event.target.value)}
                >
                  {descriptor.options.map((option) => (
                    <option key={String(option.value)} value={String(option.value)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section className="shell-menu__section" aria-labelledby="menu-commands">
        <h3 id="menu-commands">Commands</h3>
        <p className="muted">Every command sends the game's original key, shown on the right.</p>
        {categories.map((category) => (
          <div key={category} className="command-group">
            <h4>{category}</h4>
            <ul className="command-list">
              {commands
                .filter((command) => (command.category ?? 'Commands') === category)
                .map((command) => (
                  <li key={command.id}>
                    <button
                      type="button"
                      className="command-list__button"
                      onClick={() => {
                        dialogRef.current?.close();
                        adapter.sendInput({ type: 'command', commandId: command.id });
                      }}
                    >
                      <span>{command.label}</span>
                      {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      {adapter.capabilities.saveExport ? (
        <section className="shell-menu__section" aria-labelledby="menu-saves">
          <h3 id="menu-saves">Saved games</h3>
          <p className="muted">
            Saves live in this browser. Export them to keep a backup or move them to another device.
            {nativeExtensions.length > 0
              ? ` Individual save files (${nativeExtensions.join(', ')}) also work with the desktop game, in both directions.`
              : ''}
          </p>
          <div className="button-row">
            <button type="button" className="button" disabled={busy} onClick={() => void exportSaves()}>
              Export saves
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => fileRef.current?.click()}>
              Import saves…
            </button>
            {nativeExtensions.length > 0 ? (
              <button type="button" className="button" disabled={busy} onClick={() => void listFiles()}>
                Save files for desktop…
              </button>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept={[SAVE_ARCHIVE_EXTENSION, 'application/json', ...nativeExtensions].join(',')}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void chooseImport(file);
              }}
            />
          </div>
          {saveFiles && saveFiles.length > 0 ? (
            <ul className="save-file-list" aria-label="Save files">
              {saveFiles.map((file) => (
                <li key={file.path}>
                  <span className="save-file-list__name">{file.path}</span>
                  <span className="muted">{new Date(file.modifiedAt).toLocaleString()}</span>
                  <button
                    type="button"
                    className="button button--small"
                    onClick={() => downloadBytes(file.bytes, file.path, 'application/octet-stream')}
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {pendingImport && pendingIsNative ? (
            <div className="import-confirm">
              <p>
                Import the save file <strong>{pendingImport.files[0]!.path}</strong>? It will appear in the
                game's own load menu. An existing file with the same name is kept.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => void confirmImport()}
                >
                  Import
                </button>
                <button type="button" className="button button--quiet" onClick={() => setPendingImport(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {pendingImport && !pendingIsNative ? (
            <div className="import-confirm">
              <p>
                Import {pendingImport.files.length} {pendingImport.files.length === 1 ? 'file' : 'files'}{' '}
                exported {new Date(pendingImport.exportedAt).toLocaleString()} from version{' '}
                {pendingImport.gameVersion}?
              </p>
              <ul className="bullet-list">
                {pendingImport.files.map((file) => (
                  <li key={file.path}>{file.path}</li>
                ))}
              </ul>
              {pendingImport.gameVersion !== game.version ? (
                <p className="notice">
                  These saves come from a different game version ({pendingImport.gameVersion}); the game
                  decides whether it can load them.
                </p>
              ) : null}
              <div className="button-row">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={busy}
                  onClick={() => void confirmImport()}
                >
                  Import
                </button>
                <button type="button" className="button button--quiet" onClick={() => setPendingImport(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {message ? (
            <p role={message.error ? 'alert' : 'status'} className={message.error ? 'error-text' : ''}>
              {message.text}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="shell-menu__section">
        <div className="button-row">
          <button type="button" className="button button--danger" onClick={onExit}>
            Leave game
          </button>
        </div>
        {adapter.resumeHint ? <p className="muted">{adapter.resumeHint}</p> : null}
      </section>
    </dialog>
  );
}
