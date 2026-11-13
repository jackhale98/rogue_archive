# Mobile play

Decided with the project owner: on phones, **split Brogue's screen into native-feeling pieces**, move with a **floating thumb pad**, and act with a **context-aware dock** whose buttons fan out related actions on long-press. Desktop and tablets keep the original screen.

## When the phone layout applies

The shell is in *compact* mode when touch controls are shown and the viewport's shorter side is under 600 CSS px. It overlays its controls on the game, hides the header bar (back, keyboard, full screen and menu float top-right) and tells the adapter through `setPresentation({ compact, insets, topRightReserve })`. The adapter decides how to use the space; the title screen always shows Brogue's original screen.

## Brogue's phone layout (`games/brogue-ce/adapter/views.ts`, `hud.ts`)

| Piece | Source | Shown as |
|---|---|---|
| Dungeon map (79×29 cells) | Brogue's screen | Fills the display below the status band at ~18 CSS-px rows by default; **pinch** to resize (remembered), **drag** to look around; the camera re-centres on the player when they move, inside the area not covered by controls |
| Health, hunger, depth | Read-only state snapshot from the platform layer | Status pill; tap it to open the sidebar drawer |
| Messages (3 lines) | Brogue's message rows | Colored lines in the status band; tap to open the message log |
| Flavor line ("You see…") | Row 32 | Small pill above the bottom edge |
| Text over the map: inventory, dialogs, menus | Detected per frame (`camera.ts`) | **Sheet**: lifted out, scaled up to 30 CSS-px rows, centred over a dimmed map; tap outside = Escape |
| Descriptions (monsters, items), `--MORE--` boxes | Same detection | Not drawn over the map. Brogue's box text is read out of the cells (gaps where map glyphs show through are dropped by comparing with the dungeon from before the box appeared), re-flowed into paragraphs with Brogue's colors, and shown in a full-screen **reader** at a large font. **Long-press** something to open the reader directly; when Brogue shows a description by itself (exploring, combat, a preview tap) a small **"ⓘ … Read" chip** appears under the status band instead, so play is never interrupted. Closing the reader (×, tap outside, Escape) sends nothing to the game. The map shows the dungeon underneath |
| Sidebar (cols 0–19) | Brogue's screen | **Drawer**, rows in use only, scaled up; tap outside closes |
| Bottom button row | — | Replaced by the dock |

All pieces show Brogue's own cells (glyphs, tiles, colours) rendered from the same buffer; taps map back to the original cells, so Brogue only ever sees ordinary mouse events.

## Context-aware controls (`games/brogue-ce/adapter/state.ts`)

| Context | How it's detected | Dock | Pad |
|---|---|---|---|
| Exploring | Waiting for input, nothing else applies | Explore (hold: stairs ↓/↑) · Search (hold: rest, long rest) · Pack (hold: apply, equip, throw, remove, drop) · More (command list). Badly hurt: Rest leads | ✓ |
| Targeting | `<tab>` targeting prompt, or Brogue's keyboard cursor mode | Confirm · Next · Cancel | ✓ (moves the cursor) |
| `--MORE--` | Shown on screen | One wide Continue | — |
| Yes/No | Text-input wait with a Yes/No box | Yes · No | — |
| Menus, typing | Text-input wait (Brogue uses it for every menu) | Back · OK · Type | — |
| Busy (auto-explore, travel, animation) | Engine not waiting for input for >350 ms | Stop | — |

The game-state snapshot (HP, max HP, nutrition, strength, depth, gold, cursor, stairs, input flags) is read in `port/rogue-archive-platform.c` and never written back. Engine conformance tests confirm the game is unchanged.

## Message log

A scrollable log of Brogue's full message history (from its own `messageArchive`, read-only), grouped by turn, keeping Brogue's colors and repeat counts. It opens from the Log button (all devices) or by tapping the messages in the status band. It follows new messages while you're at the bottom and stays put while you scroll back, with a "Latest" button. It's a platform feature: any adapter can emit `message-log` events.

## Shared touch components (`apps/web/src/features/game-shell/TouchControls.tsx`)

- **ThumbPad**: press anywhere on the disc and slide; the direction follows the finger (8 sectors, dead zone in the middle). Holding repeats steps; sliding to the centre stops; tapping the centre sends the centre command. Each direction is also a labelled button.
- **ActionDock**: tap = main action. Long-press (340 ms) fans out alternates; slide onto one and release to choose, release on the button to keep the fan open for tapping, release elsewhere to cancel. Optional vibration (Settings → Vibration, off by default).
- Shell commands `shell:palette` and `shell:keyboard` let adapters place "More" and "Type" buttons.

## Not yet done

- Verification on real phones (all tests use Chromium's mobile emulation).
- iPhone has no Fullscreen API for pages; "Add to Home Screen" gives a full-screen app instead. A one-time hint is a candidate.
- Pinch zoom is unit-tested through the layout code but not end-to-end (Playwright has no multi-touch helper).
