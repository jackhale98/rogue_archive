# Cataclysm: DDA — inventory of the game's interface

A review of how Cataclysm: Dark Days Ahead **0.I-1** (the pinned release) is
played and of every menu or screen a player meets, written to design the
phone controls (the next phase). Nothing here is implemented beyond the
phase-1 placeholder dock (`adapter/input.ts controlsFor`).

Sources: the pinned upstream checkout (`src/`, `data/raw/keybindings.json`,
`data/raw/keybindings/vehicle.json`), read for this review, and the running
WebAssembly build. Where a statement comes from the source rather than from
watching the running game, it says so.

**How to read each entry**

- **For / how often** — what the screen is for, and how often a player meets
  it: *constantly* (every few turns), *often* (several times an hour),
  *occasionally* (a few times a session), *rarely*.
- **Driven by** — upstream's keys (the defaults in `keybindings.json`), mouse
  support, and the **keybinding context id** (the `category` the screen's
  `input_context` is created with; the same id the in-game keybinding editor,
  `?`, shows).
- **Detect** — how the adapter can tell the screen is up. The port reports
  (`port/rogue-archive-web.cpp`, `adapter/state.ts`): the context id the game
  is waiting in and the stack of waiting contexts, which of a few telling
  actions it registers (`inventory`, `look`, `QUIT`, `CONFIRM`, `SELECT`,
  `ANY_INPUT`, `TEXT.CONFIRM`, `NEXT_TAB`), in a game / at the main menu, the
  titles of open ImGui windows, and the screen as text (curses windows with
  ImGui text drawn over them).
- **Upstream touch** — what upstream's Android port does for it (`#if
  defined(__ANDROID__)` code; summary in the next section). The web build
  gets none of it: the Android code is compiled only for Android.
- **Phone pain** — what makes it hard on a phone.

## Two rendering systems, one input model

Every screen waits for input through an `input_context` with a category id,
whatever draws it. Drawing differs:

- **curses windows** (`catacurses` over SDL): the map, the sidebar panels,
  inventory selectors, character creation, crafting, construction, vehicle
  interaction, AIM, the overmap, the character sheet, the message log,
  options. The port copies each window's cells as it is drawn.
- **Dear ImGui windows** (`cataimgui::window`, new in 0.H–0.I): every
  `uilist` menu (the action menu, the main game menu, the debug menu, most
  "choose one" lists), `query_popup` (yes/no and message popups), number and
  text input popups (`input_popup`), the keybinding editor, item info, the
  extended description, missions, scores, the death screen and the loading
  progress. The port records the text ImGui draws (with its position) and the
  window titles.

Mouse: upstream supports the mouse in many screens (`SELECT` = left click,
`SEC_SELECT` = right click, `MOUSE_MOVE` = hover, `SCROLL_UP/DOWN` = wheel,
registered in action.cpp, crafting_gui.cpp, game.cpp, help.cpp,
inventory_ui.cpp, main_menu.cpp, newcharacter.cpp, options.cpp, output.cpp,
overmap_ui.cpp, player_display.cpp, popup.cpp, ranged.cpp, uilist.cpp,
worldfactory.cpp...). All ImGui windows take clicks and the wheel. SDL turns
a tap into a left click, so a tap already does what a click does.

## Upstream's Android port: what it offers

All in `src/sdltiles.cpp` and options in `src/options.cpp`
(`add_options_android`), compiled only for Android:

- **Quick-shortcuts bar.** A row of on-screen key buttons along the bottom
  (left- or right-aligned, a percentage of the screen width, opacity and size
  options). One list per keybinding context (`quick_shortcuts_map[category]`),
  so the map, the inventory and each menu have their own row:
  - on the map (`DEFAULTMODE`) it starts from `ANDROID_SHORTCUT_DEFAULTS`
    (`0mi`: help, map, inventory) and grows: every action chosen from the
    action menu is added (`ANDROID_ACTIONMENU_AUTOADD`), every item letter
    chosen in an inventory is added to the inventory's row
    (`ANDROID_INVENTORY_AUTOADD`), and every key typed on the keyboard is
    added;
  - **contextual auto-add** (`ANDROID_SHORTCUT_AUTOADD`): each turn it adds
    and removes shortcuts from the surroundings: examine, close, butcher,
    go up/down stairs, control vehicle, pick up, ignore enemy + safe mode
    when safe mode stops you, cycle move mode and fire in combat, toggle
    run/crouch/prone when on, eat when hungry or thirsty, sleep when dead
    tired (the same weighting as the action menu's suggestions);
  - in any other context the row is filled from the context's registered
    actions (best key for each) and from "manual keys": the hotkeys of the
    current `uilist`'s entries and of dialogue responses
    (`register_manual_key`, `uilist.cpp`, `npctalk.cpp`), so lettered choices
    become buttons;
  - unused shortcuts expire after N turns
    (`ANDROID_SHORTCUT_REMOVE_TURNS`), a flick up removes one, holding one
    shows the action's name as a hint, used ones can move to the front;
    shortcuts can be saved with the game (`ANDROID_SHORTCUT_PERSISTENCE`,
    `<save>.shortcuts`), and kept separately inside "no auto pickup" zones
    (home base) (`ANDROID_SHORTCUT_ZONE`).
- **Virtual joystick.** Touch and hold anywhere: after
  `ANDROID_INITIAL_DELAY` a joystick appears; deflection past a dead zone
  sends a direction (8-way if the context registers diagonals, else 4-way),
  repeating faster the further it is pushed (repeat-rate and sensitivity
  options); it can follow the finger. Holding still repeats the tap key.
- **Gestures.** Tap: `ANDROID_TAP_KEY` (`.`, wait a turn) on the map, Enter
  elsewhere. Double tap: Escape. Two-finger tap: `i` (inventory). Two-finger
  swipes: `K`/`J`/`L`/`H` (up/down/left/right: the wide moves, which pan the
  view or move a menu cursor by pages). Pinch: `z`/`Z` (zoom). Three-finger
  gestures are stubbed out.
- **Virtual keyboard.** The Back button shows/hides the system keyboard;
  long-press Back toggles the shortcuts bar. `ANDROID_AUTO_KEYBOARD` shows it
  for text inputs (`is_string_input`: `STRING_INPUT`, `STRING_EDITOR`) and
  hides it afterwards; inventory multiselectors set `allow_text_entry` so
  counts can be typed without the keyboard closing (`inventory_ui.cpp`).
- **Native UI.** `ANDROID_NATIVE_UI`: `uilist` menus and `query_yn`
  questions open as native Android dialogs (`uilist.cpp`, `output.cpp`) when
  the menu has entries and no fixed position.
- **Quicksave on losing focus** (`ANDROID_QUICKSAVE`, marked experimental:
  "may result in corrupt save games"), vibration on input, and the window is
  always full screen.

What it does not offer: no special handling of targeting, the overmap, AIM,
crafting or vehicle screens beyond the generic row of their context's keys;
no reflowed text; the game's 80x24 minimum terminal is simply drawn small
(players lower the font size or use landscape).

## The screens

### Main menu

- **For / how often:** start, load, world management, settings, help,
  credits. Once per session.
- **Driven by:** context `MAIN_MENU` (registered in main_menu.cpp: cardinal
  moves, `NEXT_TAB`/`PREV_TAB`, `PAGE_UP/DOWN`, `CONFIRM`, `QUIT`, `SELECT`,
  `MOUSE_MOVE`, `SCROLL_UP/DOWN`, `DELETE_TEMPLATE` `d`). The top row is a
  horizontal menu: `m` MOTD, `n` New Game, `a` Load, `w` World, `u` Tutorial
  Game, `t` Settings, `e`/`?` Help, `c` Credits (no Quit on the web).
  Left/right (or `h`/`l`) moves along it, Enter opens a sub-menu that opens
  upwards: New Game → `u` Custom Character, `p` Preset Character, `r` Random
  Character, `d` Play Now! (default scenario), `o` Play Now! (random
  scenario); Load → one entry per world, then one per character; World →
  per world: Show World Mods, Copy World Settings, Character to Template,
  Reset World, Delete World; Settings → Options, Keybindings, Autopickup,
  Safemode, Colors. Mouse: hover and click on items.
- **Detect:** `mainMenu` true and context `MAIN_MENU`; text: the menu row
  ("MOTD New Game Load World ...").
- **Upstream touch:** generic shortcuts row (its registered actions).
- **Phone pain:** the menu is drawn at the bottom of an 80-column screen with
  the sub-menu popping up above it; items are short words in small text.
  Tutorial Game is listed but the web bundle leaves out its mod
  (`dda_tutorial` is marked obsolete, as in upstream's own web build).

### World creation and choice

- **For / how often:** create a world (mods, world options) the first time;
  pick a world when there are several. Rarely.
- **Driven by:** `WORLDGEN_CONFIRM_DIALOG` (tabs World Mods / World Options,
  `NEXT_TAB`, `PICK_RANDOM_WORLDNAME` `*`, Finish `>`...), mod manager
  `MODMANAGER_DIALOG` (two lists, add/remove, reorder), `PICK_WORLD_DIALOG`
  (a list of worlds), the world name is a `STRING_INPUT`. Play Now! skips
  all of it (it creates a world with default settings and no prompt).
- **Detect:** those context ids.
- **Upstream touch:** generic shortcuts row; virtual keyboard for the name.
- **Phone pain:** two-pane mod list with long descriptions; long option
  lists with left/right to change values; finishing needs `>` (not obvious).

### Character creation (all tabs)

One screen with eight tabs (`newcharacter.cpp`): **POINTS, SCENARIO,
PROFESSION, BACKGROUND, STATS, TRAITS, SKILLS, DESCRIPTION**. Tabs are
switched with `NEXT_TAB`/`PREV_TAB` (Tab, Shift+Tab, or `>`/`<` on the
description tab: "Finish"), `QUIT` (Esc) asks to abandon. Custom Character
shows them all; Preset and Random start further in; Play Now! skips the
screen.

- **For / how often:** once per character (a long session the first time:
  a dozen decisions, hundreds of options). Rarely, but it is the first
  thing a new player meets after the main menu.
- **POINTS** (`NEW_CHAR_POINTS`): choose the point system (multi-pool,
  one pool, freeform). Up/down, Enter.
- **SCENARIO** (`NEW_CHAR_SCENARIOS`): a long list (tens of scenarios) with a
  description pane; `s` sort, `*` random, `/` filter, `#`/`&`/`~` change
  the cataclysm and game start dates (calendar UI `CALENDAR_UI`).
- **PROFESSION** (`NEW_CHAR_PROFESSIONS`): hundreds of professions, filtered
  by the scenario; description pane with items, skills, bionics; `s` sort,
  `*` random, `/` filter, `@` gender, `$` outfit.
- **BACKGROUND** (hobbies; same list UI as professions): several can be
  toggled.
- **STATS** (`NEW_CHAR_STATS`): four stats with up/down to choose and
  left/right (or `h`/`l`) to change; description of each.
- **TRAITS** (`NEW_CHAR_TRAITS`): three columns (positive, negative,
  neutral), left/right between columns, Enter toggles, `S` trait variant,
  `s` sort, `*` random, `/` filter; costs shown.
- **SKILLS** (`NEW_CHAR_SKILLS`): a list with left/right to lower/raise,
  `<`/`>` scroll the skill description.
- **DESCRIPTION** (`NEW_CHAR_DESCRIPTION`): name (a text field: typing goes
  straight into it), `n` random name, `*` random description, `@` gender,
  `$` outfit, `C` starting city, `/` starting location, `!` save template,
  `%`/`^` reroll (random characters), `>` finish ("Are you SURE you're
  finished?" yes/no), `#`/`&` dates.
- **Mouse:** `SELECT`/`MOUSE_MOVE` are registered (click on list rows).
- **Detect:** context ids `NEW_CHAR_*` (one per tab); the tab row text
  ("POINTS SCENARIO PROFESSION ..."), the highlighted tab.
- **Upstream touch:** generic shortcuts row per tab context; keyboard
  auto-shown only when the name field is a `STRING_INPUT` (it is not: the
  description tab reads text keys directly, so on Android players open the
  keyboard by hand).
- **Phone pain:** tab bar plus three panes at 80 columns; left/right means
  "change value" on some tabs and "column" on others; Finish is `>` on the
  last tab; filtering needs typing; the description tab takes typed letters
  as the name, so letters cannot be shortcuts there. Long text (scenario and
  profession descriptions) is cramped.

### Main play: the map and the sidebar

- **For / how often:** the game. Constantly.
- **Driven by:** `DEFAULTMODE` (121 actions; the table in `adapter/input.ts`
  lists the 65 with default keys). Movement: `hjklyubn`, arrows, numpad;
  `.`/`5` wait a turn; `<`/`>` stairs; `z`/`Z` zoom; `TAB` autoattack;
  `"` movement mode (walk/run/crouch/prone); `Enter` the **action menu**
  (every action by category, with contextual suggestions at the top);
  `Esc` the game menu. Mouse on the map (`game::try_get_left_click_action`,
  `try_get_right_click_action`): left click previews a route to the clicked
  tile, a second click on it walks there (auto-move); right click fires at a
  monster (if wielding a gun), closes an adjacent door, picks up on your own
  tile, examines an adjacent tile; hover moves nothing. The sidebar (panels,
  `toggle_panel_adm` to configure) shows stats, location, weather, wielded
  item, messages; it is curses text.
- **Detect:** in a game, context `DEFAULTMODE`, and the context registers
  `inventory` (a direction prompt also uses `DEFAULTMODE`, see below);
  `player` position and `turn` from the snapshot; the message log from
  `Messages::recent_messages`.
- **Upstream touch:** the whole Android toolkit above: tap = wait, joystick
  to walk, two-finger tap = inventory, pinch = zoom, contextual shortcuts.
- **Phone pain:** 80x24 cells minimum (8x16 px font: 640x384 px) — wider
  than an upright phone; the sidebar takes 30-50 columns; ~120 commands on
  65 keys, many on capitals and punctuation; zoom is a key; the map scrolls
  only with the player or look mode; messages are small; safe mode stops
  movement when a monster appears ("Monster spotted: ... press ! to turn off
  safe mode, ' to ignore") — a phone player needs those two keys at once.

### Direction prompts ("Examine where?", open, close, smash, chat, grab...)

- **For / how often:** after `e`, `o`, `c`, `s`, `G`, `C`, `D`, `\`...: pick
  an adjacent tile. Often.
- **Driven by:** `choose_direction` / `choose_adjacent` (action.cpp) creates
  its own `DEFAULTMODE` context with only the directions, `pause` (own tile),
  `QUIT`, `CONFIRM`, `SELECT` (click a tile). When only one target is
  possible some actions skip the prompt (option `AUTOSELECT_SINGLE_VALID_TARGET`).
- **Detect:** context `DEFAULTMODE` **without** `inventory` registered
  (`detectContext` → `direction`); the prompt text in the sidebar message
  area ("Examine where? (Direction button)").
- **Upstream touch:** joystick swipe = direction; tap = Enter.
- **Phone pain:** the same pad as movement, but it must not repeat; the
  prompt is easy to miss.

### Look around and examine (look `;` / `x`, peek `X`, list `V`)

- **For / how often:** inspect tiles, creatures, items at a distance. Often.
- **Driven by:** `LOOK` (game.cpp `look_around`): move the cursor with the
  direction keys (`HJKLYUBN` wide), `<`/`>` change level, `e`/`Enter`
  extended description (ImGui window, context `EXTENDED_DESCRIPTION`: `c`
  creature, `f` furniture, `t` terrain, `v` vehicle), `V` list items and
  monsters, `t` blind throw, `Esc` back; mouse: hover moves the cursor,
  click selects. `V` opens `LIST_ITEMS` / `LIST_MONSTERS` (two lists:
  items around with `/` filter, `s` sort, `+`/`-` priority, `e` examine,
  `I` compare; monsters with `a`/`r` safe-mode blacklist, `f` fire, `x` look).
- **Detect:** context `LOOK` (or `LIST_ITEMS`, `LIST_MONSTERS`,
  `EXTENDED_DESCRIPTION`); the description box text in the sidebar.
- **Upstream touch:** joystick moves the cursor; generic shortcuts row.
- **Phone pain:** a cursor moved one tile per key; the description is drawn in
  the sidebar in small text (and partly off-screen at 80 columns on a phone).
  Tapping a tile is the natural gesture and upstream already supports it
  (mouse hover/click).

### Targeting and firing (`f`, `t` throw, `F` fire mode, spells `]`)

- **For / how often:** ranged combat, throwing, spells, reach attacks,
  turrets. Often in combat.
- **Driven by:** `TARGET` (ranged.cpp): move the cursor, `Tab`/`Shift+Tab`
  (or PgDn/PgUp, mouse wheel) next/previous target, `f`/`Enter`/right click
  fire, `.`/`5` aim (spend moves aiming), `a` aimed shot, `c` careful, `p`
  precise, `s`/`F` switch mode, `o` switch ammo, `*` snap to target, `v`
  move view vs cursor, `t` turret lines, `-` unload after cancel, `Esc`
  cancel. Mouse: hover moves the cursor, click selects.
- **Detect:** context `TARGET`; the targeting panel text (sidebar) lists the
  target and hit chances.
- **Upstream touch:** generic shortcuts row (all those keys), joystick for
  the cursor.
- **Phone pain:** many single-letter aim levels; the hit-chance panel is the
  key information and it is small text in the sidebar; next target is Tab.

### Inventory and its variants

All are `inventory_selector` screens (inventory_ui.cpp, curses) with context
**`INVENTORY`** (35 actions) and a title naming the action.

- **For / how often:** constantly — `i` view, `w` wield, `W` wear, `T` take
  off, `E` eat/drink, `a` apply (use), `R` read, `d` drop, `D` drop to an
  adjacent tile, `v` insert into a container, `U` unload, `r` reload, `I`
  compare, `=` reassign letters, `g` pick up (pickup selector), `%` item
  action menu, `!`... from the AIM and crafting too.
- **Driven by:** item letters (`a`-`z`, `A`-`Z`, assigned per item; typing a
  letter selects that item), up/down (`j`/`k`, arrows, PgUp/PgDn), columns
  (`h`/`Left`... `NEXT_COLUMN`, `PREV_COLUMN` Shift+Tab, `SWITCH_LISTS`
  Tab), `Enter` confirm, `Esc` quit, `/` filter, `t` category selection,
  `>` show/hide contents (containers nest: pockets, bags), `e` examine
  (ImGui item info, `<`/`>` scroll), `*` favorite, `;` category view, `o`
  examine contents, `i` organize, `w`/`W` wield/wear from the list. Single
  pick (`inventory_pick_selector`): a letter or Enter picks and returns.
  **Multi-select** (`inventory_multiselector`: multidrop `d`, pick up `g`,
  insert `v`, unload): `l`/Right/`6` toggles the highlighted item, `,`
  select all, `!` select a count, `+`/`-` count up/down, typing a number then
  the item letter sets a count, `Enter` confirms. Mouse: hover highlights,
  click selects, drag (`CLICK_AND_DRAG`), wheel scrolls.
- **Detect:** context `INVENTORY` (also used by the AIM's sub-selectors and
  crafting's component choice); which variant: the title on the top row
  ("Wield item", "Wear item", "Consume item", "Use item", "Multidrop",
  "Pick up", "Insert", "Read", "Compare"...) and the hint line at the bottom
  (multi-select lists the toggle keys).
- **Upstream touch:** a shortcuts row per `INVENTORY` context; chosen item
  letters are added to it (`ANDROID_INVENTORY_AUTOADD`) and pruned when the
  item is gone (`remove_stale_inventory_quick_shortcuts`); the keyboard
  stays up for typed counts (`allow_text_entry`).
- **Phone pain:** the core of the game and the hardest screen: two or three
  columns (worn, inventory, ground) at 80 columns; item names are long;
  nesting (a bag in a backpack); letters change with the inventory; counts
  need the number row; the item info (`e`) is a long scrollable text.

### Advanced Inventory Manager (AIM, `/`)

- **For / how often:** move items between your inventory, the 9 tiles
  around you, a dragged vehicle, containers and worn items, in bulk.
  Often for players who loot and build bases.
- **Driven by:** `ADVANCED_INVENTORY` (36 actions): two panes, `h`/`l` (or
  Left/Right) select a pane, `j`/`k` move, `Tab` toggles the pane's tab,
  sources by numpad layout: `7 8 9 / 4 5 6 / 1 2 3` the tiles around,
  `i`/`0` inventory, `a` all 9 tiles, `d` dragged vehicle, `w` worn, `c`
  container, `x` back to parent, `v` vehicle storage; `Enter` move one, `m`
  move some (count prompt), `M` move the stack, `,` move all, `s` sort, `t`
  category selection, `e` examine, `o` examine contents, `u` unload, `p`
  auto-pickup, `*` favorite, PgUp/PgDn (`<`/`>`) pages. ImGui is used only
  for the sort/filter popups.
- **Detect:** context `ADVANCED_INVENTORY`; the two pane headers with the
  location minimap.
- **Upstream touch:** generic shortcuts row (36 keys).
- **Phone pain:** two panes of long names side by side; the source keys are a
  numpad diagram on digit keys; most of the value is bulk moves, which need
  several keys in order.

### Crafting (`&`, recraft `-`, long craft)

- **For / how often:** the crafting menu: thousands of recipes in category
  tabs and sub-tabs, with requirements (tools, components, skills, time).
  Often.
- **Driven by:** `CRAFTING` (crafting_gui.cpp): `Tab`/`Shift+Tab` category,
  `<`/`>` (left/right) sub-category, up/down recipes, `/` filter (a rich
  query language: `c:` components, `t:` tools, `s:` skill...), `e` show the
  result (item info), `[`/`]` scroll recipe info, `b` batch, `c` choose
  crafter (NPC), `*` favorite, `v`/`V` read/unread, `u` unread first, `L`
  related recipes, `I` compare, `Enter` craft. Then component and tool
  choice menus (`uilist`, ImGui) and a count prompt for batches. Mouse:
  click and wheel (`SELECT`, `SCROLL_UP/DOWN`).
- **Detect:** context `CRAFTING`; the tab row ("WEAPONS AMMO FOOD CHEMS
  ...").
- **Upstream touch:** generic shortcuts row.
- **Phone pain:** a two-level tab bar, a long list, a dense requirements pane
  with colour-coded availability; searching needs the keyboard and the
  query syntax.

### Construction (`*`)

- **For / how often:** build terrain and furniture (walls, doors, fires,
  farming, base building). Occasionally, often when building a base.
- **Driven by:** `CONSTRUCTION` (construction.cpp): category tabs, a list,
  `;` toggle unavailable, `<`/`>` scroll stages, `/` filter, `Enter` pick;
  then a direction prompt (or a tile pick) where to build.
- **Detect:** context `CONSTRUCTION`, then the direction prompt.
- **Upstream touch:** generic shortcuts row.
- **Phone pain:** as crafting (tabs, long list, requirement pane), plus the
  tile choice afterwards.

### Disassembly (`(`)

- **For / how often:** take items apart for components. Occasionally.
- **Driven by:** an inventory selector (`INVENTORY`, title "Disassemble
  item"), then confirmation popups; the work is a long activity.
- **Detect:** context `INVENTORY` + title.
- **Upstream touch / pain:** as the inventory.

### Vehicle interaction (`e` on a vehicle → examine, `^` control, `G`
grab/drag)

- **For / how often:** install/repair/remove parts, refuel, siphon, change
  tires, rename, assign crew (`veh_interact`, curses); controlling a
  vehicle (driving, the `VEHICLE` context with 62 actions in
  `data/raw/keybindings/vehicle.json`: turn, accelerate/brake, cruise
  control, lights, engines, doors, aim turrets...). Occasionally (repair and
  building), often while driving.
- **Driven by:** `VEH_INTERACT` (veh_interact.cpp: `i` install, `r` repair,
  `m` mend, `f` refill, `d` unload, `o` remove, `s` siphon, `c` tire, `p`
  shape, `w` crew, `e` rename, `a` relabel, `Tab` tabs, `[`/`]`, `<`/`>`,
  `{`/`}` scroll the lists, direction keys move over the vehicle's parts);
  examining a vehicle tile first opens a `uilist` of what to do there
  ("Examine vehicle", "Get items", "Fill/Refuel", "Control"...).
  `APP_INTERACT` for appliances. Driving: `VEHICLE` (direction keys steer
  and accelerate, `^` again to stop controlling, the vehicle menu from
  examine).
- **Detect:** `VEH_INTERACT`, `VEHICLE`, `APP_INTERACT`; the vehicle grid
  text.
- **Upstream touch:** contextual "control vehicle" shortcut on the map;
  generic row elsewhere.
- **Phone pain:** a grid of the vehicle plus three panes of part lists and
  descriptions; driving needs held, repeated direction keys.

### The overmap (map overlay, `m`)

- **For / how often:** the world map: travel planning, notes, mission
  targets. Often.
- **Driven by:** `OVERMAP` (overmap_ui.cpp, 24 actions + the globals):
  move the cursor with the directions (`HJKL...` fast), `<`/`>` z-level,
  `0` centre, `W` choose destination and `T` travel (auto-travel), `N`
  create/edit note, `D` delete note, `L` list notes (`OVERMAP_NOTES`), `R`
  mark danger, `/` search, toggles `B` blinking, `O` overlays, `A` land use
  codes, `G` notes, `C` city labels, `V` reveals, `H` hordes, `w` weather,
  `T` forest trails, `x` fast travel, `E` explored, `M` missions, `;`
  look, `z`/`Z` zoom, `m`/`Esc` close; mouse: hover, click, wheel zoom.
  The overmap editor (`OVERMAP_EDITOR`) is debug only.
- **Detect:** context `OVERMAP`; the legend panel on the right.
- **Upstream touch:** joystick moves the cursor; pinch keys (`z`/`Z`) work
  there too only in `DEFAULTMODE` (pinch is map-only).
- **Phone pain:** a cursor moved tile by tile across a huge map; the legend
  is a 30-column panel; notes need typing.

### Character sheet (`@`) and other "about me" screens

- **For / how often:** stats, encumbrance, skills, traits, bionics, effects,
  proficiencies. Occasionally.
- **Driven by:** `PLAYER_INFO` (player_display.cpp): tabs selected with
  `w`/`e`/`r`/`t`/`x`/`c`/`v` (stats, encumbrance, skills, traits, bionics,
  effects, proficiencies) or Tab, up/down in a tab, `p` proficiencies, `s`
  body status, `m` morale, `W` armor sprite; mouse: click (registered).
  Related: medical `N` (`MEDICAL`, `A` use item), body status `{`
  (`BODYSTATUS`/same window), morale (`MORALE`), bionics `p` (`BIONICS`:
  letters activate, `!` toggle examine mode, `=` reassign, `s` sort, `R`
  refuel), mutations `[` (`MUTATIONS`), martial arts `_`
  (`MELEE_STYLE_PICKER`, `MA_DETAILS_UI`), missions `M` (ImGui), factions
  `#` (`FACTION_MANAGER`), diary `)` (`DIARY`; scores `SCORES_UI`).
- **Detect:** those context ids.
- **Upstream touch:** generic shortcuts row.
- **Phone pain:** dense multi-column text; tab keys are letters that mean
  nothing; mostly read-only, so a reader view would serve.

### Messages (`P`)

- **For / how often:** the full message log with filtering. Occasionally;
  the recent messages show in the sidebar constantly.
- **Driven by:** `MESSAGE_LOG` (messages.cpp: up/down, PgUp/PgDn, `/`
  filter, `r` reset filter, `Esc`; wheel).
- **Detect:** context `MESSAGE_LOG`. The adapter already sends the game's
  messages to the shell's log (`Messages::recent_messages`, with times).
- **Upstream touch:** none special.
- **Phone pain:** small text; the shell's log covers it.

### Popups: yes/no, messages, counts, text

- **For / how often:** constantly: "Really attack?", "Monster spotted",
  "Save and quit?", "You see...", "--press any key--", count prompts
  ("How many do you want to drop?"), names.
- **Driven by:** `YESNO` (`Y`/`y` yes, `N`/`n`/`Esc` no; option
  `FORCE_CAPITAL_YN` requires capitals), `YESNOQUIT` (`q` cancel),
  `YES_QUERY` (dangerous actions: "Yes, I will!"), `YES_NO_ALWAYS_NEVER`
  (pickup questions), `CANCEL_ACTIVITY_OR_IGNORE_QUERY` (an activity was
  interrupted: continue, ignore, cancel), `POPUP_WAIT` / `WAIT_FOR_ANY_KEY`
  (a raw wait outside any context: the port reports `rawWait`),
  `STRING_INPUT` (text fields: names, notes, filters; `TEXT.*` editing
  keys), `STRING_EDITOR` (multi-line: diary, descriptions). All ImGui
  windows in 0.I (popup.cpp, input_popup.cpp) except the string editor.
- **Detect:** those context ids; the ImGui window title and text.
- **Upstream touch:** native Android dialog for `query_yn`
  (`ANDROID_NATIVE_UI`); keyboard auto-shown for `STRING_INPUT`/`STRING_EDITOR`.
- **Phone pain:** the answer keys are in the text ("(Y/n)"); some popups are
  long; count prompts need the number row.

### Generic menus (`uilist`)

- **For / how often:** every "choose one" list: the action menu (Enter), the
  item action menu (`%`), the game menu (Esc), examine menus at furniture
  and vehicles, crafting component choices, butchery types, NPC orders,
  activity choices, wishes and the debug menu. Constantly.
- **Driven by:** `UILIST` (uilist.cpp, ImGui): entry hotkeys (letters, shown
  in the entry), up/down, PgUp/PgDn, Home/End, `/` filter (`UILIST.FILTER`),
  `{`/`}` scroll the item info, `Enter`, `Esc`; mouse: hover, click, wheel.
  Some menus have a description pane or a callback that reacts to the
  highlighted entry.
- **Detect:** context `UILIST`; the ImGui window title; the entries are the
  ImGui text lines.
- **Upstream touch:** manual keys (the entries' hotkeys) become the shortcuts
  row; native Android list dialog (`ANDROID_NATIVE_UI`).
- **Phone pain:** usually fine with taps (ImGui rows are full-width click
  targets), but rows are one text line high (16 px).

### Game menu (Esc), options, keybindings

- **For / how often:** the in-game menu (`main_menu` action: a `uilist`
  with Options, Keybindings, Autopickup, Safemode, Distractions, Colors,
  world mods, Help, Save and quit, Abandon...). Occasionally. Options
  (`OPTIONS`: pages General, Interface, Graphics, World defaults, Debug;
  left/right change a value, Tab pages, `/` filter) — rarely, but this is
  where font size, sidebar layout, auto-pickup and safe mode are set.
  Keybindings (`HELP_KEYBINDINGS`, ImGui, from `?` in any screen: the
  context's actions with their keys; `+`/`=` add a local/global key, `-`
  remove, `*` reset, `.` execute the action) — rarely, but it is also a
  per-context list of every action that could be executed by tap.
  Auto pickup (`AUTO_PICKUP`), safe mode rules (`SAFEMODE`), colors
  (`COLORS`), sidebar panels (`PANEL_MGMT`) — rarely.
- **Detect:** those context ids.
- **Upstream touch:** the Android options page; generic rows.
- **Phone pain:** option values change with left/right only; long
  descriptions; `HELP_KEYBINDINGS`'s "execute" is a hidden gem for touch.

### Help (`0`), the in-game manual

- **For / how often:** the help topics (`DISPLAY_HELP`) and the scrolling
  text (`SCROLLABLE_TEXT`). Rarely.
- **Detect:** those ids. **Pain:** long text: a reader view fits.

### NPC dialogue (`C` chat)

- **For / how often:** talking to NPCs: lettered responses, trade, missions,
  orders. Occasionally.
- **Driven by:** `DIALOGUE_CHOOSE_RESPONSE` (letters for responses, `L`
  look at, `S` size up, `A` assess, `Y` yell, `O` opinion); trading is an
  inventory-style `trade_selector` (`INVENTORY`, with `F1`/`F2` auto
  balance); NPC rules (ImGui).
- **Detect:** `DIALOGUE_CHOOSE_RESPONSE`.
- **Upstream touch:** the responses' letters become shortcuts (manual keys).
- **Phone pain:** long text and long response lines.

### Waiting, sleeping, long activities

- **For / how often:** `|` wait (a `uilist` of durations), `$` sleep (an
  alarm/duration question), crafting, reading, butchering, disassembling:
  activities that run for many turns and are interrupted by events
  ("Stop reading? (y/n)"). Often.
- **Detect:** not waiting for input while the game runs turns (`busy`), then
  `CANCEL_ACTIVITY_OR_IGNORE_QUERY` or `YESNO` when interrupted.
- **Phone pain:** nothing to press while busy (a Stop button maps to any
  key); interruptions need a quick answer.

### Debug menu

- **For / how often:** cheats and tools (`debug` action, unbound by
  default; `DEBUG_SPELLS`, `EDITMAP`, `WISH_ITEM`, `OVERMAP_EDITOR`). Rarely,
  for testers.
- **Detect:** those ids; `uilist` titles.
- **Phone pain:** not a phone concern; keep reachable from More.

### Death and game over

- **For / how often:** once per character (permadeath): "You died" message,
  the end screen (ImGui `end_screen_ui_impl`: a tombstone/epitaph where the
  last words can be typed), the memorial file, then the "watch the
  aftermath" query (deathcam, `QUIT_WATCH`) and back to the main menu.
- **Detect:** `player.dead`, `quit` 4 (died) or 5 (watching), ImGui window
  title of the end screen, then `mainMenu`.
- **Upstream touch:** none special.
- **Phone pain:** a text field for the epitaph; several key presses to get
  back to the main menu.

### Loading and saving

- **For / how often:** loading the game data (tens of seconds; an ImGui
  progress window, `loading_ui`), world generation and map loading at game
  start, saving (`S` Save and quit, `YESNO` "Save and quit?"; quicksave is
  unbound by default). Every session.
- **Detect:** not waiting, not in game (`loading`); `mainMenu` after a save.
- **Phone pain:** long waits without feedback (the shell shows elapsed
  time); the game saves only when asked.

## Candidate phone helpers, ranked

"Additional menu functionality to ease use": helpers the adapter could add
**without changing the game** (they read the snapshot and send upstream's
keys). Ranked by benefit for a phone player against cost to build.
Not implemented.

1. **Contextual action row on the map.** Show what the game itself suggests:
   the action menu's weighted entries (`handle_action_menu`: open, close,
   examine, butcher, stairs, control vehicle, fire when armed and in
   combat, toggles that are on) and Android's auto-add list (pickup when
   items are here, ignore/safe mode when safe mode stops you, eat when
   hungry, sleep when dead tired). *Benefit: very high* — turns 65 keys into
   the three or four that matter now. *Cost: medium* — export the same
   checks read-only from the port (`can_interact_at`, hostiles in view,
   hunger, wielded gun), small dock logic.
2. **Tap a tile = upstream's mouse.** Tap previews a route and a second tap
   walks there; long-press = upstream's right click (fire / close / pick up
   / examine); in look and targeting a tap moves the cursor. *Benefit: very
   high* (walking, looking, aiming). *Cost: low* — SDL already turns taps
   into clicks; add long-press → right button and suppress compatibility
   clicks (the HyperRogue pattern).
3. **A phone-sized terminal.** Choose font size / terminal size / sidebar
   layout for the screen (upstream options `FONT_WIDTH`/`FONT_HEIGHT`,
   `TERMINAL_X/Y`, `SCALING_FACTOR`, sidebar style "narrow"/"labels") and
   pinch to zoom the map tiles (`z`/`Z`, as Android's pinch). *Benefit: very
   high* (today an upright phone shows the left part of 80 columns).
   *Cost: medium* — options written before start-up plus a landscape-first
   layout; upright needs the 80x24 minimum dealt with (scale the canvas, or
   recompose like Brogue).
4. **Menu sheet for `uilist` and popups.** Lift the ImGui menu's entries
   (title, hotkey, text, enabled) into a large modal sheet; tap = the
   entry's hotkey; yes/no popups become two big buttons. *Benefit: high*
   (menus are everywhere). *Cost: medium* — read entries from the uilist
   (a link-time wrapper on `uilist::query` or the ImGui text already
   captured) and the answer keys from the popup.
5. **Inventory sheet.** Present `INVENTORY` screens as a scrolling list with
   the selector's own entries (letter, name, count, category, column), tap
   to pick, a count stepper for multi-select, and the screen's action keys
   (wield/wear/examine/drop) as buttons. *Benefit: very high* (the most used
   and least usable screen). *Cost: high* — read the selector's columns and
   entries (inventory_ui.cpp internals), keep letters in sync, handle the
   variants and nesting.
6. **Pad that follows the context.** Movement on the map (repeatable),
   cursor moves in look/targeting/overmap (with fast `HJKL...`), one-shot
   directions in direction prompts, arrow keys in menus. *Benefit: high*.
   *Cost: low* — context ids already distinguish these.
7. **Safe-mode bar.** When the game stops movement for a spotted monster,
   offer "Ignore (')", "Safe mode off (!)" and "Look" at once. *Benefit:
   high* (frequent, confusing). *Cost: low* — the message and the snapshot
   say it.
8. **Targeting dock.** Fire, next/previous target, aim levels (a/c/p),
   switch ammo/mode, cancel; the hit-chance text from the screen in a large
   card. *Benefit: high in combat*. *Cost: low-medium*.
9. **Typing helpers.** Show the keyboard automatically for `STRING_INPUT`,
   `STRING_EDITOR` and the character name field; a number pad for count
   prompts. *Benefit: medium*. *Cost: low* (contexts are known; the name
   field needs the description tab's context).
10. **Character creation guide.** Big Next/Back tab buttons, Finish, and
    Play Now! (default scenario) offered on the main menu for a first game.
    *Benefit: medium* (once per character, but first impressions). *Cost:
    low-medium*.
11. **Reader for long text.** Item info, extended descriptions, help,
    character sheet, dialogue: reflowed large text read from the screen
    text (Brogue's reader). *Benefit: medium*. *Cost: medium*.
12. **Recently used / pinned actions.** Android's quick-shortcuts idea: the
    last few actions chosen from More or the action menu stay on the dock
    (per context), and players can pin their own. *Benefit: medium* (suits
    each play style). *Cost: medium* (per-game storage, UI to pin).
13. **AIM helper.** A 3x3 source picker (the numpad layout as a grid) and
    move one / some / all buttons. *Benefit: medium* (base builders).
    *Cost: medium*.
14. **Overmap helper.** Tap to place the cursor, Travel here (`W`+`T`), notes
    with the keyboard. *Benefit: medium*. *Cost: low-medium* (upstream's
    mouse already moves the cursor).
15. **Stop / busy button and interruption answers.** A single Stop while an
    activity runs and the three answers of an interrupted activity.
    *Benefit: medium*. *Cost: low*.
16. **Driving controls.** Steering/accelerate pad and cruise keys in the
    `VEHICLE` context. *Benefit: low-medium* (a minority of play). *Cost:
    medium*.
17. **"Execute from keybindings".** The `?` screen of any context lists
    every action with an Execute key (`.`): a searchable action list per
    screen, for free. *Benefit: low-medium* (power users). *Cost: low*.
