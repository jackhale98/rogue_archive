// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * The start screen: continue a saved character or start a new one.
 *
 * On a WebTiles server this is the lobby: the server starts DCSS with the
 * player's name, and DCSS either loads that name's save or begins character
 * creation (species, background) in its own interface. Here the names are
 * the saved characters in this browser.
 */
import type { SavedCharacter } from './protocol.ts';

const STYLE = `
.dcss-launcher{position:absolute;inset:0;z-index:2;display:grid;place-items:center;overflow-y:auto;padding:16px;box-sizing:border-box;
  background:radial-gradient(120% 80% at 50% 0%,rgba(224,170,74,.10),rgba(0,0,0,0) 60%),#0b0a08;color:#ece3cf;
  font:15px/1.45 'Inter Variable',system-ui,sans-serif}
.dcss-launcher[hidden],.dcss-launcher [hidden]{display:none}
.dcss-launcher__card{width:min(30rem,100%);display:grid;gap:18px}
.dcss-launcher__title{margin:0;font:600 clamp(22px,4vw,28px)/1.15 'Fraunces Variable',Georgia,serif;letter-spacing:.01em}
.dcss-launcher__version{margin:2px 0 0;color:#b3a88f;font-size:13px}
.dcss-launcher__notice{margin:0;padding:10px 14px;border-radius:12px;border:1px solid rgba(224,170,74,.35);background:rgba(224,170,74,.08)}
.dcss-launcher__section{display:grid;gap:8px}
.dcss-launcher__label{margin:0;color:#b3a88f;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.dcss-launcher__save{display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 14px;border-radius:12px;
  border:1px solid rgba(236,227,207,.16);background:#1a1712;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dcss-launcher__save:hover,.dcss-launcher__save:focus-visible{border-color:#e0aa4a;outline:none}
.dcss-launcher__save b{font-size:16px}
.dcss-launcher__save span{margin-left:auto;color:#b3a88f;font-size:13px;white-space:nowrap}
.dcss-launcher__new{display:flex;gap:8px}
.dcss-launcher__input{flex:1;min-width:0;min-height:48px;padding:0 14px;border-radius:12px;border:1px solid rgba(236,227,207,.22);
  background:#13110d;color:inherit;font:inherit;font-size:16px}
.dcss-launcher__input:focus{outline:2px solid #e0aa4a;outline-offset:1px}
.dcss-launcher__start{min-height:48px;padding:0 20px;border-radius:12px;border:0;background:#e0aa4a;color:#1a1308;font:inherit;
  font-weight:700;cursor:pointer}
.dcss-launcher__start:disabled{opacity:.5;cursor:default}
.dcss-launcher__hint{margin:0;color:#b3a88f;font-size:13px}
.dcss-launcher__error{margin:0;color:#ef8a76;font-size:13px}
.dcss-launcher__preparing{width:min(26rem,100%);display:grid;justify-items:center;gap:14px;text-align:center}
.dcss-launcher__spinner{width:44px;height:44px;border-radius:50%;border:3px solid rgba(224,170,74,.2);border-top-color:#e0aa4a;
  animation:dcss-spin 1s linear infinite}
@keyframes dcss-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dcss-launcher__spinner{animation-duration:3s}}
.dcss-launcher__elapsed{margin:0;color:#e0aa4a;font-variant-numeric:tabular-nums;font-weight:600}
`;

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

const EXIT_NOTICES: Record<string, string> = {
  saved: 'Game saved. Pick your character below to continue.',
  dead: 'Your character has died. Their story is in the message log.',
  quit: 'You abandoned that character.',
  won: 'You won! Congratulations.',
  crash: 'The game stopped unexpectedly. Your last save is kept.',
  abort: 'The game was interrupted. Your last save is kept.',
};

export interface LauncherCallbacks {
  start(name: string): void;
}

export class DcssLauncher {
  readonly #root: HTMLDivElement;
  readonly #style: HTMLStyleElement;
  readonly #notice: HTMLParagraphElement;
  readonly #saves: HTMLDivElement;
  readonly #savesSection: HTMLDivElement;
  readonly #input: HTMLInputElement;
  readonly #button: HTMLButtonElement;
  readonly #error: HTMLParagraphElement;
  readonly #card: HTMLDivElement;
  readonly #preparing: HTMLDivElement;
  readonly #preparingTitle: HTMLHeadingElement;
  readonly #elapsed: HTMLParagraphElement;
  #ticker: ReturnType<typeof setInterval> | undefined;
  #characters: SavedCharacter[] = [];

  constructor(container: HTMLElement, version: string, defaultName: string, callbacks: LauncherCallbacks) {
    this.#style = document.createElement('style');
    this.#style.textContent = STYLE;
    this.#root = document.createElement('div');
    this.#root.className = 'dcss-launcher';
    this.#root.hidden = true;

    const card = div('dcss-launcher__card');
    this.#card = card;
    const heading = document.createElement('div');
    const title = document.createElement('h2');
    title.className = 'dcss-launcher__title';
    title.textContent = 'Dungeon Crawl Stone Soup';
    const subtitle = paragraph('dcss-launcher__version', `Version ${version}`);
    heading.append(title, subtitle);

    this.#notice = paragraph('dcss-launcher__notice', '');
    this.#notice.hidden = true;
    this.#notice.setAttribute('role', 'status');

    this.#savesSection = div('dcss-launcher__section');
    this.#saves = div('dcss-launcher__section');
    this.#savesSection.append(paragraph('dcss-launcher__label', 'Continue'), this.#saves);

    const newSection = div('dcss-launcher__section');
    const label = document.createElement('label');
    label.className = 'dcss-launcher__label';
    label.textContent = 'New character';
    label.htmlFor = 'dcss-launcher-name';
    const form = document.createElement('form');
    form.className = 'dcss-launcher__new';
    this.#input = document.createElement('input');
    this.#input.id = 'dcss-launcher-name';
    this.#input.className = 'dcss-launcher__input';
    this.#input.placeholder = 'Name';
    this.#input.maxLength = 20;
    this.#input.autocomplete = 'off';
    this.#input.spellcheck = false;
    this.#input.setAttribute('autocapitalize', 'words');
    this.#input.setAttribute('enterkeyhint', 'go');
    this.#input.value = defaultName;
    this.#button = document.createElement('button');
    this.#button.type = 'submit';
    this.#button.className = 'dcss-launcher__start';
    this.#button.textContent = 'Start';
    form.append(this.#input, this.#button);
    this.#error = paragraph('dcss-launcher__error', '');
    this.#error.hidden = true;
    const hint = paragraph(
      'dcss-launcher__hint',
      'You choose species and background next. Characters are saved in this browser; Menu → Saves backs them up.',
    );
    newSection.append(label, form, this.#error, hint);

    this.#input.addEventListener('input', () => this.#validate());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = this.#validate();
      if (name) callbacks.start(name);
    });
    this.#saves.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-name]');
      if (button?.dataset.name) callbacks.start(button.dataset.name);
    });

    card.append(heading, this.#notice, this.#savesSection, newSection);

    // Shown from Start until DCSS shows its first screen.
    this.#preparing = div('dcss-launcher__preparing');
    this.#preparing.hidden = true;
    this.#preparing.setAttribute('role', 'status');
    this.#preparingTitle = document.createElement('h2');
    this.#preparingTitle.className = 'dcss-launcher__title';
    this.#elapsed = paragraph('dcss-launcher__elapsed', '');
    this.#preparing.append(
      div('dcss-launcher__spinner'),
      this.#preparingTitle,
      paragraph('dcss-launcher__hint', 'This takes a few seconds.'),
      this.#elapsed,
    );
    this.#root.append(card, this.#preparing);
    container.append(this.#style, this.#root);
  }

  get visible(): boolean {
    return !this.#root.hidden;
  }

  show(characters: SavedCharacter[], exitReason?: string): void {
    this.#stopTicker();
    this.#card.hidden = false;
    this.#preparing.hidden = true;
    this.#characters = characters;
    const notice = exitReason ? EXIT_NOTICES[exitReason] : undefined;
    this.#notice.textContent = notice ?? '';
    this.#notice.hidden = !notice;
    this.#savesSection.hidden = characters.length === 0;
    this.#saves.replaceChildren(
      ...characters.map((character) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dcss-launcher__save';
        button.dataset.name = character.name;
        const name = document.createElement('b');
        name.textContent = character.name;
        const when = document.createElement('span');
        when.textContent = `saved ${relativeTime(character.modifiedAt)}`;
        button.append(name, when);
        button.setAttribute(
          'aria-label',
          `Continue ${character.name}, saved ${relativeTime(character.modifiedAt)}`,
        );
        return button;
      }),
    );
    this.#validate();
    this.#root.hidden = false;
    const first = this.#saves.querySelector('button');
    (first ?? this.#button).focus({ preventScroll: true });
  }

  hide(): void {
    this.#stopTicker();
    this.#root.hidden = true;
  }

  get preparing(): boolean {
    return !this.#root.hidden && !this.#preparing.hidden;
  }

  /** "Entering the dungeon" while the game starts, with the time so far. */
  showPreparing(name: string): void {
    if (this.preparing) return;
    this.#card.hidden = true;
    this.#preparing.hidden = false;
    this.#root.hidden = false;
    this.#preparingTitle.textContent = `Preparing the dungeon for ${name}…`;
    const started = performance.now();
    const tick = () => {
      this.#elapsed.textContent = `${Math.round((performance.now() - started) / 1000)} s`;
    };
    tick();
    this.#stopTicker();
    this.#ticker = setInterval(tick, 1000);
  }

  #stopTicker(): void {
    clearInterval(this.#ticker);
    this.#ticker = undefined;
  }

  /** Returns the name if it can start a new character, else shows why not. */
  #validate(): string | null {
    const name = this.#input.value.trim();
    let problem = '';
    if (!name) problem = '';
    else if (!NAME_PATTERN.test(name)) problem = 'Use up to 20 letters, digits, - or _.';
    else if (this.#characters.some((character) => character.name.toLowerCase() === name.toLowerCase()))
      problem = `${name} already has a saved game: continue it above, or choose another name.`;
    this.#error.textContent = problem;
    this.#error.hidden = !problem;
    this.#button.disabled = !name || !!problem;
    return name && !problem ? name : null;
  }

  destroy(): void {
    this.#stopTicker();
    this.#style.remove();
    this.#root.remove();
  }
}

function div(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  return element;
}

function relativeTime(time: number): string {
  const seconds = Math.max(0, (Date.now() - time) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(time).toLocaleDateString();
}
