/* SPDX-License-Identifier: BSD-3-Clause */
/*
 * Conformance harness host for Rogue: the bridge port/curses-web.c expects
 * (normally JavaScript in the worker), written in C, so the same game and
 * curses code run natively and in WebAssembly (Node).
 *
 * - Keys come from RA_REPLAY_KEYS (comma-separated key codes), one each time
 *   the game waits for input, as a player typing.
 * - At every wait the screen (text, standout cells, the cursor) and the state
 *   snapshot are printed to stdout. When the keys run out the run ends.
 * - The clock and process id are fixed, so the dungeon seed (main.c:
 *   time + getpid) is the same in both builds.
 *
 * Not deployed.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

static int *keys = NULL;
static int key_count = 0;
static int key_next = 0;
static int armed = 0;
static int frame_count = 0;

static unsigned char last_cells[80 * 24 * 2];
static int last_cols = 0, last_rows = 0, last_cx = 0, last_cy = 0, last_cursor = 0;
static int last_state[16];
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

void ra_present(const unsigned char *cells, int cols, int rows, int cx, int cy, int cursor,
                const int *state, int stateLen)
{
    memcpy(last_cells, cells, (size_t)cols * rows * 2);
    last_cols = cols;
    last_rows = rows;
    last_cx = cx;
    last_cy = cy;
    last_cursor = cursor;
    last_state_len = stateLen < 16 ? stateLen : 16;
    memcpy(last_state, state, sizeof(int) * last_state_len);
}

static void dump_frame(void)
{
    printf("== frame %d cursor %d,%d,%d state", frame_count++, last_cx, last_cy, last_cursor);
    for (int i = 0; i < last_state_len; i++)
        printf(" %d", last_state[i]);
    printf("\n");
    for (int y = 0; y < last_rows; y++)
    {
        char line[81], marks[81];
        int end = 0, marked = 0;
        for (int x = 0; x < last_cols; x++)
        {
            unsigned char ch = last_cells[(y * last_cols + x) * 2];
            line[x] = (ch >= 32 && ch < 127) ? (char)ch : '?';
            marks[x] = last_cells[(y * last_cols + x) * 2 + 1] ? '^' : ' ';
            if (ch != ' ')
                end = x + 1;
            if (marks[x] != ' ')
                marked = x + 1;
        }
        line[end] = '\0';
        marks[marked] = '\0';
        if (end)
            printf("%02d|%s\n", y, line);
        if (marked)
            printf("%02d^%s\n", y, marks);
    }
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

void ra_service(void)
{
}

void ra_sleep(int ms)
{
    (void)ms;
}
