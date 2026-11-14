/* SPDX-License-Identifier: BSD-3-Clause */
/*
 * A small curses for Rogue in the browser (Rogue Archive); see curses.h.
 *
 * Windows are in-memory cell arrays (character | attribute). wrefresh()
 * copies a window to the physical screen (curscr) and presents it to the
 * host; wgetch() presents the screen and waits for the host's next key.
 *
 * The host bridge (ra_*) is JavaScript in the browser (the worker installs
 * the hooks on Module) and C in the conformance harness (RA_REPLAY;
 * tests/conformance/replay-platform.c), so the same code runs natively.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "curses.h"
#include "rogue.h"

/* The screen: Rogue needs (and plays on) 80x24. */
#define RA_LINES 24
#define RA_COLS 80

WINDOW *stdscr = NULL;
WINDOW *curscr = NULL;
int LINES = RA_LINES;
int COLS = RA_COLS;
int ESCDELAY = 0;
const char *ra_clr_eol = "\033[K";

static bool ended = TRUE;
static bool half_delay = FALSE;
static bool no_delay = FALSE;
/* The window whose cursor the player sees (the last one refreshed). */
static WINDOW *focus = NULL;

/* Read-only state for the shell, sent with each frame. */
enum
{
    ST_IN_GAME,
    ST_HP,
    ST_MAX_HP,
    ST_LEVEL,
    ST_HERO_X,
    ST_HERO_Y,
    ST_GOLD,
    ST_WAITING,
    /* 1 when the window last shown is not stdscr: a list, help or a
       detection overlay (show_win), not the message line. */
    ST_OVERLAY,
    /* 1 when the hero stands on the stairs. */
    ST_ON_STAIRS,
    /* 1 once the hero carries the Amulet of Yendor. */
    ST_AMULET,
    /* hungry_state: 0 not hungry, 1 Hungry, 2 Weak, 3 Faint. */
    ST_HUNGER,
    /* The type (its symbol) of an object lying where the hero stands, else 0. */
    ST_UNDER,
    /* 1 while armour is worn. */
    ST_ARMOR,
    /* 1 while hallucinating: the screen's monster and object symbols are random. */
    ST_HALLUCINATING,
    ST_FIELDS
};
static int state[ST_FIELDS];
static bool waiting = FALSE;
static unsigned char frame[RA_LINES * RA_COLS * 2];

/* ------------------------------------------------------------------------- */
/* Host bridge */

#ifndef RA_REPLAY
#include <emscripten.h>

EM_JS(void, ra_present, (const unsigned char *cells, int cols, int rows, int cx, int cy, int cursor,
                         const int *st, int stLen), {
    Module.raPresent(HEAPU8.slice(cells, cells + cols * rows * 2), cols, rows, cx, cy, cursor,
                     HEAP32.slice(st >> 2, (st >> 2) + stLen));
});

/* Next key code, or 0 if none is queued. */
EM_JS(int, ra_poll_key, (void), { return Module.raPollKey(); });

/* Resolves when a key arrives (or a host request needs servicing). */
EM_ASYNC_JS(void, ra_wait_for_key, (void), { await Module.raWaitForKey(); });

/* Persists the save directory if the host asked; called while waiting for input. */
EM_ASYNC_JS(void, ra_service, (void), { await Module.raService(); });

EM_ASYNC_JS(void, ra_sleep, (int ms), { await Module.raSleep(ms); });
#else
void ra_present(const unsigned char *cells, int cols, int rows, int cx, int cy, int cursor,
                const int *st, int stLen);
int ra_poll_key(void);
void ra_wait_for_key(void);
void ra_service(void);
void ra_sleep(int ms);
#endif

/* The type of an object on the floor under the hero (read only, as the
   pick-up command looks for it in command.c), else 0. */
static int object_under_hero(void)
{
    for (THING *obj = lvl_obj; obj != NULL; obj = next(obj))
        if (obj->o_pos.y == hero.y && obj->o_pos.x == hero.x)
            return obj->o_type;
    return 0;
}

static void present(void)
{
    WINDOW *scr = curscr;
    for (int i = 0; i < RA_LINES * RA_COLS; i++)
    {
        chtype c = scr->cells[i];
        frame[i * 2] = (unsigned char)(c & A_CHARTEXT);
        frame[i * 2 + 1] = (c & A_STANDOUT) ? 1 : 0;
    }
    state[ST_IN_GAME] = playing ? 1 : 0;
    state[ST_HP] = pstats.s_hpt;
    state[ST_MAX_HP] = max_hp;
    state[ST_LEVEL] = level;
    state[ST_HERO_X] = hero.x;
    state[ST_HERO_Y] = hero.y;
    state[ST_GOLD] = purse;
    state[ST_WAITING] = waiting ? 1 : 0;
    state[ST_OVERLAY] = (focus && focus != stdscr) ? 1 : 0;
    state[ST_ON_STAIRS] = playing && ce(hero, stairs) ? 1 : 0;
    state[ST_AMULET] = playing && amulet ? 1 : 0;
    state[ST_HUNGER] = playing ? hungry_state : 0;
    state[ST_UNDER] = playing ? object_under_hero() : 0;
    state[ST_ARMOR] = playing && cur_armor != NULL ? 1 : 0;
    state[ST_HALLUCINATING] = playing && on(player, ISHALU) ? 1 : 0;
    WINDOW *w = focus ? focus : stdscr;
    int cx = w ? w->_begx + w->_curx : 0;
    int cy = w ? w->_begy + w->_cury : 0;
    ra_present(frame, RA_COLS, RA_LINES, cx, cy, (w && !w->leave) ? 1 : 0, state, ST_FIELDS);
}

/* ------------------------------------------------------------------------- */
/* Windows */

static WINDOW *alloc_window(int lines, int cols, int y, int x)
{
    if (lines <= 0)
        lines = RA_LINES - y;
    if (cols <= 0)
        cols = RA_COLS - x;
    WINDOW *win = calloc(1, sizeof(WINDOW));
    if (!win)
        return NULL;
    win->_maxy = lines;
    win->_maxx = cols;
    win->_begy = y;
    win->_begx = x;
    win->cells = malloc(sizeof(chtype) * (size_t)lines * (size_t)cols);
    if (!win->cells)
    {
        free(win);
        return NULL;
    }
    for (int i = 0; i < lines * cols; i++)
        win->cells[i] = ' ';
    return win;
}

WINDOW *initscr(void)
{
    if (!stdscr)
    {
        stdscr = alloc_window(RA_LINES, RA_COLS, 0, 0);
        curscr = alloc_window(RA_LINES, RA_COLS, 0, 0);
    }
    ended = FALSE;
    return stdscr;
}

int endwin(void)
{
    ended = TRUE;
    return OK;
}

bool isendwin(void)
{
    return ended;
}

WINDOW *newwin(int lines, int cols, int y, int x)
{
    return alloc_window(lines, cols, y, x);
}

WINDOW *subwin(WINDOW *orig, int lines, int cols, int y, int x)
{
    (void)orig;
    return alloc_window(lines, cols, y, x);
}

int delwin(WINDOW *win)
{
    if (!win || win == stdscr || win == curscr)
        return ERR;
    if (focus == win)
        focus = NULL;
    free(win->cells);
    free(win);
    return OK;
}

int mvwin(WINDOW *win, int y, int x)
{
    if (!win)
        return ERR;
    win->_begy = y;
    win->_begx = x;
    return OK;
}

int wmove(WINDOW *win, int y, int x)
{
    if (!win || y < 0 || x < 0 || y >= win->_maxy || x >= win->_maxx)
        return ERR;
    win->_cury = y;
    win->_curx = x;
    return OK;
}

static void newline(WINDOW *win)
{
    win->_curx = 0;
    if (win->_cury < win->_maxy - 1)
        win->_cury++;
}

int waddch(WINDOW *win, chtype ch)
{
    if (!win)
        return ERR;
    unsigned char c = (unsigned char)(ch & A_CHARTEXT);
    if (c == '\n')
    {
        wclrtoeol(win);
        newline(win);
        return OK;
    }
    if (c == '\r')
    {
        win->_curx = 0;
        return OK;
    }
    if (c == '\b')
    {
        if (win->_curx > 0)
            win->_curx--;
        return OK;
    }
    if (c == '\t')
    {
        int next = (win->_curx / 8 + 1) * 8;
        while (win->_curx < next && win->_curx < win->_maxx - 1)
            waddch(win, ' ');
        return OK;
    }
    win->cells[win->_cury * win->_maxx + win->_curx] = c | ((ch & A_ATTRIBUTES) | win->attrs);
    if (win->_curx < win->_maxx - 1)
        win->_curx++;
    else
        newline(win);
    return OK;
}

int waddnstr(WINDOW *win, const char *str, int n)
{
    if (!win || !str)
        return ERR;
    for (int i = 0; str[i] && (n < 0 || i < n); i++)
        waddch(win, (unsigned char)str[i]);
    return OK;
}

int waddstr(WINDOW *win, const char *str)
{
    return waddnstr(win, str, -1);
}

int vw_printw(WINDOW *win, const char *fmt, va_list args)
{
    char buf[1024];
    vsnprintf(buf, sizeof buf, fmt, args);
    return waddstr(win, buf);
}

int wprintw(WINDOW *win, const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    int r = vw_printw(win, fmt, args);
    va_end(args);
    return r;
}

int mvwprintw(WINDOW *win, int y, int x, const char *fmt, ...)
{
    if (wmove(win, y, x) == ERR)
        return ERR;
    va_list args;
    va_start(args, fmt);
    int r = vw_printw(win, fmt, args);
    va_end(args);
    return r;
}

int printw(const char *fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    int r = vw_printw(stdscr, fmt, args);
    va_end(args);
    return r;
}

int mvprintw(int y, int x, const char *fmt, ...)
{
    if (wmove(stdscr, y, x) == ERR)
        return ERR;
    va_list args;
    va_start(args, fmt);
    int r = vw_printw(stdscr, fmt, args);
    va_end(args);
    return r;
}

int werase(WINDOW *win)
{
    if (!win)
        return ERR;
    for (int i = 0; i < win->_maxy * win->_maxx; i++)
        win->cells[i] = ' ';
    win->_cury = win->_curx = 0;
    return OK;
}

int wclear(WINDOW *win)
{
    werase(win);
    if (win)
        win->clear = TRUE;
    return OK;
}

int wclrtoeol(WINDOW *win)
{
    if (!win)
        return ERR;
    for (int x = win->_curx; x < win->_maxx; x++)
        win->cells[win->_cury * win->_maxx + x] = ' ';
    return OK;
}

int wclrtobot(WINDOW *win)
{
    if (!win)
        return ERR;
    wclrtoeol(win);
    for (int i = (win->_cury + 1) * win->_maxx; i < win->_maxy * win->_maxx; i++)
        win->cells[i] = ' ';
    return OK;
}

/* Copies a window onto the physical screen. */
static void copy_to_screen(WINDOW *win)
{
    for (int y = 0; y < win->_maxy; y++)
    {
        int sy = win->_begy + y;
        if (sy < 0 || sy >= RA_LINES)
            continue;
        for (int x = 0; x < win->_maxx; x++)
        {
            int sx = win->_begx + x;
            if (sx < 0 || sx >= RA_COLS)
                continue;
            curscr->cells[sy * RA_COLS + sx] = win->cells[y * win->_maxx + x];
        }
    }
}

int wnoutrefresh(WINDOW *win)
{
    if (!win || !curscr)
        return ERR;
    if (win != curscr)
    {
        copy_to_screen(win);
        focus = win;
    }
    win->clear = FALSE;
    return OK;
}

int doupdate(void)
{
    present();
    return OK;
}

int wrefresh(WINDOW *win)
{
    if (wnoutrefresh(win) == ERR)
        return ERR;
    return doupdate();
}

int touchwin(WINDOW *win)
{
    (void)win;
    return OK;
}

chtype winch(WINDOW *win)
{
    if (!win)
        return (chtype)ERR;
    return win->cells[win->_cury * win->_maxx + win->_curx];
}

int wstandout(WINDOW *win)
{
    if (win)
        win->attrs = A_STANDOUT;
    return OK;
}

int wstandend(WINDOW *win)
{
    if (win)
        win->attrs = A_NORMAL;
    return OK;
}

int wattron(WINDOW *win, int attrs)
{
    if (win)
        win->attrs |= (chtype)attrs;
    return OK;
}

int wattroff(WINDOW *win, int attrs)
{
    if (win)
        win->attrs &= ~(chtype)attrs;
    return OK;
}

static int copy_window(const WINDOW *src, WINDOW *dst, bool skip_blanks)
{
    if (!src || !dst)
        return ERR;
    for (int y = 0; y < dst->_maxy; y++)
    {
        int sy = dst->_begy + y - src->_begy;
        if (sy < 0 || sy >= src->_maxy)
            continue;
        for (int x = 0; x < dst->_maxx; x++)
        {
            int sx = dst->_begx + x - src->_begx;
            if (sx < 0 || sx >= src->_maxx)
                continue;
            chtype c = src->cells[sy * src->_maxx + sx];
            if (skip_blanks && (c & A_CHARTEXT) == ' ')
                continue;
            dst->cells[y * dst->_maxx + x] = c;
        }
    }
    return OK;
}

int overwrite(const WINDOW *src, WINDOW *dst)
{
    return copy_window(src, dst, FALSE);
}

int overlay(const WINDOW *src, WINDOW *dst)
{
    return copy_window(src, dst, TRUE);
}

int clearok(WINDOW *win, bool flag)
{
    if (win)
        win->clear = flag;
    return OK;
}

int leaveok(WINDOW *win, bool flag)
{
    if (win)
        win->leave = flag;
    return OK;
}

int idlok(WINDOW *win, bool flag)
{
    (void)win;
    (void)flag;
    return OK;
}

int scrollok(WINDOW *win, bool flag)
{
    (void)win;
    (void)flag;
    return OK;
}

int keypad(WINDOW *win, bool flag)
{
    if (win)
        win->keypad = flag;
    return OK;
}

int nodelay(WINDOW *win, bool flag)
{
    (void)win;
    no_delay = flag;
    return OK;
}

int meta(WINDOW *win, bool flag)
{
    (void)win;
    (void)flag;
    return OK;
}

/* ------------------------------------------------------------------------- */
/* Input */

/*
 * Keys arrive already decoded (curses KEY_* codes for arrows and the like),
 * so there are never escape sequences to wait for: after ESC, Rogue's
 * md_readchar() switches to halfdelay to see whether a sequence follows, and
 * gets ERR at once, which it reads as a plain ESC.
 */
int wgetch(WINDOW *win)
{
    (void)win;
    int key = ra_poll_key();
    if (key)
        return key;
    if (half_delay || no_delay)
        return ERR;
    waiting = TRUE;
    present();
    do
    {
        ra_service();
        ra_wait_for_key();
        key = ra_poll_key();
    } while (!key);
    waiting = FALSE;
    return key;
}

/* Reads a line (Enter ends it; Backspace edits), echoing it. */
int wgetnstr(WINDOW *win, char *str, int n)
{
    int len = 0;
    for (;;)
    {
        int c = wgetch(win);
        if (c == '\n' || c == '\r')
            break;
        if ((c == '\b' || c == 127 || c == KEY_BACKSPACE) && len > 0)
        {
            len--;
            waddstr(win, "\b \b");
            wrefresh(win);
            continue;
        }
        if (c >= 32 && c < 127 && len < n - 1 && len < 255)
        {
            str[len++] = (char)c;
            waddch(win, (chtype)c);
            wrefresh(win);
        }
    }
    str[len] = '\0';
    return OK;
}

int _getch(void)
{
    return wgetch(stdscr);
}

int flushinp(void)
{
    while (ra_poll_key())
        ;
    return OK;
}

int raw(void) { return OK; }
int noraw(void) { return OK; }
int cbreak(void)
{
    half_delay = FALSE;
    return OK;
}
int nocbreak(void)
{
    half_delay = FALSE;
    return OK;
}
int echo(void) { return OK; }
int noecho(void) { return OK; }
int nl(void) { return OK; }
int nonl(void) { return OK; }
int halfdelay(int tenths)
{
    (void)tenths;
    half_delay = TRUE;
    return OK;
}
int typeahead(int fd)
{
    (void)fd;
    return OK;
}
int beep(void) { return OK; }
int flash(void) { return OK; }
int baudrate(void) { return 38400; }
int mvcur(int oldrow, int oldcol, int newrow, int newcol)
{
    (void)oldrow;
    (void)oldcol;
    (void)newrow;
    (void)newcol;
    return OK;
}
int curs_set(int visibility)
{
    (void)visibility;
    return OK;
}
char erasechar(void) { return '\b'; }
char killchar(void) { return 0x15; /* Ctrl+U */ }
int savetty(void) { return OK; }
int resetty(void) { return OK; }
int def_prog_mode(void) { return OK; }
int reset_prog_mode(void) { return OK; }

const char *unctrl(chtype ch)
{
    static char buf[3];
    unsigned char c = (unsigned char)(ch & A_CHARTEXT);
    if (c < 32)
    {
        buf[0] = '^';
        buf[1] = (char)(c + '@');
        buf[2] = '\0';
    }
    else if (c == 127)
    {
        buf[0] = '^';
        buf[1] = '?';
        buf[2] = '\0';
    }
    else
    {
        buf[0] = (char)c;
        buf[1] = '\0';
    }
    return buf;
}

/* Rogue sleeps briefly in a few places (e.g. after death); let the page draw. */
unsigned int sleep(unsigned int seconds)
{
    present();
    ra_sleep((int)seconds * 1000);
    return 0;
}
