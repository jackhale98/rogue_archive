# Mobile play

Decided with the project owner: on phones, **split Brogue's screen into native-feeling pieces**, move with a **floating thumb pad**, and act with a **context-aware dock** whose buttons fan out related actions on long-press. Desktop and tablets keep the original screen.

## Starting and ending a game

The screens players see most are the start of a game (title, character creation, the first pages) and its end (death or quitting, the tombstone, the scores, back to the start). On phones every step is a labelled button or a tappable line, none needs the keyboard, and each screen has one lead (highlighted) button:

- **Start screens** (`packages/start-screen`, DCSS's launcher): the name field starts with a random name (or the last one used), so Start is one tap; **Random name** picks another.
- **Questions that want a word typed** are buttons: DCSS's "(Confirm with "quit".)" is **Abandon character**; Sil-Q's and Angband's "verify … by typing the '@' sign" are **Kill character** and **Retire character**.
- **The end of a game** leads with the way on: Continue through each screen, then **Back to title** (Sil-Q) or **New game** (Angband, HyperRogue). What the game printed after closing its screen (the scores Rogue and NetHack print as they exit, as on a terminal) is shown on the start screen under "game is over".
- A dead character's savefile, which starts a new character from it, is labelled **New from *name* (dead)** (Angband's savefile menu says so; Sil-Q remembers the tombstone's name), not "Continue".
- Full-screen text pages (Sil-Q's title, creation and tombstone; Angband's pages) are fitted by the part of the screen in use (`usedRect`), so their text is larger, and start below the shell's tools on an upright phone.
- Every game has a way to give up by touch in its command list (More): Brogue *Abandon game*, DCSS *Quit*, Sil-Q *Kill character*, Rogue *Quit*, NetHack *Quit without saving*, Angband *Retire*; HyperRogue's *New game* is in Quest's fan.

The e2e specs (`e2e/*.mobile.spec.ts`) play each game's new game and its end by touch alone.

## When the phone layout applies

The shell is in *compact* mode when touch controls are shown and the viewport's shorter side is under 600 CSS px. It hides the header bar and tells the adapter through `setPresentation({ compact, insets, topRightReserve })`. The adapter decides how to use the space; the title screen always shows Brogue's original screen.

- **Portrait:** the controls float over the game: the dock and the thumb pad along the bottom, the tools (back, keyboard, full screen, log, menu) top-right. `insets.bottom` is the height from the bottom edge to the top of the higher of the two (their margin and the safe area included); `topRightReserve` is the tools' width, and adapters put their status band below the tools.
- **Landscape:** the dock and the thumb pad sit in **rails** beside the game (the dock on the left, the pad on the right under the tools; swapped with Settings → Direction pad side → Left hand), so nothing the game draws is under a control. The rails keep their width whatever the context shows, so the game is not resized when the pad comes and goes; a dock too long for the rail gives its buttons less height (labels wrap to two lines rather than widening it); the outer edges clear the safe area (a side notch). The game gets the column between them, with zero insets and no `topRightReserve` (its band uses the column's full width). `e2e/landscape.mobile.spec.ts` checks this for every game at 844×390 and 667×375.

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

**Item details** (`games/brogue-ce/adapter/camera.ts` `findItemDetails`, `itemActions`): when an item is chosen in the inventory, Brogue draws its details panel beside the list. The sheet then shows only that panel (found from the list's `a)`, `b)` labels and Brogue's placement rule), so the text stays large. The dock offers the panel's own buttons, with the likely one emphasized: Apply, Equip or Remove, then Throw and Drop, with Relabel and Call on a long-press. It also has ▲/▼ Item to step through the pack, and Back.

**Title screen** (`games/brogue-ce/adapter/title.ts`): Brogue's title menu is a few small text buttons on the full screen. On phones it is replaced by large buttons below Brogue's own animated title art, drawn large at the top (the renderer's `titleArtView`), over a fade into its flames (New game, Load saved game, Seeded game, Recordings, High scores, Stats, Variant, Mode) that send Brogue's own hotkeys, opening the right flyout first. The file picker ("Open saved game:", "View recording:") becomes a list of saves with dates, plus Newer, Older and Back. The end of a game (the gravestone's `--MORE--`, then the high scores' "Press space to continue.") gets one wide Continue (Space: Enter does nothing there), and "You die…" also Inventory (Brogue's `i`); then "Save recording as" offers Save recording, Don't save and Rename. Other title screens (the seed prompt) show Brogue's screen with Back, OK and Type in the dock. Brogue's own flags still say "in game" after saving and returning to the title, so the adapter treats the title menu on screen as the end of the game until the dungeon's depth line returns.

## Context-aware controls (`games/brogue-ce/adapter/state.ts`)

| Context | How it's detected | Dock | Pad |
|---|---|---|---|
| Exploring (quiet) | Waiting for a command, no enemy in view | Explore `x` (hold: stairs ↓/↑, Run ⇧) · Search `s` (hold: Search five turns `Ctrl+S`, Rest `z`, and `Z` named for what it will do: Rest until better when hurt or affected, else Rest 100 turns) · Pack `i` (hold: apply, throw, equip, remove, drop, swap `w`, eat) · Look `Tab` · More (command list) | ✓ |
| In danger | An enemy in view or adjacent | Fight `x` when one is adjacent (it attacks it), else Explore (hold: search, rest, Run) · Throw again `T` when the last thrown item is still carried (hold: Throw `t`), else Throw · Pack · Look · More. Rest and Search never lead here | ✓ |
| Targeting | `<tab>` targeting prompt, or Brogue's keyboard cursor mode | Throw / Zap / Go (from the prompt text: "Throw … where?", "Zapping your …:", the look cursor) or Confirm · Next · Cancel | ✓ (moves the cursor) |
| Recording playback | `rogue.playbackMode` | Play/Pause `Space` · Slower `j` · Faster `k` · Turn → `l` (hold: ← Turn `h`, Level ↓ `>`, Level ↑ `<`) · Omniscience `Tab` (toggle) · More (playback commands and the screens a recording can show) | — |
| `--MORE--` | Shown on screen | One wide Continue | — |
| Yes/No | Text-input wait with a Yes/No box | Yes · No | — |
| Menus, typing | Text-input wait (Brogue uses it for every menu) | Back · Shift ⓘ · OK · Type | — |
| Busy (auto-explore, travel, animation) | Engine not waiting for input for >350 ms | Stop | — |

One button on the map leads (is emphasized), in order of urgency:

1. **Go ↓ / Go ↑** when the route to the stairs is shown (the cursor is on them): `>` shows the route, a second `>` goes, so this is one tap instead of a second long-press.
2. **Eat** when Hungry or worse and food is carried: Apply `a` then the food's letter, exactly what a player types.
3. In danger: **Fight** with an adjacent enemy, else **Throw again**.
4. Quiet: **Rest** (`Z`) when below half health; **Stairs ↓** once the newest message is "I see no path for further exploration."

Search shows its progress ("Search 3/5"): the fifth search in a row is Brogue's stronger one.

The game-state snapshot (HP, max HP, nutrition, strength, depth, gold, cursor, stairs, input flags; and, at a command prompt, an adjacent enemy (`adjacentFightingDir()`), enemies in view, whether `T` can throw again, whether `Z` would rest until better, search turns, the first food's letter, playback paused and omniscience) is read in `port/rogue-archive-platform.c` and never written back. Engine conformance tests confirm the game is unchanged, and `tests/conformance/key-coverage.ts` checks that every touch command sends the key upstream's `executeKeystroke` (or `executePlaybackInput`) binds to that action.

The command palette leaves out keys that would do something else on the map: `y`/`n` (they move diagonally; Brogue's yes/no boxes take Enter and Escape, which the Yes/No dock sends) and the playback keys. Enter on the map shows Brogue's keyboard look cursor; the palette names it so.

## Message log

A scrollable log of Brogue's full message history (from its own `messageArchive`, read-only), grouped by turn, keeping Brogue's colors and repeat counts. It opens from the Log button (all devices) or by tapping the messages in the status band. It follows new messages while you're at the bottom and stays put while you scroll back, with a "Latest" button. It's a platform feature: any adapter can emit `message-log` events.

## Shift

A latching **Shift** for touch: tap it (it lights up), and the next tap, menu choice, pad direction or command is sent with Shift held, exactly as on a keyboard; then it releases (tap again to cancel). Brogue uses Shift for **item details in menus** ("Apply what? (a-z, shift for more info…)"), **running** (Shift + direction) and cycling targets backwards. It's in the menu dock, as a long-press option on Explore (the slot then shows "Run ⇧" while latched) and on Next when targeting. The game also sees Shift as held while it's latched (`modifierHeld`).

## DCSS

DCSS shows upstream's WebTiles client in a frame (see [games/dcss/PORTING.md](../../games/dcss/PORTING.md)), so its menus, descriptions and character creation are already DOM text and buttons. The phone work is about room, reach and the command set.

**Layout** (`games/dcss/adapter/hud.ts`, `client-host/host.css`): a status band (health and magic bars, place, up to four status lights) replaces upstream's 42-column stats panel. Tapping the band opens that panel as a drawer; the map button beside it shows the minimap as a large popup (tap outside to close) instead of keeping it on screen. The map fills the rest of the frame above a 4-line message pane (`--more--` and prompts appear there). **Pinch** to zoom the map (remembered; `client-host/host.js` `map_gestures`): the client draws the tiles at the new size (upstream's cell size, shrunk to fit the line of sight, times the zoom; in text mode the glyphs' font), so zooming in shows less than the line of sight; the level map (`X`) keeps its own scale. **Drag** to look around over what has been seen (the client's view centre, as upstream's minimap "farview"); the player's next move centres the view again. Taps and long presses on the map work as before at any zoom or position. Popups and menus use the whole frame and scroll. The frame sits in the space the shell's controls leave, so nothing is hidden under the dock or pad.

**The command set.** DCSS has about 70 commands bound to keys, far more than Brogue. The goal is that every one is reachable by touch without a settings screen, a help page or the keyboard. Three levels:

1. **Dock: six buttons for the map**, one per kind of action, each leading with the most common one. Which six depends on whether hostile monsters are in view.

   Exploring (nothing hostile in view):

   | Button (tap) | Long-press fan (slide and release) |
   |---|---|
   | **Explore** `o`, or **Rest** `5` when badly hurt | Rest (or Explore), Wait, Run (next direction), Fight `Tab`, Attack (next direction), Quiver `Q`, Swap weapons `'` |
   | **Stairs**: what `<`/`>` does where you stand: **Down >**, **Up <**, **Pray** (altar), **Shop**, **Enter >** (portal), **Exit <** (portal vault exit); elsewhere **Travel** `G` | The others of Down `>`, Up `<`, Travel `G`, Map `X`, Find `Ctrl-F` |
   | **Cast** `z`, or **Ability** `a` once DCSS has said the character knows no spells | Ability (or Cast), Evoke `V`, Learn `M`, Spells `I`, God `^`, Force cast `Z` |
   | **Pack** `i` | Pick up `g`, Equip `e`, Unequip `c`, Quaff `q`, Read `r`, Drop `d`, Items here `;` |
   | **Look** `x` | Map `X`, In view `Ctrl-X`, Status `@`, Skills `m`, Resists `%`, Overview `Ctrl-O`, Mutations `A` |
   | **More** | The palette: every command by category (Movement, Combat, Magic, Items, Information, Game) |

   Down stairs, branch stairs, portals, altars and shops underfoot make the stairs button the emphasized one; up stairs and portal-vault exits (where arriving puts you) do not, unless you carry the Orb or Zot is approaching, which also moves the stairs button first.

   Fighting (hostile monsters in view; auto-explore and resting are refused then, so neither is offered):

   | Button (tap) | Long-press fan |
   |---|---|
   | **Fight** `Tab` | Strike `v`, Attack (next direction), Swap weapons `'`, Wait `s`, Shout `t` |
   | **Fire: *quiver*** `p`, labelled from the game's quiver ("Throw: 3 darts", "Cast: Magic Dart") | Aim `f`, Quiver `Q`, next `)` / previous `(` quivered action, Throw `F` |
   | **Cast** `z` (or **Ability** `a`) | as above |
   | **Quaff** `q` | Read `r`, Evoke `V`, Pack `i`, Equip `e`, Unequip `c`, Pick up `g` |
   | **Look** `x` | as above |
   | **More** | The palette |

   Against a nasty monster (the highest threat, red in upstream's monster list), or a tough one while below half health, **Quaff** leads and is highlighted, Fight follows without the highlight; standing on stairs, taking them (Down `>` / Up `<`) leads instead, and Look gives way.

   A latched Run or Attack stays visible (pressed) in the first slot in both docks, also when wounded.

   *Where it comes from:* `client-host/host.js` reads the WebTiles client's own map knowledge after each map update, the way upstream's `monster_list.js` does (read only): visible monsters with hostile attitude (leaving out what the monster list leaves out, such as plants), how many are adjacent and the highest threat, and the player's cell's minimap feature (stairs up, down, branch, portal, feature) plus its feature tile name (altar, shop, portal exit). It posts `{hostiles, adjacent, maxThreat, underfoot}` to the adapter. The Orb and Zot come from the status lights; spells from the spell menu or the "You don't know any spells." message.

2. **The thumb pad** moves (vi keys `hjklyubn`), its centre waits a turn (`s`). **Run** latches Shift and **Attack** latches Ctrl for the next direction (attack that square without moving, `Ctrl+hjklyubn`); a latch shows pressed while on. The same pad moves the cursor while targeting and on the level map.

3. **Context docks.** The dock changes with what the game is waiting for. It follows `input_mode`, popups, menus and text prompts (`games/dcss/adapter/state.ts`):

   | Context | Dock |
   |---|---|
   | Start screen | (none: the start screen's own buttons and name field) |
   | Character creation, game menu | OK, the step's own extra keys (Recommended and Random species, background or weapon), Back; Type when there are none. "Do you want to play this combination? [Y/n/q]" (a random or recommended character): Yes, No, Cancel |
   | Menu or popup (inventory, descriptions, character sheet) | Close, Page ▲ (Up), Page ▼ (Down), Select, Type |
   | Travel menu (`G`, tag `travel`) | Down `>`, Up `<`, Repeat `Tab` (last destination), Altars `_`, Close, Type; the branches are the menu's own items |
   | Pick up and other multi-select menus (tag `pickup`, or the multi-select flag) | Accept, All `,`, Page ▼ (▲, lines), Close, Type |
   | Item menus (quaff, read, equip, unequip…; tag `use_item`) | Select, Describe `?` (the selected item), **→ *mode*** `!` and **→ Equip / → Unequip** `Tab`, each labelled with the mode it switches to, read from the menu's key help (only those it offers), Page ▼ (▲, lines), Close, Type |
   | Spells and abilities (tags `spell`, `ability`) | Close, Page ▲, Page ▼, Describe `!` (switches between using and describing), Select, Type |
   | `--more--` | Continue, Skip |
   | Yes/no question | Yes, No, **Always** `A` when the question offers it, Cancel |
   | Level-up stat increase | Str `S`, Int `I`, Dex `D`, Type (the game re-asks on Escape) |
   | Item prompt ("Quaff which item?") | Choices (`?` lists them), Type, OK, Cancel |
   | Text field | Type, OK, Cancel; a prompt asking for a word ("Confirm with "quit"") offers it as one button (**Abandon character**), and Cancel |
   | The end of a game (after the morgue file is written: the inventory, then "Goodbye" with the scores) | **Continue** (Page ▲/▼ in the inventory), back to the start screen |
   | Aiming (fire, throw, cast at a target; `TARGET_PATH`) | Fire (or *Stop here* `.`), Next (or Previous, Info), Quiver ▸ `)` (or ◂ `(`), Cancel, plus the pad |
   | Looking (`x`, or a spot to target; `TARGET`) | Select (or *Stop here*), Next (or Previous), Info `v`, Cancel, plus the pad |
   | A direction (`TARGET_DIR`) | The pad, Cancel |
   | Level map | Travel, `>` (or `<`), Close, plus the pad |
   | Busy (travel, resting) | Stop |

Upstream's own touch-friendly pieces stay. Tapping the map travels there, the action panel above the map offers one-tap use of consumables, and every menu item and creation choice is tappable. `games/dcss/tests/conformance/key-coverage.ts` checks that each touch command sends the key upstream binds to that command (`cmd-keys.h`), and for keys a prompt reads itself (travel's `Tab` and `_`, yes/no's Always, the stat increase) that the prompt still handles them; `upstream-drift.ts` checks what the touch controls read from the client and the game (map knowledge, monster attitude, minimap features, menu tags, the stat question, the Orb and Zot lights).

The palette also has the commands no dock leads with: cycle the quiver `(` `)`, attack without moving (the Attack latch), add a macro `Ctrl-E`, and save now `Ctrl-S` (save and exit without the question).

## Sil-Q

Sil-Q draws an 80×24 text screen (`games/sil-q/adapter/index.ts`, drawn with `packages/term-view`), or with Display set to Tiles, the map with Sil-Q's own tiles by MicroChasm in square cells (on desktop between the text sidebar, message line and status line; on phones the whole map view), the rest staying text.

- **Layout on phones:** a status band replaces Sil's sidebar: health, voice and depth; a row with what Sil's sidebar and status line show about the character (stealth mode, the song and minor theme, hunger, Entranced, Blind, Confused, Afraid, Poisoned, Bleeding, Stun, Slow/Fast, a light about to go out), with Sil's own wording and thresholds; and the newest message. Tapping it opens the message log. The map is drawn at a readable cell size following the player; pinch to zoom, drag to look around (it recentres when the player moves). The title screen and character creation are fitted whole.
- **Text over the map** (inventory, item lists, menus, the character sheet) opens as a sheet over the dimmed map; tap a line to choose it, tap outside to close (Escape).
- **Long-press on the map** looks at that cell: Sil's look command, `p` (back to the player, free cursor), then one step per cell, so the prompt line describes what is there (Target, Recall, Cancel in the dock).
- **Situation** comes from read-only fields the port adds to its snapshot (`port/main-web.c`): what is underfoot (stairs, a forge, an object, the Iron Crown), `on_the_run`, unspent experience against the cheapest ability whose prerequisites are met (priced as the abilities screen does), visible monsters in line of sight and adjacent (from the monster list, as `[` counts them), a bow and arrows in the first quiver, known closed doors next to the player.
- **Keysets:** buttons send Sil's original keys. If the player turns on `hjkl_movement` or `angband_keyset` (the snapshot carries the keyset in use), map commands are sent after Sil's keymap bypass `\`, so each button still does what it says; directions are digits, which every keyset maps to movement.

| Context | Dock |
|---|---|
| Title menu | The menu's lettered choices as buttons and **Continue *name*** for each saved character; OK, Back, Type. Screens that wait for a key (the opening verse, the scores) offer **Continue** |
| Character creation | Step by step (read from Sil's key help, `birthStep`): race and house, the current menu's choices only (the races stay on screen beside the houses), **Random** (`*`); stats and skills, **↑ Prev**, **↓ Next**, **− Less**, **+ More**; history and age/height/weight, **Reroll** (Space); the name, **Type a name** and **Random name** (Tab). Every step has **Start over** (Escape, which Sil uses to restart the character) and, nearest the thumb, **OK** / **Accept**. The pad keeps Sil's arrow keys, Enter in its centre |
| "Open saved character" name prompt | The saved characters by name; Type a name, OK, Back |
| Map, exploring | The context lead (below) · Stealth (toggle, lit while on; fan: sing, run) · Rest (fan: hold, run, exchange places, open, close, bash, disarm, tunnel, alternate action, stairs, pick up), or **Door** (`/`) when a closed door is next to the player · Pack (fan: equipment, wear, take off, eat, drink, use, drop, staffs, instruments, examine, fire, throw) · Look (fan: monsters and objects in view, map, character, abilities, smithing, knowledge, messages) · More (every command); the pad with Hold in the centre. Rest leads when wounded and nothing else does |
| Map, monsters in view | Lead · **Fire** with a bow and arrows in the first quiver (fan: second quiver, throw, throw at nearest), else **Throw** · **Oil** with a flask of oil in the pack (`t` and the flask's letter; the aim prompt follows. Look gives way to it) · **Sing** showing the current song · Stealth · Look · Pack · More |
| Map, monster adjacent | Lead · Hold (fan: rest) · Sing · Throw (or **Oil** with a flask) · Exchange places (fan: doors) · Pack · More (attack by moving into the monster with the pad) |
| Map, below half health with monsters in view | Stairs if standing on them · **Quaff** (fan: use) · Eat herb · Sing · Pack · Look · More |
| Context lead | The Iron Crown underfoot → **Prise** (`k`); fleeing with a Silmaril (`on_the_run`) → **Up** `<`; stairs underfoot → **Down** / **Up**; an object underfoot → **Pick up**; a forge → **Smith** (`0`); enough unspent experience for an ability → **Abilities** (Tab) |
| Item prompt ("Drop which item?") | The item letters; **Show items** (`*`) names them; Worn/Pack (`/`), Floor (`-`) when offered; Cancel |
| Song prompt ("Sing which song") | The songs offered, by name (the one being sung lit); Stop singing (`s`); Exchange themes (`x`) when weaving themes; Cancel |
| Menus and lists | The lettered lines as buttons, Close, Select, Choices, Type; the pad (abilities and smithing screens use arrow keys) |
| `-more-` · yes/no | Continue, Skip · Yes, No, Cancel |
| "Please verify ABORTING by typing the '@' sign" (Kill character, `Q`) | **Kill character** (`@`), Cancel |
| The tombstone and the menu after death (files.c `final_menu`) | In reading order: Scores, Inventory, Dungeon, Messages, Character, Add a note, Save character sheet, then the lead **Back to title** (`h`) |
| Aim ("'f' for closest") | The pad; **Nearest** (`f`; **Target** once one is set), **Choose target** (`*`; Re-target), Cancel |
| Direction (open, close, bash, tunnel, disarm) | The pad and Cancel only: these prompts take no target |
| Look / target | The pad; what the prompt offers: Target (`t`), Next (Space; **More** when the prompt says `-more-`), Recall (`r`) for a monster; Cancel |
| Text field | Type, OK, Cancel |

`games/sil-q/tests/conformance/key-coverage.ts` checks that each command sends the key Sil's `process_command` binds to that action.

### DCSS start-up and character creation on phones

- From Start until DCSS shows its first screen, the start screen shows "Preparing the dungeon for *name*…" with a spinner and the seconds elapsed. DCSS's caches ship prebuilt, so this takes a second or two; the dock stays empty meanwhile.
- Character creation takes the screen's full width on every step. A first tap on a species, background or weapon shows what it is (upstream's description, which desktop shows on hover, pinned at the bottom of the screen); a second tap, or OK, chooses it (`client-host/host.js`).
- Character creation's species and background columns are flowed into one scrolling column on phones, column by column with each group's heading (`client-host/host.css`; `host.js` orders the items from upstream's grid placement). The status band reads "New character" until the character exists.

## Rogue

Rogue's 80×24 screen is drawn with `packages/term-view` in monochrome (curses standout in reverse video), or with Display: Tiles (RLTiles) or 1-Bit (Kenney's 1-Bit Pack) the map in pictures at a readable size; a start screen (`packages/start-screen`) names the character or continues a saved game.

- **Layout on phones:** a status band (Rogue's status line and its message line; tap for the message log), the map at a readable size following the hero (pinch to zoom, drag to look around), lists (inventory, discoveries) as a sheet with tappable lines; long press on the map identifies the symbol there (`/`).

| Context | Dock |
|---|---|
| Map | Search (fan: rest, search ×10, rest ×10, run, careful run, pick up, step over, identify trap) · Fight (fan: fight in a chosen direction, fight to the death, throw, zap, again) · Pack (fan: eat, quaff, read, wield, wear, take off, ring on/off, drop, call, one item, again) · Stairs (fan: up) · Look (fan: discoveries, last message, weapon, armor, rings, help) · More, plus the pad with Search in the centre. Leads from the snapshot and the map: an object underfoot → Pick up; a monster next to the hero → "Fight ↖B" (`f` and the direction, one tap; only the direction while hallucinating); only a floating eye next to the hero → "Throw →E"; an aquator in sight with armour worn → Take off; Hungry → Eat; on the stairs → Down >; with the Amulet → Up <. A latched Run (⇧) or careful run (⌃, Ctrl+direction) turns the next pad direction into a run; any other action lets go |
| `--More--` | By default not shown: Menu → `--More--` prompts → Continue automatically (the default) sends Space as soon as Rogue shows it; the message stays in the band and the log. With Wait for a key (original): Continue, plus the pad: a move or search continues first, then acts (Rogue ignores every key but Space at `--More--`, which in a fight comes after almost every blow) |
| "Press space to continue", or `--More--` over another window (lists, help, Discoveries, detection overlays; `ST_OVERLAY`) | Close; never continued automatically. A list opened from an item prompt (`*`) offers its items: a tap sends Space (closing the list) and the letter (answering the prompt). In the plain inventory, a tapped line offers that item's actions (Eat, Quaff, Read, Zap, Wield, Wear or Take off, Put on or Remove, Throw, Drop, Call; the likely one first and highlighted): Rogue's lists take only Space, so an action sends Space, the command, and answers the command's item prompt with the letter when it comes (after the direction, for Throw) |
| Tombstone and scores ("Press return") | Continue (Enter); the top ten Rogue then prints (on a terminal, after its screen closes) is shown on the start screen |
| "which direction?" | The pad; Cancel |
| Item prompt ("(* for list)") | Show items, Cancel, Type; with the list shown, its items. A command from the dock or the command list shows the list at once (`*`) |
| Busy (running, resting, a repeat count) | Nothing: Rogue reads no keys until it is done |
| Lists over the map | The lettered lines, Close, Cancel |
| Yes/no ("Really quit?", "Save file?") | Yes, No, Cancel |
| Typed answers ("call it", "file name") | Type, OK, Cancel |

`games/rogue/tests/conformance/key-coverage.ts` checks each command against `command.c`.

## HyperRogue

HyperRogue draws its own interface with WebGL (upstream's web build), so the phone layout keeps it whole: the canvas fills the area the shell's controls leave (upright: below the floating tools and above the dock; sideways: the column between the rails), at up to twice the CSS resolution, and the game lays out its own HUD (kills, score, messages) for that size. Touch follows upstream's mobile version (`mobile.cpp`) on top of the web build's click handling: the finger shows what is under it (the game's hover), lifting it acts there (move towards the cell, attack, use a ranged orb on it, choose a menu line), and holding still for half a second asks for help about it (the desktop's right-click). Upstream's Android interface itself (`mobile.cpp`, its on-screen compass) is built around the Android app's own platform code, so it is not compiled in.

| Context | Dock |
|---|---|
| Map | What applies, first: Aim (a ranged orb is held) · Fire (crossbow mode; lit while aiming, with the reload count) · Wind jump `t` (strong wind) · Drop Dead Orb `g` (Dead Orbs carried) · Orbs `i` (Orb Strategy) · Mark (in or next to the Minefield). Then Centre (fan: rotate either way) · Overview `o` (fan: Inspect) · Quest (fan: help, new game, menu; "Cancel fire" while the crossbow aims, as Esc does) · More, plus the pad (vi keys, Wait in the centre) |
| Menus, help, quest screen | Back (Esc), OK (Enter); the game's own lines are tappable |
| Caught (game over): the quest screen the game opens | **New game** (F5), Back (look at the scene), OK |
| Caught, looking at the scene | **New game**, Quest (the score), Menu |

What a tap on the map does can be switched from the dock (lit while on):

- **Aim** (shown while a ranged orb is held): upstream's own "touch for ranged" mode (`touchmode`, which its `touch_interface` button cycles; the port sets it with `ra_set_touch_mode`). The next tap always targets a ranged orb there, with the game's messages if it can't, and never walks: the desktop's Shift+click. Aim ends once a turn passes (the orb was used) or no ranged orb is left. Without Aim, a tap on a distant cell still uses an orb if one applies (as upstream's mobile version); while the finger is down the hint names the orb a release would use ("Release uses Orb of Teleport", from the game's `orbToTarget`).
- **Inspect** (Overview's fan): upstream's "touch for info" mode: taps show help about the cell (the desktop's right-click), never move, until switched off.
- **Mark** (Minefield): taps mark or unmark a possible mine (the adapter points at the cell, then presses `m`, upstream's key for the cell under the pointer). Ends on leaving the Minefield.

A small hint above the dock says which mode is on, and shows the Orb of Safety's charge while it is powered ("leaving now keeps this game"). `t` targets the cell at the centre of the view, which after any move is the player, so the dock offers it only with strong wind (where it jumps); it stays in More.

`games/hyperrogue/tests/conformance/key-coverage.ts` checks each command against `control.cpp`, including the touch modes the dock switches.

## NetHack

NetHack's interface is its window port (`games/nethack/adapter/windowport.ts`), drawn as tty draws it on an 80×24 screen (see [games/nethack/PORTING.md](../../games/nethack/PORTING.md)).

- **Layout on phones:** a band with NetHack's two status lines (hit points as a bar) and the message line (tap for the message log); the map at a readable size following the hero (pinch to zoom, drag to look around), in text or NetHack's own tiles; menus and text windows (the inventory, character creation, help, "Things that are here") lifted into a large sheet over the map, drawn without them, whose "a - item" lines can be tapped.
- **Taps and presses** (the design: [nethack-controls.md](nethack-controls.md)):
  - a menu line chooses it (its key, as tty); a text window, a menu only to read or `--More--` continues on a tap anywhere;
  - a map cell: NetHack's own click action (`mouseaction`): far away travels there, next to the hero moves, attacks or opens;
  - the hero: NetHack's menu of what can be done here (`#herecmdmenu`: stairs, pick up, loot, fountain, altar…);
  - a long press next to the hero: its menu of what can be done there (`#therecmdmenu`: doors, walls, pets, monsters, traps); farther away: what is there (farlook, `;`);
  - while choosing a position: the cell; while asked for a direction: the direction towards the cell.
- **--More--** continues by itself (Settings → *--More-- prompts* → wait, to read each one); the band shows this turn's messages, up to three lines.
- **Dock:** from a read-only snapshot of what the player sees and knows (never hidden state):

| Context | Dock |
|---|---|
| Exploring | A lead when the place or moment calls for it (Up/Down on stairs, Pick up or Loot, Offer on an altar with a corpse, Drink at a fountain or sink, Sit on a throne, Eat when hungry, Pay in a shop, Drop several when burdened, Enhance after "You feel more confident") · Search (fan: rest, ×10, ×20, here menu) · Travel (fan: to the stairs, stairs, run, jump) · Pack (fan: eat, quaff, read, wear, wield…) · Look (fan: look here, discoveries, equipment, overview…) · More |
| Fighting (a hostile monster next to the hero or lined up) | Fight ↖x (one tap, at the monster) · Fire →x (quiver loaded, monster lined up) or Throw · Cast or Zap · Quaff · Elbereth · More |
| In trouble (stoned, slimed, strangled, ill, weak from hunger, low hit points) | Pray · Quaff · Elbereth · Fight ↖x or Flee ▴ (travel to the up stairs) · Pack · More |
| Question ("[ynq]") | Its answers as buttons (Yes, No, Quit, All; other letters as themselves), Cancel |
| Item prompt ("What do you want to eat? [fg or ?*]") | On a phone the suitable items open at once (`?`), whatever asked (a button, the game's own menus, the keyboard), once per question; on desktop for touch commands; up to three items are buttons of their own (letter and name); Choose, All items (`*`), Hands (`-`) when offered, Cancel |
| Direction | The pad (Self in the centre), At ↖x (the monster), Down `>`, Up `<`, Cancel; or tap towards a cell |
| Position (travel, farlook, jump…) | Select (also the pad's centre; the pad moves the cursor), Monster (fan: objects, doors, altars, anything, unexplored), Stairs (fan: up, traps), Yourself, Cancel; or tap the cell |
| Menu | Choosing one: a button per line when there are five or fewer, else its Random line (`*`); Accept and All (several to choose), pages, Cancel, Type; a menu to read: pages and Close |
| Text window, `--More--` | Next or Continue, Close |
| The end of a game ("Do you want your possessions identified?" and the questions after it) | Yes, No, **Skip to the end** (`q`); the lists after them: Continue; the tombstone and "Goodbye": Continue; then NetHack's scores on the start screen |
| Typed line, extended command | Elbereth when engraving (with strategy shortcuts on), Type (the keyboard), OK, Cancel |

The window port tells NetHack its windows are up (`iflags.window_inited`, as tty does), so the end of a game shows the tombstone and the "Goodbye" summary, and the scores NetHack prints after closing its windows reach the start screen.

Character creation: "Shall I pick a character for you?" answers as Pick for me, Let me choose, Pick, no questions, Quit; the role, race, gender and alignment menus have a Random button; "Is this ok?" has a button per choice.

The Elbereth button (fighting, trouble, the command list; only with Settings → *Strategy shortcuts* on, off by default, since the game never tells you about Elbereth directly) engraves it in the dust: `E`, fingers, no to adding to an engraving, the text; every question is still the game's, and the game decides whether it works.

## Angband

Angband draws an 80×24 screen (`games/angband/adapter/index.ts`, drawn with `packages/term-view`), or with Display set to Tiles, the map with Adam Bolt's tiles through Angband's own graphics mode, in square cells (on desktop between the text sidebar, message line and status line, at the size that fits the whole map panel; on phones the whole map view). Angband 4.2 has mouse support of its own, so on any screen a tap is a click on that cell, as a mouse would give it.

- **Layout on phones:** a status band replaces the sidebar: health (with a bar), mana for casters, level and depth (Town, or feet and level); Angband's own status line (light, hunger, speed, timed effects, what is underfoot) as it words it; and the message line. Tapping it opens the message log. The map is drawn at a readable cell size following the player; pinch to zoom, drag to look around (it recentres when the player moves). The savefile menu, character creation, stores and full-screen pages (the character sheet, knowledge, help) are fitted whole, with their choices also as dock buttons.
- **Full-screen pages** (character creation, the character sheet, stores, help, knowledge menus, and any page drawn over the whole map) are fitted whole; pinch to zoom in (around the cursor) and drag to move about; each new page opens fitted. Keys a page names in its prompt ("'c' to change name, 'h' to change mode") are buttons.
- **Text over the map** (the inventory, item prompts, the command menu, context menus, monster and object lists) opens as a sheet over the dimmed map, which leaves the list's own text out; item lists include their weight column; a button per item only when there are three or fewer; tap a row to choose it (a click on it, which Angband's menus take), tap outside to close (Escape).
- **Taps on the map** are Angband's clicks (`ui-context.c`, the `mouse_movement` option, on by default): next to the player walks there (attacking a monster in the way), farther away travels there by Angband's pathfinding (stopped, as running is, when something comes into view); on the player picks up or holds. **Long-press** looks at the cell (Alt+click: look mode with its cursor there; Next, Target, Recall, Close in the dock). On desktop, right-click opens Angband's context menu for the cell.
- **Situation** comes from read-only fields the port adds to its snapshot (`port/main-web.c`, read with upstream's own predicates): stairs, a shop entrance or objects underfoot; visible monsters in view and adjacent, with the direction to an adjacent one (the current target first); a launcher with ammunition (`player_can_fire`); a spellcasting class and whether it can cast now; known closed doors next to the player; resting or running.
- **Keysets:** buttons send Angband's original keys, or the roguelike keyset's when that option is on (the snapshot carries it; each command knows both, from `ui-game.c`'s tables). Movement uses the arrow and Home/PageUp/End/PageDown keys, which `pref.prf` maps to walking in both keysets; Run latches Shift for the next direction.

| Context | Dock |
|---|---|
| Splash screen, scores and other "press any key" pages | Continue (Enter), Skip; on pages left with Escape (the scores), Done and Next page |
| Savefile menu (Angband's own, at start and after save and quit) | **New character** and **Continue *name*** for each savefile (two clicks on its row: the menu moves to a row on the first and chooses it on the second); the pad |
| Character creation | The screen's lettered choices (race, class, how to roll stats); OK (Enter), Random (`*`), Back (Escape); the pad (up/down move, left/right change the point-based stats) |
| Map, exploring | The lead (below) · Rest (`R`, Enter: as needed; fan: hold, run, open, close, disarm, tunnel, alter, stairs, pick up), or **Door** (`o`) when a closed door is next to the player · Cast for casters (fan: browse, study, staffs, wands, rods, activate) · Pack (fan: equipment, quiver, wear, take off, eat, quaff, read, use, drop, examine, fuel) · Look (fan: map, monster and object lists, character, knowledge, messages, locate) · More (fan: Angband's command menu); the pad with Hold in the centre |
| Map, monsters in view | Lead · **Fire** at the nearest (`h`; roguelike Tab) with a launcher and ammunition, else **Throw** · Cast · Look · Pack · More |
| Map, monster adjacent | Lead · **Attack** (one tap: a move towards the monster) · Cast · Fire/Throw · Pack · More |
| Map, below half health with monsters in view | Stairs if standing on them · **Quaff** (fan: eat, use) · Read · Attack if one is adjacent · Pack · More |
| Lead | Down/Up on stairs · **Enter shop** on a shop entrance (`,`, which enters it) · **Pick up** with objects underfoot |
| Item prompt ("Drop which item? (Inven: a-d, / for Equip, ESC)") | The items by letter and name; Worn/Pack (`/`), Quiver (`\|`), Floor (`-`) when offered; Cancel |
| Store or home | Buy (`p`), Sell (`s`), Examine (`l`), Pack, Leave (Escape), the wares by letter; the pad |
| Menus and lists | The lettered rows, Close, Select, Page, Type; the pad |
| yes/no | Yes, No, Cancel |
| Aim ("Direction ('*' or <click> to target, "'" for closest…)") | The pad; **Closest** (`'`), **At target** (`t`) once one is set, Choose target (`*`), Cancel; or tap the map |
| Direction (open, close, disarm, tunnel) | The pad and Cancel; or tap the map |
| Look / target | The pad; Next (Space), Target (`t`), Recall (`r`), Close |
| Text field (name, quantities, rest count, inscriptions) | Type, OK, Back; the character's name: OK, **Random name** (`*`), Type, Back |
| The last step of creation ("'ESC' to step back, 'S' to start over") | **Start playing**, Back, Start over |
| "Please verify RETIRING THIS CHARACTER by typing the '@' sign" | **Retire character** (`@`), Cancel |
| The death menu beside the tombstone (ui-death.c) | In reading order: Scores, Information, Messages, Examine items, History, File dump, Quit, then the lead **New game** (then "Start a new game?") |

`games/angband/tests/conformance/key-coverage.ts` checks that each command sends, in both keysets, the key `ui-game.c`'s tables bind to that command and that no keymap takes first; the conformance replays send the same keys and clicks as the dock and the map gestures.

## DRL

With the Text display (the default), DRL plays its console mode (`games/drl/adapter/index.ts`, drawn with `packages/term-view`): an 80×25 screen of characters, drawn in a VGA text-mode palette with the curses line characters as box drawing. The console has no mouse (as in a terminal), so taps never reach the game: everything is the dock, the pad and gestures. Everything is read from DRL's own screen (`adapter/state.ts`): its HUD (rows 22-24), its message rows (0-1), its prompts on row 2 and the boxes it draws.

- **Layout on phones:** a status band from DRL's HUD: health (with a bar; DRL shows a percentage, or current/maximum), the weapon and its ammunition, armour, experience, the level's name; then DRL's latest message lines (and a prompt on row 2, such as `[more]`). Tapping it opens the message log. The map (rows 2-21) follows the player at a readable cell size; pinch to zoom, drag to look around (it recentres when the player moves). A box DRL draws over the map (its game menu) is lifted into a sheet over the dimmed map; tap outside to close it (Escape). Full screens (the main menu, the choices before a game, the inventory, equipment, help, the mortem) fit the screen whole, as their text is laid out for 80 columns.
- **Starting and ending a game:** DRL's own main menu is the start screen (New game, Continue game, scores, settings, Exit) and its choices before a game (game type, a seed, difficulty, class, trait) are full screens; the pad moves through their choices (its arrows are the arrow keys, its diagonals Home, End, Page Up and Page Down), with Select (Enter) in its centre and on the dock; Back is Escape. The name is typed with the device keyboard (the dock offers it). Leaving uses DRL's Save & Quit. Death goes through DRL's own screens (the mortem, the scores) back to its main menu.
- **Long-press** on the map opens DRL's look mode (`l`).
- **No modifiers:** the console reads none (as upstream's Linux console), so there is no Run toggle; Run is DRL's own `,` then a direction, in Action's fan.

| Context | Dock |
|---|---|
| Map (`map`) | **Fire** (`f`; fan: Target `t`, Alt fire `F`, Alt target `T`, Next target Tab) · Action (Space: doors, stairs, buttons; fan: Pick up `g`, Use here `G`, Run `,`, Rest `W`) · Reload (`r`; fan: Alt reload `R`, Swap `z`, Unload `u`, Skill `x`) · Inventory (`i`; fan: Equipment, Traits, Player, Assemblies) · Look (`l`; fan: Info `m`, Self `M`, Messages `s`, Help `h`) · Menu (Escape: DRL's game menu); the pad with Wait (`w`) in the centre. At 30% health or less, **Heal?** (the inventory) leads. |
| Look and targeting (`look`) | **Fire** (Enter), Next (Tab), Info (`m`), Cancel; the pad moves the cursor |
| Direction (`direction`) | The pad; Cancel |
| Menus and boxes (`menu`), full screens (`title`) | **Select** (Enter), Back (Escape; fan: Backspace, which drops in the inventory); the pad moves through the choices (← → between panels), Select (Enter) in its centre |
| `[more]` and "Press <Enter>" over the map (`pager`) | **Continue** (Enter), wide |
| Yes/no (`yesno`) | Yes, No, Cancel |
| Typing (`text`: the name, a seed) | **Done** (Enter), Keyboard, Delete, Cancel |

`games/drl/tests/conformance/key-coverage.ts` checks that each command reaches, through the console's input path, the binding DRL gives its action by default.

### DRL's Tiles display (`games/drl/adapter/tiles.ts`)

The Display setting (the game's settings, applied when DRL next starts) offers DRL's own graphical mode: its sprites, lighting and its mouse, drawn by DRL with WebGL 2 on the page. The design choices, for review on a real phone:

- **DRL's picture, not a recomposition.** The canvas fills the game's area; DRL draws everything, its own HUD, minimap and menus included. DRL sizes its window once, when it starts: one canvas pixel a CSS pixel where its 80×25 interface fits (landscape phones, desktops), larger where it does not (an upright phone: about 820 pixels across 412 CSS pixels, so DRL's 10×19 font is about 5 CSS pixels wide, as small as the Text display's full screens). The art is pixel art and is scaled with sharp pixels. Turning the phone fits the picture with bars until DRL is started again (DRL cannot change its window while it runs).
- **The status band and dock are kept,** read from the text DRL draws over its graphics (its GL console's cells, the same 80×25 layout as the console): the band covers DRL's message rows at the top and the dock and pad cover its HUD at the foot, and repeat both. Contexts and docks are the Text display's.
- **Taps are DRL's mouse** (`drlbase.pas` `HandleMouseEvent`): a tap is a left click (on the map: walk to a neighbouring cell, travel to an explored one, or use, pick up or open the inventory on the player's own cell; in menus: choose the entry), a long press (half a second) a right click (fire at that cell; reload when out of ammunition or on the player's cell). Drag and pinch do nothing: DRL's camera follows the player, and its tile and font scales are in DRL's own Settings (tile multiplier).
- **Keys** from the dock and pad reach SDL as keyboard events, each held for two of DRL's own frames (DRL reads key states once a frame); they reach DRL a frame or two later than in the Text display.
- **Memory:** in WebKit on Linux about 120 MB more than the Text display while playing (about 540 MB for the page's process), 650 MB at its peak (BUILDING.md); not yet measured on an iPhone.

## Cataclysm: DDA (pending design)

**Not designed yet.** Phase 1 of the port (`games/cataclysm-dda`) runs upstream's own web build on the page and gives phones only a placeholder: the canvas at the game's smallest terminal (80×24 cells, 640×384 CSS px, so an upright phone shows its left part), the thumb pad (vi keys, wait in the centre) on the map and at direction prompts, and a dock of Inventory (`i`), Look (`;`), Actions (the game's action menu, Enter) on the map, and More and Keyboard everywhere. Taps reach the game as clicks (SDL2), which upstream already uses on the map (route, then walk), in look and targeting, and in every menu.

Enough to start and play a game by touch (`adapter/input.ts controlsFor`, by the game's keybinding context; these keys are not map actions, so they are kept out of the command list the key coverage check holds to upstream's bindings):

| Screen | Controls |
|---|---|
| Main menu (`MAIN_MENU`) | **Play Now!** (`n`, then the New Game sub-menu's `d`: the default scenario and character, the quickest way into a game) leads; New game (`n`), Load (`a`), Random start (`n` `o`), Back; the pad moves along the menu with the arrow keys, Enter in its centre |
| Yes/no questions (`YESNO`, `YESNOQUIT`, `YES_NO_ALWAYS_NEVER`) | **Yes** (a capital `Y`: `FORCE_CAPITAL_YN` is on by default) and No; Cancel for `YESNOQUIT` |
| Character creation (`NEW_CHAR_*`) | ← Tab, Tab →, Random (`*`), Back, Keyboard, and OK, or **Finish** (`>`) on the description tab; the pad sends arrow keys |
| Other menus and popups | the pad (arrow keys, Page up/down on the diagonals, Enter in the centre), Back, More, Keyboard, **OK** |

The game's **Display** setting (Tiles, or Text for less memory) is in its menu (the gear); it sets the game's own Use tiles options at the next start. Text is the one to try when a phone closes the page while the world is made.

The design is the next phase, to be agreed with the project owner. Its input is [`games/cataclysm-dda/UI-INVENTORY.md`](../../games/cataclysm-dda/UI-INVENTORY.md): every screen a player meets, how upstream drives and labels it (keybinding context ids), how the adapter detects it, what upstream's Android port does (quick-shortcuts bar per context, virtual joystick, gestures, native dialogs), the pain points, and a ranked list of candidate helpers.

## Shared touch components (`apps/web/src/features/game-shell/TouchControls.tsx`)

- **ThumbPad** (160–192 CSS px across, scaled to the screen): press anywhere on the disc and slide; the direction follows the finger (8 sectors, dead zone in the middle). Holding repeats steps; sliding to the centre stops; tapping the centre sends the centre command. Each direction is also a labelled button.
- **ActionDock order**: by default the first action sits nearest the thumb (the bottom of the dock) and the rest stack away from it, so the map docks keep their lead in reach and do not shift when a lead comes and goes. A layout with `reading: true` (menus, lettered choices, character creation) is shown in reading order instead, top to bottom and left to right in rows, still anchored at the bottom: "a" before "b", Page up before Page down, and the lead listed last to sit nearest the thumb.
- **ActionDock**: toggles (`TouchAction.active`) render as pressed buttons (`aria-pressed`). Tap = main action. Long-press (340 ms) fans out alternates; slide onto one and release to choose, release on the button to keep the fan open for tapping, release elsewhere to cancel. Optional vibration (Settings → Vibration, off by default).
- Shell commands `shell:palette` and `shell:keyboard` let adapters place "More" and "Type" buttons.
- Dock buttons cancel `touchend`, so the browser's follow-up click can't land on what the action just opened (e.g. a command in the menu "More" opens under the finger).

## Not yet done

- Verification on real phones (all tests use Chromium's mobile emulation).
- iPhone has no Fullscreen API for pages; "Add to Home Screen" gives a full-screen app instead. A one-time hint is a candidate.
- Pinch zoom is unit-tested through the layout code but not end-to-end (Playwright has no multi-touch helper).
