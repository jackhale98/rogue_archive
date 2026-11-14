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

/** Commands the shell handles itself; adapters may place them in layouts. */
export const SHELL_COMMAND = {
  /** Open the full command list. */
  palette: 'shell:palette',
  /** Open the device keyboard for typing to the game. */
  keyboard: 'shell:keyboard',
  /** Open the message log. */
  log: 'shell:log',
} as const;

/** One line of a game's message history, with optional colors. */
export interface LogEntry {
  /** Stable and increasing; an entry with a known id replaces the earlier version (e.g. "(x3)"). */
  id: number;
  /** Optional grouping label, e.g. "Turn 152". */
  group?: string;
  runs: { text: string; color?: string }[];
}

/** One touch button. */
export interface TouchAction {
  command: string;
  /** Overrides the command's shortLabel/label for this context. */
  label?: string;
  /** Long-press fans these out; slide onto one and release to choose it. */
  alternates?: string[];
  /** Visually emphasized as the likely next action. */
  emphasis?: 'primary';
  /** Spans the full dock width (e.g. a lone "Continue"). */
  wide?: boolean;
  /** For toggles (e.g. a latching Shift): whether it is currently on. */
  active?: boolean;
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
  /** Primary actions shown as buttons (a bare string is a command id). */
  actions: (string | TouchAction)[];
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
  /** Messages for the shell's scrollable log. `reset` clears it first (e.g. a new game). */
  | { type: 'message-log'; reset: boolean; entries: LogEntry[] }
  /** Ask the shell to do something it owns (see SHELL_COMMAND), e.g. from a tap inside the game's own UI. */
  | { type: 'shell-command'; command: string }
  /** The game's situation changed; show these touch controls (context is a label for tests and styling). */
  | { type: 'touch-layout'; layout: TouchControlLayout; context: string }
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

export interface Presentation {
  compact: boolean;
  insets: { top: number; right: number; bottom: number; left: number };
  /** Width (CSS px) of the shell's floating tools in the top-right corner, in compact mode. */
  topRightReserve?: number;
}

/** Implemented by every game package. */
/** A way to leave a game in progress (e.g. "Save and leave"), offered before leaving. */
export interface GameExitOption {
  id: string;
  label: string;
  /** The main choice. */
  primary?: boolean;
  /** Progress is lost: shown as a warning. */
  destructive?: boolean;
}

/** What the shell asks before leaving a game in progress. */
export interface GameExitPrompt {
  /** How saving works for this game, now: a sentence or two. */
  message: string;
  options: readonly GameExitOption[];
}

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
  /** How saving works and how to continue next time (shown in the game menu). */
  readonly resumeHint?: string;
  /**
   * Asked when the player leaves: what to tell them and how they can leave
   * (save and quit, leave without saving...). Null, or no method: nothing is
   * in progress, so the shell leaves at once.
   */
  exitPrompt?(): GameExitPrompt | null;
  /**
   * Carries out an exit option (e.g. the game's own save and quit); resolves
   * once it is done, rejects if it could not be. The shell then persists and
   * leaves.
   */
  exitWith?(optionId: string): Promise<void>;

  initialize(host: GameHost, options: InitializeOptions): Promise<void>;
  start(): Promise<void>;
  sendInput(input: GameInput): void;
  /** Make progress durable now (page hidden, player leaving). Resolves when written. */
  persist(): Promise<void>;
  setVisible?(visible: boolean): void;
  /**
   * Tells the adapter how it is being presented. `compact` means a small touch
   * screen where the shell overlays its controls on the game; the adapter may
   * then use a layout designed for phones. `insets` are CSS pixels on each
   * edge covered by shell controls, so important content can avoid them.
   */
  setPresentation?(presentation: Presentation): void;
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
export { waitUntil } from './wait.ts';
