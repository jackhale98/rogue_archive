import { useEffect, useState } from 'react';
import {
  isAppleWebKit,
  isInstalledApp,
  requestDurableStorage,
  storageStatus,
  type StorageStatus,
} from '../app/durable-storage.ts';
import { catalog } from '../app/catalog.ts';
import { useSettings, type PlatformSettings } from '../app/settings.tsx';
import { DownloadAll } from '../features/offline/OfflineControls.tsx';

interface Choice<K extends keyof PlatformSettings> {
  key: K;
  label: string;
  description: string;
  options: { value: PlatformSettings[K]; label: string }[];
}

const CHOICES = [
  {
    key: 'theme',
    label: 'Theme',
    description: 'Applies to the library and menus. Games keep their own colors.',
    options: [
      { value: 'system', label: 'Match system' },
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
    ],
  },
  {
    key: 'textSize',
    label: 'Text size',
    description: 'Scales the site text. Browser zoom also works everywhere.',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'large', label: 'Large' },
    ],
  },
  {
    key: 'touchControls',
    label: 'On-screen controls',
    description: 'Automatic shows them on touch screens.',
    options: [
      { value: 'auto', label: 'Automatic' },
      { value: 'always', label: 'Always show' },
      { value: 'never', label: 'Never show' },
    ],
  },
  {
    key: 'handedness',
    label: 'Direction pad side',
    description: 'Which side of the screen the movement pad sits on in landscape.',
    options: [
      { value: 'right', label: 'Right hand' },
      { value: 'left', label: 'Left hand' },
    ],
  },
  {
    key: 'haptics',
    label: 'Vibration',
    description:
      'A short buzz for touch controls, on devices that support it (most Android phones; not iPhone).',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'on', label: 'On' },
    ],
  },
  {
    key: 'reducedMotion',
    label: 'Motion',
    description: 'Reduce interface animation. Game animations are part of each game.',
    options: [
      { value: 'system', label: 'Match system' },
      { value: 'reduce', label: 'Reduce' },
    ],
  },
] as const satisfies readonly Choice<keyof PlatformSettings>[];

async function clearSiteData(): Promise<void> {
  const databases = (await indexedDB.databases?.()) ?? [];
  await Promise.all(
    databases
      .map((db) => db.name)
      .filter((name): name is string => !!name)
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          }),
      ),
  );
  if ('caches' in window) await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
}

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

/** How long this browser keeps saves, and a way to ask it to keep them. */
function KeepingSaves() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [declined, setDeclined] = useState(false);
  useEffect(() => {
    void storageStatus().then(setStatus);
  }, []);
  if (!status) return null;
  const ask = () =>
    void requestDurableStorage(true).then(async (granted) => {
      setDeclined(!granted);
      setStatus(await storageStatus());
    });
  const apple = isAppleWebKit();
  const installed = isInstalledApp();
  return (
    <>
      <h2 className="section-title">Keeping your saves</h2>
      <p role="status">
        {!status.supported
          ? 'This browser does not say how long it keeps site data.'
          : status.persisted
            ? "This browser has agreed to keep this site's data: it will not clear your saves to free up space. They are removed only if you clear them (here or in the browser's settings)."
            : "This browser may clear this site's data, saves included, if the device runs short of space (sites used least recently go first)."}
        {status.usage !== undefined
          ? ` Saves, settings and offline copies use ${megabytes(status.usage)}.`
          : ''}
      </p>
      {status.supported && !status.persisted ? (
        <>
          <button type="button" className="button" onClick={ask}>
            Ask the browser to keep saves
          </button>
          {declined ? (
            <p className="muted">
              The browser said no for now. Browsers decide for themselves; most agree once a site is installed
              as an app or used regularly.
            </p>
          ) : null}
        </>
      ) : null}
      {apple ? (
        <p>
          {installed
            ? "On Apple devices, an app added to the Home Screen keeps its own storage, separate from Safari's."
            : "Safari can delete a site's data after 7 days of using Safari without visiting the site. To keep saves longer, add Rogue Archive to your Home Screen (Share, then Add to Home Screen) and play from there. The Home Screen app has its own storage: export saves here and import them there."}
        </p>
      ) : null}
      <p className="muted">
        Saves never leave your device. To keep a copy elsewhere, use Export saves in each game's menu; the
        file can be imported here or on another device.
      </p>
    </>
  );
}

export function SettingsPage() {
  const { settings, update } = useSettings();
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);

  return (
    <section className="page page--narrow">
      <h1 className="page-title">Settings</h1>
      <p className="muted">
        Stored only in this browser. Per-game preferences are on each game's page and in its in-game menu.
      </p>
      <div className="settings-list">
        {CHOICES.map((choice) => (
          <label key={choice.key} className="setting">
            <span className="setting__label">{choice.label}</span>
            <span className="setting__description">{choice.description}</span>
            <select
              value={settings[choice.key]}
              onChange={(event) => update(choice.key, event.target.value as never)}
            >
              {choice.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <h2 className="section-title">Offline play</h2>
      <p>
        A game you have opened once works without a connection. To have them all ready, download them now;
        each game's card in the library also has a download button.
      </p>
      <DownloadAll games={catalog.games} />

      <KeepingSaves />

      <h2 className="section-title">Local data</h2>
      <p>
        Removing local data deletes <strong>all saved games</strong>, settings and offline copies for this
        site in this browser. Export any saves you want to keep first (from each game's menu).
      </p>
      {cleared ? (
        <p role="status">Local data removed. Reload the page to start fresh.</p>
      ) : confirming ? (
        <div className="button-row">
          <button
            type="button"
            className="button button--danger"
            onClick={() => void clearSiteData().then(() => setCleared(true))}
          >
            Yes, delete everything
          </button>
          <button type="button" className="button button--quiet" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="button" onClick={() => setConfirming(true)}>
          Remove all local data…
        </button>
      )}
    </section>
  );
}
