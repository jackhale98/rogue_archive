// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Phone status band: health, magic, place and the game's status lights (from
 * "player" messages) and the latest messages (from "msgs"). It stands in for
 * the WebTiles stats panel, which the compact layout shows as a drawer.
 */
import { PALETTE, type Run } from './messages.ts';
import type { PlayerState } from './state.ts';

const STYLE = `
.dcss-hud{position:absolute;top:0;left:0;right:0;display:grid;grid-template-columns:auto minmax(0,1fr);
  grid-template-areas:"status messages";align-items:center;gap:6px 12px;box-sizing:border-box;
  padding:6px calc(var(--reserve,0px) + 8px) 6px 8px;padding-top:max(6px,env(safe-area-inset-top));
  background:linear-gradient(rgba(10,9,7,.96),rgba(10,9,7,.9));border-bottom:1px solid rgba(236,227,207,.12);
  font:13px/1.25 'Inter Variable',system-ui,sans-serif;color:#ece3cf;z-index:1}
.dcss-hud[data-portrait]{grid-template-columns:minmax(0,1fr);grid-template-areas:"status" "messages"}
.dcss-hud__status{grid-area:status;display:flex;align-items:center;gap:8px;min-height:32px;min-width:0;padding:0 10px 0 6px;
  border:1px solid rgba(236,227,207,.16);border-radius:999px;background:rgba(30,26,21,.9);color:inherit;font:inherit;
  cursor:pointer;overflow:hidden}
.dcss-hud__bar{position:relative;flex:none;width:64px;height:10px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}
.dcss-hud__bar>i{position:absolute;inset:0 auto 0 0;width:calc(var(--v,1)*100%);border-radius:inherit;
  background:hsl(calc(var(--v,1)*110) 62% 48%)}
.dcss-hud__bar[data-kind=mp]>i{background:#5e78ff}
.dcss-hud__num{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.dcss-hud__place{color:#b3a88f;white-space:nowrap}
.dcss-hud__lights{display:flex;gap:4px;min-width:0;overflow:hidden}
.dcss-hud__light{flex:none;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,.08);font-size:11px;font-weight:700;
  white-space:nowrap}
.dcss-hud__messages{grid-area:messages;min-width:0;font:12px/16px ui-monospace,Menlo,Consolas,monospace;
  white-space:pre;overflow:hidden;cursor:pointer;background:none;border:0;padding:0;text-align:left;color:#babdb6}
.dcss-hud__messages>div{overflow:hidden;text-overflow:ellipsis}
`;

export interface HudCallbacks {
  onStatus(): void;
  onMessages(): void;
}

export class DcssHud {
  readonly element: HTMLDivElement;
  readonly #style: HTMLStyleElement;
  readonly #status: HTMLButtonElement;
  readonly #messages: HTMLButtonElement;
  #signature = '';
  #portrait = false;

  constructor(container: HTMLElement, callbacks: HudCallbacks) {
    this.#style = document.createElement('style');
    this.#style.textContent = STYLE;
    this.element = document.createElement('div');
    this.element.className = 'dcss-hud';
    this.#status = document.createElement('button');
    this.#status.type = 'button';
    this.#status.className = 'dcss-hud__status';
    this.#status.addEventListener('click', () => callbacks.onStatus());
    this.#messages = document.createElement('button');
    this.#messages.type = 'button';
    this.#messages.className = 'dcss-hud__messages';
    this.#messages.setAttribute('aria-label', 'Messages (open the message log)');
    this.#messages.addEventListener('click', () => callbacks.onMessages());
    this.element.append(this.#status, this.#messages);
    container.append(this.#style, this.element);
  }

  /** Height in CSS pixels. */
  get height(): number {
    return this.element.getBoundingClientRect().height;
  }

  setReserve(px: number, portrait: boolean): void {
    this.element.style.setProperty('--reserve', `${portrait ? 0 : px}px`);
    // In portrait the shell's tools sit above the status row.
    this.element.style.paddingTop = portrait ? `max(${44 + 6}px, env(safe-area-inset-top))` : '';
    if (portrait !== this.#portrait) {
      this.#portrait = portrait;
      this.element.toggleAttribute('data-portrait', portrait);
    }
  }

  update(player: Partial<PlayerState>, recent: Run[][]): void {
    const lines = recent.slice(this.#portrait ? -2 : -1);
    const signature = JSON.stringify([
      player.hp,
      player.hp_max,
      player.mp,
      player.mp_max,
      player.place,
      player.depth,
      player.status,
      lines,
      this.#portrait,
    ]);
    if (signature === this.#signature) return;
    this.#signature = signature;

    const hp = player.hp ?? 0;
    const hpMax = player.hp_max ?? 0;
    const mp = player.mp ?? 0;
    const mpMax = player.mp_max ?? 0;
    const place = player.place ? `${player.place}${player.depth ? `:${player.depth}` : ''}` : '';
    const lights = (player.status ?? []).filter((light) => light.light).slice(0, 4);
    const fraction = (value: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, value / max)) : 1);
    this.#status.replaceChildren(
      el('span', 'dcss-hud__bar', [el('i')], { '--v': String(fraction(hp, hpMax)) }),
      el('span', 'dcss-hud__num', [`${hp}/${hpMax}`]),
      ...(mpMax > 0
        ? [
            el(
              'span',
              'dcss-hud__bar',
              [el('i')],
              { '--v': String(fraction(mp, mpMax)), width: '36px' },
              { 'data-kind': 'mp' },
            ),
            el('span', 'dcss-hud__num', [`${mp}/${mpMax}`]),
          ]
        : []),
      ...(place ? [el('span', 'dcss-hud__place', [place])] : []),
      el(
        'span',
        'dcss-hud__lights',
        lights.map((light) =>
          el(
            'span',
            'dcss-hud__light',
            [light.light],
            light.col !== undefined ? { color: PALETTE[light.col & 15] ?? '' } : {},
          ),
        ),
      ),
    );
    this.#status.setAttribute(
      'aria-label',
      `Health ${hp} of ${hpMax}${mpMax > 0 ? `, magic ${mp} of ${mpMax}` : ''}${place ? `, ${place}` : ''}${
        lights.length ? `, ${lights.map((light) => light.text || light.light).join(', ')}` : ''
      }. Show character panel`,
    );
    this.#messages.replaceChildren(
      ...lines.map((runs) => {
        const line = document.createElement('div');
        for (const run of runs) {
          const span = document.createElement('span');
          span.textContent = run.text;
          if (run.color) span.style.color = run.color;
          line.appendChild(span);
        }
        if (runs.length === 0) line.textContent = ' ';
        return line;
      }),
    );
  }

  destroy(): void {
    this.#style.remove();
    this.element.remove();
  }
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
