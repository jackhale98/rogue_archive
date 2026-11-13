// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Rogue Archive adapter for Dungeon Crawl Stone Soup.
 *
 * DCSS runs in a Web Worker in headless WebTiles mode (see worker.ts and
 * port/rogue-archive-platform.cc). Upstream's own WebTiles client, shipped
 * with the same DCSS version, renders it in an iframe (client-host/), so the
 * game looks and behaves as it does on the official servers. This adapter
 * connects the two, follows the game's messages for the shell (status band,
 * message log, context-aware touch controls), and turns touch commands into
 * DCSS's own keys.
 */
import {
  GAME_API_VERSION,
  type GameAdapter,
  type GameHost,
  type GameInput,
  type GameModule,
  type GameSettingDescriptor,
  type InitializeOptions,
  type Presentation,
  type RuntimeFile,
  type SaveFile,
} from '@rogue-archive/game-api';
import { DcssHud } from './hud.ts';
import { DcssLauncher } from './launcher.ts';
import {
  DCSS_COMMANDS,
  DCSS_TOUCH_LAYOUT,
  controlsFor,
  findCommand,
  keyInput,
  type DcssContext,
  type KeyInput,
} from './input.ts';
import { MessageLog, type GameMessage } from './messages.ts';
import type { FromWorker, SavedCharacter, ToWorker } from './protocol.ts';
import { GameTracker, parseLines } from './state.ts';

export const GAME_ID = 'dcss';
const FLUSH_TIMEOUT_MS = 8000;
const BUSY_DELAY_MS = 350;
/** The socket path is only a name: the platform layer never opens a real socket. */
const SOCKET = '/tmp/rogue-archive-webtiles.sock';

/** What the client host page (client-host/host.js) offers once loaded. */
interface ClientApi {
  receive(lines: string[]): void;
  key(input: KeyInput): void;
  restart(): void;
  setClasses(classes: string[]): void;
  relayout(): void;
}

interface ClientBridge {
  send(text: string): void;
  ready(api: ClientApi): void;
}

export interface DcssDebugState {
  context: DcssContext | null;
  inGame: boolean;
  player: Record<string, unknown>;
  popups: string[];
  menus: string[];
  inputMode: number;
  /** The client's document (same origin), for tests. */
  document(): Document | null;
  /** Visible text of the client (map excluded), for tests. */
  text(): string;
}

function findFile(files: RuntimeFile[], path: string): RuntimeFile {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`Runtime manifest is missing ${path}`);
  return file;
}

class DcssAdapter implements GameAdapter {
  readonly apiVersion = GAME_API_VERSION;
  readonly gameId = GAME_ID;
  readonly capabilities = {
    keyboard: true,
    pointer: true,
    touch: true,
    save: true,
    saveExport: true,
    offline: true,
    audio: false,
  };
  readonly commands = DCSS_COMMANDS;
  readonly touchLayout = DCSS_TOUCH_LAYOUT;
  readonly settings: readonly GameSettingDescriptor[] = [
    {
      key: 'displayMode',
      label: 'Map display',
      description: 'Tiles, or the classic text characters (glyphs).',
      options: [
        { value: 'tiles', label: 'Tiles' },
        { value: 'glyphs', label: 'Text (glyphs)' },
        { value: 'hybrid', label: 'Hybrid' },
      ],
      default: 'tiles',
      appliesOn: 'next-launch',
    },
  ];
  /** DCSS saves (.cs) load in desktop DCSS of the same version, and back. */
  readonly nativeSaveExtensions = ['.cs'] as const;
  readonly resumeHint =
    'DCSS saves when you change level and when you save with S. Pick your character on the start menu to continue.';

  #host: GameHost | null = null;
  #worker: Worker | null = null;
  #frame: HTMLIFrameElement | null = null;
  #client: ClientApi | null = null;
  #mount: HTMLElement | null = null;
  #settings: Record<string, unknown> = {};
  #requestId = 0;
  #pending = new Map<number, (message: FromWorker) => void>();
  #started = false;
  /** Game output that arrived before the client finished loading. */
  #backlog: string[] = [];
  #keyBacklog: KeyInput[] = [];
  #tracker = new GameTracker();
  #log = new MessageLog();
  #layoutSignature = '';
  #busyTimer: ReturnType<typeof setTimeout> | undefined;
  #presentation: Presentation | null = null;
  #hud: DcssHud | null = null;
  #launcher: DcssLauncher | null = null;
  #characters: SavedCharacter[] = [];
  /** A game process is running (the launcher is hidden). */
  #playing = false;
  #version = '';
  #drawer = false;
  #run = false;
  #cleanup: (() => void)[] = [];
  readonly debug: DcssDebugState;

  constructor() {
    const tracker = this.#tracker;
    this.debug = {
      context: null,
      get inGame() {
        return tracker.inGame;
      },
      get player() {
        return { ...tracker.player };
      },
      get popups() {
        return [...tracker.popups];
      },
      get menus() {
        return [...tracker.menus];
      },
      get inputMode() {
        return tracker.inputMode;
      },
      document: () => this.#frame?.contentDocument ?? null,
      text: () => this.#frame?.contentDocument?.body.innerText ?? '',
    };
  }

  async initialize(host: GameHost, options: InitializeOptions): Promise<void> {
    this.#host = host;
    this.#settings = options.settings;
    this.#mount = options.mount;
    const { runtime, runtimeBaseUrl, signal } = options;
    this.#version = runtime.upstream.tag;

    if (typeof WebAssembly !== 'object' || typeof DecompressionStream !== 'function') {
      throw Object.assign(new Error('This browser does not support WebAssembly.'), { kind: 'unsupported' });
    }
    const url = (file: RuntimeFile) => new URL(file.path, runtimeBaseUrl).href;
    const verified = (path: string) => {
      const file = findFile(runtime.files, path);
      return { url: url(file), file };
    };

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'dcss' });
    this.#worker = worker;
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        if (message.type === 'ready') {
          this.#characters = message.characters;
          resolve();
        } else if (message.type === 'error' && !this.#started) {
          reject(
            Object.assign(new Error(message.error.message), {
              kind: message.error.kind,
              action: message.error.action,
            }),
          );
        }
        this.#onWorkerMessage(message);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        reject(
          Object.assign(new Error(event.message || 'The game worker failed to start.'), { kind: 'crash' }),
        );
      };
    });
    signal.addEventListener('abort', () => void this.shutdown(), { once: true });
    this.#post({
      type: 'init',
      glue: verified('crawl.mjs'),
      wasm: verified('crawl.wasm.gzip'),
      data: verified('crawl-data.data.gzip'),
    });

    // Upstream's client, in a frame of its own (its scripts and styles stay
    // out of the shell's page). It is same-origin: the bridge is a property.
    const frame = document.createElement('iframe');
    frame.className = 'dcss-client';
    frame.title = 'Dungeon Crawl Stone Soup';
    frame.setAttribute('allow', 'fullscreen');
    frame.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;border:0;display:block;background:#000';
    const clientReady = new Promise<void>((resolve) => {
      const bridge: ClientBridge = {
        send: (text) => this.#post({ type: 'send', text }),
        ready: (api) => {
          this.#client = api;
          resolve();
        },
      };
      (frame as HTMLIFrameElement & { raBridge?: ClientBridge }).raBridge = bridge;
    });
    frame.src = new URL('client/index.html', runtimeBaseUrl).href;
    options.mount.append(frame);
    this.#frame = frame;

    await Promise.all([ready, clientReady]);
    if (signal.aborted) return;
    this.#attachFrameEvents(frame);
    this.#applyPresentation();
    host.emit({ type: 'status', status: { stage: 'ready' } });
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#showLauncher();
  }

  /** The start screen: continue a saved character or create one (like a WebTiles lobby). */
  #showLauncher(exitReason?: string): void {
    const mount = this.#mount;
    if (!mount) return;
    this.#playing = false;
    this.#launcher ??= new DcssLauncher(mount, this.#version, String(this.#settings.lastName ?? ''), {
      start: (name) => this.#launch(name),
    });
    this.#launcher.show(this.#characters, exitReason);
    this.#publishContext(true);
  }

  #launch(name: string): void {
    this.#launcher?.hide();
    this.#playing = true;
    this.#settings = { ...this.#settings, lastName: name };
    this.#host?.emit({ type: 'setting-changed', key: 'lastName', value: name });
    const display = String(this.#settings.displayMode ?? 'tiles');
    const args = [
      '-headless',
      '-webtiles-socket',
      SOCKET,
      '-await-connection',
      // A WebTiles server always names the player: that save loads, or a new
      // character with this name is created.
      '-name',
      name,
      '-extra-opt-last',
      `tile_display_mode=${['tiles', 'glyphs', 'hybrid'].includes(display) ? display : 'tiles'}`,
    ];
    this.#post({ type: 'start', args });
    this.#publishContext(true);
    this.#focusClient();
  }

  sendInput(input: GameInput): void {
    if (!this.#playing) return;
    if (input.type === 'key') {
      this.#press(input);
      return;
    }
    if (input.type === 'text') {
      for (const char of input.text) {
        this.#press(keyInput({ key: char === '\n' ? 'Enter' : char }));
      }
      return;
    }
    if (input.type !== 'command') return;
    if (input.commandId === 'run') {
      this.#run = !this.#run;
      this.#publishContext(true);
      return;
    }
    const command = findCommand(input.commandId);
    if (!command) return;
    const spec = { ...command.keys };
    // The Run latch turns the next move into a run (Shift + direction).
    if (this.#run && command.id.startsWith('move-')) {
      spec.key = spec.key.toUpperCase();
      spec.shift = true;
      this.#run = false;
      this.#publishContext(true);
    }
    this.#press(keyInput(spec));
  }

  #press(input: KeyInput): void {
    if (!this.#client) {
      this.#keyBacklog.push(input);
      return;
    }
    this.#client.key(input);
  }

  async persist(): Promise<void> {
    if (!this.#worker) return;
    const reply = await this.#request<'flushed'>((id) => ({ type: 'flush', id }), FLUSH_TIMEOUT_MS);
    if (reply.error) throw new Error(reply.error);
  }

  setVisible(visible: boolean): void {
    if (!visible)
      void this.persist().catch((error: unknown) => this.#host?.logger.warn('persist failed', error));
  }

  setPresentation(presentation: Presentation): void {
    this.#presentation = presentation;
    this.#applyPresentation();
  }

  /** Phone layout: the status band on top, the client in the space the controls leave. */
  #applyPresentation(): void {
    const frame = this.#frame;
    const mount = this.#mount;
    if (!frame || !mount) return;
    const presentation = this.#presentation;
    const compact = !!presentation?.compact;
    if (!compact) {
      this.#hud?.destroy();
      this.#hud = null;
      this.#drawer = false;
      frame.style.inset = '0';
      frame.style.width = frame.style.height = '100%';
    } else {
      if (!this.#hud) {
        this.#hud = new DcssHud(mount, () => this.#setDrawer(!this.#drawer));
      }
      const rect = mount.getBoundingClientRect();
      const portrait = rect.height > rect.width;
      this.#hud.setReserve(presentation.topRightReserve ?? 0, portrait);
      this.#hud.update(this.#tracker.player);
      this.#hud.setExpanded(this.#drawer);
      const insets = presentation.insets;
      const top = Math.round(this.#hud.height);
      const left = Math.round(insets.left);
      const right = Math.round(insets.right);
      const bottom = Math.round(insets.bottom);
      // An iframe is a replaced element: with width/height "auto" it would take
      // its default 300x150 size, not the space between the insets.
      frame.style.inset = `${top}px auto auto ${left}px`;
      frame.style.width = `calc(100% - ${left + right}px)`;
      frame.style.height = `calc(100% - ${top + bottom}px)`;
    }
    this.#client?.setClasses(
      [compact ? 'compact' : '', compact && this.#drawer ? 'drawer' : ''].filter(Boolean),
    );
  }

  /** Phones: the stats panel opens over the map; the client re-fits around it. */
  #setDrawer(open: boolean): void {
    this.#drawer = open;
    this.#applyPresentation();
    this.#client?.relayout();
  }

  applySetting(key: string, value: string | number): void {
    this.#settings = { ...this.#settings, [key]: value };
  }

  async exportSaves(): Promise<SaveFile[]> {
    const reply = await this.#request<'exported'>((id) => ({ type: 'export', id }), FLUSH_TIMEOUT_MS * 2);
    if (reply.error) throw new Error(reply.error);
    return reply.files;
  }

  async importSaves(files: SaveFile[]): Promise<void> {
    const reply = await this.#request<'imported'>(
      (id) => ({ type: 'import', id, files }),
      FLUSH_TIMEOUT_MS * 2,
    );
    if (reply.error) throw new Error(reply.error);
  }

  #shutdownPromise: Promise<void> | null = null;

  shutdown(): Promise<void> {
    this.#shutdownPromise ??= this.#shutdown();
    return this.#shutdownPromise;
  }

  async #shutdown(): Promise<void> {
    const worker = this.#worker;
    if (!worker) return;
    if (this.#started) {
      try {
        await this.persist();
      } catch (error) {
        this.#host?.logger.warn('Could not persist before shutdown', error);
      }
    }
    worker.terminate();
    this.#worker = null;
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
    clearTimeout(this.#busyTimer);
    this.#hud?.destroy();
    this.#hud = null;
    this.#launcher?.destroy();
    this.#launcher = null;
    this.#frame?.remove();
    this.#frame = null;
    this.#client = null;
    for (const resolve of this.#pending.values())
      resolve({ type: 'flushed', id: -1, error: 'Game stopped.' });
    this.#pending.clear();
  }

  #post(message: ToWorker): void {
    this.#worker?.postMessage(message);
  }

  #request<T extends 'flushed' | 'exported' | 'imported'>(
    build: (id: number) => ToWorker,
    timeoutMs: number,
  ): Promise<Extract<FromWorker, { type: T }>> {
    const id = ++this.#requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error('The game did not respond in time.'));
      }, timeoutMs);
      this.#pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message as Extract<FromWorker, { type: T }>);
      });
      this.#post(build(id));
    });
  }

  #onWorkerMessage(message: FromWorker): void {
    const host = this.#host;
    switch (message.type) {
      case 'messages':
        this.#observe(message.lines);
        if (this.#client) {
          if (this.#backlog.length) this.#client.receive(this.#backlog.splice(0));
          this.#client.receive(message.lines);
          for (const key of this.#keyBacklog.splice(0)) this.#client.key(key);
        } else {
          this.#backlog.push(...message.lines);
        }
        break;
      case 'status':
        host?.emit({ type: 'status', status: message.status });
        break;
      case 'error':
        if (this.#started) host?.emit({ type: 'error', error: message.error });
        break;
      case 'exit':
        // The game process ended; the worker has a fresh one ready.
        this.#tracker.reset();
        this.#client?.restart();
        this.#characters = message.characters;
        this.#showLauncher(message.reason);
        host?.logger.info(
          `Game process ended (${message.reason}${message.message ? `: ${message.message}` : ''})`,
        );
        break;
      case 'log':
        if (message.level === 'error') host?.logger.error(message.text);
        else host?.logger.debug(message.text);
        break;
      case 'flushed':
      case 'exported':
      case 'imported': {
        const resolve = this.#pending.get(message.id);
        if (resolve) {
          this.#pending.delete(message.id);
          resolve(message);
        }
        break;
      }
      case 'ready':
        break;
      case 'characters':
        this.#characters = message.characters;
        if (this.#launcher?.visible) this.#launcher.show(this.#characters);
        break;
    }
  }

  /** Follows the game's output for the shell: context, status, message log. */
  #observe(lines: string[]): void {
    let changed = false;
    for (const message of parseLines(lines)) {
      if (this.#tracker.apply(message)) changed = true;
      if (message.msg === 'msgs') {
        const update = this.#log.apply(
          message as { messages?: GameMessage[]; rollback?: number; old_msgs?: number },
        );
        if (update) {
          this.#host?.emit({ type: 'message-log', reset: update.reset, entries: update.entries });
          changed = true;
        }
      }
    }
    if (!changed) return;
    this.#hud?.update(this.#tracker.player);
    this.#publishContext();
  }

  /**
   * Publishes the controls for what the game is waiting for. Brief "busy"
   * moments (the game working between inputs) are debounced so the dock does
   * not flicker during runs, travel and animations.
   */
  #publishContext(force = false): void {
    const context = this.#playing ? this.#tracker.context() : 'launcher';
    clearTimeout(this.#busyTimer);
    if (context === 'busy' && !force) {
      this.#busyTimer = setTimeout(() => this.#emitContext('busy'), BUSY_DELAY_MS);
      return;
    }
    this.#emitContext(context, force);
  }

  #emitContext(context: DcssContext, force = false): void {
    this.debug.context = context;
    const player = this.#tracker.player;
    const layout = controlsFor(context, { hp: player.hp ?? 0, hpMax: player.hp_max ?? 0, run: this.#run });
    const signature = JSON.stringify([context, layout]);
    if (signature === this.#layoutSignature && !force) return;
    this.#layoutSignature = signature;
    this.#host?.emit({ type: 'touch-layout', layout, context });
    this.#host?.emit({
      type: 'input-context',
      context: {
        textEntry: context === 'text' || context === 'start' || context === 'prompt',
        mode: context,
      },
    });
  }

  #focusClient(): void {
    this.#frame?.contentWindow?.focus();
  }

  #attachFrameEvents(frame: HTMLIFrameElement): void {
    // The client fits itself to its window: resize it with the frame.
    const observer = new ResizeObserver(() => this.#client?.relayout());
    observer.observe(frame);
    this.#cleanup.push(() => observer.disconnect());
  }
}

export function createAdapter(): GameAdapter & { readonly debug: DcssDebugState } {
  return new DcssAdapter();
}

const module: GameModule = { createAdapter };
export default module;
