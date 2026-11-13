# Design system

**Mood:** a premium digital archive: restrained, warm, atmospheric and fast. The site frames the games; once a game starts, the game owns the screen.

## Tokens (`apps/web/src/styles/tokens.css`)

| Token | Dark (default) | Light | Use |
|---|---|---|---|
| `--bg` / `--ink-1` | `#16130f` | `#f4ecdb` | Page |
| `--surface` / `--ink-2` | `#1e1a15` | `#fbf6ea` | Cards, panels |
| `--text` | `#ece3cf` | `#231d14` | Body text |
| `--text-muted` | `#b3a88f` | `#6a5d45` | Secondary text (≥ 4.5:1 on surfaces) |
| `--accent` | `#e0aa4a` | `#9a5e0c` | Calls to action, selection, focus |
| `--line` | `#3a3329` | `#d6c7a6` | Borders |

Type: **Fraunces** (display) and **Inter** (text), both self-hosted (OFL); monospace from the system for keys and code. Spacing uses a 4px-based scale (`--space-1`…`--space-8`). Radii are 6, 10 and 16px.

## Rules

- Status is always text plus symbol (●◕◑◐○⊘), never color alone.
- Focus is always visible (2px amber outline). Touch targets are at least 44px.
- Motion is limited to short color and lift transitions and respects `prefers-reduced-motion` and the in-app setting.
- The theme follows the system, with an override in Settings. The play screen always uses the dark palette so games sit in a dark frame.
- Covers are 16:9 captures from the running game. Games without art use a typographic cover built from their glyph.
- No gradients for decoration, glassmorphism, badges for their own sake, or a generic RPG HUD over games.
