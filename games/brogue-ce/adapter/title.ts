// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Phones: Brogue's title screen as large buttons. Brogue's own menu is a few
 * lines of small text on a 100x34 screen; here each choice is a big button
 * that sends Brogue's own hotkeys (MainMenu.c), opening the right flyout
 * first. The file picker ("Open saved game:", "View recording:") becomes a
 * list of saves with their dates.
 */
import { CELL_BYTES, COLS, ROWS } from './constants.ts';

export interface SavedFile {
  /** Brogue's hotkey for this entry in the picker ('a', 'b', ...). */
  key: string;
  name: string;
  date: string;
}

export type TitleScreen =
  | { kind: 'main'; playOpen: boolean; viewOpen: boolean }
  | { kind: 'files'; prompt: string; files: SavedFile[] }
  | { kind: 'variant' }
  | { kind: 'mode' }
  | { kind: 'other' };

function rows(cells: Uint8Array): string[] {
  const out: string[] = [];
  for (let y = 0; y < ROWS; y++) {
    let text = '';
    for (let x = 0; x < COLS; x++) {
      const offset = (y * COLS + x) * CELL_BYTES;
      const sprite = cells[offset]! | (cells[offset + 1]! << 8);
      text += sprite >= 32 && sprite < 127 ? String.fromCharCode(sprite) : ' ';
    }
    out.push(text);
  }
  return out;
}

/** The in-game sidebar's depth line ("-- Depth: 3 --"), absent on the title screen. */
export function showsDungeon(cells: Uint8Array): boolean {
  return rows(cells).some((line) => /-- Depth: \d+ --/.test(line));
}

/** Recognizes which part of the title screen Brogue is showing. */
export function readTitleScreen(cells: Uint8Array): TitleScreen {
  const lines = rows(cells);
  const screen = lines.join('\n');
  const promptRow = lines.findIndex((line) => /Open saved game:|View recording:/.test(line));
  if (promptRow >= 0) {
    const prompt = /(Open saved game|View recording):/.exec(lines[promptRow]!)![1]!;
    const files: SavedFile[] = [];
    for (const line of lines.slice(promptRow + 1)) {
      const match = /([a-z])\) (.+?)\s{2,}(\d{4}-\d{2}-\d{2})?\s*$/.exec(line);
      if (!match) continue;
      files.push({ key: match[1]!, name: match[2]!.trim(), date: match[3] ?? '' });
    }
    return { kind: 'files', prompt, files };
  }
  if (/Rapid Brogue/.test(screen) && /Bullet Brogue/.test(screen)) return { kind: 'variant' };
  if (/\bWizard\b/.test(screen) && /\bEasy\b/.test(screen) && /\bNormal\b/.test(screen))
    return { kind: 'mode' };
  if (/New Game/.test(screen) && /\bQuit\b/.test(screen)) {
    return {
      kind: 'main',
      playOpen: /Load Game/.test(screen),
      viewOpen: /High Scores/.test(screen),
    };
  }
  return { kind: 'other' };
}

interface Choice {
  label: string;
  detail?: string;
  keys: string[];
  primary?: boolean;
}

/** The choices for a screen, as key sequences (a flyout's hotkey, then the item's). */
export function titleChoices(screen: TitleScreen): Choice[] {
  switch (screen.kind) {
    case 'main': {
      const play = (key: string) => (screen.playOpen ? [key] : ['p', key]);
      const view = (key: string) => (screen.viewOpen ? [key] : ['v', key]);
      return [
        { label: 'New game', keys: ['n'], primary: true },
        { label: 'Load saved game', keys: play('l') },
        { label: 'New seeded game', keys: play('s') },
        { label: 'View recording', keys: view('r') },
        { label: 'High scores', keys: view('h') },
        { label: 'Game stats', keys: view('g') },
        { label: 'Change variant', keys: play('a') },
        { label: 'Change mode', keys: play('m') },
      ];
    }
    case 'files':
      return screen.files.map((file, index) => ({
        label: file.name,
        ...(file.date ? { detail: file.date } : {}),
        keys: [file.key],
        primary: index === 0,
      }));
    case 'variant':
      return [
        { label: 'Brogue', detail: '26 levels, the classic', keys: ['b'], primary: true },
        { label: 'Rapid Brogue', detail: 'A shorter descent', keys: ['r'] },
        { label: 'Bullet Brogue', detail: 'Very short', keys: ['l'] },
      ];
    case 'mode':
      return [
        { label: 'Normal', keys: ['n'], primary: true },
        { label: 'Easy', keys: ['e'] },
        { label: 'Wizard', detail: 'Debug mode', keys: ['w'] },
      ];
    case 'other':
      return [];
  }
}

const STYLE = `
.brogue-title{position:absolute;inset:0;z-index:2;display:grid;place-items:center;overflow-y:auto;padding:16px;box-sizing:border-box;
  background:radial-gradient(120% 80% at 50% 0%,rgba(224,170,74,.12),rgba(0,0,0,0) 60%),rgba(8,7,6,.94);color:#ece3cf;
  font:15px/1.4 'Inter Variable',system-ui,sans-serif}
/* The main menu: Brogue's title art and flames show above (the renderer draws
   them large at the top); the buttons sit at the bottom over a fade. */
.brogue-title[data-backdrop]{align-items:end;padding-bottom:max(16px,env(safe-area-inset-bottom));
  background:linear-gradient(to bottom,rgba(8,7,6,0) 0,rgba(8,7,6,0) calc(var(--art-end,60%) - 220px),rgba(8,7,6,.94) var(--art-end,60%),rgba(8,7,6,.94) 100%)}
.brogue-title[data-backdrop] .brogue-title__choice:not([data-primary]){background:rgba(26,23,18,.86);backdrop-filter:blur(2px)}
.brogue-title[hidden]{display:none}
.brogue-title__card{width:min(32rem,100%);display:grid;gap:14px}
.brogue-title__heading{margin:0;font:600 clamp(24px,5vw,32px)/1.1 'Fraunces Variable',Georgia,serif;text-align:center}
.brogue-title__sub{margin:-8px 0 0;color:#b3a88f;text-align:center;font-size:13px}
.brogue-title__grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.brogue-title__grid[data-list]{grid-template-columns:minmax(0,1fr)}
.brogue-title__choice{display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:56px;padding:10px 16px;
  border-radius:14px;border:1px solid rgba(236,227,207,.18);background:#1a1712;color:inherit;font:inherit;font-weight:600;
  text-align:left;cursor:pointer;touch-action:manipulation}
.brogue-title__choice:focus-visible,.brogue-title__choice:hover{border-color:#e0aa4a;outline:none}
.brogue-title__choice[data-primary]{background:#e0aa4a;border-color:#e0aa4a;color:#1a1308}
.brogue-title__choice[data-wide]{grid-column:1/-1}
.brogue-title__choice small{font-weight:400;font-size:12px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brogue-title__row{display:flex;gap:10px}
.brogue-title__row>button{flex:1}
.brogue-title__empty{margin:0;text-align:center;color:#b3a88f}
`;

export class BrogueTitlePanel {
  readonly #root: HTMLDivElement;
  readonly #style: HTMLStyleElement;
  readonly #send: (keys: string[]) => void;
  #signature = '';

  constructor(container: HTMLElement, send: (keys: string[]) => void) {
    this.#send = send;
    this.#style = document.createElement('style');
    this.#style.textContent = STYLE;
    this.#root = document.createElement('div');
    this.#root.className = 'brogue-title';
    this.#root.hidden = true;
    this.#root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-keys]');
      if (button?.dataset.keys) this.#send(button.dataset.keys.split(','));
    });
    container.append(this.#style, this.#root);
  }

  get visible(): boolean {
    return !this.#root.hidden;
  }

  /** Shows the panel for this screen, or hides it for screens Brogue shows best itself. */
  update(screen: TitleScreen): void {
    const choices = titleChoices(screen);
    const signature = JSON.stringify([screen.kind, choices]);
    if (signature === this.#signature) return;
    this.#signature = signature;
    if (screen.kind === 'other') {
      this.#root.hidden = true;
      return;
    }
    const card = document.createElement('div');
    card.className = 'brogue-title__card';
    const heading = document.createElement('h2');
    heading.className = 'brogue-title__heading';
    const sub = document.createElement('p');
    sub.className = 'brogue-title__sub';
    const grid = document.createElement('div');
    grid.className = 'brogue-title__grid';
    const button = (choice: Choice, wide = false) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = 'brogue-title__choice';
      element.dataset.keys = choice.keys.join(',');
      if (choice.primary) element.dataset.primary = '';
      if (wide) element.dataset.wide = '';
      element.append(choice.label);
      if (choice.detail) {
        const small = document.createElement('small');
        small.textContent = choice.detail;
        element.append(small);
      }
      return element;
    };
    if (screen.kind === 'main') {
      // Brogue's own title art names the game above the buttons.
      sub.textContent = 'Community Edition';
      choices.forEach((choice, index) => grid.append(button(choice, index === 0)));
      card.append(sub, grid);
    } else if (screen.kind === 'files') {
      heading.textContent = screen.prompt === 'View recording' ? 'Recordings' : 'Saved games';
      sub.textContent = 'Newest first';
      grid.dataset.list = '';
      if (choices.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'brogue-title__empty';
        empty.textContent = 'Nothing saved yet.';
        grid.append(empty);
      }
      for (const choice of choices) grid.append(button(choice));
      const row = document.createElement('div');
      row.className = 'brogue-title__row';
      // Brogue pages long lists with Page Up / Page Down (MainMenu.c dialogChooseFile).
      row.append(
        button({ label: '▲ Newer', keys: ['PageUp'] }),
        button({ label: 'Older ▼', keys: ['PageDown'] }),
        button({ label: 'Back', keys: ['Escape'] }),
      );
      card.append(heading, sub, grid, row);
    } else {
      heading.textContent = screen.kind === 'variant' ? 'Variant' : 'Mode';
      grid.dataset.list = '';
      for (const choice of choices) grid.append(button(choice));
      grid.append(button({ label: 'Back', keys: ['Escape'] }));
      card.append(heading, grid);
    }
    this.#root.replaceChildren(card);
    this.#root.toggleAttribute('data-backdrop', screen.kind === 'main');
    this.#root.hidden = false;
  }

  /** Where the title art drawn behind ends (CSS px), so the panel fades into it. */
  setArtEnd(px: number): void {
    this.#root.style.setProperty('--art-end', `${Math.round(px)}px`);
  }

  /** The main menu, which shows Brogue's title art behind it. */
  get showsArt(): boolean {
    return this.visible && this.#root.hasAttribute('data-backdrop');
  }

  hide(): void {
    this.#signature = '';
    this.#root.hidden = true;
  }

  destroy(): void {
    this.#style.remove();
    this.#root.remove();
  }
}
