/* SPDX-License-Identifier: NGPL */
/*
 * Rogue Archive glue for NetHack's WebAssembly build (upstream's shim window
 * port, sys/libnh). The page answers the shim's window calls in JavaScript;
 * these functions let it read the structures those calls pass (glyph_info,
 * the menu identifiers, the extended command list, the status conditions)
 * without depending on their memory layout, and give it a read-only snapshot
 * of game state for the touch controls. Nothing here changes game state,
 * except ra_set_plname() (the name the player typed, as tty's askname()
 * stores it) and the menu result ra_menu_select() builds for select_menu().
 *
 * Linked with upstream's own link command (scripts/build.sh).
 */
#include "hack.h"
#include "func_tab.h"
#include "dlb.h"
#include <emscripten/emscripten.h>

/* ------------------------------------------------------------------------ */
/* glyph_info (print_glyph, add_menu) */

EMSCRIPTEN_KEEPALIVE int ra_gi_glyph(const glyph_info *info) { return info ? info->glyph : NO_GLYPH; }
EMSCRIPTEN_KEEPALIVE int ra_gi_char(const glyph_info *info) { return info ? info->ttychar : ' '; }
EMSCRIPTEN_KEEPALIVE int ra_gi_color(const glyph_info *info) { return info ? info->gm.sym.color : NO_COLOR; }
EMSCRIPTEN_KEEPALIVE int ra_gi_tile(const glyph_info *info) { return info ? info->gm.tileidx : -1; }
EMSCRIPTEN_KEEPALIVE unsigned ra_gi_flags(const glyph_info *info) { return info ? info->gm.glyphflags : 0; }

/* ------------------------------------------------------------------------ */
/* Menus: add_menu() passes a pointer to the item's identifier, valid only
   during the call, and select_menu() must return a malloc'd menu_item array
   holding the chosen identifiers. The identifiers are copied here, per
   window, in the order they were added. */

#define RA_MENU_WINDOWS 64

static struct {
    anything *items;
    int count, size;
} ra_menus[RA_MENU_WINDOWS];

EMSCRIPTEN_KEEPALIVE void
ra_menu_start(int window)
{
    if (window < 0 || window >= RA_MENU_WINDOWS)
        return;
    ra_menus[window].count = 0;
}

/* Keeps an item's identifier; returns its index in the menu. The shim passes
   the identifier's value (its first four bytes, read as an int: "vipi00iisi"),
   which holds any identifier NetHack sets (a_int, a_char, a_obj...: four bytes
   or fewer on wasm32, the rest zero). */
EMSCRIPTEN_KEEPALIVE int
ra_menu_keep(int window, int value)
{
    anything item = cg.zeroany;

    if (window < 0 || window >= RA_MENU_WINDOWS)
        return -1;
    if (ra_menus[window].count == ra_menus[window].size) {
        int size = ra_menus[window].size ? ra_menus[window].size * 2 : 64;
        anything *items = (anything *) realloc(ra_menus[window].items, size * sizeof (anything));

        if (!items)
            return -1;
        ra_menus[window].items = items;
        ra_menus[window].size = size;
    }
    item.a_int = value;
    ra_menus[window].items[ra_menus[window].count] = item;
    return ra_menus[window].count++;
}

/* Whether an item can be chosen (a non-zero identifier; headings have none). */
EMSCRIPTEN_KEEPALIVE int
ra_menu_selectable(int window, int index)
{
    if (window < 0 || window >= RA_MENU_WINDOWS || index < 0 || index >= ra_menus[window].count)
        return 0;
    return memcmp(&ra_menus[window].items[index], &cg.zeroany, sizeof (anything)) != 0;
}

/* Builds select_menu()'s result: the chosen items (by index) and counts
   (-1: all). Returns how many were chosen. */
EMSCRIPTEN_KEEPALIVE int
ra_menu_select(int window, menu_item **out, const int *indices, const int *counts, int n)
{
    menu_item *list;
    int i;

    *out = (menu_item *) 0;
    if (window < 0 || window >= RA_MENU_WINDOWS || n <= 0)
        return 0;
    list = (menu_item *) alloc((unsigned) (n * sizeof (menu_item)));
    for (i = 0; i < n; i++) {
        int index = indices[i];

        list[i].item = (index >= 0 && index < ra_menus[window].count) ? ra_menus[window].items[index] : cg.zeroany;
        list[i].count = counts[i];
        list[i].itemflags = 0;
    }
    *out = list;
    return n;
}

/* ------------------------------------------------------------------------ */
/* Extended commands (#name) */

EMSCRIPTEN_KEEPALIVE int
ra_ext_cmd_index(const char *name)
{
    int i;

    for (i = 0; extcmdlist[i].ef_txt; i++)
        if (!strcmpi(extcmdlist[i].ef_txt, name))
            return i;
    return -1;
}

EMSCRIPTEN_KEEPALIVE const char *
ra_ext_cmd_text(int i)
{
    return extcmdlist[i].ef_txt;
}

EMSCRIPTEN_KEEPALIVE const char *
ra_ext_cmd_desc(int i)
{
    return extcmdlist[i].ef_desc;
}

/* ------------------------------------------------------------------------ */
/* Status conditions, as tty shows them (in conditions' ranking order). */

EMSCRIPTEN_KEEPALIVE void
ra_conditions(unsigned long mask, char *out, int size)
{
    int i;

    out[0] = '\0';
    for (i = 0; i < CONDITION_COUNT; i++) {
        int c = cond_idx[i];

        if ((mask & conditions[c].mask) && (int) (strlen(out) + strlen(conditions[c].text[0]) + 2) < size) {
            Strcat(out, " ");
            Strcat(out, conditions[c].text[0]);
        }
    }
}

/* ------------------------------------------------------------------------ */
/* display_file(): a file from the data library (help texts, the license...). */

EMSCRIPTEN_KEEPALIVE char *
ra_file_text(const char *name)
{
    dlb *f = dlb_fopen(name, RDTMODE);
    char line[BUFSZ], *text;
    size_t len = 0, size = 4096;

    if (!f)
        return (char *) 0;
    text = (char *) alloc((unsigned) size);
    text[0] = '\0';
    while (dlb_fgets(line, sizeof line, f)) {
        size_t n = strlen(line);

        if (len + n + 1 > size) {
            size *= 2;
            text = (char *) realloc(text, size);
        }
        memcpy(text + len, line, n + 1);
        len += n;
    }
    (void) dlb_fclose(f);
    return text;
}

EMSCRIPTEN_KEEPALIVE void
ra_free(void *p)
{
    free(p);
}

/* askname(): the name the player typed. */
EMSCRIPTEN_KEEPALIVE void
ra_set_plname(const char *name)
{
    (void) strncpy(svp.plname, name, sizeof svp.plname - 1);
    svp.plname[sizeof svp.plname - 1] = '\0';
}

/* ------------------------------------------------------------------------ */
/* Read-only state for the shell (adapter/state.ts mirrors this order). */

enum {
    RA_IN_GAME,     /* the game is running (the move loop) */
    RA_HP,
    RA_HPMAX,
    RA_EN,
    RA_ENMAX,
    RA_DEPTH,
    RA_X,
    RA_Y,
    RA_MOVES,
    RA_HUNGER,      /* u.uhs: 0 satiated, 1 not hungry, 2 hungry .. 6 starved */
    RA_FIELDS
};

static int ra_state_buf[RA_FIELDS];

EMSCRIPTEN_KEEPALIVE int *
ra_state(void)
{
    int *s = ra_state_buf;

    memset(s, 0, sizeof ra_state_buf);
    s[RA_IN_GAME] = program_state.in_moveloop ? 1 : 0;
    if (!program_state.in_moveloop)
        return s;
    s[RA_HP] = Upolyd ? u.mh : u.uhp;
    s[RA_HPMAX] = Upolyd ? u.mhmax : u.uhpmax;
    s[RA_EN] = u.uen;
    s[RA_ENMAX] = u.uenmax;
    s[RA_DEPTH] = depth(&u.uz);
    s[RA_X] = u.ux;
    s[RA_Y] = u.uy;
    s[RA_MOVES] = (int) svm.moves;
    s[RA_HUNGER] = u.uhs;
    return s;
}

EMSCRIPTEN_KEEPALIVE int ra_state_fields(void) { return RA_FIELDS; }
