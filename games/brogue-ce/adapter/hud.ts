// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Phone status band: health, hunger and depth (from the read-only state
 * snapshot), Brogue's latest messages (from the message rows of the screen),
 * and the flavor line ("You see dense foliage."). It replaces the sidebar and
 * message area, which the compact layout does not draw over the map.
 */
import { CELL_BYTES, COLS, MAP_ORIGIN_X, ROWS } from './constants.ts';
import { messageLines } from './camera.ts';
import { hungerLabel, type BrogueState } from './state.ts';

const STYLE = `
.brogue-hud{position:absolute;top:0;left:0;right:0;display:grid;grid-template-columns:auto minmax(0,1fr);
  grid-template-areas:"status messages";align-items:center;gap:6px 12px;box-sizing:border-box;
  padding:6px calc(var(--reserve,0px) + 8px) 6px 8px;padding-top:max(6px,env(safe-area-inset-top));
  background:linear-gradient(rgba(10,9,7,.94),rgba(10,9,7,.86));border-bottom:1px solid rgba(236,227,207,.12);
  font:13px/1.25 'Inter Variable',system-ui,sans-serif;color:#ece3cf;z-index:1;pointer-events:auto}
.brogue-hud[data-portrait]{grid-template-columns:minmax(0,1fr);grid-template-areas:"status" "messages"}
.brogue-hud__status{grid-area:status;display:flex;align-items:center;gap:8px;min-height:32px;padding:0 10px 0 6px;
  border:1px solid rgba(236,227,207,.16);border-radius:999px;background:rgba(30,26,21,.9);color:inherit;font:inherit;cursor:pointer}
.brogue-hud__hp{position:relative;width:76px;height:12px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}
.brogue-hud__hp>i{position:absolute;inset:0 auto 0 0;width:calc(var(--hp,1)*100%);border-radius:inherit;
  background:hsl(calc(var(--hp,1)*110) 62% 48%)}
.brogue-hud__num{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.brogue-hud__chip{padding:1px 7px;border-radius:999px;background:#e0aa4a;color:#1a1308;font-size:11px;font-weight:700;
  text-transform:uppercase;letter-spacing:.04em}
.brogue-hud__chip[data-level="Weak"],.brogue-hud__chip[data-level="Faint"],.brogue-hud__chip[data-level="Starving"]{background:#e2735f}
.brogue-hud__depth{color:#b3a88f;white-space:nowrap}
.brogue-hud__messages{grid-area:messages;min-width:0;font:12px/16px ui-monospace,Menlo,Consolas,monospace;
  white-space:pre;overflow:hidden;cursor:pointer;background:none;border:0;padding:0;text-align:left;color:inherit}
.brogue-hud__messages>div{overflow:hidden;text-overflow:ellipsis}
.brogue-flavor{position:absolute;left:50%;bottom:max(8px,env(safe-area-inset-bottom));transform:translateX(-50%);
  max-width:min(70%,560px);padding:4px 12px;border-radius:999px;background:rgba(10,9,7,.82);
  font:12px/1.3 ui-monospace,Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  pointer-events:none;z-index:1}
.brogue-flavor:empty{display:none}
`;

export interface HudCallbacks {
  onStatus(): void;
  onMessages(): void;
}

export class BrogueHud {
  readonly element: HTMLDivElement;
  readonly #flavor: HTMLDivElement;
  readonly #style: HTMLStyleElement;
  readonly #status: HTMLButtonElement;
  readonly #messages: HTMLButtonElement;
  #signature = '';
  #portrait = false;

  constructor(container: HTMLElement, callbacks: HudCallbacks) {
    this.#style = document.createElement('style');
    this.#style.textContent = STYLE;
    this.element = document.createElement('div');
    this.element.className = 'brogue-hud';
    this.#status = document.createElement('button');
    this.#status.type = 'button';
    this.#status.className = 'brogue-hud__status';
    this.#status.addEventListener('click', () => callbacks.onStatus());
    this.#messages = document.createElement('button');
    this.#messages.type = 'button';
    this.#messages.className = 'brogue-hud__messages';
    this.#messages.setAttribute('aria-label', 'Messages (open the message log)');
    this.#messages.addEventListener('click', () => callbacks.onMessages());
    this.element.append(this.#status, this.#messages);
    this.#flavor = document.createElement('div');
    this.#flavor.className = 'brogue-flavor';
    this.#flavor.setAttribute('aria-live', 'polite');
    container.append(this.#style, this.element, this.#flavor);
  }

  /** Height in CSS pixels, for the map to start below it. */
  get height(): number {
    return this.element.getBoundingClientRect().height;
  }

  setReserve(px: number, portrait: boolean, bottomInset = 0): void {
    this.element.style.setProperty('--reserve', `${portrait ? 0 : px}px`);
    // Keep the flavor line above controls that run along the bottom (portrait).
    this.#flavor.style.bottom = bottomInset > 0 ? `${bottomInset + 8}px` : '';
    // In portrait the tools sit above the status row instead of beside the messages.
    this.element.style.paddingTop = portrait ? `max(${44 + 6}px, env(safe-area-inset-top))` : '';
    if (portrait !== this.#portrait) {
      this.#portrait = portrait;
      this.element.toggleAttribute('data-portrait', portrait);
    }
  }

  /** The flavor line is hidden while a card or sheet covers the map. */
  setFlavorVisible(visible: boolean): void {
    this.#flavor.hidden = !visible;
  }

  update(state: BrogueState, cells: Uint8Array): void {
    const lines = messageLines(cells).slice(this.#portrait ? 0 : 1);
    const flavor = rowText(cells, ROWS - 2).trim();
    const hunger = hungerLabel(state.nutrition);
    const signature = JSON.stringify([state.hp, state.maxHp, hunger, state.depth, lines, flavor]);
    if (signature === this.#signature) return;
    this.#signature = signature;

    const fraction = state.maxHp > 0 ? Math.max(0, Math.min(1, state.hp / state.maxHp)) : 1;
    this.#status.replaceChildren(
      el('span', 'brogue-hud__hp', [el('i')], { '--hp': String(fraction) }),
      el('span', 'brogue-hud__num', [`${state.hp}/${state.maxHp}`]),
      ...(hunger ? [el('span', 'brogue-hud__chip', [hunger], {}, { 'data-level': hunger })] : []),
      el('span', 'brogue-hud__depth', [`Depth ${state.depth}`]),
    );
    this.#status.setAttribute(
      'aria-label',
      `Health ${state.hp} of ${state.maxHp}${hunger ? `, ${hunger}` : ''}, depth ${state.depth}. Show sidebar`,
    );
    this.#messages.replaceChildren(
      ...lines.map((runs) => {
        const line = document.createElement('div');
        for (const run of runs) {
          const span = document.createElement('span');
          span.textContent = run.text;
          span.style.color = run.color;
          line.appendChild(span);
        }
        if (runs.length === 0) line.textContent = ' ';
        return line;
      }),
    );
    this.#flavor.textContent = flavor;
  }

  destroy(): void {
    this.#style.remove();
    this.element.remove();
    this.#flavor.remove();
  }
}

function rowText(cells: Uint8Array, y: number): string {
  let text = '';
  for (let x = MAP_ORIGIN_X; x < COLS; x++) {
    const offset = (y * COLS + x) * CELL_BYTES;
    const sprite = cells[offset]! | (cells[offset + 1]! << 8);
    text += sprite >= 32 && sprite < 127 ? String.fromCharCode(sprite) : ' ';
  }
  return text;
}

function el(
  tag: string,
  className?: string,
  children: (Node | string)[] = [],
  styles: Record<string, string> = {},
  attributes: Record<string, string> = {},
): HTMLElement {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const [key, value] of Object.entries(styles)) element.style.setProperty(key, value);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  element.append(...children);
  return element;
}
