import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getStore } from './store.ts';

export interface PlatformSettings {
  theme: 'system' | 'light' | 'dark';
  textSize: 'default' | 'large';
  touchControls: 'auto' | 'always' | 'never';
  handedness: 'right' | 'left';
  reducedMotion: 'system' | 'reduce';
  haptics: 'off' | 'on';
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  theme: 'system',
  textSize: 'default',
  touchControls: 'auto',
  handedness: 'right',
  reducedMotion: 'system',
  haptics: 'off',
};

const SCOPE = 'platform';

interface SettingsContextValue {
  settings: PlatformSettings;
  update<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]): void;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  update: () => undefined,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    void getStore().then(async (store) => {
      if (!store || cancelled) return;
      const saved = (await store.getSettings(SCOPE)) as Partial<PlatformSettings>;
      if (!cancelled) setSettings((current) => ({ ...current, ...saved }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
    root.dataset.textSize = settings.textSize;
    if (settings.reducedMotion === 'reduce') root.dataset.motion = 'reduce';
    else delete root.dataset.motion;
  }, [settings]);

  const update = useCallback(<K extends keyof PlatformSettings>(key: K, value: PlatformSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    void getStore().then((store) => store?.setSetting(SCOPE, key, value));
  }, []);

  const value = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

/** Per-game settings live under their own namespace and never collide. */
export function gameSettingsScope(gameId: string): string {
  return `game:${gameId}`;
}
