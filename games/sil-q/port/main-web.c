/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * Rogue Archive display module for Sil-Q (WebAssembly).
 *
 * Sil-Q, like Angband 3.0, separates the game from its display through the
 * "term" interface (z-term.h): a front end supplies hooks to draw text, wipe
 * cells, place the cursor, and handle "extra" requests (wait for a key, flush
 * input, refresh, delay). This file is such a front end, modelled on
 * upstream's template main-xxx.c. It keeps a copy of the screen and hands it
 * to the Web Worker on every refresh; keys come back from the worker.
 *
 * It is selected through upstream's main.c without modifying it: the build
 * defines USE_GCU and renames init_gcu/help_gcu to init_web/help_web, so the
 * "gcu" entry of main.c's module table starts this module (main-gcu.c itself
 * is not compiled).
 */
#include "angband.h"
#include "main.h"

#include <string.h>
#include <sys/types.h>
#include <unistd.h>

/* The main window; Sil needs at least 80x24. */
#define WEB_COLS_MIN 80
#define WEB_ROWS_MIN 24
#define WEB_COLS_MAX 160
#define WEB_ROWS_MAX 64

typedef struct term_data term_data;
struct term_data
{
    term t;
};

static term_data data;
static int cols = WEB_COLS_MIN;
static int rows = WEB_ROWS_MIN;
/* Two bytes per cell: character, attribute. */
static byte screen[WEB_COLS_MAX * WEB_ROWS_MAX * 2];
static int cursor_x = 0, cursor_y = 0;
static bool cursor_visible = FALSE;

/* Read-only state for the shell (status band, context). Field order is
 * mirrored in adapter/state.ts. */
enum
{
    ST_IN_DUNGEON,
    ST_HP,
    ST_MAX_HP,
    ST_VOICE,
    ST_MAX_VOICE,
    ST_DEPTH,
    ST_PLAYER_X,
    ST_PLAYER_Y,
    ST_MAP_X,
    ST_MAP_Y,
    ST_MSG_COUNT,
    ST_WAITING,
    ST_FIELDS
};
static int state[ST_FIELDS];
static bool waiting = FALSE;

/* ------------------------------------------------------------------------- */
/*
 * The host bridge. In the browser the worker installs these hooks on
 * `Module`; the conformance harness (RA_REPLAY) defines them in C instead
 * (tests/conformance/replay-platform.c), so the same module runs natively.
 */
#ifndef RA_REPLAY
#include <emscripten.h>

EM_JS(void, ra_present, (const byte *cells, int cols, int rows, int cx, int cy, int cursor,
                         const int *state, int stateLen), {
    Module.raPresent(HEAPU8.slice(cells, cells + cols * rows * 2), cols, rows, cx, cy, cursor,
                     HEAP32.slice(state >> 2, (state >> 2) + stateLen));
});

/* Next key code, or 0 if none is queued. */
EM_JS(int, ra_poll_key, (void), { return Module.raPollKey(); });

/* Resolves when a key arrives (or a host request needs servicing). */
EM_ASYNC_JS(void, ra_wait_for_key, (void), { await Module.raWaitForKey(); });

EM_JS(void, ra_flush_keys, (void), { Module.raFlushKeys(); });

EM_ASYNC_JS(void, ra_sleep, (int ms), { await Module.raSleep(ms); });

/* Persists the save directory if the host asked; called while waiting for input. */
EM_ASYNC_JS(void, ra_service, (void), { await Module.raService(); });

EM_JS(void, ra_palette, (const byte *table, int count), {
    Module.raPalette(HEAPU8.slice(table, table + count * 4));
});

/* A new message, or (repeat) a new text for the newest one. */
EM_JS(void, ra_message, (int repeat, const char *text, int color), {
    Module.raMessage(repeat !== 0, UTF8ToString(text), color);
});
#else
void ra_present(const byte *cells, int cols, int rows, int cx, int cy, int cursor,
                const int *state, int stateLen);
int ra_poll_key(void);
void ra_wait_for_key(void);
void ra_flush_keys(void);
void ra_sleep(int ms);
void ra_service(void);
void ra_palette(const byte *table, int count);
void ra_message(int repeat, const char *text, int color);
#endif

/* ------------------------------------------------------------------------- */

/* Length of a message without the " <Nx>" Sil appends to repeats. */
static size_t message_base_len(cptr text)
{
    size_t len = strlen(text);
    cptr mark = strrchr(text, '<');
    if (mark && mark > text && mark[-1] == ' ' && len >= 2 && text[len - 1] == '>' && text[len - 2] == 'x')
        return (size_t)(mark - 1 - text);
    return len;
}

static bool same_message(cptr a, cptr b)
{
    size_t len = message_base_len(a);
    return len == message_base_len(b) && strncmp(a, b, len) == 0;
}

/*
 * Sends messages added since the last refresh (Sil keeps up to MESSAGE_MAX).
 * A message repeating the newest one is merged by Sil ("... <2x>"); it is
 * sent as a replacement for the newest entry.
 */
static void send_messages(void)
{
    static s16b last_count = 0;
    static char last_newest[1024] = "";
    s16b count = message_num();
    int fresh = 0;

    if (count > last_count)
    {
        fresh = count - last_count;
    }
    else if (count > 0 && strcmp(message_str(0), last_newest) != 0)
    {
        if (same_message(message_str(0), last_newest))
        {
            ra_message(1, message_str(0), message_color(0));
        }
        else
        {
            /* The ring is full (count stays at its maximum): find the newest
             * message we already sent. */
            int age;
            for (age = 0; age < count && age < 64; age++)
                if (same_message(message_str(age), last_newest))
                    break;
            fresh = age;
        }
    }
    if (count > 0)
        my_strcpy(last_newest, message_str(0), sizeof(last_newest));
    last_count = count;
    if (fresh > 64)
        fresh = 64;
    for (int age = fresh - 1; age >= 0; age--)
        ra_message(0, message_str(age), message_color(age));
}

static void present(void)
{
    /* character_dungeon stays set at the title menu after a game ends. */
    state[ST_IN_DUNGEON] = (character_dungeon && p_ptr->playing) ? 1 : 0;
    state[ST_HP] = p_ptr->chp;
    state[ST_MAX_HP] = p_ptr->mhp;
    state[ST_VOICE] = p_ptr->csp;
    state[ST_MAX_VOICE] = p_ptr->msp;
    state[ST_DEPTH] = p_ptr->depth;
    state[ST_PLAYER_X] = p_ptr->px;
    state[ST_PLAYER_Y] = p_ptr->py;
    state[ST_MAP_X] = p_ptr->wx;
    state[ST_MAP_Y] = p_ptr->wy;
    state[ST_MSG_COUNT] = message_num();
    state[ST_WAITING] = waiting ? 1 : 0;
    if (character_generated)
        send_messages();
    ra_present(screen, cols, rows, cursor_x, cursor_y, cursor_visible ? 1 : 0, state, ST_FIELDS);
}

static void send_palette(void)
{
    ra_palette(&angband_color_table[0][0], 256);
}

/* Moves queued keys into the term's key queue. */
static bool take_keys(void)
{
    bool any = FALSE;
    int key;
    while ((key = ra_poll_key()) != 0)
    {
        Term_keypress(key);
        any = TRUE;
    }
    return any;
}

static errr Term_xtra_web(int n, int v)
{
    switch (n)
    {
    case TERM_XTRA_EVENT:
        if (take_keys())
            return 0;
        if (!v)
            return 0;
        /* Block until a key arrives, showing the latest screen first. */
        waiting = TRUE;
        present();
        do
        {
            ra_service();
            ra_wait_for_key();
        } while (!take_keys());
        waiting = FALSE;
        return 0;

    case TERM_XTRA_FLUSH:
        ra_flush_keys();
        return 0;

    case TERM_XTRA_CLEAR:
        for (int i = 0; i < cols * rows; i++)
        {
            screen[i * 2] = ' ';
            screen[i * 2 + 1] = TERM_WHITE;
        }
        return 0;

    case TERM_XTRA_SHAPE:
        cursor_visible = v ? TRUE : FALSE;
        return 0;

    case TERM_XTRA_FRESH:
        present();
        return 0;

    case TERM_XTRA_REACT:
        send_palette();
        return 0;

    case TERM_XTRA_DELAY:
        if (v > 0)
        {
            present();
            ra_sleep(v);
        }
        return 0;

    case TERM_XTRA_NOISE:
    case TERM_XTRA_SOUND:
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
    for (int i = 0; i < n && x + i < cols; i++)
    {
        int at = (y * cols + x + i) * 2;
        screen[at] = ' ';
        screen[at + 1] = TERM_WHITE;
    }
    return 0;
}

static errr Term_text_web(int x, int y, int n, byte a, cptr cp)
{
    for (int i = 0; i < n && x + i < cols; i++)
    {
        int at = (y * cols + x + i) * 2;
        screen[at] = (byte)cp[i];
        screen[at + 1] = a;
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

/*
 * Sil's Unix build drops setuid/setgid privileges at startup (files.c
 * safe_setuid_drop) and quits if that fails. In the browser there are no
 * privileges to drop, but Emscripten's C library reports these calls as
 * failing; these definitions take precedence when linking and succeed.
 */
int setregid(gid_t rgid, gid_t egid)
{
    (void)rgid;
    (void)egid;
    return 0;
}

int setegid(gid_t gid)
{
    (void)gid;
    return 0;
}

int setgid(gid_t gid)
{
    (void)gid;
    return 0;
}

int setreuid(uid_t ruid, uid_t euid)
{
    (void)ruid;
    (void)euid;
    return 0;
}

const char help_web[] = "Rogue Archive (browser), subopts -w<cols> -h<rows>";

errr init_web(int argc, char **argv)
{
    term *t = &data.t;

    /* Sub-options after "--": the window size the page has room for. */
    for (int i = 1; i < argc; i++)
    {
        if (strncmp(argv[i], "-w", 2) == 0)
            cols = atoi(argv[i] + 2);
        else if (strncmp(argv[i], "-h", 2) == 0)
            rows = atoi(argv[i] + 2);
    }
    if (cols < WEB_COLS_MIN)
        cols = WEB_COLS_MIN;
    if (cols > WEB_COLS_MAX)
        cols = WEB_COLS_MAX;
    if (rows < WEB_ROWS_MIN)
        rows = WEB_ROWS_MIN;
    if (rows > WEB_ROWS_MAX)
        rows = WEB_ROWS_MAX;

    term_init(t, cols, rows, 256);
    /* The page draws the cursor itself (as the GCU port's "hard" cursor). */
    t->soft_cursor = FALSE;
    t->attr_blank = TERM_WHITE;
    t->char_blank = ' ';
    t->init_hook = Term_init_web;
    t->nuke_hook = Term_nuke_web;
    t->xtra_hook = Term_xtra_web;
    t->curs_hook = Term_curs_web;
    t->wipe_hook = Term_wipe_web;
    t->text_hook = Term_text_web;
    t->data = &data;
    Term_activate(t);
    angband_term[0] = t;
    return 0;
}
