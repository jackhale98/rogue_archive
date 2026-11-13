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
| Menus, typing | Text-input wait (Brogue uses it for every menu) | Back · Shift ⓘ · OK · Type | — |
| Busy (auto-explore, travel, animation) | Engine not waiting for input for >350 ms | Stop | — |

The game-state snapshot (HP, max HP, nutrition, strength, depth, gold, cursor, stairs, input flags) is read in `port/rogue-archive-platform.c` and never written back. Engine conformance tests confirm the game is unchanged.

## Message log

A scrollable log of Brogue's full message history (from its own `messageArchive`, read-only), grouped by turn, keeping Brogue's colors and repeat counts. It opens from the Log button (all devices) or by tapping the messages in the status band. It follows new messages while you're at the bottom and stays put while you scroll back, with a "Latest" button. It's a platform feature: any adapter can emit `message-log` events.

## Shift

A latching **Shift** for touch: tap it (it lights up), and the next tap, menu choice, pad direction or command is sent with Shift held, exactly as on a keyboard; then it releases (tap again to cancel). Brogue uses Shift for **item details in menus** ("Apply what? (a-z, shift for more info…)"), **running** (Shift + direction) and cycling targets backwards. It's in the menu dock, as a long-press option on Explore (the slot then shows "Run ⇧" while latched) and on Next when targeting. The game also sees Shift as held while it's latched (`modifierHeld`).

## DCSS

DCSS shows upstream's WebTiles client in a frame (see [games/dcss/PORTING.md](../../games/dcss/PORTING.md)), so its menus, descriptions and character creation are already DOM text and buttons. The phone work is about room, reach and the command set.

**Layout** (`games/dcss/adapter/hud.ts`, `client-host/host.css`): a status band (health and magic bars, place, up to four status lights) replaces upstream's 42-column stats panel. Tapping the band opens that panel as a drawer; the map button beside it shows the minimap as a large popup (tap outside to close) instead of keeping it on screen. The map fills the rest of the frame above a 4-line message pane (`--more--` and prompts appear there). Popups and menus use the whole frame and scroll. The frame sits in the space the shell's controls leave, so nothing is hidden under the dock or pad.

**The command set.** DCSS has about 70 commands bound to keys, far more than Brogue. The goal is that every one is reachable by touch without a settings screen, a help page or the keyboard. Three levels:

1. **Dock: six buttons for the map context**, one per kind of action, each leading with the most common one:

   | Button (tap) | Long-press fan (slide and release) |
   |---|---|
   | **Explore** `o`, or **Rest** `5` when badly hurt | Rest, Wait, Run (next direction), Down `>`, Up `<`, Travel `G` |
   | **Fight** `Tab` | Fire at nearest `p`, Aim `f`, Throw `F`, Quiver `Q`, Strike `v`, Swap weapons `'` |
   | **Cast** `z` | Ability `a`, Evoke `V`, Learn `M`, Spells `I`, God `^`, Force cast `Z` |
   | **Pack** `i` | Pick up `g`, Equip `e`, Unequip `c`, Quaff `q`, Read `r`, Drop `d`, Items here `;` |
   | **Look** `x` | Map `X`, In view `Ctrl-X`, Status `@`, Skills `m`, Resists `%`, Overview `Ctrl-O`, Mutations `A` |
   | **More** | The palette: every command by category (Movement, Combat, Magic, Items, Information, Game) |

2. **The thumb pad** moves (vi keys `hjklyubn`), its centre waits a turn (`s`), and **Run** latches Shift for the next direction (shown pressed while latched). The same pad moves the cursor while targeting and on the level map.

3. **Context docks.** The dock changes with what the game is waiting for. It follows `input_mode`, popups, menus and text prompts (`games/dcss/adapter/state.ts`):

   | Context | Dock |
   |---|---|
   | Start screen | (none: the start screen's own buttons and name field) |
   | Character creation, game menu | OK, Back, Type |
   | Menu or popup (inventory, descriptions, character sheet) | Close, Page ▲ (Up), Page ▼ (Down), Select, Type |
   | `--more--` | Continue, Skip |
   | Yes/no question | Yes, No, Cancel |
   | Item prompt ("Quaff which item?") | Choices (`?` lists them), Type, OK, Cancel |
   | Text field | Type, OK, Cancel |
   | Targeting | Fire (or *Stop here* `.`), Next (or Previous), Info, Cancel, plus the pad |
   | Level map | Travel, `>` (or `<`), Close, plus the pad |
   | Busy (travel, resting) | Stop |

Upstream's own touch-friendly pieces stay. Tapping the map travels there, the action panel above the map offers one-tap use of consumables, and every menu item and creation choice is tappable. `games/dcss/tests/conformance/key-coverage.ts` checks that each touch command sends the key upstream binds to that command.

## Shared touch components (`apps/web/src/features/game-shell/TouchControls.tsx`)

- **ThumbPad**: press anywhere on the disc and slide; the direction follows the finger (8 sectors, dead zone in the middle). Holding repeats steps; sliding to the centre stops; tapping the centre sends the centre command. Each direction is also a labelled button.
- **ActionDock**: toggles (`TouchAction.active`) render as pressed buttons (`aria-pressed`). Tap = main action. Long-press (340 ms) fans out alternates; slide onto one and release to choose, release on the button to keep the fan open for tapping, release elsewhere to cancel. Optional vibration (Settings → Vibration, off by default).
- Shell commands `shell:palette` and `shell:keyboard` let adapters place "More" and "Type" buttons.

## Not yet done

- Verification on real phones (all tests use Chromium's mobile emulation).
- iPhone has no Fullscreen API for pages; "Add to Home Screen" gives a full-screen app instead. A one-time hint is a candidate.
- Pinch zoom is unit-tested through the layout code but not end-to-end (Playwright has no multi-touch helper).
