/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * Rogue Archive display module for Angband 4.2 (WebAssembly).
 *
 * Angband separates the game from its display through the "term" interface
 * (ui-term.h): a front end supplies hooks to draw text and tiles, wipe cells,
 * place the cursor, and handle "extra" requests (wait for an event, flush
 * input, refresh, delay). This file is such a front end, modelled on
 * upstream's template main-xxx.c and its curses module main-gcu.c. It keeps
 * a copy of the screen (characters, colours and tiles) and hands it to the
 * Web Worker at each refresh; keys and mouse clicks come back from it.
 *
 * It is selected through upstream's main.c without modifying it: the build
 * defines USE_GCU and renames init_gcu/help_gcu to init_web/help_web, so the
 * "gcu" entry of main.c's module table starts this module (main-gcu.c itself
 * is not compiled). ANGBAND_SYS is therefore "gcu" and upstream's
 * font-gcu.prf applies, as in a terminal.
 *
 * Tiles are Angband's own graphics modes (lib/tiles/list.txt and each mode's
 * pref files, read by upstream's grafmode.c and ui-prefs.c): with one chosen,
 * the game draws the map through pict_hook with tile coordinates, which this
 * module passes on; the page draws them from the tile sheet.
 */
#include "angband.h"
#include "cave.h"
#include "game-event.h"
#include "game-world.h"
#include "grafmode.h"
#include "init.h"
#include "main.h"
#include "message.h"
#include "mon-predicate.h"
#include "monster.h"
#include "obj-util.h"
#include "player-calcs.h"
#include "player-timed.h"
#include "player-util.h"
#include "target.h"
#include "ui-birth.h"
#include "ui-display.h"
#include "ui-game.h"
#include "ui-map.h"
#include "ui-output.h"
#include "ui-prefs.h"
#include "ui-term.h"

#include <stdlib.h>
#include <string.h>

/* The main window; Angband needs at least 80x24. */
#define WEB_COLS_MIN 80
#define WEB_ROWS_MIN 24
#define WEB_COLS_MAX 160
#define WEB_ROWS_MAX 64

/* A cell drawn as a tile (the character the page receives for it). */
#define TILE_CELL 0x7F

typedef struct term_data term_data;
struct term_data
{
	term t;
};

static term_data data;
static int cols = WEB_COLS_MIN;
static int rows = WEB_ROWS_MIN;
/* Two bytes per cell: character (Latin-1), colour (bit 7: solid block). */
static uint8_t screen[WEB_COLS_MAX * WEB_ROWS_MAX * 2];
/* Two entries per cell: foreground and background tile, 0x8000 | row << 7 | col (0 if none). */
static uint16_t tiles[WEB_COLS_MAX * WEB_ROWS_MAX * 2];
static int cursor_x = 0, cursor_y = 0;
static bool cursor_visible = false;

/* Read-only state for the shell (status band, context). Field order is
 * mirrored in adapter/state.ts; new fields go at the end. Everything here is
 * read from the game, never written. */
enum
{
	ST_IN_GAME,
	ST_HP,
	ST_MAX_HP,
	ST_SP,
	ST_MAX_SP,
	/* Dungeon level (each is 50 feet; 0 is the town). */
	ST_DEPTH,
	ST_PLAYER_X,
	ST_PLAYER_Y,
	/* The map's offset in the dungeon (the main term's panel). */
	ST_OFFSET_X,
	ST_OFFSET_Y,
	/* Where the map starts on screen (ROW_MAP, COL_MAP for the sidebar mode). */
	ST_COL_MAP,
	ST_ROW_MAP,
	ST_MSG_COUNT,
	ST_WAITING,
	/* The rogue_like_commands option. */
	ST_ROGUELIKE,
	ST_LEVEL,
	ST_GOLD,
	/* Graphics mode in use (0: text; see lib/tiles/list.txt). */
	ST_GRAPHICS,
	/* Underfoot: 1 down staircase, 2 up staircase, 3 a shop entrance (else 0). */
	ST_UNDER_FEATURE,
	/* Underfoot: objects the player knows of (0 if none). */
	ST_UNDER_OBJECTS,
	/* Visible monsters in view, and those adjacent to the player. */
	ST_MONSTERS_IN_VIEW,
	ST_MONSTERS_ADJACENT,
	/* Direction digit (1-9) to the adjacent visible monster to attack, 0 if none. */
	ST_ATTACK_DIR,
	/* A launcher with ammunition for it, as the fire command requires. */
	ST_CAN_FIRE,
	/* Items in the quiver (ammunition and throwing weapons). */
	ST_QUIVER,
	/* The class casts spells, and can now (not blind, confused or in the dark). */
	ST_CASTER,
	ST_CAN_CAST,
	/* Known closed doors next to the player. */
	ST_DOORS_ADJACENT,
	/* The player is resting, running or following a path. */
	ST_BUSY,
	/* The mouse_movement option (clicks on the map move the player). */
	ST_MOUSE_MOVEMENT,
	ST_IS_DEAD,
	/* A character is loaded or being created (character_generated). */
	ST_GENERATED,
	ST_FIELDS
};
static int state[ST_FIELDS];
static bool waiting = false;

/* ------------------------------------------------------------------------- */
/*
 * The host bridge. In the browser the worker installs these hooks on
 * `Module`; the conformance harness (RA_REPLAY) defines them in C instead
 * (tests/conformance/replay-platform.c), so the same module runs natively.
 */
#ifndef RA_REPLAY
#include <emscripten.h>

EM_JS(void, ra_present, (const uint8_t *cells, const uint16_t *tile_cells, int cols, int rows,
                         int cx, int cy, int cursor, const int *state, int stateLen), {
	Module.raPresent(HEAPU8.slice(cells, cells + cols * rows * 2),
	                 HEAPU16.slice(tile_cells >> 1, (tile_cells >> 1) + cols * rows * 2), cols, rows,
	                 cx, cy, cursor, HEAP32.slice(state >> 2, (state >> 2) + stateLen));
});

/*
 * Next input event, or 0 if none is queued: a key is code | mods << 21; a
 * mouse click is -(1 + x + y * 256 + button * 65536), button carrying the
 * modifiers in its high nibble as Term_mousepress expects.
 */
EM_JS(int, ra_poll_event, (void), { return Module.raPollEvent(); });

/* Resolves when an event arrives (or a host request needs servicing). */
EM_ASYNC_JS(void, ra_wait_for_event, (void), { await Module.raWaitForEvent(); });

EM_JS(void, ra_flush_events, (void), { Module.raFlushEvents(); });

EM_ASYNC_JS(void, ra_sleep, (int ms), { await Module.raSleep(ms); });

/* Persists the save directory if the host asked; called while waiting for input. */
EM_ASYNC_JS(void, ra_service, (void), { await Module.raService(); });

/* A graphics mode the page asked for (-1 if none). */
EM_JS(int, ra_graphics_request, (void), { return Module.raGraphicsRequest(); });

EM_JS(void, ra_palette, (const uint8_t *table, int count), {
	Module.raPalette(HEAPU8.slice(table, table + count * 4));
});

/* A new message, or (repeat) a new text for the newest one. */
EM_JS(void, ra_message, (int repeat, const char *text, int color), {
	Module.raMessage(repeat !== 0, UTF8ToString(text), color);
});
#else
void ra_present(const uint8_t *cells, const uint16_t *tile_cells, int cols, int rows, int cx,
                int cy, int cursor, const int *state, int stateLen);
int ra_poll_event(void);
void ra_wait_for_event(void);
void ra_flush_events(void);
void ra_sleep(int ms);
void ra_service(void);
int ra_graphics_request(void);
void ra_palette(const uint8_t *table, int count);
void ra_message(int repeat, const char *text, int color);
#endif

/* ------------------------------------------------------------------------- */

/* A message with Angband's repeat count, as its message log shows it. */
static const char *message_text(int age, char *buf, size_t len)
{
	uint16_t count = message_count(age);
	if (count > 1)
		strnfmt(buf, len, "%s <%dx>", message_str(age), count);
	else
		my_strcpy(buf, message_str(age), len);
	return buf;
}

/*
 * Sends messages added since the last refresh. Angband counts a message that
 * repeats the newest one instead of adding it; the new count is sent as a
 * replacement for the newest entry.
 */
static void send_messages(void)
{
	static int last_count = 0;
	static char last_newest[1024] = "";
	static int last_repeats = 0;
	int count = messages_num();
	int fresh = 0;
	char buf[1100];

	if (count > last_count) {
		fresh = count - last_count;
	} else if (count > 0 && strcmp(message_str(0), last_newest) != 0) {
		/* The log is full (its count stays at the maximum): find the
		 * newest message already sent. */
		int age;
		for (age = 0; age < count && age < 64; age++)
			if (strcmp(message_str(age), last_newest) == 0)
				break;
		fresh = age;
	} else if (count > 0 && message_count(0) != last_repeats) {
		ra_message(1, message_text(0, buf, sizeof(buf)), message_color(0));
	}
	if (fresh > 64)
		fresh = 64;
	for (int age = fresh - 1; age >= 0; age--)
		ra_message(0, message_text(age, buf, sizeof(buf)), message_color(age));
	if (count > 0) {
		my_strcpy(last_newest, message_str(0), sizeof(last_newest));
		last_repeats = message_count(0);
	}
	last_count = count;
}

/* Direction digit from the player to an adjacent grid. */
static int direction_to(struct loc from, struct loc to)
{
	static const int digits[3][3] = { { 7, 8, 9 }, { 4, 5, 6 }, { 1, 2, 3 } };
	int dy = to.y - from.y, dx = to.x - from.x;
	if (dx < -1 || dx > 1 || dy < -1 || dy > 1 || (!dx && !dy))
		return 0;
	return digits[dy + 1][dx + 1];
}

/* What the shell's docks and status band use; reads only. */
static void read_context(void)
{
	bool on_map = state[ST_IN_GAME] && cave && player->cave
		&& square_in_bounds_fully(cave, player->grid);
	struct monster *target = target_is_set() ? target_get_monster() : NULL;

	state[ST_ROGUELIKE] = OPT(player, rogue_like_commands) ? 1 : 0;
	state[ST_MOUSE_MOVEMENT] = OPT(player, mouse_movement) ? 1 : 0;
	state[ST_LEVEL] = player->lev;
	state[ST_GOLD] = player->au;
	state[ST_IS_DEAD] = player->is_dead ? 1 : 0;
	state[ST_UNDER_FEATURE] = 0;
	state[ST_UNDER_OBJECTS] = 0;
	state[ST_MONSTERS_IN_VIEW] = 0;
	state[ST_MONSTERS_ADJACENT] = 0;
	state[ST_ATTACK_DIR] = 0;
	state[ST_CAN_FIRE] = 0;
	state[ST_QUIVER] = 0;
	state[ST_CASTER] = 0;
	state[ST_CAN_CAST] = 0;
	state[ST_DOORS_ADJACENT] = 0;
	state[ST_BUSY] = 0;
	if (!on_map)
		return;

	state[ST_QUIVER] = player->upkeep->quiver_cnt;
	state[ST_CAN_FIRE] = (player_can_fire(player, false) && player->upkeep->quiver_cnt > 0) ? 1 : 0;
	state[ST_CASTER] = player->class->magic.total_spells ? 1 : 0;
	state[ST_CAN_CAST] = player_can_cast(player, false) ? 1 : 0;
	state[ST_BUSY] = (player_resting_is_special(player->upkeep->resting)
		|| player_is_resting(player) || player->upkeep->running) ? 1 : 0;

	if (square_isdownstairs(cave, player->grid))
		state[ST_UNDER_FEATURE] = 1;
	else if (square_isupstairs(cave, player->grid))
		state[ST_UNDER_FEATURE] = 2;
	else if (square_isshop(cave, player->grid))
		state[ST_UNDER_FEATURE] = 3;
	for (struct object *obj = square_object(player->cave, player->grid); obj; obj = obj->next)
		state[ST_UNDER_OBJECTS]++;

	for (int i = 1; i < cave_monster_max(cave); i++) {
		struct monster *mon = cave_monster(cave, i);
		if (!mon || !mon->race || !monster_is_visible(mon))
			continue;
		if (monster_is_in_view(mon))
			state[ST_MONSTERS_IN_VIEW]++;
		int dir = direction_to(player->grid, mon->grid);
		if (dir) {
			state[ST_MONSTERS_ADJACENT]++;
			/* The current target first, else the first found. */
			if (!state[ST_ATTACK_DIR] || mon == target)
				state[ST_ATTACK_DIR] = dir;
		}
	}
	for (int dy = -1; dy <= 1; dy++)
		for (int dx = -1; dx <= 1; dx++) {
			struct loc grid = loc(player->grid.x + dx, player->grid.y + dy);
			if ((dy || dx) && square_in_bounds(cave, grid)
					&& square_iscloseddoor(player->cave, grid))
				state[ST_DOORS_ADJACENT]++;
		}
}

static void present(void)
{
	bool have_player = player && player->upkeep;
	term *main_term = angband_term[0];

	memset(state, 0, sizeof(state));
	state[ST_GRAPHICS] = use_graphics;
	state[ST_WAITING] = waiting ? 1 : 0;
	/* The message log exists once a character is (being) made. */
	state[ST_MSG_COUNT] = character_generated ? messages_num() : 0;
	state[ST_GENERATED] = character_generated ? 1 : 0;
	if (main_term) {
		state[ST_OFFSET_X] = main_term->offset_x;
		state[ST_OFFSET_Y] = main_term->offset_y;
		state[ST_COL_MAP] = col_map[main_term->sidebar_mode];
		state[ST_ROW_MAP] = row_top_map[main_term->sidebar_mode];
	}
	if (have_player) {
		/* character_dungeon stays set while the death screens show. */
		state[ST_IN_GAME] = (character_dungeon && player->upkeep->playing && !player->is_dead) ? 1 : 0;
		state[ST_HP] = player->chp;
		state[ST_MAX_HP] = player->mhp;
		state[ST_SP] = player->csp;
		state[ST_MAX_SP] = player->msp;
		state[ST_DEPTH] = player->depth;
		state[ST_PLAYER_X] = player->grid.x;
		state[ST_PLAYER_Y] = player->grid.y;
		read_context();
	}
	if (character_generated)
		send_messages();
	ra_present(screen, tiles, cols, rows, cursor_x, cursor_y, cursor_visible ? 1 : 0, state,
		ST_FIELDS);
}

static void send_palette(void)
{
	ra_palette(&angband_color_table[0][0], MAX_COLORS);
}

/*
 * Switches the graphics mode, as upstream's SDL2 front end does from its
 * menu: Angband's own visuals for that mode (its pref file), then a redraw.
 */
static void set_graphics(int id)
{
	graphics_mode *mode = get_graphics_mode((uint8_t)id);

	if (!mode)
		mode = get_graphics_mode(GRAPHICS_NONE);
	if (!mode || mode->grafID == use_graphics)
		return;
	current_graphics_mode = mode;
	use_graphics = mode->grafID;
	tile_width = 1;
	tile_height = 1;
	if (!character_dungeon)
		return;
	reset_visuals(true);

	/* As main-sdl2.c's refresh_angband_terms(): do_cmd_redraw() without
	 * flushing input. */
	term *old = Term;
	Term_activate(angband_term[0]);
	event_signal_point(EVENT_MAP, -1, -1);
	Term_flush();
	verify_panel();
	player->upkeep->notice |= (PN_COMBINE);
	player->upkeep->update |= (PU_TORCH | PU_INVEN);
	player->upkeep->update |= (PU_BONUS | PU_HP | PU_SPELLS);
	player->upkeep->update |= (PU_UPDATE_VIEW | PU_MONSTERS);
	player->upkeep->redraw |= (PR_BASIC | PR_EXTRA | PR_MAP | PR_INVEN | PR_EQUIP | PR_MESSAGE
		| PR_MONSTER | PR_OBJECT | PR_MONLIST | PR_ITEMLIST);
	Term_clear();
	handle_stuff(player);
	move_cursor_relative(player->grid.x, player->grid.y);
	Term_redraw_all();
	Term_activate(old);
}

/* Moves queued events into the term's queue. */
static bool take_events(void)
{
	bool any = false;
	int event;
	while ((event = ra_poll_event()) != 0) {
		if (event > 0) {
			Term_keypress((keycode_t)(event & 0x1FFFFF), (uint8_t)((event >> 21) & 0x1F));
		} else {
			int n = -event - 1;
			Term_mousepress(n & 0xFF, (n >> 8) & 0xFF, (char)((n >> 16) & 0xFF));
		}
		any = true;
	}
	return any;
}

static errr Term_xtra_web(int n, int v)
{
	switch (n) {
	case TERM_XTRA_EVENT:
		if (take_events())
			return 0;
		if (!v)
			return 0;
		/* Block until an event arrives, showing the latest screen first. */
		waiting = true;
		present();
		do {
			int mode = ra_graphics_request();
			if (mode >= 0) {
				set_graphics(mode);
				present();
			}
			ra_service();
			ra_wait_for_event();
		} while (!take_events());
		waiting = false;
		return 0;

	case TERM_XTRA_FLUSH:
		ra_flush_events();
		return 0;

	case TERM_XTRA_CLEAR:
		for (int i = 0; i < cols * rows; i++) {
			screen[i * 2] = ' ';
			screen[i * 2 + 1] = COLOUR_WHITE;
			tiles[i * 2] = tiles[i * 2 + 1] = 0;
		}
		return 0;

	case TERM_XTRA_SHAPE:
		cursor_visible = v ? true : false;
		return 0;

	case TERM_XTRA_FRESH:
		present();
		return 0;

	case TERM_XTRA_REACT:
		send_palette();
		return 0;

	case TERM_XTRA_DELAY:
		if (v > 0) {
			present();
			ra_sleep(v);
		}
		return 0;

	case TERM_XTRA_NOISE:
	case TERM_XTRA_FROSH:
	case TERM_XTRA_BORED:
	case TERM_XTRA_ALIVE:
	case TERM_XTRA_LEVEL:
		return 0;
	}
	return 1;
}

static errr Term_curs_web(int x, int y)
{
	cursor_x = x;
	cursor_y = y;
	return 0;
}

static errr Term_wipe_web(int x, int y, int n)
{
	for (int i = 0; i < n && x + i < cols; i++) {
		int at = y * cols + x + i;
		screen[at * 2] = ' ';
		screen[at * 2 + 1] = COLOUR_WHITE;
		tiles[at * 2] = tiles[at * 2 + 1] = 0;
	}
	return 0;
}

/* A character for the page: Latin-1 as is (Angband's text and font-gcu.prf
 * stay within it), a few typographic marks as ASCII, anything else '?'. */
static uint8_t cell_char(wchar_t c)
{
	if (c >= 0 && c < 256 && c != TILE_CELL)
		return (uint8_t)c;
	switch (c) {
	case 0x2018:
	case 0x2019:
		return '\'';
	case 0x201C:
	case 0x201D:
		return '"';
	case 0x2013:
	case 0x2014:
		return '-';
	}
	return '?';
}

static errr Term_text_web(int x, int y, int n, int a, const wchar_t *s)
{
	/* As main-gcu.c: the background set (a / MULT_BG) of solid walls fills
	 * the cell with the foreground colour. */
	bool solid = (a / MULT_BG) == BG_SAME;
	uint8_t colour = (uint8_t)((a % MULT_BG) % MAX_COLORS) | (solid ? 0x80 : 0);

	for (int i = 0; i < n && x + i < cols; i++) {
		int at = y * cols + x + i;
		screen[at * 2] = solid ? ' ' : cell_char(s[i]);
		screen[at * 2 + 1] = colour;
		tiles[at * 2] = tiles[at * 2 + 1] = 0;
	}
	return 0;
}

static uint16_t tile_code(int a, wchar_t c)
{
	if (!(a & 0x80) || !(c & 0x80))
		return 0;
	return (uint16_t)(0x8000 | ((a & 0x7F) << 7) | (c & 0x7F));
}

static errr Term_pict_web(int x, int y, int n, const int *ap, const wchar_t *cp, const int *tap,
		const wchar_t *tcp)
{
	for (int i = 0; i < n && x + i < cols; i++) {
		int at = y * cols + x + i;
		screen[at * 2] = TILE_CELL;
		screen[at * 2 + 1] = COLOUR_WHITE;
		tiles[at * 2] = tile_code(ap[i], cp[i]);
		tiles[at * 2 + 1] = tile_code(tap[i], tcp[i]);
	}
	return 0;
}

static void Term_init_web(term *t)
{
	(void)t;
	send_palette();
}

static void Term_nuke_web(term *t)
{
	(void)t;
}

const char help_web[] = "Rogue Archive (browser), subopts -w<cols> -h<rows> -g<graphics mode> -n (new characters name their savefiles)";

errr init_web(int argc, char **argv)
{
	term *t = &data.t;
	int graphics = GRAPHICS_NONE;

	/* Sub-options after "--": the window size the page has room for, and
	 * the graphics mode. */
	for (int i = 1; i < argc; i++) {
		if (strncmp(argv[i], "-w", 2) == 0)
			cols = atoi(argv[i] + 2);
		else if (strncmp(argv[i], "-h", 2) == 0)
			rows = atoi(argv[i] + 2);
		else if (strncmp(argv[i], "-g", 2) == 0)
			graphics = atoi(argv[i] + 2);
		else if (strcmp(argv[i], "-n") == 0) {
			/*
			 * main.c names the default savefile after the login (the
			 * browser has none). Without it, Angband's savefile menu
			 * (-c) starts new characters with no savefile, and they
			 * are saved under their own names (ui-birth.c).
			 */
			savefile[0] = '\0';
			arg_name[0] = '\0';
		}
	}
	if (cols < WEB_COLS_MIN)
		cols = WEB_COLS_MIN;
	if (cols > WEB_COLS_MAX)
		cols = WEB_COLS_MAX;
	if (rows < WEB_ROWS_MIN)
		rows = WEB_ROWS_MIN;
	if (rows > WEB_ROWS_MAX)
		rows = WEB_ROWS_MAX;

	/* Angband's graphics modes (lib/tiles/list.txt), as other front ends. */
	if (!init_graphics_modes())
		quit("Graphics list load failed");
	current_graphics_mode = get_graphics_mode((uint8_t)graphics);
	if (!current_graphics_mode)
		current_graphics_mode = get_graphics_mode(GRAPHICS_NONE);
	use_graphics = current_graphics_mode ? current_graphics_mode->grafID : GRAPHICS_NONE;
	tile_width = 1;
	tile_height = 1;

	term_init(t, cols, rows, 1024);
	/* The page draws the cursor itself (as the GCU port's "hard" cursor). */
	t->soft_cursor = false;
	/* Text and tiles: cells with tile coordinates go to pict_hook. */
	t->higher_pict = true;
	/* Keys arrive as Angband keycodes (KC_ENTER, ESCAPE, arrows...). */
	t->complex_input = true;
	t->init_hook = Term_init_web;
	t->nuke_hook = Term_nuke_web;
	t->xtra_hook = Term_xtra_web;
	t->curs_hook = Term_curs_web;
	t->bigcurs_hook = Term_curs_web;
	t->wipe_hook = Term_wipe_web;
	t->text_hook = Term_text_web;
	t->pict_hook = Term_pict_web;
	t->data = &data;
	Term_activate(t);
	angband_term[0] = t;
	return 0;
}
