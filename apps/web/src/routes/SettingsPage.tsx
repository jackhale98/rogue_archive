import { useState } from 'react';
import { useSettings, type PlatformSettings } from '../app/settings.tsx';

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
