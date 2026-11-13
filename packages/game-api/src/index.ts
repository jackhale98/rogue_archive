/**
 * Rogue Archive common game API.
 *
 * This is the contract between the shared web platform (library, launcher,
 * shell, storage) and an independently adapted game. It deliberately covers
 * lifecycle, capabilities, input transport, persistence and status only.
 * Game semantics (moving, attacking, inventories, spells...) stay inside each
 * adapter: the platform never interprets them.
 */

export const GAME_API_VERSION = 1 as const;
export type GameApiVersion = typeof GAME_API_VERSION;

// ---------------------------------------------------------------------------
// Runtime artifacts

/** One file in a game's runtime build, as written by tools/write-runtime-manifest.mjs. */
export interface RuntimeFile {
  path: string;
  size: number;
  sha256: string;
}

/** Describes a reproducible runtime build of a game. */
export interface RuntimeManifest {
  schemaVersion: 1;
  gameId: string;
  buildId: string;
  /** Directory (relative to the manifest) holding the immutable runtime files. */
  baseUrl: string;
  upstream: { repository: string; tag: string; commit: string };
  toolchain: string;
  files: RuntimeFile[];
}

// ---------------------------------------------------------------------------
// Lifecycle and status

export type RuntimeStage =
  | 'idle'
  | 'downloading'
  | 'verifying'
  | 'initializing'
  | 'restoring-saves'
  | 'ready'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface RuntimeStatus {
  stage: RuntimeStage;
  /** Short human-readable description of what is happening. */
  detail?: string;
  /** Only present when real progress is measurable. */
  progress?: { loaded: number; total: number };
}

export type ErrorKind = 'network' | 'integrity' | 'unsupported' | 'out-of-memory' | 'storage' | 'crash';

export interface GameError {
  kind: ErrorKind;
  message: string;
  /** What the player can do about it. */
  action?: string;
}

// ---------------------------------------------------------------------------
// Input

export interface KeyModifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
}

export type GameInput =
  | { type: 'key'; key: string; code: string; modifiers: KeyModifiers }
  | { type: 'text'; text: string }
  | { type: 'command'; commandId: string }
  | { type: 'game-specific'; name: string; payload?: unknown };

/** A game command offered to touch/command-palette users. The adapter decides validity. */
export interface GameCommandDescriptor {
  id: string;
  label: string;
  /** Compact label for small touch buttons. */
  shortLabel?: string;
  /** The original key binding, shown so players learn the real controls. */
  shortcut?: string;
  category?: string;
  description?: string;
}

/** Declarative touch-control layout. The shell renders it; the adapter interprets it. */
export interface TouchControlLayout {
  /** Command ids for an eight-way pad, clockwise from north-west; null for no button. */
  directionPad?: {
    nw: string;
    n: string;
    ne: string;
    w: string;
    center: string | null;
    e: string;
    sw: string;
    s: string;
    se: string;
  };
  /** Primary actions shown as buttons. */
  actions: string[];
  /** Commands available from the "more" command palette. */
  palette: string[];
}

/** What kind of input the game is currently waiting for. */
export interface InputContext {
  /** True when the game expects typed text (a name, a seed...). */
  textEntry: boolean;
  /** Adapter-defined label, e.g. "map", "menu", "title". */
  mode?: string;
}

// ---------------------------------------------------------------------------
// Persistence

/** A file belonging to a game's save area, exchanged verbatim with the engine. */
export interface SaveFile {
  path: string;
  bytes: Uint8Array;
  modifiedAt: number;
}

export type SaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: number }
  | { state: 'error'; message: string };

// ---------------------------------------------------------------------------
// Events from a game to the host

export type GameEvent =
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'error'; error: GameError }
  | { type: 'message'; text: string; severity?: 'info' | 'warning' }
  | { type: 'input-context'; context: InputContext }
  | { type: 'save-state'; state: SaveState }
  | { type: 'setting-changed'; key: string; value: unknown }
  | { type: 'exit'; reason: 'user' | 'game-over' | 'error' };

export interface GameLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** Services the platform provides to an adapter. */
export interface GameHost {
  emit(event: GameEvent): void;
  logger: GameLogger;
}

export interface InitializeOptions {
  /** Element the adapter renders into; it owns everything inside it. */
  mount: HTMLElement;
  /** Absolute URL of the directory holding the runtime files. */
  runtimeBaseUrl: string;
  runtime: RuntimeManifest;
  /** Per-game settings, namespaced by the platform. */
  settings: Record<string, unknown>;
  signal: AbortSignal;
}

/** A per-game preference the shell can render without knowing what it means. */
export interface GameSettingDescriptor {
  key: string;
  label: string;
  description?: string;
  options: { value: string | number; label: string }[];
  default: string | number;
  /** When the change takes effect. */
  appliesOn: 'immediately' | 'next-launch';
}

export interface GameCapabilities {
  keyboard: boolean;
  pointer: boolean;
  touch: boolean;
  save: boolean;
  saveExport: boolean;
  offline: boolean;
  audio: boolean;
}

/** Implemented by every game package. */
export interface GameAdapter {
  readonly apiVersion: GameApiVersion;
  readonly gameId: string;
  readonly capabilities: GameCapabilities;
  readonly commands: readonly GameCommandDescriptor[];
  readonly touchLayout?: TouchControlLayout;
  readonly settings?: readonly GameSettingDescriptor[];
  /**
   * File extensions of the game's own save files (e.g. ".broguesave"). Files
   * with these extensions can be downloaded individually and imported as-is,
   * so saves move to and from the native desktop game.
   */
  readonly nativeSaveExtensions?: readonly string[];
  /** Shown after leaving mid-game: how to continue next time. */
  readonly resumeHint?: string;

  initialize(host: GameHost, options: InitializeOptions): Promise<void>;
  start(): Promise<void>;
  sendInput(input: GameInput): void;
  /** Make progress durable now (page hidden, player leaving). Resolves when written. */
  persist(): Promise<void>;
  setVisible?(visible: boolean): void;
  applySetting?(key: string, value: string | number): void;
  /** Adapter-defined view controls (e.g. zoom); returns the new label to display. */
  cycleView?(): string;
  exportSaves?(): Promise<SaveFile[]>;
  importSaves?(files: SaveFile[]): Promise<void>;
  shutdown(): Promise<void>;
}

/** Entry point exported by a game package. */
export interface GameModule {
  createAdapter(): GameAdapter;
}

export { LifecycleMachine, type LifecycleState, type LifecycleTransition } from './lifecycle.ts';
export { domKeyToInput } from './keyboard.ts';
