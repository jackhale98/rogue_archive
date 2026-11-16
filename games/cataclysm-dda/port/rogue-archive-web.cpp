// SPDX-License-Identifier: CC-BY-SA-3.0
//
// Rogue Archive's read-only view of Cataclysm: Dark Days Ahead, linked into
// upstream's own web build (make NATIVE=emscripten). Nothing here changes the
// game: it observes it.
//
// Upstream's code is not patched. A few upstream functions are wrapped at link
// time (wasm-ld --wrap, see scripts/emcc-link.sh): each wrapper records what
// it sees and then calls the real function.
//
//   input_context::handle_input        which keybinding context (data/raw/
//                                      keybindings.json "category") the game
//                                      is waiting in, and whether it is waiting
//   input_manager::get_input_event     raw waits ("press any key")
//   cata_cursesport::curses_drawwindow the text of every curses window, as it
//                                      is drawn, into a screen-sized grid
//   ImDrawList::AddText, ImGui::NewFrame
//                                      the text of the game's ImGui windows
//                                      (menus, popups), placed in the same grid
//   do_turn, main_menu::opening_screen in a game, or at the main menu
//   handle_resize                      (display only) redraw at once after the
//                                      page resizes the game, not at the next key
//
// The page reads the result through the exported ra_* functions (JSON text).
#include <emscripten/emscripten.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <list>
#include <string>
#include <vector>

#include "avatar.h"
#include "calendar.h"
#include "cursesdef.h"
#include "cursesport.h"
#include "game.h"
#include "input.h"
#include "input_context.h"
#include "main_menu.h"
#include "messages.h"
#include "output.h"
#include "sdltiles.h"
#include "ui_manager.h"
#include "point.h"
#include "third-party/imgui/imgui.h"
#include "third-party/imgui/imgui_internal.h"

bool do_turn();

namespace
{

// The context's category is private; an explicit instantiation may name a
// private member (C++17 [temp.spec]/6), which gives read-only access to it
// without patching upstream's header.
template<typename Tag, typename Tag::type Member>
struct expose {
    friend typename Tag::type get( Tag ) {
        return Member;
    }
};
struct category_tag {
    using type = std::string input_context::*;
    friend type get( category_tag );
};
template struct expose<category_tag, &input_context::category>;

struct waiting_context {
    const input_context *ctxt;
    std::string category;
};

std::vector<waiting_context> contexts;
int raw_waits = 0;
bool in_game = false;
bool at_main_menu = false;
unsigned long input_waits = 0;

// The screen as text: one UTF-8 string per cell.
std::vector<std::vector<std::string>> screen;
std::vector<std::vector<std::string>> overlay;
int screen_w = 0;
int screen_h = 0;

void fit_screen()
{
    if( screen_w == TERMX && screen_h == TERMY ) {
        return;
    }
    screen_w = std::max( TERMX, 0 );
    screen_h = std::max( TERMY, 0 );
    screen.assign( screen_h, std::vector<std::string>( screen_w, " " ) );
    overlay.assign( screen_h, std::vector<std::string>( screen_w, std::string() ) );
}

void json_string( std::string &out, const std::string &text )
{
    out += '"';
    for( const unsigned char c : text ) {
        switch( c ) {
            case '"':
                out += "\\\"";
                break;
            case '\\':
                out += "\\\\";
                break;
            case '\n':
                out += "\\n";
                break;
            case '\r':
                out += "\\r";
                break;
            case '\t':
                out += "\\t";
                break;
            default:
                if( c < 0x20 ) {
                    char buffer[8];
                    std::snprintf( buffer, sizeof( buffer ), "\\u%04x", c );
                    out += buffer;
                } else {
                    out += static_cast<char>( c );
                }
        }
    }
    out += '"';
}

// One UTF-8 code point from text at i (advancing i).
std::string next_code_point( const char *&text, const char *end )
{
    const unsigned char lead = static_cast<unsigned char>( *text );
    int length = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
    if( text + length > end ) {
        length = static_cast<int>( end - text );
    }
    std::string point( text, text + length );
    text += length;
    return point;
}

// A curses cell as text: the line-drawing codes curses stores as single bytes
// (output.h LINE_*_C) become their box-drawing characters.
std::string cell_text( const std::string &ch )
{
    static const char *const lines[] = { "│", "─", "└", "┌", "┐", "┘", "├", "┴", "┤", "┬", "┼" };
    if( ch.size() == 1 ) {
        const unsigned char code = static_cast<unsigned char>( ch[0] );
        if( code >= 0xa0 && code <= 0xaa ) {
            return lines[code - 0xa0];
        }
    }
    return ch;
}

std::string result;

} // namespace

// --- Link-time wrappers ------------------------------------------------------

// The wrappers have the C++ functions' mangled names (C linkage, so the names
// are not mangled again) and their signatures, member functions taking `this`
// first (a result returned in memory comes before it, for both).
#pragma clang diagnostic ignored "-Wreturn-type-c-linkage"
#pragma clang diagnostic ignored "-Wmissing-declarations"

extern "C" {

const std::string &__real__ZN13input_context12handle_inputEv( input_context *self );
const std::string &__real__ZN13input_context12handle_inputEi( input_context *self, int timeout );
input_event __real__ZN13input_manager15get_input_eventE13keyboard_mode( input_manager *self,
        keyboard_mode mode );
void __real__ZN15cata_cursesport17curses_drawwindowERKN10catacurses6windowE(
    const catacurses::window &w );
void __real__ZN10ImDrawList7AddTextEP6ImFontfRK6ImVec2jPKcS6_fPK6ImVec4( ImDrawList *self,
        ImFont *font, float font_size, const ImVec2 &pos, ImU32 col, const char *text_begin,
        const char *text_end, float wrap_width, const ImVec4 *clip );
void __real__ZN10ImDrawList7AddTextERK6ImVec2jPKcS4_( ImDrawList *self, const ImVec2 &pos,
        ImU32 col, const char *text_begin, const char *text_end );
void __real__ZN5ImGui8NewFrameEv();
bool __real__Z7do_turnv();
bool __real__ZN9main_menu14opening_screenEv( main_menu *self );

static const std::string &wait_in( input_context *self, int timeout, bool with_timeout )
{
    contexts.push_back( { self, self->*get( category_tag() ) } );
    input_waits++;
    try {
        const std::string &action = with_timeout ?
                                    __real__ZN13input_context12handle_inputEi( self, timeout ) :
                                    __real__ZN13input_context12handle_inputEv( self );
        contexts.pop_back();
        return action;
    } catch( ... ) {
        contexts.pop_back();
        throw;
    }
}

const std::string &__wrap__ZN13input_context12handle_inputEv( input_context *self )
{
    return wait_in( self, 0, false );
}

const std::string &__wrap__ZN13input_context12handle_inputEi( input_context *self, int timeout )
{
    return wait_in( self, timeout, true );
}

input_event __wrap__ZN13input_manager15get_input_eventE13keyboard_mode( input_manager *self,
        keyboard_mode mode )
{
    // Waits inside handle_input are already counted.
    const bool raw = contexts.empty();
    if( raw ) {
        raw_waits++;
        input_waits++;
    }
    try {
        input_event event = __real__ZN13input_manager15get_input_eventE13keyboard_mode( self, mode );
        if( raw ) {
            raw_waits--;
        }
        return event;
    } catch( ... ) {
        if( raw ) {
            raw_waits--;
        }
        throw;
    }
}

void __wrap__ZN15cata_cursesport17curses_drawwindowERKN10catacurses6windowE(
    const catacurses::window &w )
{
    fit_screen();
    if( const cata_cursesport::WINDOW *win = w.get<cata_cursesport::WINDOW>() ) {
        for( int y = 0; y < win->height && y < static_cast<int>( win->line.size() ); ++y ) {
            const int sy = win->pos.y + y;
            if( sy < 0 || sy >= screen_h ) {
                continue;
            }
            const std::vector<cata_cursesport::cursecell> &cells = win->line[y].chars;
            for( int x = 0; x < win->width && x < static_cast<int>( cells.size() ); ++x ) {
                const int sx = win->pos.x + x;
                if( sx < 0 || sx >= screen_w ) {
                    continue;
                }
                // Wide characters leave an empty cell after them.
                screen[sy][sx] = cell_text( cells[x].ch );
            }
        }
    }
    __real__ZN15cata_cursesport17curses_drawwindowERKN10catacurses6windowE( w );
}

static void record_text( const ImVec2 &pos, const char *text_begin, const char *text_end )
{
    if( !text_begin || fontwidth <= 0 || fontheight <= 0 ) {
        return;
    }
    // ImGui's implicit "Debug" window is never shown.
    if( const ImGuiContext *ctx = ImGui::GetCurrentContext() ) {
        if( ctx->CurrentWindow && std::string( ctx->CurrentWindow->Name ).rfind( "Debug##", 0 ) == 0 ) {
            return;
        }
    }
    if( !text_end ) {
        text_end = text_begin + std::char_traits<char>::length( text_begin );
    }
    fit_screen();
    const int row = static_cast<int>( ( pos.y + fontheight / 2.0f ) / fontheight );
    int col = static_cast<int>( ( pos.x + fontwidth / 2.0f ) / fontwidth );
    if( row < 0 || row >= screen_h ) {
        return;
    }
    const char *p = text_begin;
    while( p < text_end && col < screen_w ) {
        std::string point = next_code_point( p, text_end );
        if( point == "\n" ) {
            break;
        }
        if( col >= 0 ) {
            overlay[row][col] = point;
        }
        col++;
    }
}

void __wrap__ZN10ImDrawList7AddTextEP6ImFontfRK6ImVec2jPKcS6_fPK6ImVec4( ImDrawList *self,
        ImFont *font, float font_size, const ImVec2 &pos, ImU32 col, const char *text_begin,
        const char *text_end, float wrap_width, const ImVec4 *clip )
{
    record_text( pos, text_begin, text_end );
    __real__ZN10ImDrawList7AddTextEP6ImFontfRK6ImVec2jPKcS6_fPK6ImVec4( self, font, font_size, pos,
            col, text_begin, text_end, wrap_width, clip );
}

void __wrap__ZN10ImDrawList7AddTextERK6ImVec2jPKcS4_( ImDrawList *self, const ImVec2 &pos,
        ImU32 col, const char *text_begin, const char *text_end )
{
    record_text( pos, text_begin, text_end );
    __real__ZN10ImDrawList7AddTextERK6ImVec2jPKcS4_( self, pos, col, text_begin, text_end );
}

void __wrap__ZN5ImGui8NewFrameEv()
{
    fit_screen();
    for( std::vector<std::string> &row : overlay ) {
        std::fill( row.begin(), row.end(), std::string() );
    }
    __real__ZN5ImGui8NewFrameEv();
}

bool __real__Z13handle_resizeii( int w, int h );

// After the window is resized (the page's area changed), redraw at once, as
// upstream does after its render target is reset (sdltiles.cpp
// CheckMessages). Upstream otherwise redraws at the next key, so the screen
// stays black until then: on the web the game's window is resized once the
// page has laid it out, after the main menu is drawn. This only redraws.
bool __wrap__Z13handle_resizeii( int w, int h )
{
    const bool resized = __real__Z13handle_resizeii( w, h );
    if( resized ) {
        ui_manager::invalidate( rectangle<point>( point::zero, point( w, h ) ), false );
        ui_manager::redraw_invalidated();
    }
    return resized;
}

bool __wrap__Z7do_turnv()
{
    in_game = true;
    at_main_menu = false;
    const bool over = __real__Z7do_turnv();
    if( over ) {
        in_game = false;
    }
    return over;
}

bool __wrap__ZN9main_menu14opening_screenEv( main_menu *self )
{
    in_game = false;
    at_main_menu = true;
    const bool start = __real__ZN9main_menu14opening_screenEv( self );
    at_main_menu = false;
    return start;
}

// --- Exports for the page ----------------------------------------------------

/**
 * A snapshot as JSON: the keybinding context the game waits in ("" when it is
 * not waiting), whether it waits for any input, in a game / at the main menu,
 * the player's position, the turn, the terminal size and ImGui windows open.
 */
EMSCRIPTEN_KEEPALIVE const char *ra_state()
{
    result.clear();
    result += "{\"context\":";
    json_string( result, contexts.empty() ? std::string() : contexts.back().category );
    result += ",\"contexts\":[";
    for( size_t i = 0; i < contexts.size(); ++i ) {
        if( i ) {
            result += ',';
        }
        json_string( result, contexts[i].category );
    }
    // Which of a few telling actions the waiting context registers: the map
    // and a direction prompt ("Examine where?") share the DEFAULTMODE
    // category, but only the map registers the inventory.
    result += "],\"registers\":[";
    if( !contexts.empty() ) {
        bool first_action = true;
        for( const char *action : {
                 "inventory", "look", "QUIT", "CONFIRM", "SELECT", "ANY_INPUT", "TEXT.CONFIRM", "NEXT_TAB"
             } ) {
            if( contexts.back().ctxt->is_registered_action( action ) ) {
                if( !first_action ) {
                    result += ',';
                }
                first_action = false;
                json_string( result, action );
            }
        }
    }
    result += "],\"waiting\":";
    result += !contexts.empty() || raw_waits > 0 ? "true" : "false";
    result += ",\"rawWait\":";
    result += raw_waits > 0 && contexts.empty() ? "true" : "false";
    result += ",\"waits\":" + std::to_string( input_waits );
    result += ",\"inGame\":";
    result += in_game ? "true" : "false";
    result += ",\"mainMenu\":";
    result += at_main_menu ? "true" : "false";
    result += ",\"termX\":" + std::to_string( TERMX ) + ",\"termY\":" + std::to_string( TERMY );
    result += ",\"cellW\":" + std::to_string( fontwidth ) + ",\"cellH\":" + std::to_string(
                  fontheight );
    if( in_game && g ) {
        const avatar &u = get_avatar();
        const tripoint_bub_ms p = u.pos_bub();
        const tripoint_abs_ms a = u.pos_abs();
        result += ",\"player\":{\"x\":" + std::to_string( p.x() ) + ",\"y\":" + std::to_string(
                      p.y() ) + ",\"z\":" + std::to_string( p.z() ) + ",\"absX\":" + std::to_string(
                      a.x() ) + ",\"absY\":" + std::to_string( a.y() ) + ",\"absZ\":" + std::to_string(
                      a.z() ) + ",\"name\":";
        json_string( result, u.get_name() );
        result += ",\"dead\":";
        result += u.is_dead_state() ? "true" : "false";
        result += "}";
        result += ",\"turn\":" + std::to_string( to_turn<int>( calendar::turn ) );
        result += ",\"quit\":" + std::to_string( static_cast<int>( g->uquit ) );
    }
    result += ",\"imgui\":[";
    bool first = true;
    if( ImGuiContext *ctx = ImGui::GetCurrentContext() ) {
        for( const ImGuiWindow *window : ctx->Windows ) {
            if( !window->WasActive || window->Hidden || ( window->Flags & ImGuiWindowFlags_ChildWindow ) ||
                std::string( window->Name ).rfind( "Debug##", 0 ) == 0 ) {
                continue;
            }
            if( !first ) {
                result += ',';
            }
            first = false;
            json_string( result, window->Name );
        }
    }
    result += "]}";
    return result.c_str();
}

/** The screen as text, one line per terminal row (ImGui text over the curses text). */
EMSCRIPTEN_KEEPALIVE const char *ra_screen_text()
{
    fit_screen();
    result.clear();
    for( int y = 0; y < screen_h; ++y ) {
        for( int x = 0; x < screen_w; ++x ) {
            result += !overlay[y][x].empty() ? overlay[y][x] : screen[y][x];
        }
        result += '\n';
    }
    return result.c_str();
}

/** The latest messages, oldest first, as JSON [[time, text], ...]. */
EMSCRIPTEN_KEEPALIVE const char *ra_messages( int count )
{
    result = "[";
    if( in_game && g ) {
        const std::vector<std::pair<std::string, std::string>> recent = Messages::recent_messages(
                    std::max( count, 0 ) );
        for( size_t i = 0; i < recent.size(); ++i ) {
            if( i ) {
                result += ',';
            }
            result += '[';
            json_string( result, recent[i].first );
            result += ',';
            json_string( result, recent[i].second );
            result += ']';
        }
    }
    result += ']';
    return result.c_str();
}

/** How many messages the game holds (to notice new ones cheaply). */
EMSCRIPTEN_KEEPALIVE int ra_message_count()
{
    return in_game && g ? static_cast<int>( Messages::size() ) : 0;
}

/**
 * Stops the game for good when the player leaves the page's game view: the
 * game's loop never returns (it waits for input through Asyncify), so the
 * page aborts the runtime, after which Emscripten ignores the pending wake-up
 * and the instance can be collected. The page saves (syncs) before this.
 */
EMSCRIPTEN_KEEPALIVE void ra_stop()
{
    std::abort();
}

} // extern "C"
