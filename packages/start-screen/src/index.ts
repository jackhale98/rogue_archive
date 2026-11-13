// SPDX-License-Identifier: MIT
/**
 * A start screen for games that the page starts by name, like a game server's
 * lobby: continue a saved character, or begin a new one. Large touch targets,
 * keyboard accessible, no game-specific logic.
 */

export interface SavedEntry {
  name: string;
  /** e.g. "saved 5 minutes ago" */
  detail?: string;
}

export interface StartScreenOptions {
  title: string;
  subtitle?: string;
  /** What starting does, under the name field. */
  hint?: string;
  /** Allowed names (default: 1-20 letters, digits, - or _). */
  namePattern?: RegExp;
  defaultName?: string;
  onNew(name: string): void;
  onContinue(name: string): void;
}

const STYLE = `
.ra-start{position:absolute;inset:0;z-index:2;display:grid;place-items:center;overflow-y:auto;padding:16px;box-sizing:border-box;
  background:radial-gradient(120% 80% at 50% 0%,rgba(224,170,74,.10),rgba(0,0,0,0) 60%),#0b0a08;color:#ece3cf;
  font:15px/1.45 'Inter Variable',system-ui,sans-serif}
.ra-start[hidden],.ra-start [hidden]{display:none}
.ra-start__card{width:min(30rem,100%);display:grid;gap:18px}
.ra-start__title{margin:0;font:600 clamp(22px,4vw,28px)/1.15 'Fraunces Variable',Georgia,serif;letter-spacing:.01em}
.ra-start__subtitle{margin:2px 0 0;color:#b3a88f;font-size:13px}
.ra-start__notice{margin:0;padding:10px 14px;border-radius:12px;border:1px solid rgba(224,170,74,.35);background:rgba(224,170,74,.08)}
.ra-start__section{display:grid;gap:8px}
.ra-start__label{margin:0;color:#b3a88f;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.ra-start__save{display:flex;align-items:center;gap:12px;min-height:52px;padding:8px 14px;border-radius:12px;
  border:1px solid rgba(236,227,207,.16);background:#1a1712;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ra-start__save:hover,.ra-start__save:focus-visible{border-color:#e0aa4a;outline:none}
.ra-start__save b{font-size:16px}
.ra-start__save span{margin-left:auto;color:#b3a88f;font-size:13px;white-space:nowrap}
.ra-start__new{display:flex;gap:8px}
.ra-start__input{flex:1;min-width:0;min-height:48px;padding:0 14px;border-radius:12px;border:1px solid rgba(236,227,207,.22);
  background:#13110d;color:inherit;font:inherit;font-size:16px}
.ra-start__input:focus{outline:2px solid #e0aa4a;outline-offset:1px}
.ra-start__go{min-height:48px;padding:0 20px;border-radius:12px;border:0;background:#e0aa4a;color:#1a1308;font:inherit;
  font-weight:700;cursor:pointer}
.ra-start__go:disabled{opacity:.5;cursor:default}
.ra-start__hint{margin:0;color:#b3a88f;font-size:13px}
.ra-start__error{margin:0;color:#ef8a76;font-size:13px}
`;

let instances = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class StartScreen {
  readonly #root: HTMLDivElement;
  readonly #style: HTMLStyleElement;
  readonly #notice: HTMLParagraphElement;
  readonly #savesSection: HTMLDivElement;
  readonly #saves: HTMLDivElement;
  readonly #input: HTMLInputElement;
  readonly #button: HTMLButtonElement;
  readonly #error: HTMLParagraphElement;
  readonly #pattern: RegExp;
  #entries: SavedEntry[] = [];

  constructor(container: HTMLElement, options: StartScreenOptions) {
    this.#pattern = options.namePattern ?? /^[A-Za-z0-9_-]{1,20}$/;
    this.#style = document.createElement('style');
    this.#style.textContent = STYLE;
    this.#root = element('div', 'ra-start');
    this.#root.hidden = true;

    const card = element('div', 'ra-start__card');
    const heading = document.createElement('div');
    heading.append(element('h2', 'ra-start__title', options.title));
    if (options.subtitle) heading.append(element('p', 'ra-start__subtitle', options.subtitle));

    this.#notice = element('p', 'ra-start__notice');
    this.#notice.hidden = true;
    this.#notice.setAttribute('role', 'status');

    this.#savesSection = element('div', 'ra-start__section');
    this.#saves = element('div', 'ra-start__section');
    this.#savesSection.append(element('p', 'ra-start__label', 'Continue'), this.#saves);

    const id = `ra-start-name-${++instances}`;
    const newSection = element('div', 'ra-start__section');
    const label = element('label', 'ra-start__label', 'New character');
    label.htmlFor = id;
    const form = element('form', 'ra-start__new');
    this.#input = element('input', 'ra-start__input');
    this.#input.id = id;
    this.#input.placeholder = 'Name';
    this.#input.maxLength = 20;
    this.#input.autocomplete = 'off';
    this.#input.spellcheck = false;
    this.#input.setAttribute('autocapitalize', 'words');
    this.#input.setAttribute('enterkeyhint', 'go');
    this.#input.value = options.defaultName ?? '';
    this.#button = element('button', 'ra-start__go', 'Start');
    this.#button.type = 'submit';
    form.append(this.#input, this.#button);
    this.#error = element('p', 'ra-start__error');
    this.#error.hidden = true;
    newSection.append(label, form, this.#error);
    if (options.hint) newSection.append(element('p', 'ra-start__hint', options.hint));

    this.#input.addEventListener('input', () => this.#validate());
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = this.#validate();
      if (name) options.onNew(name);
    });
    this.#saves.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-name]');
      if (button?.dataset.name) options.onContinue(button.dataset.name);
    });

    card.append(heading, this.#notice, this.#savesSection, newSection);
    this.#root.append(card);
    container.append(this.#style, this.#root);
  }

  get visible(): boolean {
    return !this.#root.hidden;
  }

  show(entries: SavedEntry[], notice?: string): void {
    this.#entries = entries;
    this.#notice.textContent = notice ?? '';
    this.#notice.hidden = !notice;
    this.update(entries);
    this.#root.hidden = false;
    const first = this.#saves.querySelector('button');
    (first ?? this.#button).focus({ preventScroll: true });
  }

  /** Replaces the saved characters listed (e.g. after an import). */
  update(entries: SavedEntry[]): void {
    this.#entries = entries;
    this.#savesSection.hidden = entries.length === 0;
    this.#saves.replaceChildren(
      ...entries.map((entry) => {
        const button = element('button', 'ra-start__save');
        button.type = 'button';
        button.dataset.name = entry.name;
        button.append(element('b', '', entry.name));
        if (entry.detail) button.append(element('span', '', entry.detail));
        button.setAttribute('aria-label', `Continue ${entry.name}${entry.detail ? `, ${entry.detail}` : ''}`);
        return button;
      }),
    );
    this.#validate();
  }

  hide(): void {
    this.#root.hidden = true;
  }

  destroy(): void {
    this.#style.remove();
    this.#root.remove();
  }

  #validate(): string | null {
    const name = this.#input.value.trim();
    let problem = '';
    if (name && !this.#pattern.test(name)) problem = 'Use up to 20 letters, digits, - or _.';
    else if (name && this.#entries.some((entry) => entry.name.toLowerCase() === name.toLowerCase()))
      problem = `${name} already has a saved game: continue it above, or choose another name.`;
    this.#error.textContent = problem;
    this.#error.hidden = !problem;
    this.#button.disabled = !name || !!problem;
    return name && !problem ? name : null;
  }
}

/** "just now", "5 minutes ago", "yesterday", or a date. */
export function relativeTime(when: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - when) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(when).toLocaleDateString();
}
