// SPDX-License-Identifier: GPL-2.0-or-later
// Rogue Archive's main file for HyperRogue: upstream's own web main file
// (hyperweb.cpp, which includes the whole game) plus a few functions the page
// calls. Nothing here changes the game's rules or state, except ra_save(),
// which makes the same emergency save upstream's Android app makes when it is
// sent to the background.

#include "hyperweb.cpp"

namespace hr {

extern "C" {

/** Saves the game in progress (as hyperroid's keepinmemory: an emergency save). */
EMSCRIPTEN_KEEPALIVE void ra_save() {
  if(!casual) saveStats(true);
}

/** Order of the fields ra_state() writes; mirrored in adapter/state.ts. */
enum {
  RA_IN_MAP,     // 1 while the map is the only screen (no menu or dialog open)
  RA_TREASURE,   // gold(): the score's treasure count
  RA_KILLS,      // tkills()
  RA_TURNS,      // turncount
  RA_CAN_MOVE,   // 0 once the player is caught (the game is over)
  RA_LAND,       // the current land's eLand value
  RA_LAND_ITEMS, // treasure collected in the current land
  RA_ORB_COUNT,  // kinds of orb the player holds
  RA_FIELDS
};

/** A read-only snapshot for the page's status band. Returns the number of fields. */
EMSCRIPTEN_KEEPALIVE int ra_state(int *out, int capacity) {
  int s[RA_FIELDS] = {};
  s[RA_IN_MAP] = isize(screens) == 1 ? 1 : 0;
  s[RA_TREASURE] = gold();
  s[RA_KILLS] = tkills();
  s[RA_TURNS] = turncount;
  s[RA_CAN_MOVE] = canmove ? 1 : 0;
  if(cwt.at) {
    eLand land = cwt.at->land;
    s[RA_LAND] = int(land);
    eItem treasure = treasureType(land);
    s[RA_LAND_ITEMS] = treasure ? items[treasure] : 0;
  }
  int orbs = 0;
  for(int i = 0; i < ittypes; i++)
    if(itemclass(eItem(i)) == IC_ORB && items[i]) orbs++;
  s[RA_ORB_COUNT] = orbs;
  int n = capacity < RA_FIELDS ? capacity : RA_FIELDS;
  for(int i = 0; i < n; i++) out[i] = s[i];
  return RA_FIELDS;
}

/**
 * Fits the game to its canvas's container (the element with id "this_wide"),
 * as upstream's own fullscreen handler does: upstream's window-resize handler
 * ignores resizes in fullscreen mode, and the page's area changes without a
 * window resize (controls appearing, phone rotation).
 */
EMSCRIPTEN_KEEPALIVE void ra_resize() {
  if(!vid.want_fullscreen) return;
  vid.full = true;
  get_canvas_size();
  setvideomode();
}

/** Messages so far (the game's own log, as its message log screen shows). */
EMSCRIPTEN_KEEPALIVE int ra_log_size() { return isize(gamelog); }

/** Message i's text (static storage, valid until the next call). */
EMSCRIPTEN_KEEPALIVE const char *ra_log_text(int i) {
  static std::string text;
  text = i >= 0 && i < isize(gamelog) ? gamelog[i].msg : "";
  return text.c_str();
}

/** How many times message i repeated in a row (shown as "(x3)"). */
EMSCRIPTEN_KEEPALIVE int ra_log_quantity(int i) {
  return i >= 0 && i < isize(gamelog) ? gamelog[i].quantity : 0;
}

/** The turn message i appeared on. */
EMSCRIPTEN_KEEPALIVE int ra_log_turn(int i) {
  return i >= 0 && i < isize(gamelog) ? gamelog[i].turnstamp : 0;
}

/**
 * What the game shows about the cell under the pointer (its hover text, as
 * drawn at the top of the screen). Static storage, valid until the next call.
 */
EMSCRIPTEN_KEEPALIVE const char *ra_hover_text() {
  static std::string text;
  text = mouseovers;
  return text.c_str();
}

/** The current land's English name (static storage, valid until the next call). */
EMSCRIPTEN_KEEPALIVE const char *ra_land_name() {
  static std::string name;
  name = cwt.at ? linf[cwt.at->land].name : "";
  return name.c_str();
}

}

}
