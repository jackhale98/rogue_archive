# NetHack touch controls: design

Status: **implemented** (the decisions below were made with the project owner; phone play on a physical device is still to come). NetHack's command set is far larger than the other games' (171 commands in `cmd.c`, 69 of them reachable only as extended commands, and dozens of follow-up prompts), so this document settles the interaction model first.

## Goals and constraints

- **A full run by touch**, from the first level to the Astral Plane: not just moving and fighting, but the things a winning game needs (identifying, Elbereth, praying, shopping, altars, digging, wishes).
- **The keyboard stays NetHack's.** Every touch control sends NetHack's own keys or commands; no rule changes.
- **Use the game's own context logic first.** NetHack 5.0 already knows what can be done where and with what (below). Where it does, the port asks the game rather than guessing.
- **No hidden information.** Context signals come only from what the player can see or knows (the displayed map, inventory, status, messages), never from game state the player can't see (undiscovered traps, unseen monsters, prayer timeout, Luck).
- **Few taps for frequent actions; everything reachable.** Frequent: move, fight, search, travel, stairs, pick up, eat, inventory. Everything else: two or three taps through a fan, the item's own actions, or the command list.

## What NetHack 5.0 gives us

| Engine feature | What it does | Use |
|---|---|---|
| `#therecmdmenu` (mouse button 1 by default) | A menu of what you can do at a map position: on yourself (go up/down the stairs, pick up, loot, tip, eat what's here, drink from the fountain, sit on the throne, offer at the altar, untrap, look here, cast); next to you (open, close, lock, unlock, kick the door; search for a door trap; examine or disarm a trap; push the boulder; talk to, ride, saddle, name, swap places with, attack a monster); far away (travel, throw). One applicable action runs directly. | Long-press on a cell |
| `#herecmdmenu` | The same for your own square. | Tap on the hero |
| `mouseaction` (bindable to a mouse button) | The classic click: far travels, adjacent moves, attacks, opens a closed door, kicks a locked one, searches a wall; on yourself it drinks, sits, takes the stairs, picks up or loots, else rests. | Tap on a cell |
| `clicklook` (mouse button 2) | Describes what is at a position (farlook). | In the long-press menu ("Look at map symbol") |
| Item actions (new in 5.0) | Choose an item in the inventory and the game lists what you can do with it: wield, wear, eat, quaff, read, apply, zap, throw, quiver, engrave with it, dip, rub, offer, name, adjust its letter, drop... (about 70 actions). The `m` prefix on `)` `[` `(` `=` `"` `*` gives the same for one class. | The Pack button |
| getobj's `?` and `*` | At "What do you want to eat? [fg or ?*]", `?` lists the suitable items as a menu, `*` everything. | Item prompts |
| getpos | Choosing a position (travel `_`, farlook `;`, jump, cast at, #terrain, naming): cursor keys, `m`/`M` monsters, `o`/`O` objects, `d`/`D` doors, `x`/`X` unexplored, `a`/`A` anything, `t`/`T` traps, `<` `>` stairs, `_` altars, `@` yourself, `.` `,` `;` `:` to pick; a click picks the clicked cell. | Its own dock |
| `BIND` and `OPTIONS` | Keys and mouse buttons can be rebound in a configuration file. | Mouse buttons for taps |

## The interaction model

Five layers, from most direct to most general:

1. **The map** (gestures):
   - **Tap a cell:** NetHack's `mouseaction`. A far cell travels there. An adjacent cell moves, attacks, opens a closed door or kicks a locked one. Your own cell does the obvious thing there: stairs, fountain, throne, pick up or loot, else rest.
   - **Tap the hero:** `#herecmdmenu`, everything you can do here, as a sheet (decision 1).
   - **Long-press a cell next to the hero:** `#therecmdmenu` (mouse button 2), everything you can do there: on a door open, unlock, search for a trap, kick; on a wall search for secret doors; on a pet talk, swap places, name; on a hostile attack. With nothing to offer, the game walks there.
   - **Long-press a cell farther away:** what is there, NetHack's farlook (`;` and the cell). For a click, upstream's `#therecmdmenu` offers nothing at a distance but travel (it passes both click flags, which neither far-away entry accepts), and a tap already travels.
   - **While choosing a position:** a tap or long press picks that cell.
   - **Pinch and drag:** zoom, and look around (as now).
2. **The dock** (six buttons and the thumb pad) follows the situation (below). The first slot holds what the situation calls for most; long-pressing a button fans out related commands.
3. **Items first, from the Pack.** Pack opens the inventory; tapping an item opens the game's own item-actions menu for it. Most item use (wear, wield, quaff, read, zap, engrave-identify, dip, name) goes this way, with the game deciding what applies.
4. **Prompts get their own docks** (item, direction, position, yes/no, text, menu: below), so a command's follow-up questions never need the keyboard.
5. **The command list** (More): every command and every extended command, searchable, with its key.

## Docks by context

| Context | How it is recognised | Dock |
|---|---|---|
| **Exploring** (nothing hostile in view) | The map and its displayed glyphs | Lead · Search `s` (fan: rest `.`, search ×10/×20, rest ×20) · Travel `_` (fan: down `>` and up `<` stairs, travel to the stairs `_ >`/`_ <`, `G` run) · Pack `i` (fan: the `m`-prefix class menus, eat, quaff, read, apply, drop several `D`) · Look `;` (fan: look here `:`, discoveries `\`, equipment `*`, overview Ctrl+O, attributes Ctrl+X, #terrain, messages Ctrl+P) · More |
| **Fighting** (a hostile monster in view) | Displayed monster glyphs, not pets or peacefuls | **Fight ↖x** (`F` and the direction, one tap, when one is adjacent) · **Fire ⟶x** (`f` and the direction, when the quiver is loaded and a target is lined up) or Throw `t` · Cast `Z` (when spells are known) or Zap `z` · Quaff `q` · Elbereth (engrave in the dust; below) · More |
| **In trouble** (low hit points, weak from hunger, stoning, slime, strangling, food poisoning or terminal illness on the status line) | Status values and conditions the player sees | **Pray** (#pray; the game asks to confirm) · Quaff · Elbereth · Flee toward the stairs (travel `_ <`) · Pack · More |
| **Item prompt** ("What do you want to eat? [fg or ?*]") | yn_function without choices | The suitable items as a sheet at once (`?`, for a command given by touch). With one suitable item the game names it on the message line instead ("d - an uncursed food ration."); with up to three, each is a button (its letter and the name the game gave). Buttons: Choose `?`, All items `*`, Hands `-` when offered, Cancel |
| **Direction** ("In what direction?") | The prompt text | The pad; Self `.`; Down `>`; Up `<`; **At the x** (the direction of the only visible hostile in line); Cancel |
| **Position** (getpos) | The glue's getpos flag | Tap a cell to choose it; buttons: Select `.` (also the pad's centre; the pad moves the cursor), Monster `m` (fan: objects, doors, altars, anything, unexplored), Stairs `>` (fan: `<`, traps), Yourself `@`, Cancel. The first time a game asks for a position, NetHack 5.0 shows its tip about it (the `tips` option, on as upstream). |
| **Yes/no** ("[ynq]") | Its choices | Its answers as buttons (as now) |
| **Text** (getlin) | getlin | The keyboard, plus suggestions where the question has common answers: "Elbereth" when engraving, the item's name when naming |
| **Extended command** (`#`) | get_ext_cmd | A searchable sheet of NetHack's extended commands (from the game's own list, with descriptions), not typing |
| **Menu**, **text window**, `--More--` | As now | As now: Accept, All, pages, Cancel; Next, Close; Continue |

**Leads** (the first slot, from what the player sees):

| Situation | Lead |
|---|---|
| On stairs or a ladder | Down `>` / Up `<` |
| Objects here | Pick up `,` (a container: Loot) |
| On an altar with a corpse in reach | Offer (#offer) |
| On a fountain, sink or throne | Quaff from it / Sit |
| Hungry (Weak: highlighted) | Eat `e` (the floor's corpse first, as the game offers) |
| "You feel more confident in your … skills." | Enhance (#enhance) until used |
| In a shop with unpaid items | Pay `p` |
| Engulfed | Fight (any direction attacks) |
| Burdened or worse | Drop several `D` |

## Elbereth, the Big One

Engraving Elbereth is central to survival and takes five prompts (`E`, `-` for fingers, "Do you want to add to the current engraving?", the text, Enter). The Elbereth button sends `E` and answers the follow-ups the way the player would: no to adding (so it is written fresh), then the text. It only automates the typing: the game still decides whether it works (fingers in dust, scuffing, blindness...), and every prompt is still NetHack's.

## Messages

NetHack prints many messages per turn, especially in fights. The phone band shows all of this turn's messages, up to three lines, then "+N more", which opens the log. `--More--` only appears when the game asks for it (`display_nhwindow` of the message window, blocking); it continues automatically unless *--More-- prompts* is set to wait, as in the Rogue port.

## Engine signals (read-only glue)

The glue (`port/rogue-archive-glue.c`) grows a snapshot of what the player can see or knows:

- **Here:** the remembered feature (stairs up or down, ladder, altar and its alignment, fountain, sink, throne, a known trap); the count of seen objects here, and whether one is a container or a corpse.
- **Around:** adjacent cells with a displayed hostile monster (a monster glyph that is not a pet; peaceful status as farlook reports it), adjacent closed or locked doors (as displayed); the nearest displayed hostile in a straight line within throwing range.
- **You:** hit points, power, hunger state, encumbrance, the status conditions, engulfed, trapped, levitating, riding; whether the quiver holds something and the wielded launcher matches it; whether any spell is known; in a shop with unpaid items.
- **Prompts:** getpos active (its message); the item prompt's letters (already in the prompt text).

Never: monsters or traps the hero hasn't seen, prayer timeout, Luck, or any other hidden value.

## Implementation phases

1. **Glue and gestures:** the snapshot above; a configuration file (`BIND=mouse1:mouseaction`, `BIND=mouse2:therecmdmenu`); tap, tap-the-hero and long-press as above; check it plays the same with the keyboard.
2. **Prompt docks:** item prompts as lists at once, direction (with At the x), position, extended-command sheet, text suggestions.
3. **Map docks and leads:** exploring, fighting, trouble; one-tap Fight and Fire; Elbereth; Pray.
4. **Messages:** the band's lines, the --More-- setting.
5. **Verification:**
   - unit tests for every dock decision;
   - a key coverage check: every command's key is bound to that command in `cmd.c`;
   - the Node play check extended with scripted situations (a fight, an item prompt, a direction, a position, the extended command sheet);
   - end-to-end tests on phone;
   - your play-through on an iPhone, the real test.

## Decisions (made with the project owner)

1. **Tapping the hero:** `#herecmdmenu`, a menu of everything possible here (not `mouseaction`'s single guess), since the dock's lead slot already gives the one-tap action.
2. **Long-press:** `#therecmdmenu`, actions there. Next to the hero that is the game's menu; farther away, where upstream's menu has nothing for a click but travel, it is farlook (above).
3. **Elbereth and Pray buttons:** yes, in the fighting and trouble docks and the command list, with the game's own confirmations.
4. **Item prompts:** the list of suitable items at once (or, for up to three items, buttons for them).

## Notes from implementing it

- **The configuration file is read only if the environment is set before the module starts.** Emscripten's C library copies `ENV` when the module starts, so `HOME` (for `~/.nethackrc`) and `NETHACKOPTIONS` are set in `preRun`; set later, both were silently ignored. The Node play check now checks that mouse button 2 opens the game's menu (upstream's default for it is `clicklook`).
