/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * Conformance harness host for Angband: the bridge port/main-web.c expects
 * (normally JavaScript in the worker), written in C, so the same display
 * module and game objects run natively and in WebAssembly (Node).
 *
 * - Events come from RA_REPLAY_KEYS (comma-separated), one each time the
 *   game waits for input, as a player typing: a number is a key code (with
 *   modifiers << 21, as the worker encodes them), "m<x>.<y>.<button>" a mouse
 *   click on a screen cell.
 * - At every wait the screen (text, a hash of its colours and tiles, the
 *   cursor) and the state snapshot are printed to stdout; messages are printed
 *   as they arrive. When the events run out the run ends.
 * - The clock and process id are fixed, so the game's random seed
 *   (z-rand.c Rand_init: time(NULL) mutated by getpid()) is the same in both
 *   builds.
 * - Natively, the account is hidden as the browser has none (getpwuid), and
 *   the user id is 0, as the browser's is (getuid).
 * - RA_REPLAY_GRAPHICS: a graphics mode to switch to at the first wait after
 *   the first map is shown, as the page's Display setting does.
 *
 * Not deployed.
 */
#include <pwd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static int *events = NULL;
static int event_count = 0;
static int event_next = 0;
static int armed = 0;
static int frame_count = 0;
static int graphics_request = -2;

/* The game's random number generator (z-rand.c), compared at every wait. */
extern uint32_t state_i;
extern uint32_t STATE[32];
extern uint32_t Rand_value;

static unsigned int rng_hash(void)
{
	unsigned int hash = 2166136261u;
	hash = (hash ^ state_i) * 16777619u;
	hash = (hash ^ Rand_value) * 16777619u;
	for (int i = 0; i < 32; i++)
		hash = (hash ^ STATE[i]) * 16777619u;
	return hash;
}

static uint8_t last_cells[160 * 64 * 2];
static uint16_t last_tiles[160 * 64 * 2];
static int last_cols = 0, last_rows = 0, last_cx = 0, last_cy = 0, last_cursor = 0;
static int last_state[64];
static int last_state_len = 0;

time_t time(time_t *t)
{
	if (t)
		*t = 1000000000;
	return 1000000000;
}

pid_t getpid(void)
{
	return 4242;
}

#ifndef __EMSCRIPTEN__
struct passwd *getpwuid(uid_t uid)
{
	(void)uid;
	return NULL;
}

/* The browser's (Emscripten's) user id is 0, which savefiles and the save
 * screen record ("User 0"); natively the run must not depend on who runs it
 * (CI runs as uid 1001, a container often as root). */
uid_t getuid(void)
{
	return 0;
}

uid_t geteuid(void)
{
	return 0;
}
#endif

static void load_events(void)
{
	if (events)
		return;
	const char *spec = getenv("RA_REPLAY_KEYS");
	if (!spec)
		spec = "";
	events = calloc(strlen(spec) + 1, sizeof(int));
	const char *p = spec;
	while (*p) {
		char *end;
		if (*p == 'm') {
			long x = strtol(p + 1, &end, 10);
			long y = strtol(end + 1, &end, 10);
			long button = strtol(end + 1, &end, 10);
			events[event_count++] = -(int)(1 + x + y * 256 + button * 65536);
		} else {
			long code = strtol(p, &end, 10);
			if (end == p)
				break;
			events[event_count++] = (int)code;
		}
		p = *end == ',' ? end + 1 : end;
	}
	const char *graphics = getenv("RA_REPLAY_GRAPHICS");
	if (graphics && *graphics)
		graphics_request = atoi(graphics);
}

void ra_present(const uint8_t *cells, const uint16_t *tile_cells, int cols, int rows, int cx,
		int cy, int cursor, const int *state, int stateLen)
{
	memcpy(last_cells, cells, (size_t)cols * rows * 2);
	memcpy(last_tiles, tile_cells, (size_t)cols * rows * 2 * sizeof(uint16_t));
	last_cols = cols;
	last_rows = rows;
	last_cx = cx;
	last_cy = cy;
	last_cursor = cursor;
	last_state_len = stateLen < 64 ? stateLen : 64;
	memcpy(last_state, state, sizeof(int) * last_state_len);
	if (getenv("RA_REPLAY_TRACE"))
		printf("-- present rng %08x\n", rng_hash());
}

static void dump_frame(void)
{
	unsigned int hash = 2166136261u;
	printf("== frame %d cursor %d,%d,%d state", frame_count++, last_cx, last_cy, last_cursor);
	for (int i = 0; i < last_state_len; i++)
		printf(" %d", last_state[i]);
	printf("\n");
	for (int y = 0; y < last_rows; y++) {
		char line[161];
		int end = 0;
		for (int x = 0; x < last_cols; x++) {
			int at = y * last_cols + x;
			uint8_t ch = last_cells[at * 2];
			line[x] = (ch >= 32 && ch < 127) ? (char)ch : (ch == 0x7F ? '%' : '?');
			if (ch != ' ')
				end = x + 1;
			hash = (hash ^ last_cells[at * 2 + 1]) * 16777619u;
			hash = (hash ^ last_tiles[at * 2]) * 16777619u;
			hash = (hash ^ last_tiles[at * 2 + 1]) * 16777619u;
		}
		line[end] = '\0';
		if (end)
			printf("%02d|%s\n", y, line);
	}
	printf("colours %08x rng %08x\n", hash, rng_hash());
}

int ra_poll_event(void)
{
	load_events();
	if (!armed || event_next >= event_count)
		return 0;
	armed = 0;
	return events[event_next++];
}

void ra_wait_for_event(void)
{
	load_events();
	dump_frame();
	if (event_next >= event_count) {
		printf("== end after %d events\n", event_count);
		fflush(stdout);
		_exit(0);
	}
	armed = 1;
}

void ra_flush_events(void)
{
	/* Events are handed over one per wait, so there is never a queue to drop. */
}

void ra_sleep(int ms)
{
	(void)ms;
}

void ra_service(void)
{
}

int ra_graphics_request(void)
{
	load_events();
	/* After the first map: the snapshot's ST_IN_GAME (field 0). */
	if (graphics_request >= 0 && last_state_len > 0 && last_state[0] == 1) {
		int mode = graphics_request;
		graphics_request = -2;
		printf("== graphics %d\n", mode);
		return mode;
	}
	return -1;
}

void ra_palette(const uint8_t *table, int count)
{
	(void)table;
	(void)count;
}

void ra_message(int repeat, const char *text, int color)
{
	printf("%s %d %s\n", repeat ? "msg-repeat" : "msg", color, text);
}
