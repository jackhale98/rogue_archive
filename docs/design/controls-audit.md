# Touch controls audit (November 2026)

An audit of every port's phone controls against the game's full command set and what matters over a whole run (not just the first levels), from the pinned upstream source and community guides. It complements [mobile-play.md](mobile-play.md), which describes what is implemented. "New field" means a new **read-only** value the port's platform layer would add to its state snapshot (never game state written).

## Summary

| Game | Biggest problems found | Engine context available | Main limits |
|---|---|---|---|
| Rogue | --More-- after every blow (fixed: continues automatically); auto-continue would have closed overlays (fixed: `ST_OVERLAY`); item lists ignored taps, so item prompts were a dead end (fixed) | Screen + snapshot; easy to add stairs-under-hero, amulet, hunger, armour, status flags | Hidden things (secret doors, unseen monsters) are hidden by design |
| Brogue CE | Palette `yes`/`no` send `y`/`n`, which move diagonally on the map; Ctrl+S (5-turn search) unreachable; stairs travel needs two long-presses per level; Throw / Throw again never one tap; Rest leads even next to an enemy | Snapshot has stairs, cursor, playback; easy to add enemy adjacent/visible, rethrow, statuses, searching | Targeting cursor and pending verb are locals: only prompt text tells throwing from zapping |
| DCSS | Rest leads mid-fight (game refuses); latched Run hidden when wounded; one dock for aim / look / direction; travel menu, stat increase and multi-select menus need the keyboard; casting leads for non-casters | Rich: WebTiles `player` (hp, mp, quiver, status), map cells with monster threat, menu tags, input modes | Spells/abilities known only after their menu opens; "done exploring" only as message text |
| Sil-Q | Song prompt shows a typing dock; "Nearest" offered at plain direction prompts (rejected there); Rest leads everywhere; quaff buried; status (stealth, song, hunger, conditions) invisible on phones | Easy to add stealth mode, songs, stairs/forge/item underfoot, monsters in view/adjacent, quiver, hunger, statuses, unspent XP, `on_the_run` | Which unidentified herb/potion heals; whether a monster is worth fighting |
| HyperRogue | `t` (target centre) is the primary button but almost never usable on a phone; tapping with a ranged orb silently uses it (no forced aim or confirm); Wait duplicated (pad centre and dock) | Easy to add has-ranged-orb, the orb a tap would use (`orbToTarget`), crossbow mode, Strong Wind, Dead Orbs, Orb of Safety; upstream's own `touch_interface` modes | No cheap "in danger" flag; no "which orb works where" without an expensive scan |

## Rogue 5.4.4

Done in this change: `--More--` on the message line continues automatically (setting); overlays (lists, help, Discoveries, detection) stay up until closed; lists opened from an item prompt answer it.

Still to do:
- **Fight without --More--:** `f`+direction fights without a message per blow and stops itself when hit points fall to the largest single hit taken. Make the dock's Fight one gesture: when a monster letter is adjacent, "Fight ↖B" sends `f` and that direction.
- **Context leads:** standing on stairs (new `ST_ON_STAIRS`) → Stairs; with the Amulet (new `ST_AMULET`) → Up `<`; Hungry/Weak (new `ST_HUNGER`) → Eat; an object underfoot (new `ST_UNDER`) → Pick up; a visible `A` (aquator) while armour is worn (new `ST_ARMOR`) → Take off; an adjacent `E` (floating eye) → Throw/Zap, not Fight.
- **Repeat counts:** Search ×10 and Rest ×10 in the Search fan (`10s`, `10.`); Ctrl-run (stops beside things) next to Run.
- **Again** (`a`) belongs with Fight/Pack, not Search; "Stop" in the busy dock does nothing in Rogue (it reads no keys while running) and should go.
- Item prompts could open the list at once (send `*`), and the inventory could offer per-item verbs (Space, verb, letter).

## Brogue CE

- **Bugs:** drop or rename the palette's `yes`/`no` (`y`/`n` move diagonally on the map; Brogue's `confirm()` takes Enter/Esc); `search` says "five turns" but `s` searches one turn; add **Long search (Ctrl+S)**; fix labels ("More" used for both acknowledge and the palette; Enter on the map is the keyboard look cursor, not "Confirm"); Rest-until-better also rests 100 turns at full health.
- **Stairs:** `>` shows the route, a second `>` goes. When the cursor sits on the stairs (`ST_DOWN_X/Y` already in the snapshot) make "Go ↓" the primary button; after "I see no path for further exploration." promote Stairs.
- **Danger dock** (new `ST_ENEMY_ADJACENT` = `adjacentFightingDir() != NO_DIRECTION`, `ST_ENEMIES_VISIBLE`): Throw again `T` (new `ST_CAN_RETHROW`), Fight `x`, Pack, Look; no Rest/Search as the main button.
- **Quiet dock:** Explore (fan: Stairs ↓, Stairs ↑, Run) · Search (fan: Long search, Rest, Rest 100) · Pack (fan: Apply, Throw, Equip, Remove, Drop, Swap `w`) · Look `Tab` · More; Eat first when Hungry (needs the food's letter: new `ST_FOOD_LETTER`).
- **Recording playback** (`ST_PLAYBACK` already parsed, unused): Pause, slower/faster, seek, levels, omniscience.
- Labels from prompt text: "Throw" vs "Zap" on the targeting dock.
- Add touch commands to the key-coverage check, as the other ports do.

## Dungeon Crawl Stone Soup

- **Bugs:** Rest leads below 50% HP even with monsters near (the game refuses); a latched Run disappears when wounded; aim (`TARGET_PATH`), look (`TARGET`) and direction (`TARGET_DIR`) share one dock — split them (Fire/Next/Quiver for aiming; Select/Next/Info for looking; pad + Cancel for directions).
- **Monsters in view:** the client already receives map cells with monster attitude and threat; the client host can read them (as upstream's monster list does) and send `{hostiles, maxThreat}`. Hostiles → Fight Tab · "Fire: *quiver*" `p` (quiver from `player.quiver_desc`) · Cast `z` · Quaff · Look; no Explore (refused with monsters near).
- **Underfoot** (map cell flags): Down/Up/Pray/Shop/Enter on the stairs button; otherwise Travel `G`.
- **Menus by tag** (already stored): travel (Down `>`, Up `<`, Repeat Tab, Altars `_`), use_item, spell/ability (Describe `!`), pickup (All `,`, Accept), yes/no with **Always** `A`; stat increase as Str/Int/Dex buttons from the prompt text.
- Lead with Ability for non-casters once the ability/spell menus have been seen (the only source of that knowledge); Orb carried or Zot clock low → Stairs/Travel first.
- Missing keys to add: cycle quiver `(` `)`, attack without moving (Ctrl+direction), add macro, save now.

## Sil-Q

- **Bugs:** the song prompt ("Songs: … Sing which song:") shows the typing dock — parse its letters into buttons (plus stop `s`, swap `x`); "Nearest" (`t`/`*`) is offered at plain direction prompts (open, close, bash, tunnel, disarm), where the game rejects it — only aim prompts ("'f' for") take it; the `*` button means "choose a target", not "list"; long-press on the map runs plain `l` rather than looking at that cell; the hardcoded original keyset breaks if a player enables `hjkl_movement` or `angband_keyset` (expose and follow them, or lock them).
- **Phones hide the status line:** show stealth mode, current song, hunger and conditions in the band (new fields from `p_ptr`: `stealth_mode`, `song1/2`, `food`, `blind`, `confused`, `afraid`, `poisoned`, `cut`, `stun`, `entranced`, light timeout).
- **Context leads** (new fields): on stairs (`cave_feat` FEAT_MORE/LESS) → Down/Up; at a forge → Smith; item underfoot → Pick up; the Iron Crown underfoot → Prise (`k`, today palette-only); `on_the_run` (escaping with a Silmaril) → Up; unspent experience → Abilities.
- **Docks:** exploring (context lead · Stealth toggle · Rest · Pack · Look · More; a door adjacent turns Rest into Door `/`); monster in view (Fire with quiver, else Throw · Sing showing the song · Stealth · Look with Recall `r`); adjacent (Hold · Sing · Throw · Exchange); low health (Quaff · Eat herbs · Stairs if on them).
- Flasks of oil have no THROWING flag, so "throw at nearest" never throws them: Throw `t` then the flask.

## HyperRogue

- **Demote `t`:** it targets the cell at the centre of the view, which after any move is the player (rejected). Keep it only when Strong Wind is held (new `RA_WIND`), where it jumps.
- **Ranged orbs on touch:** a tap on a distant cell with a ranged orb (Teleport, Frog, Dash, …) uses it automatically if it applies, else walks — players can teleport by accident. Add an **Aim** toggle when a ranged orb is held (new `RA_RANGED` = `haveRangedOrb()`), using upstream's own touch modes (`touchmode`: ranged = forced target with error messages, info = inspect without moving) through a small UI-state setter, and show the orb a tap would use (`orbToTarget`). Smallest step: enable upstream's `touch_interface`, which draws its own mode-cycling button.
- **Contextual buttons:** crossbow fire mode as a toggle (new `RA_FIRE_MODE`, reload turns) — while it is on, Esc cancels fire mode, so relabel; Drop only with Dead Orbs (`g` otherwise wastes a turn); Inventory `i` in Orb Strategy mode; Mark `m` in the Minefield (land already in the snapshot); Orb of Safety indicator (`items[itOrbSafety]`) since leaving saves only while it is powered.
- **Dock:** Centre (fan: rotate) · Overview `o` (relabel from "o") · Quest (fan: help, new game, menu) · More; Wait only on the pad's centre.
- Special lands (Camelot, Ivory Tower, Rose Garden, the Princess) need no extra keys.

## Where the engines don't give enough context

- **Brogue:** the targeting cursor and the pending item verb are local to their functions; only on-screen prompt text tells them apart. No "level explored" flag (message text only). No "last applied item" for "zap again".
- **DCSS:** known spells and abilities only inside their menus; background not sent; why travel or rest stopped (message text only); rune count only on the `}` screen.
- **Sil-Q:** whether an unidentified potion or herb heals; whether a monster is worth fighting; whether an adjacent door is locked (known to the game, maybe not to the player).
- **Rogue:** secret doors, unseen monsters, wand charges and item identities are hidden by design.
- **HyperRogue:** no cheap danger flag (threat is checked per move); no map of where each orb applies without an expensive scan.
