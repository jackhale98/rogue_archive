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

**Item details** (`games/brogue-ce/adapter/camera.ts` `findItemDetails`, `itemActions`): when an item is chosen in the inventory, Brogue draws its details panel beside the list. The sheet then shows only that panel (found from the list's `a)`, `b)` labels and Brogue's placement rule), so the text stays large. The dock offers the panel's own buttons, with the likely one emphasized: Apply, Equip or Remove, then Throw and Drop, with Relabel and Call on a long-press. It also has ▲/▼ Item to step through the pack, and Back.

**Title screen** (`games/brogue-ce/adapter/title.ts`): Brogue's title menu is a few small text buttons on the full screen. On phones it is replaced by large buttons below Brogue's own animated title art, drawn large at the top (the renderer's `titleArtView`), over a fade into its flames (New game, Load saved game, Seeded game, Recordings, High scores, Stats, Variant, Mode) that send Brogue's own hotkeys, opening the right flyout first. The file picker ("Open saved game:", "View recording:") becomes a list of saves with dates, plus Newer, Older and Back. Other title screens (high scores, the seed prompt) show Brogue's screen with Back, OK and Type in the dock. Brogue's own flags still say "in game" after saving and returning to the title, so the adapter treats the title menu on screen as the end of the game until the dungeon's depth line returns.

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

**Layout** (`games/dcss/adapter/hud.ts`, `client-host/host.css`): a status band (health and magic bars, place, up to four status lights) replaces upstream's 42-column stats panel. Tapping the band opens that panel as a drawer; the map button beside it shows the minimap as a large popup (tap outside to close) instead of keeping it on screen. The map fills the rest of the frame above a 4-line message pane (`--more--` and prompts appear there). Popups and menus use the whole frame and scroll. The frame sits in the space the shell's controls leave, so nothing is hidden under the dock or pad.

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
   | Character creation, game menu | OK, Back, Type |
   | Menu or popup (inventory, descriptions, character sheet) | Close, Page ▲ (Up), Page ▼ (Down), Select, Type |
   | Travel menu (`G`, tag `travel`) | Down `>`, Up `<`, Repeat `Tab` (last destination), Altars `_`, Close, Type; the branches are the menu's own items |
   | Pick up and other multi-select menus (tag `pickup`, or the multi-select flag) | Accept, All `,`, Page ▼ (▲, lines), Close, Type |
   | Item menus (quaff, read, equip, unequip…; tag `use_item`) | Select, Describe `?` (the selected item), **→ *mode*** `!` and **→ Equip / → Unequip** `Tab`, each labelled with the mode it switches to, read from the menu's key help (only those it offers), Page ▼ (▲, lines), Close, Type |
   | Spells and abilities (tags `spell`, `ability`) | Close, Page ▲, Page ▼, Describe `!` (switches between using and describing), Select, Type |
   | `--more--` | Continue, Skip |
   | Yes/no question | Yes, No, **Always** `A` when the question offers it, Cancel |
   | Level-up stat increase | Str `S`, Int `I`, Dex `D`, Type (the game re-asks on Escape) |
   | Item prompt ("Quaff which item?") | Choices (`?` lists them), Type, OK, Cancel |
   | Text field | Type, OK, Cancel |
   | Aiming (fire, throw, cast at a target; `TARGET_PATH`) | Fire (or *Stop here* `.`), Next (or Previous, Info), Quiver ▸ `)` (or ◂ `(`), Cancel, plus the pad |
   | Looking (`x`, or a spot to target; `TARGET`) | Select (or *Stop here*), Next (or Previous), Info `v`, Cancel, plus the pad |
   | A direction (`TARGET_DIR`) | The pad, Cancel |
   | Level map | Travel, `>` (or `<`), Close, plus the pad |
   | Busy (travel, resting) | Stop |

Upstream's own touch-friendly pieces stay. Tapping the map travels there, the action panel above the map offers one-tap use of consumables, and every menu item and creation choice is tappable. `games/dcss/tests/conformance/key-coverage.ts` checks that each touch command sends the key upstream binds to that command (`cmd-keys.h`), and for keys a prompt reads itself (travel's `Tab` and `_`, yes/no's Always, the stat increase) that the prompt still handles them; `upstream-drift.ts` checks what the touch controls read from the client and the game (map knowledge, monster attitude, minimap features, menu tags, the stat question, the Orb and Zot lights).

The palette also has the commands no dock leads with: cycle the quiver `(` `)`, attack without moving (the Attack latch), add a macro `Ctrl-E`, and save now `Ctrl-S` (save and exit without the question).

## Sil-Q

Sil-Q draws an 80×24 text screen (`games/sil-q/adapter/index.ts`, drawn with `packages/term-view`).

- **Layout on phones:** a status band replaces Sil's sidebar: health, voice and depth; a row with what Sil's sidebar and status line show about the character (stealth mode, the song and minor theme, hunger, Entranced, Blind, Confused, Afraid, Poisoned, Bleeding, Stun, Slow/Fast, a light about to go out), with Sil's own wording and thresholds; and the newest message. Tapping it opens the message log. The map is drawn at a readable cell size following the player; pinch to zoom, drag to look around (it recentres when the player moves). The title screen and character creation are fitted whole.
- **Text over the map** (inventory, item lists, menus, the character sheet) opens as a sheet over the dimmed map; tap a line to choose it, tap outside to close (Escape).
- **Long-press on the map** looks at that cell: Sil's look command, `p` (back to the player, free cursor), then one step per cell, so the prompt line describes what is there (Target, Recall, Cancel in the dock).
- **Situation** comes from read-only fields the port adds to its snapshot (`port/main-web.c`): what is underfoot (stairs, a forge, an object, the Iron Crown), `on_the_run`, unspent experience against the cheapest ability whose prerequisites are met (priced as the abilities screen does), visible monsters in line of sight and adjacent (from the monster list, as `[` counts them), a bow and arrows in the first quiver, known closed doors next to the player.
- **Keysets:** buttons send Sil's original keys. If the player turns on `hjkl_movement` or `angband_keyset` (the snapshot carries the keyset in use), map commands are sent after Sil's keymap bypass `\`, so each button still does what it says; directions are digits, which every keyset maps to movement.

| Context | Dock |
|---|---|
| Title menu and character creation | The screen's lettered choices as buttons; on the title menu, **Continue *name*** for each saved character; OK, Back, Type; the pad for Sil's arrow keys (up/down move, left/right lower or raise stats and skills), Enter in its centre |
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
| Aim ("'f' for closest") | The pad; **Nearest** (`f`; **Target** once one is set), **Choose target** (`*`; Re-target), Cancel |
| Direction (open, close, bash, tunnel, disarm) | The pad and Cancel only: these prompts take no target |
| Look / target | The pad; what the prompt offers: Target (`t`), Next (Space; **More** when the prompt says `-more-`), Recall (`r`) for a monster; Cancel |
| Text field | Type, OK, Cancel |

`games/sil-q/tests/conformance/key-coverage.ts` checks that each command sends the key Sil's `process_command` binds to that action.

### DCSS start-up and character creation on phones

- From Start until DCSS shows its first screen, the start screen shows "Preparing the dungeon for *name*…" with a spinner and the seconds elapsed. DCSS's caches ship prebuilt, so this takes a second or two; the dock stays empty meanwhile.
- Character creation's species and background columns are flowed into one scrolling column on phones, column by column with each group's heading (`client-host/host.css`; `host.js` orders the items from upstream's grid placement). The status band reads "New character" until the character exists.

## Rogue

Rogue's 80×24 screen is drawn with `packages/term-view` in monochrome (curses standout in reverse video), or with Display: Tiles (RLTiles) or 1-Bit (Kenney's 1-Bit Pack) the map in pictures at a readable size; a start screen (`packages/start-screen`) names the character or continues a saved game.

- **Layout on phones:** a status band (Rogue's status line and its message line; tap for the message log), the map at a readable size following the hero (pinch to zoom, drag to look around), lists (inventory, discoveries) as a sheet with tappable lines; long press on the map identifies the symbol there (`/`).

| Context | Dock |
|---|---|
| Map | Search (fan: rest, search ×10, rest ×10, run, careful run, pick up, step over, identify trap) · Fight (fan: fight in a chosen direction, fight to the death, throw, zap, again) · Pack (fan: eat, quaff, read, wield, wear, take off, ring on/off, drop, call, one item, again) · Stairs (fan: up) · Look (fan: discoveries, last message, weapon, armor, rings, help) · More, plus the pad with Search in the centre. Leads from the snapshot and the map: an object underfoot → Pick up; a monster next to the hero → "Fight ↖B" (`f` and the direction, one tap; only the direction while hallucinating); only a floating eye next to the hero → "Throw →E"; an aquator in sight with armour worn → Take off; Hungry → Eat; on the stairs → Down >; with the Amulet → Up <. A latched Run (⇧) or careful run (⌃, Ctrl+direction) turns the next pad direction into a run; any other action lets go |
| `--More--` | By default not shown: Menu → `--More--` prompts → Continue automatically (the default) sends Space as soon as Rogue shows it; the message stays in the band and the log. With Wait for a key (original): Continue, plus the pad: a move or search continues first, then acts (Rogue ignores every key but Space at `--More--`, which in a fight comes after almost every blow) |
| "Press space to continue", or `--More--` over another window (lists, help, Discoveries, detection overlays; `ST_OVERLAY`) | Close; never continued automatically. A list opened from an item prompt (`*`) offers its items: a tap sends Space (closing the list) and the letter (answering the prompt). In the plain inventory, a tapped line offers that item's actions (Eat, Quaff, Read, Zap, Wield, Wear or Take off, Put on or Remove, Throw, Drop, Call; the likely one first and highlighted): Rogue's lists take only Space, so an action sends Space, the command, and answers the command's item prompt with the letter when it comes (after the direction, for Throw) |
| Tombstone and scores ("Press return") | Continue (Enter) |
| "which direction?" | The pad; Cancel |
| Item prompt ("(* for list)") | Show items, Cancel, Type; with the list shown, its items. A command from the dock or the command list shows the list at once (`*`) |
| Busy (running, resting, a repeat count) | Nothing: Rogue reads no keys until it is done |
| Lists over the map | The lettered lines, Close, Cancel |
| Yes/no ("Really quit?", "Save file?") | Yes, No, Cancel |
| Typed answers ("call it", "file name") | Type, OK, Cancel |

`games/rogue/tests/conformance/key-coverage.ts` checks each command against `command.c`.

## HyperRogue

HyperRogue draws its own interface with WebGL (upstream's web build), so the phone layout keeps it whole: the canvas fills the area between the shell's floating tools and the dock, at up to twice the CSS resolution, and the game lays out its own HUD (kills, score, messages) for that size. Touch follows upstream's mobile version (`mobile.cpp`) on top of the web build's click handling: the finger shows what is under it (the game's hover), lifting it acts there (move towards the cell, attack, use a ranged orb on it, choose a menu line), and holding still for half a second asks for help about it (the desktop's right-click). Upstream's Android interface itself (`mobile.cpp`, its on-screen compass) is built around the Android app's own platform code, so it is not compiled in.

| Context | Dock |
|---|---|
| Map | What applies, first: Aim (a ranged orb is held) · Fire (crossbow mode; lit while aiming, with the reload count) · Wind jump `t` (strong wind) · Drop Dead Orb `g` (Dead Orbs carried) · Orbs `i` (Orb Strategy) · Mark (in or next to the Minefield). Then Centre (fan: rotate either way) · Overview `o` (fan: Inspect) · Quest (fan: help, new game, menu; "Cancel fire" while the crossbow aims, as Esc does) · More, plus the pad (vi keys, Wait in the centre) |
| Menus, help, quest screen | Back (Esc), OK (Enter); the game's own lines are tappable |
| Caught (game over) | Options (the quest screen), New game, Menu |

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
| Item prompt ("What do you want to eat? [fg or ?*]") | For a touch command, the suitable items open at once (`?`); up to three items are buttons of their own (letter and name); Choose, All items (`*`), Hands (`-`) when offered, Cancel |
| Direction | The pad (Self in the centre), At ↖x (the monster), Down `>`, Up `<`, Cancel; or tap towards a cell |
| Position (travel, farlook, jump…) | Select (also the pad's centre; the pad moves the cursor), Monster (fan: objects, doors, altars, anything, unexplored), Stairs (fan: up, traps), Yourself, Cancel; or tap the cell |
| Menu | Choosing one: a button per line when there are five or fewer, else its Random line (`*`); Accept and All (several to choose), pages, Cancel, Type; a menu to read: pages and Close |
| Text window, `--More--` | Next or Continue, Close |
| Typed line, extended command | Elbereth when engraving (with strategy shortcuts on), Type (the keyboard), OK, Cancel |

Character creation: "Shall I pick a character for you?" answers as Pick for me, Let me choose, Pick, no questions, Quit; the role, race, gender and alignment menus have a Random button; "Is this ok?" has a button per choice.

The Elbereth button (fighting, trouble, the command list; only with Settings → *Strategy shortcuts* on, off by default, since the game never tells you about Elbereth directly) engraves it in the dust: `E`, fingers, no to adding to an engraving, the text; every question is still the game's, and the game decides whether it works.

## Shared touch components (`apps/web/src/features/game-shell/TouchControls.tsx`)

- **ThumbPad** (160–192 CSS px across, scaled to the screen): press anywhere on the disc and slide; the direction follows the finger (8 sectors, dead zone in the middle). Holding repeats steps; sliding to the centre stops; tapping the centre sends the centre command. Each direction is also a labelled button.
- **ActionDock**: toggles (`TouchAction.active`) render as pressed buttons (`aria-pressed`). Tap = main action. Long-press (340 ms) fans out alternates; slide onto one and release to choose, release on the button to keep the fan open for tapping, release elsewhere to cancel. Optional vibration (Settings → Vibration, off by default).
- Shell commands `shell:palette` and `shell:keyboard` let adapters place "More" and "Type" buttons.
- Dock buttons cancel `touchend`, so the browser's follow-up click can't land on what the action just opened (e.g. a command in the menu "More" opens under the finger).

## Not yet done

- Verification on real phones (all tests use Chromium's mobile emulation).
- iPhone has no Fullscreen API for pages; "Add to Home Screen" gives a full-screen app instead. A one-time hint is a candidate.
- Pinch zoom is unit-tested through the layout code but not end-to-end (Playwright has no multi-touch helper).
