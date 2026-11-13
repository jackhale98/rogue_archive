/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Inert terminal and backtrace functions for headless WebTiles builds; see include/. */
#include "curses.h"

WINDOW *stdscr = 0;
int COLORS = 8;
int COLOR_PAIRS = 64;
int LINES = 24;
int COLS = 80;
int ESCDELAY = 0;

int addnwstr(const wchar_t *s, int n) { (void)s; (void)n; return OK; }
int assume_default_colors(int f, int b) { (void)f; (void)b; return OK; }
int attr_set(attr_t a, short p, void *o) { (void)a; (void)p; (void)o; return OK; }
int clear(void) { return OK; }
int clrtoeol(void) { return OK; }
int color_content(short c, short *r, short *g, short *b) { (void)c; *r = *g = *b = 0; return OK; }
int curs_set(int v) { (void)v; return OK; }
int define_key(const char *d, int k) { (void)d; (void)k; return OK; }
int endwin(void) { return OK; }
int get_wch(wint_t *c) { *c = 27; return OK; }
int getcchar(const cchar_t *w, wchar_t *s, attr_t *a, short *p, void *o)
{
    (void)w; (void)o;
    if (s) s[0] = 0;
    if (a) *a = 0;
    if (p) *p = 0;
    return OK;
}
int getch(void) { return 27; }
int getcurx(const WINDOW *w) { (void)w; return 0; }
int getcury(const WINDOW *w) { (void)w; return 0; }
int getmouse(MEVENT *e) { (void)e; return ERR; }
int init_pair(short p, short f, short b) { (void)p; (void)f; (void)b; return OK; }
WINDOW *initscr(void) { return 0; }
int intrflush(WINDOW *w, int b) { (void)w; (void)b; return OK; }
int key_defined(const char *d) { (void)d; return 0; }
int keypad(WINDOW *w, int b) { (void)w; (void)b; return OK; }
int meta(WINDOW *w, int b) { (void)w; (void)b; return OK; }
mmask_t mousemask(mmask_t m, mmask_t *o) { (void)m; if (o) *o = 0; return 0; }
int move(int y, int x) { (void)y; (void)x; return OK; }
int mvadd_wchnstr(int y, int x, const cchar_t *c, int n) { (void)y; (void)x; (void)c; (void)n; return OK; }
int mvin_wch(int y, int x, cchar_t *c) { (void)y; (void)x; if (c) c->chars[0] = 0; return OK; }
int nodelay(WINDOW *w, int b) { (void)w; (void)b; return OK; }
int noecho(void) { return OK; }
int nonl(void) { return OK; }
int pair_content(short p, short *f, short *b) { (void)p; *f = *b = 0; return OK; }
int raw(void) { return OK; }
int refresh(void) { return OK; }
int resetty(void) { return OK; }
int scrollok(WINDOW *w, int b) { (void)w; (void)b; return OK; }
int set_escdelay(int d) { (void)d; return OK; }
int setcchar(cchar_t *w, const wchar_t *s, attr_t a, short p, const void *o)
{
    (void)o;
    w->attr = a;
    w->ext_color = p;
    w->chars[0] = s ? s[0] : 0;
    w->chars[1] = 0;
    return OK;
}
int start_color(void) { return OK; }
char *termname(void) { static char name[] = "rogue-archive"; return name; }
void timeout(int delay) { (void)delay; }
int use_default_colors(void) { return OK; }

/* execinfo.h: no stack walking in WebAssembly. */
#include <stdlib.h>
#include "execinfo.h"
int backtrace(void **buffer, int size) { (void)buffer; (void)size; return 0; }
char **backtrace_symbols(void *const *buffer, int size) { (void)buffer; (void)size; return calloc(1, sizeof(char *)); }
void backtrace_symbols_fd(void *const *buffer, int size, int fd) { (void)buffer; (void)size; (void)fd; }
