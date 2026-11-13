// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * Phone status band: health, magic, place and the game's status lights (from
 * "player" messages). It stands in for the WebTiles stats panel, which the
 * compact layout shows as a drawer when the band is tapped. Messages stay in
 * the client's own message pane, where prompts appear too; the shell's log
 * button has the full history.
 */
import { PALETTE } from './messages.ts';
import type { PlayerState } from './state.ts';

const STYLE = `
.dcss-hud{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;box-sizing:border-box;
  padding:6px calc(var(--reserve,0px) + 8px) 6px 8px;padding-top:max(6px,env(safe-area-inset-top));
  background:linear-gradient(rgba(10,9,7,.96),rgba(10,9,7,.9));border-bottom:1px solid rgba(236,227,207,.12);
  font:13px/1.25 'Inter Variable',system-ui,sans-serif;color:#ece3cf;z-index:1}
.dcss-hud__status{flex:1;display:flex;align-items:center;gap:8px;min-height:34px;min-width:0;padding:0 10px 0 6px;
  border:1px solid rgba(236,227,207,.16);border-radius:999px;background:rgba(30,26,21,.9);color:inherit;font:inherit;
  cursor:pointer;overflow:hidden}
.dcss-hud__status[aria-expanded=true]{border-color:#e0aa4a}
.dcss-hud__map{flex:none;display:grid;place-items:center;width:40px;height:36px;margin-left:8px;border-radius:999px;
  border:1px solid rgba(236,227,207,.16);background:rgba(30,26,21,.9);color:inherit;cursor:pointer}
.dcss-hud__map[aria-pressed=true]{border-color:#e0aa4a;color:#e0aa4a}
.dcss-hud__bar{position:relative;flex:none;width:64px;height:10px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}
.dcss-hud__bar>i{position:absolute;inset:0 auto 0 0;width:calc(var(--v,1)*100%);border-radius:inherit;
  background:hsl(calc(var(--v,1)*110) 62% 48%)}
.dcss-hud__bar[data-kind=mp]{width:36px}
.dcss-hud__bar[data-kind=mp]>i{background:#5e78ff}
.dcss-hud__num{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
.dcss-hud__place{color:#b3a88f;white-space:nowrap}
.dcss-hud__lights{display:flex;gap:4px;min-width:0;overflow:hidden}
.dcss-hud__light{flex:none;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,.08);font-size:11px;font-weight:700;
  white-space:nowrap}
`;

export class DcssHud {
  readonly element: HTMLDivElement;
  readonly #style: HTMLStyleElement;
  readonly #status: HTMLButtonElement;
  #signature = '';

  readonly #map: HTMLButtonElement;

  constructor(container: HTMLElement, onStatus: () => void, onMap: () => void) {
    this.#style = document.createElement('style');
    this.#style.textContent = STYLE;
    this.element = document.createElement('div');
    this.element.className = 'dcss-hud';
    this.#status = document.createElement('button');
    this.#status.type = 'button';
    this.#status.className = 'dcss-hud__status';
    this.#status.setAttribute('aria-expanded', 'false');
    this.#status.addEventListener('click', () => onStatus());
    this.#map = document.createElement('button');
    this.#map.type = 'button';
    this.#map.className = 'dcss-hud__map';
    this.#map.setAttribute('aria-label', 'Minimap');
    this.#map.setAttribute('aria-pressed', 'false');
    // A small map glyph: a folded map.
    this.#map.innerHTML =
      '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/></svg>';
    this.#map.addEventListener('click', () => onMap());
    this.element.append(this.#status, this.#map);
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
  }

  setMapOpen(open: boolean): void {
    this.#map.setAttribute('aria-pressed', String(open));
  }

  setExpanded(expanded: boolean): void {
    this.#status.setAttribute('aria-expanded', String(expanded));
  }

  update(player: Partial<PlayerState>): void {
    const signature = JSON.stringify([
      player.hp,
      player.hp_max,
      player.mp,
      player.mp_max,
      player.place,
      player.depth,
      player.status,
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
              { '--v': String(fraction(mp, mpMax)) },
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
