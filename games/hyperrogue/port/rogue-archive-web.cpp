// SPDX-License-Identifier: GPL-2.0-or-later
// Rogue Archive's main file for HyperRogue: upstream's own web main file
// (hyperweb.cpp, which includes the whole game) plus a few functions the page
// calls. Nothing here changes the game's rules or state, except ra_save(),
// which makes the same emergency save upstream's Android app makes when it is
// sent to the background, and ra_set_touch_mode(), which sets what a tap does
// (upstream's own interface state, cycled by its touch_interface button).

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
  RA_RANGED,     // haveRangedOrb(): a tap on a distant cell may use an orb
  RA_TARGET_ORB, // orbToTarget: the orb a click on the cell under the pointer would use (eItem, 0: none)
  RA_WIND,       // items[itStrongWind]: 't' jumps where the wind blows
  RA_CROSSBOW,   // bow::crossbow_mode(): 'f' switches fire mode
  RA_FIRE_MODE,  // bow::fire_mode: clicks aim the crossbow; Esc cancels
  RA_RELOAD,     // items[itCrossbow]: turns until the crossbow can fire again
  RA_DEAD_ORBS,  // items[itGreenStone]: 'g' drops one
  RA_ORB_STRATEGY, // inv::on: 'i' opens the orb inventory
  RA_MINEFIELD,  // the player is in or next to the Minefield: 'm' marks mines
  RA_SAFETY,     // items[itOrbSafety]: leaving now saves the game
  RA_TOUCH_MODE, // touchmode: what a click on the map does (tmode)
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
  s[RA_RANGED] = haveRangedOrb() ? 1 : 0;
  s[RA_TARGET_ORB] = s[RA_IN_MAP] ? int(orbToTarget) : 0;
  s[RA_WIND] = items[itStrongWind];
  s[RA_CROSSBOW] = bow::crossbow_mode() ? 1 : 0;
  s[RA_FIRE_MODE] = bow::fire_mode ? 1 : 0;
  s[RA_RELOAD] = bow::crossbow_mode() ? items[itCrossbow] : 0;
  s[RA_DEAD_ORBS] = items[itGreenStone];
#if CAP_INV
  s[RA_ORB_STRATEGY] = inv::on ? 1 : 0;
#endif
  if(cwt.at) {
    bool mines = cwt.at->land == laMinefield;
    forCellEx(c2, cwt.at) if(c2->land == laMinefield) mines = true;
    s[RA_MINEFIELD] = mines ? 1 : 0;
  }
  s[RA_SAFETY] = items[itOrbSafety];
  s[RA_TOUCH_MODE] = int(touchmode);
  int n = capacity < RA_FIELDS ? capacity : RA_FIELDS;
  for(int i = 0; i < n; i++) out[i] = s[i];
  return RA_FIELDS;
}

/**
 * Sets what a click (a tap) on the map does, among upstream's own touch modes
 * (control.cpp, the touch_interface button): 0 move (as usual), 1 info (help
 * about the cell, no move), 4 ranged (always target a ranged orb there, with
 * the game's error messages, never move). Interface state only, as upstream's
 * button; the others (drag, fire) are not offered. Returns the mode in effect.
 */
EMSCRIPTEN_KEEPALIVE int ra_set_touch_mode(int mode) {
  tmode m = tmode(mode);
  if(m == tmode::move || m == tmode::info || (m == tmode::ranged && mapeditor::drawplayer))
    touchmode = m;
  return int(touchmode);
}

/** An item's English name (static storage, valid until the next call). */
EMSCRIPTEN_KEEPALIVE const char *ra_item_name(int item) {
  static std::string name;
  name = item > 0 && item < ittypes ? iinf[item].name : "";
  return name.c_str();
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
