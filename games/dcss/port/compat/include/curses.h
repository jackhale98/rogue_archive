/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * Minimal curses declarations for building DCSS in headless WebTiles mode.
 *
 * Rogue Archive runs DCSS with -headless: the game talks only to the WebTiles
 * client, and libunix.cc's curses code paths never run. The terminal library
 * must still exist at link time, so this header declares exactly what
 * libunix.cc refers to and curses-stubs.c implements it as inert functions.
 * It is not a curses implementation.
 */
#ifndef ROGUE_ARCHIVE_CURSES_H
#define ROGUE_ARCHIVE_CURSES_H

#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <wchar.h>

#ifdef __cplusplus
extern "C" {
#endif

#define NCURSES_VERSION "rogue-archive-stub"
#define ERR (-1)
#define OK 0
#ifndef TRUE
#define TRUE 1
#define FALSE 0
#endif
#define CCHARW_MAX 5

typedef unsigned int chtype;
typedef unsigned int attr_t;
typedef unsigned long mmask_t;
typedef struct ra_curses_window WINDOW;
typedef struct
{
    attr_t attr;
    wchar_t chars[CCHARW_MAX];
    int ext_color;
} cchar_t;
typedef struct
{
    short id;
    int x, y, z;
    mmask_t bstate;
} MEVENT;

extern WINDOW *stdscr;
extern int COLORS;
extern int COLOR_PAIRS;
extern int LINES;
extern int COLS;
extern int ESCDELAY;

#define COLOR_BLACK 0
#define COLOR_RED 1
#define COLOR_GREEN 2
#define COLOR_YELLOW 3
#define COLOR_BLUE 4
#define COLOR_MAGENTA 5
#define COLOR_CYAN 6
#define COLOR_WHITE 7

#define A_NORMAL 0u
#define A_STANDOUT (1u << 16)
#define A_UNDERLINE (1u << 17)
#define A_REVERSE (1u << 18)
#define A_BLINK (1u << 19)
#define A_DIM (1u << 20)
#define A_BOLD (1u << 21)
#define WA_NORMAL A_NORMAL
#define WA_STANDOUT A_STANDOUT
#define WA_UNDERLINE A_UNDERLINE
#define WA_REVERSE A_REVERSE
#define WA_BLINK A_BLINK
#define WA_DIM A_DIM
#define WA_BOLD A_BOLD

#define KEY_CODE_YES 0400
#define KEY_DOWN 0402
#define KEY_UP 0403
#define KEY_LEFT 0404
#define KEY_RIGHT 0405
#define KEY_HOME 0406
#define KEY_BACKSPACE 0407
#define KEY_DC 0512
#define KEY_IC 0513
#define KEY_SF 0520
#define KEY_SR 0521
#define KEY_NPAGE 0522
#define KEY_PPAGE 0523
#define KEY_A1 0534
#define KEY_A3 0535
#define KEY_B2 0536
#define KEY_C1 0537
#define KEY_C3 0540
#define KEY_BTAB 0541
#define KEY_BEG 0542
#define KEY_END 0550
#define KEY_SDC 0577
#define KEY_SEND 0602
#define KEY_SHOME 0607
#define KEY_SLEFT 0611
#define KEY_SNEXT 0612
#define KEY_SPREVIOUS 0614
#define KEY_SRIGHT 0622
#define KEY_MOUSE 0631
#define KEY_RESIZE 0632

int addnwstr(const wchar_t *, int);
int assume_default_colors(int, int);
int attr_set(attr_t, short, void *);
int clear(void);
int clrtoeol(void);
int color_content(short, short *, short *, short *);
int curs_set(int);
int define_key(const char *, int);
int endwin(void);
int get_wch(wint_t *);
int getcchar(const cchar_t *, wchar_t *, attr_t *, short *, void *);
int getch(void);
int getcurx(const WINDOW *);
int getcury(const WINDOW *);
int getmouse(MEVENT *);
int init_pair(short, short, short);
WINDOW *initscr(void);
int intrflush(WINDOW *, int);
int key_defined(const char *);
int keypad(WINDOW *, int);
int meta(WINDOW *, int);
mmask_t mousemask(mmask_t, mmask_t *);
int move(int, int);
int mvadd_wchnstr(int, int, const cchar_t *, int);
int mvin_wch(int, int, cchar_t *);
int nodelay(WINDOW *, int);
int noecho(void);
int nonl(void);
int pair_content(short, short *, short *);
int raw(void);
int refresh(void);
int resetty(void);
int scrollok(WINDOW *, int);
int set_escdelay(int);
int setcchar(cchar_t *, const wchar_t *, attr_t, short, const void *);
int start_color(void);
char *termname(void);
void timeout(int);
int use_default_colors(void);

#ifdef __cplusplus
}
#endif

#endif
