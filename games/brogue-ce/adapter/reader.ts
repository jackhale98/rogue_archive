// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Phones: Brogue's description boxes (monsters, items) shown as readable text
 * instead of at map scale. A small chip offers "Read" when Brogue shows a
 * description on its own; long-pressing something opens the reader directly.
 * Closing the reader is purely ours — nothing is sent to the game.
 */
import type { Description } from './describe.ts';

const STYLE = `
.brogue-chip{position:absolute;left:50%;transform:translateX(-50%);z-index:1;display:flex;align-items:center;gap:10px;
  max-width:min(80%,520px);min-height:38px;padding:0 6px 0 14px;border-radius:999px;border:1px solid rgba(224,170,74,.45);
  background:rgba(16,14,11,.92);color:#ece3cf;font:14px/1.2 'Inter Variable',system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);
  cursor:pointer;animation:brogue-chip-in .18s ease-out both}
.brogue-chip__icon{color:#e0aa4a;font-weight:700}
.brogue-chip__title{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}
.brogue-chip__read{flex:none;padding:6px 12px;border-radius:999px;background:#e0aa4a;color:#1a1308;font-weight:700;font-size:13px}
.brogue-chip[hidden]{display:none}
@keyframes brogue-chip-in{from{opacity:0;transform:translate(-50%,-6px)}}
@media (prefers-reduced-motion:reduce){.brogue-chip{animation:none}}
.brogue-reader{width:min(40rem,calc(100vw - 1.5rem));max-height:calc(100dvh - 1.5rem);padding:0;border:1px solid rgba(224,170,74,.35);
  border-radius:16px;background:#16130f;color:#ece3cf;box-shadow:0 18px 50px rgba(0,0,0,.6)}
.brogue-reader[open]{display:flex;flex-direction:column}
.brogue-reader::backdrop{background:rgba(0,0,0,.55)}
.brogue-reader__bar{display:flex;justify-content:flex-end;padding:8px 8px 0}
.brogue-reader__close{min-width:44px;min-height:44px;border-radius:999px;border:1px solid rgba(236,227,207,.18);background:#1e1a15;
  color:#ece3cf;font-size:20px;line-height:1;cursor:pointer}
.brogue-reader__body{overflow-y:auto;overscroll-behavior:contain;padding:0 22px 22px;
  font:clamp(16px,2.3vmin + 8px,19px)/1.55 ui-monospace,Menlo,Consolas,monospace}
.brogue-reader__body p{margin:0 0 .8em}
.brogue-reader__body p:first-child{font-weight:700}
`;

export class BrogueReader {
  readonly #chip: HTMLButtonElement;
  readonly #dialog: HTMLDialogElement;
  readonly #body: HTMLDivElement;
  readonly #style: HTMLStyleElement;
  #current: Description | null = null;
  #shownAt = 0;

  constructor(container: HTMLElement, onClose: (description: Description | null) => void) {
    this.#style = document.createElement('style');
    this.#style.textContent = STYLE;

    this.#chip = document.createElement('button');
    this.#chip.type = 'button';
    this.#chip.className = 'brogue-chip';
    this.#chip.hidden = true;
    // Ignore taps in the chip's first moments on screen: they were meant for whatever was there before.
    this.#chip.addEventListener('click', () => {
      if (performance.now() - this.#shownAt > 350) this.open();
    });

    this.#dialog = document.createElement('dialog');
    this.#dialog.className = 'brogue-reader';
    this.#dialog.setAttribute('aria-label', 'Description');
    const bar = document.createElement('div');
    bar.className = 'brogue-reader__bar';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'brogue-reader__close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.addEventListener('click', () => this.#dialog.close());
    bar.append(close);
    this.#body = document.createElement('div');
    this.#body.className = 'brogue-reader__body';
    this.#dialog.append(bar, this.#body);
    // Tapping the dimmed area outside the panel closes it.
    this.#dialog.addEventListener('click', (event) => {
      if (event.target === this.#dialog) this.#dialog.close();
    });
    this.#dialog.addEventListener('close', () => onClose(this.#current));

    container.append(this.#style, this.#chip, this.#dialog);
  }

  get isOpen(): boolean {
    return this.#dialog.open;
  }

  /** Offer a description without interrupting play. */
  offer(description: Description, top: number): void {
    this.#current = description;
    this.#chip.style.top = `${top + 8}px`;
    this.#chip.replaceChildren(
      span('brogue-chip__icon', 'ⓘ'),
      span('brogue-chip__title', description.title),
      span('brogue-chip__read', 'Read'),
    );
    this.#chip.setAttribute('aria-label', `Read: ${description.title}`);
    if (this.#chip.hidden) this.#shownAt = performance.now();
    this.#chip.hidden = false;
  }

  withdraw(): void {
    this.#chip.hidden = true;
  }

  open(description: Description | null = this.#current): void {
    if (!description) return;
    this.#current = description;
    this.#chip.hidden = true;
    this.#body.replaceChildren(
      ...description.paragraphs.map((runs) => {
        const p = document.createElement('p');
        for (const run of runs) {
          const s = document.createElement('span');
          s.textContent = run.text;
          s.style.color = run.color;
          p.append(s);
        }
        return p;
      }),
    );
    if (!this.#dialog.open) this.#dialog.showModal();
    this.#body.scrollTop = 0;
  }

  destroy(): void {
    if (this.#dialog.open) this.#dialog.close();
    this.#style.remove();
    this.#chip.remove();
    this.#dialog.remove();
  }
}

function span(className: string, text: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}
