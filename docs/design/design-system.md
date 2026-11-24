# Design system

**Mood:** the terminal these games come from. A black (or printer-paper) screen, monospace headings and data, plain reading text, 1px rules and square corners, and one phosphor-green accent used sparingly. The site frames the games; once a game starts, the game owns the screen.

## Tokens (`apps/web/src/styles/tokens.css`)

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--bg` / `--ink-1` | `#0e1011` | `#f3f4f0` | Page |
| `--surface` / `--ink-2` | `#15181a` | `#fbfcf9` | Cards, panels |
| `--ink-0` | `#08090a` | `#e2e5df` | Glyph covers, roadmap cells |
| `--text` | `#dfe4e0` | `#121513` | Body text |
| `--text-muted` | `#97a29c` | `#545c57` | Secondary text (≥ 4.5:1 on every surface) |
| `--accent` | `#74dc9c` | `#15693a` | Calls to action, links, the prompt marks |
| `--line` | `#2c3236` | `#cbcfc8` | Rules |
| `--line-strong` | `#5d6670` | `#7d857f` | Borders of cards and controls (≥ 3:1) |
| `--brand-amber` | `#e0aa4a` | `#9a5e0c` | The wordmark's ARCHIVE only |

Type: **IBM Plex Mono** (headings, labels, tables, keys; 400 and 500) and **IBM Plex Sans** (reading text), self-hosted (OFL), Latin and Latin Extended only (`styles/fonts.css`). The header's wordmark keeps the logo's lockup in **Fraunces** and **Inter**, which the games' launch screens also use. Spacing uses a 4px-based scale (`--space-1`…`--space-8`). Corners are square (0 or 2px).

Details: section headings start with an accent `>` (a prompt, and the stairs down); the hero ends in a still block cursor; the selected filter is in reverse video; tags read `[Text] [Tiles]`; games without art show their glyph on a floor of dots; roadmap rows show the glyph in a map cell.

## Rules

- Status is always text plus symbol (●◕◑◐○⊘), never color alone.
- Focus is always visible (2px outline in the accent colour). Touch targets are at least 44px.
- Motion is limited to short color and lift transitions and respects `prefers-reduced-motion` and the in-app setting.
- The theme follows the system, with an override in Settings. The play screen always uses the dark palette so games sit in a dark frame.
- Covers are 16:9 captures from the running game. Games without art use a typographic cover built from their glyph.
- No gradients for decoration, glassmorphism, badges for their own sake, or a generic RPG HUD over games.
