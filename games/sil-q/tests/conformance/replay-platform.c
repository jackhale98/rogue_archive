/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * Conformance harness host for Sil-Q: the bridge port/main-web.c expects
 * (normally JavaScript in the worker), written in C, so the same display
 * module and game objects run natively and in WebAssembly (Node).
 *
 * - Keys come from RA_REPLAY_KEYS (comma-separated key codes), one each time
 *   the game waits for input, as a player typing.
 * - At every wait the screen (text, a hash of its colours, the cursor) and the
 *   state snapshot are printed to stdout; messages are printed as they arrive.
 *   When the keys run out the run ends.
 * - The clock and process id are fixed, so the game's random seed
 *   (dungeon.c: time(NULL) mutated by getpid()) is the same in both builds.
 *
 * - Natively, the account is hidden as the browser has none: Sil names a new
 *   character after the account name (Emscripten's getpwuid finds no user)
 *   and its savefile after the user id (Emscripten's getuid is 0).
 *
 * Not deployed.
 */
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

typedef unsigned char byte;

static int *keys = NULL;
static int key_count = 0;
static int key_next = 0;
static int armed = 0;
static int frame_count = 0;

static byte last_cells[160 * 64 * 2];
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

/* Savefiles are named "<uid>.<name>"; Emscripten's getuid is 0. */
uid_t getuid(void)
{
    return 0;
}
#endif

static void load_keys(void)
{
    if (keys)
        return;
    const char *spec = getenv("RA_REPLAY_KEYS");
    if (!spec)
        spec = "";
    keys = calloc(strlen(spec) + 1, sizeof(int));
    const char *p = spec;
    while (*p)
    {
        char *end;
        long code = strtol(p, &end, 10);
        if (end == p)
            break;
        keys[key_count++] = (int)code;
        p = *end == ',' ? end + 1 : end;
    }
}

void ra_present(const byte *cells, int cols, int rows, int cx, int cy, int cursor,
                const int *state, int stateLen)
{
    memcpy(last_cells, cells, (size_t)cols * rows * 2);
    last_cols = cols;
    last_rows = rows;
    last_cx = cx;
    last_cy = cy;
    last_cursor = cursor;
    last_state_len = stateLen < 64 ? stateLen : 64;
    memcpy(last_state, state, sizeof(int) * last_state_len);
}

static void dump_frame(void)
{
    unsigned int hash = 2166136261u;
    printf("== frame %d cursor %d,%d,%d state", frame_count++, last_cx, last_cy, last_cursor);
    for (int i = 0; i < last_state_len; i++)
        printf(" %d", last_state[i]);
    printf("\n");
    for (int y = 0; y < last_rows; y++)
    {
        char line[161];
        int end = 0;
        for (int x = 0; x < last_cols; x++)
        {
            byte ch = last_cells[(y * last_cols + x) * 2];
            line[x] = (ch >= 32 && ch < 127) ? (char)ch : '?';
            if (ch != ' ')
                end = x + 1;
            hash = (hash ^ last_cells[(y * last_cols + x) * 2 + 1]) * 16777619u;
        }
        line[end] = '\0';
        if (end)
            printf("%02d|%s\n", y, line);
    }
    printf("colours %08x\n", hash);
}

int ra_poll_key(void)
{
    load_keys();
    if (!armed || key_next >= key_count)
        return 0;
    armed = 0;
    return keys[key_next++];
}

void ra_wait_for_key(void)
{
    load_keys();
    dump_frame();
    if (key_next >= key_count)
    {
        printf("== end after %d keys\n", key_count);
        fflush(stdout);
        _exit(0);
    }
    armed = 1;
}

void ra_flush_keys(void)
{
    /* Keys are handed over one per wait, so there is never a queue to drop. */
}

void ra_sleep(int ms)
{
    (void)ms;
}

void ra_service(void)
{
}

void ra_palette(const byte *table, int count)
{
    (void)table;
    (void)count;
}

void ra_message(int repeat, const char *text, int color)
{
    printf("%s %d %s\n", repeat ? "msg-repeat" : "msg", color, text);
}
