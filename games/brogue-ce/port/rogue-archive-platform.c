// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Rogue Archive browser platform for Brogue: Community Edition.
//
// This file implements Brogue CE's `struct brogueConsole` platform interface
// (see src/platform/platform.h upstream) for a WebAssembly build that runs in
// a Web Worker. It does not change any game rules: it only moves screen cells
// out to the browser, brings input events in, and yields to the browser event
// loop (via Asyncify) wherever the native platforms would block or sleep.
//
// Parts of this file (fontIndex, remapping, the delay logic) are adapted from
// upstream src/platform/sdl2-platform.c, which is AGPL-3.0-or-later. This file
// is therefore distributed under the same license as Brogue CE.
//
// The build compiles upstream with -DBROGUE_WEB -DwebConsole=rogueArchiveConsole
// so that upstream main.c selects this console without any source patch. The
// upstream web-platform.c (a POSIX-socket server bridge) is NOT compiled.

// Brogue's headers define true/false; include them before emscripten.h, which
// cleanly replaces existing definitions with C/JS-compatible equivalents.
#include <limits.h>
#include <stdint.h>
#include <string.h>
#include "platform.h"
#include "GlobalsBase.h"
#include <emscripten.h>

#define PAUSE_BETWEEN_EVENT_POLLING 36 // same cadence as the SDL platform
#define MAX_REMAPS 128
#define CELL_BYTES 8 // u16 sprite index (LE), fg r,g,b, bg r,g,b (0..255)

// Event record exchanged with JavaScript: type, param1, param2, ctrl, shift.
#define EVENT_FIELDS 5

struct keypair {
    char from;
    char to;
};

static struct keypair remapping[MAX_REMAPS];
static size_t nremaps = 0;
static enum graphicsModes showGraphics = TEXT_GRAPHICS;
static rogueEvent lastEvent;
static uint8_t cells[ROWS * COLS * CELL_BYTES];
static boolean cellsChanged = true;
static double lastDelayTime = 0;

// Read-only snapshot of game state sent with each frame, so the browser can
// offer context-aware controls and a compact status bar. Nothing here is ever
// written back to the game. Field order is mirrored in adapter/state.ts.
enum {
    ST_HP, ST_MAX_HP, ST_NUTRITION, ST_STRENGTH, ST_DEPTH, ST_DEEPEST, ST_GOLD,
    ST_CURSOR_X, ST_CURSOR_Y, ST_CURSOR_MODE, ST_UP_X, ST_UP_Y, ST_DOWN_X, ST_DOWN_Y,
    ST_TEXT_INPUT, ST_COLORS_DANCE, ST_PLAYBACK, ST_WAITING, ST_FIELDS
};
static int32_t state[ST_FIELDS];
// What the game is currently doing: blocked in nextKeyOrMouseEvent (and how)
// or busy (animating, auto-exploring, generating a level).
static boolean waitingForInput = false;
static boolean waitingTextInput = false;
static boolean waitingColorsDance = false;

// ---------------------------------------------------------------------------
// JavaScript bridge. The worker installs these hooks on `Module` before main().

EM_JS(void, ra_present, (const uint8_t *buf, int len, int playerX, int playerY, int mode, int inGame,
                         const int32_t *state, int stateLen), {
    Module.raPresent(HEAPU8.slice(buf, buf + len), playerX, playerY, mode, inGame,
                     HEAP32.slice(state >> 2, (state >> 2) + stateLen));
});

EM_JS(int, ra_poll_event, (int *out), {
    var e = Module.raPollEvent();
    if (!e) return 0;
    for (var i = 0; i < 5; i++) HEAP32[(out >> 2) + i] = e[i];
    return 1;
});

// Resolves when input arrives, a host command is pending, or `ms` elapses.
EM_ASYNC_JS(void, ra_wait_for_input, (int ms), {
    await Module.raWaitForInput(ms);
});

EM_JS(int, ra_modifier_held, (int modifier), {
    return Module.raModifierHeld(modifier) ? 1 : 0;
});

// Returns non-zero once if the host asked us to make progress durable
// (for example because the page is being hidden or the player is exiting).
EM_JS(int, ra_take_flush_request, (void), {
    return Module.raTakeFlushRequest() ? 1 : 0;
});

// Persists the save directory (IDBFS) and waits for the write to complete.
EM_ASYNC_JS(void, ra_sync_fs, (void), {
    await Module.raSyncFs();
});

EM_JS(void, ra_notify, (int eventId, int data1, int data2, const char *str1, const char *str2), {
    Module.raNotify(eventId, data1, data2, str1 ? UTF8ToString(str1) : "", str2 ? UTF8ToString(str2) : "");
});

EM_JS(void, ra_graphics_mode_changed, (int mode), {
    Module.raGraphicsModeChanged(mode);
});

EM_JS(void, ra_game_exit, (int status), {
    Module.raGameExit(status);
});

// ---------------------------------------------------------------------------

static void present(void) {
    if (!cellsChanged) return;
    cellsChanged = false;
    int px = -1, py = -1;
    boolean inGame = rogue.gameInProgress && !rogue.gameHasEnded;
    if (inGame) {
        px = player.loc.x;
        py = player.loc.y;
    }
    memset(state, 0, sizeof(state));
    if (inGame) {
        state[ST_HP] = player.currentHP;
        state[ST_MAX_HP] = player.info.maxHP;
        state[ST_NUTRITION] = player.status[STATUS_NUTRITION];
        state[ST_STRENGTH] = rogue.strength - player.weaknessAmount;
        state[ST_DEPTH] = rogue.depthLevel;
        state[ST_DEEPEST] = rogue.deepestLevel;
        state[ST_GOLD] = (int32_t) rogue.gold;
        state[ST_UP_X] = rogue.upLoc.x;
        state[ST_UP_Y] = rogue.upLoc.y;
        state[ST_DOWN_X] = rogue.downLoc.x;
        state[ST_DOWN_Y] = rogue.downLoc.y;
    }
    state[ST_CURSOR_X] = rogue.cursorLoc.x;
    state[ST_CURSOR_Y] = rogue.cursorLoc.y;
    state[ST_CURSOR_MODE] = rogue.cursorMode ? 1 : 0;
    state[ST_TEXT_INPUT] = waitingTextInput ? 1 : 0;
    state[ST_COLORS_DANCE] = waitingColorsDance ? 1 : 0;
    state[ST_PLAYBACK] = rogue.playbackMode ? 1 : 0;
    state[ST_WAITING] = waitingForInput ? 1 : 0;
    ra_present(cells, (int) sizeof(cells), px, py, (int) showGraphics, inGame ? 1 : 0, state, ST_FIELDS);
}

// Brogue may ask for a flush at any input wait; this is the same operation the
// game performs itself whenever its recording buffer fills or a level changes,
// so it is safe at these points and does not alter gameplay.
static void serviceHostRequests(void) {
    if (ra_take_flush_request()) {
        if (rogue.recording && !rogue.playbackMode) {
            flushBufferToFile();
        }
        ra_sync_fs();
    }
}

static char applyRemaps(char c) {
    for (size_t i = 0; i < nremaps; i++) {
        if (remapping[i].from == c) return remapping[i].to;
    }
    return c;
}

static boolean pollBrogueEvent(rogueEvent *returnEvent, boolean textInput) {
    int raw[EVENT_FIELDS];
    returnEvent->eventType = EVENT_ERROR;
    if (!ra_poll_event(raw)) {
        return false;
    }
    returnEvent->eventType = (enum eventTypes) raw[0];
    returnEvent->param1 = raw[1];
    returnEvent->param2 = raw[2];
    returnEvent->controlKey = raw[3] ? true : false;
    returnEvent->shiftKey = raw[4] ? true : false;
    if (returnEvent->eventType == KEYSTROKE && !textInput
        && returnEvent->param1 > 0 && returnEvent->param1 < 128) {
        returnEvent->param1 = (unsigned char) applyRemaps((char) returnEvent->param1);
    }
    return true;
}

// Like SDL_Delay, but reduces the delay if time has passed since the last delay.
static void delayUpTo(int ms) {
    double now = emscripten_get_now();
    double remaining = ms - (now - lastDelayTime);
    if (remaining > 0) {
        emscripten_sleep((unsigned int) remaining);
    }
    lastDelayTime = emscripten_get_now();
}

static void ra_gameLoop(void) {
    lastEvent.eventType = EVENT_ERROR;
    int statusCode = rogueMain();
    serviceHostRequests();
    ra_sync_fs();
    ra_game_exit(statusCode);
    exit(statusCode);
}

static boolean ra_pauseForMilliseconds(short ms, PauseBehavior behavior) {
    if (waitingForInput) {
        waitingForInput = false;
        cellsChanged = true; // report the state change even if nothing was redrawn
    }
    present();
    delayUpTo(ms);
    serviceHostRequests();

    if (lastEvent.eventType != EVENT_ERROR
        && (lastEvent.eventType != MOUSE_ENTERED_CELL || behavior.interuptForMouseMove)) {
        return true;
    }

    return pollBrogueEvent(&lastEvent, false)
        && lastEvent.eventType != EVENT_ERROR
        && (lastEvent.eventType != MOUSE_ENTERED_CELL || behavior.interuptForMouseMove);
}

static void ra_nextKeyOrMouseEvent(rogueEvent *returnEvent, boolean textInput, boolean colorsDance) {
    if (!waitingForInput || waitingTextInput != textInput || waitingColorsDance != colorsDance) {
        waitingForInput = true;
        waitingTextInput = textInput;
        waitingColorsDance = colorsDance;
        cellsChanged = true; // report the new input state even if nothing was redrawn
    }
    present();

    if (lastEvent.eventType != EVENT_ERROR) {
        *returnEvent = lastEvent;
        lastEvent.eventType = EVENT_ERROR;
        return;
    }

    while (true) {
        serviceHostRequests();
        if (pollBrogueEvent(returnEvent, textInput)) {
            waitingForInput = false;
            break;
        }

        if (colorsDance) {
            shuffleTerrainColors(3, true);
            commitDraws();
            present();
            ra_wait_for_input(PAUSE_BETWEEN_EVENT_POLLING);
        } else {
            // Nothing animates: sleep until input or a host request arrives.
            ra_wait_for_input(INT_MAX);
        }
        lastDelayTime = emscripten_get_now();
    }
}

// Returns the sprite index for a glyph. Sprites <256 come from the text font
// sheet, 256+ from the tiles sheet. Copied from upstream sdl2-platform.c.
static int fontIndex(enum displayGlyph glyph) {
    if (glyph == G_UP_ARROW) return 0x90;
    if (glyph == G_DOWN_ARROW) return 0x91;

    if (glyph < 128) {
        return glyph;
    } else if (showGraphics == TILES_GRAPHICS || (showGraphics == HYBRID_GRAPHICS && isEnvironmentGlyph(glyph))) {
        return glyph + 128 - 2;
    } else {
        unsigned int code = glyphToUnicode(glyph);
        switch (code) {
            case U_MIDDLE_DOT: return 0x80;
            case U_FOUR_DOTS: return 0x81;
            case U_DIAMOND: return 0x82;
            case U_FLIPPED_V: return 0x83;
            case U_ARIES: return 0x84;
            case U_ESZETT: return 0xdf;
            case U_ANKH: return 0x85;
            case U_MUSIC_NOTE: return 0x86;
            case U_CIRCLE: return 0x87;
            case U_LIGHTNING_BOLT: return 0x99;
            case U_FILLED_CIRCLE: return 0x89;
            case U_NEUTER: return 0x8a;
            case U_U_ACUTE: return 0xda;
            case U_CURRENCY: return 0xa4;
            case U_UP_ARROW: return 0x90;
            case U_DOWN_ARROW: return 0x91;
            case U_LEFT_ARROW: return 0x92;
            case U_RIGHT_ARROW: return 0x93;
            case U_OMEGA: return 0x96;
            case U_CIRCLE_BARS: return 0x8c;
            case U_FILLED_CIRCLE_BARS: return 0x8d;
            case U_LEFT_TRIANGLE: return 0x8e;
            default:
                brogueAssert(code < 256);
                return code;
        }
    }
}

static uint8_t toByte(short component) {
    if (component <= 0) return 0;
    if (component >= 100) return 255;
    return (uint8_t) ((component * 255 + 50) / 100);
}

static void ra_plotChar(
    enum displayGlyph inputChar,
    short x, short y,
    short foreRed, short foreGreen, short foreBlue,
    short backRed, short backGreen, short backBlue
) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    int sprite = fontIndex(inputChar);
    uint8_t *cell = &cells[(y * COLS + x) * CELL_BYTES];
    cell[0] = (uint8_t) (sprite & 0xff);
    cell[1] = (uint8_t) ((sprite >> 8) & 0xff);
    cell[2] = toByte(foreRed);
    cell[3] = toByte(foreGreen);
    cell[4] = toByte(foreBlue);
    cell[5] = toByte(backRed);
    cell[6] = toByte(backGreen);
    cell[7] = toByte(backBlue);
    cellsChanged = true;
}

static void ra_remap(const char *from, const char *to) {
    if (nremaps < MAX_REMAPS) {
        remapping[nremaps].from = from[0];
        remapping[nremaps].to = to[0];
        nremaps++;
    }
}

static boolean ra_modifierHeld(int modifier) {
    return ra_modifier_held(modifier) ? true : false;
}

static void ra_notifyEvent(short eventId, int data1, int data2, const char *str1, const char *str2) {
    ra_notify(eventId, data1, data2, str1, str2);
}

static enum graphicsModes ra_setGraphicsMode(enum graphicsModes mode) {
    showGraphics = mode;
    refreshScreen();
    cellsChanged = true;
    ra_graphics_mode_changed((int) mode);
    return mode;
}

struct brogueConsole rogueArchiveConsole = {
    ra_gameLoop,
    ra_pauseForMilliseconds,
    ra_nextKeyOrMouseEvent,
    ra_plotChar,
    ra_remap,
    ra_modifierHeld,
    ra_notifyEvent,
    NULL,
    ra_setGraphicsMode
};
