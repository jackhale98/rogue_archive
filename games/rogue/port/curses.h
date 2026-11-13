/* SPDX-License-Identifier: BSD-3-Clause */
/*
 * A small curses for Rogue in the browser (Rogue Archive).
 *
 * Rogue draws everything through curses and also uses a curses window as a
 * data structure (the monster map). This implements the part of the curses
 * API Rogue 5.4.4 uses, over in-memory windows. A refresh copies a window to
 * the "physical" screen and hands that screen to the host (the Web Worker,
 * or the conformance harness); reading a key blocks until the host has one.
 * See port/curses-web.c.
 */
#ifndef RA_CURSES_H
#define RA_CURSES_H

#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>

#ifndef TRUE
#define TRUE 1
#endif
#ifndef FALSE
#define FALSE 0
#endif
#define OK 0
#define ERR (-1)

typedef unsigned int chtype;

#define A_CHARTEXT 0x000000ffu
#define A_ATTRIBUTES 0xffffff00u
#define A_NORMAL 0u
#define A_STANDOUT 0x00010000u
#define A_REVERSE A_STANDOUT

typedef struct _ra_window
{
    int _maxy, _maxx;   /* size */
    int _begy, _begx;   /* position on the screen */
    int _cury, _curx;   /* cursor */
    chtype attrs;     /* current attribute (standout) */
    chtype *cells;
    bool clear;       /* clearok */
    bool leave;       /* leaveok */
    bool keypad;
} WINDOW;

extern WINDOW *stdscr;
extern WINDOW *curscr;
extern int LINES;
extern int COLS;
extern int ESCDELAY;

/* Terminal capability Rogue checks (mdport.c md_hasclreol): the screen can
 * clear to the end of a line. */
extern const char *ra_clr_eol;
#define clr_eol ra_clr_eol

/* Keys (values as ncurses defines them). */
#define KEY_DOWN 0402
#define KEY_UP 0403
#define KEY_LEFT 0404
#define KEY_RIGHT 0405
#define KEY_HOME 0406
#define KEY_BACKSPACE 0407
#define KEY_NPAGE 0522
#define KEY_PPAGE 0523
#define KEY_END 0550
#define KEY_A1 0534
#define KEY_A3 0535
#define KEY_B2 0536
#define KEY_C1 0537
#define KEY_C3 0540

WINDOW *initscr(void);
int endwin(void);
bool isendwin(void);
WINDOW *newwin(int lines, int cols, int y, int x);
WINDOW *subwin(WINDOW *orig, int lines, int cols, int y, int x);
int delwin(WINDOW *win);
int mvwin(WINDOW *win, int y, int x);

int wmove(WINDOW *win, int y, int x);
int waddch(WINDOW *win, chtype ch);
int waddstr(WINDOW *win, const char *str);
int waddnstr(WINDOW *win, const char *str, int n);
int wprintw(WINDOW *win, const char *fmt, ...);
int mvwprintw(WINDOW *win, int y, int x, const char *fmt, ...);
int printw(const char *fmt, ...);
int mvprintw(int y, int x, const char *fmt, ...);
int vw_printw(WINDOW *win, const char *fmt, va_list args);
int wclear(WINDOW *win);
int werase(WINDOW *win);
int wclrtoeol(WINDOW *win);
int wclrtobot(WINDOW *win);
int wrefresh(WINDOW *win);
int wnoutrefresh(WINDOW *win);
int doupdate(void);
int touchwin(WINDOW *win);
chtype winch(WINDOW *win);
int wgetch(WINDOW *win);
int wstandout(WINDOW *win);
int wstandend(WINDOW *win);
int wattron(WINDOW *win, int attrs);
int wattroff(WINDOW *win, int attrs);
int overwrite(const WINDOW *src, WINDOW *dst);
int overlay(const WINDOW *src, WINDOW *dst);

int clearok(WINDOW *win, bool flag);
int leaveok(WINDOW *win, bool flag);
int idlok(WINDOW *win, bool flag);
int scrollok(WINDOW *win, bool flag);
int keypad(WINDOW *win, bool flag);
int nodelay(WINDOW *win, bool flag);
int meta(WINDOW *win, bool flag);

int raw(void);
int noraw(void);
int cbreak(void);
int nocbreak(void);
int echo(void);
int noecho(void);
int nl(void);
int nonl(void);
int halfdelay(int tenths);
int typeahead(int fd);
int flushinp(void);
int beep(void);
int flash(void);
int baudrate(void);
int mvcur(int oldrow, int oldcol, int newrow, int newcol);
int curs_set(int visibility);
char erasechar(void);
char killchar(void);
const char *unctrl(chtype ch);
int savetty(void);
int resetty(void);
int def_prog_mode(void);
int reset_prog_mode(void);

int wgetnstr(WINDOW *win, char *str, int n);
/* conio's unechoed read, used by mdport.c's md_getpass() (wizard mode only). */
int _getch(void);

#define getmaxy(win) ((win)->_maxy)
#define getmaxx(win) ((win)->_maxx)
#define getbegy(win) ((win)->_begy)
#define getbegx(win) ((win)->_begx)
#define getcury(win) ((win)->_cury)
#define getcurx(win) ((win)->_curx)
#define getyx(win, y, x) ((y) = (win)->_cury, (x) = (win)->_curx)
#define getbegyx(win, y, x) ((y) = (win)->_begy, (x) = (win)->_begx)
#define getmaxyx(win, y, x) ((y) = (win)->_maxy, (x) = (win)->_maxx)

#define move(y, x) wmove(stdscr, (y), (x))
#define addch(ch) waddch(stdscr, (ch))
#define addstr(str) waddstr(stdscr, (str))
#define addnstr(str, n) waddnstr(stdscr, (str), (n))
#define clear() wclear(stdscr)
#define erase() werase(stdscr)
#define clrtoeol() wclrtoeol(stdscr)
#define clrtobot() wclrtobot(stdscr)
#define refresh() wrefresh(stdscr)
#define inch() winch(stdscr)
#define getch() wgetch(stdscr)
#define standout() wstandout(stdscr)
#define standend() wstandend(stdscr)
#define attron(a) wattron(stdscr, (a))
#define attroff(a) wattroff(stdscr, (a))

#define mvwaddch(win, y, x, ch) (wmove((win), (y), (x)) == ERR ? ERR : waddch((win), (ch)))
#define mvwaddstr(win, y, x, str) (wmove((win), (y), (x)) == ERR ? ERR : waddstr((win), (str)))
#define mvwinch(win, y, x) (wmove((win), (y), (x)) == ERR ? (chtype)ERR : winch(win))
#define mvwgetch(win, y, x) (wmove((win), (y), (x)) == ERR ? ERR : wgetch(win))
#define mvaddch(y, x, ch) mvwaddch(stdscr, (y), (x), (ch))
#define mvaddstr(y, x, str) mvwaddstr(stdscr, (y), (x), (str))
#define mvinch(y, x) mvwinch(stdscr, (y), (x))
#define mvgetch(y, x) mvwgetch(stdscr, (y), (x))

#endif
