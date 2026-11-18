{ SPDX-License-Identifier: GPL-2.0-only }
{ A small curses of our own for DRL's console mode: the part of FreePascal's
  ncurses unit that FPC Valkyrie's curses driver (vcursesio, vcursesconsole,
  upstream's Linux console mode) uses, with the same names, types and values.

  The screen is an in-memory window; refresh hands it to the host
  (ra_present) as two bytes per cell: the character (for the alternate
  character set, the ACS letter) and an attribute byte: bits 0-3 the
  foreground (0-7 curses colours, +8 when bold), bits 4-6 the background,
  bit 7 the alternate character set. wgetch reads the host's key queue
  (ra_key_take) and, in blocking mode, waits for it (ra_key_wait).

  The host is JavaScript in the WebAssembly build (adapter/worker.ts, the
  Node harness) and C in the native conformance build
  (tests/conformance/replay-platform.c): the same unit in both. }
unit ncurses;

{$mode objfpc}

interface

type
  cint = LongInt;
  cuint = LongWord;
  chtype = cuint;
  pchtype = ^chtype;
  Bool = ByteBool;
  NC_FPC_COLOR = Smallint;
  TWINDOW = record
    cury, curx: Smallint;
    maxy, maxx: Smallint;
    delay: Boolean;
  end;
  PWINDOW = ^TWINDOW;

const
  COLOR_BLACK = 0;
  COLOR_RED = 1;
  COLOR_GREEN = 2;
  COLOR_YELLOW = 3;
  COLOR_BLUE = 4;
  COLOR_MAGENTA = 5;
  COLOR_CYAN = 6;
  COLOR_WHITE = 7;

  A_CHARTEXT = (1 shl 8) - 1;
  A_COLOR = ((1 shl 8) - 1) shl 8;
  A_BOLD = 1 shl (13 + 8);
  A_ALTCHARSET = 1 shl (14 + 8);

  ERR = -1;
  OK = 0;

  KEY_DOWN = 258;
  KEY_UP = 259;
  KEY_LEFT = 260;
  KEY_RIGHT = 261;
  KEY_HOME = 262;
  KEY_BACKSPACE = 263;
  KEY_F0 = 264;
  KEY_F1 = KEY_F0 + 1;
  KEY_F2 = KEY_F0 + 2;
  KEY_F3 = KEY_F0 + 3;
  KEY_F4 = KEY_F0 + 4;
  KEY_F5 = KEY_F0 + 5;
  KEY_F6 = KEY_F0 + 6;
  KEY_F7 = KEY_F0 + 7;
  KEY_F8 = KEY_F0 + 8;
  KEY_F9 = KEY_F0 + 9;
  KEY_F10 = KEY_F0 + 10;
  KEY_F11 = KEY_F0 + 11;
  KEY_F12 = KEY_F0 + 12;
  KEY_DC = 330;
  KEY_IC = 331;
  KEY_NPAGE = 338;
  KEY_PPAGE = 339;
  KEY_STAB = 340;
  KEY_ENTER = 343;
  KEY_A1 = 348;
  KEY_A3 = 349;
  KEY_B2 = 350;
  KEY_C1 = 351;
  KEY_C3 = 352;
  KEY_BTAB = 353;
  KEY_CANCEL = 355;
  KEY_END = 360;

var
  stdscr: PWINDOW = nil;
  ESCDELAY: Longint = 1000;
  LINES: Longint = 0;
  COLS: Longint = 0;

function initscr: PWINDOW;
function endwin: Longint;
function resize_term(lines_, cols_: Longint): Longint;
function raw: Longint;
function cbreak: Longint;
function noecho: Longint;
function nodelay(win: PWINDOW; bf: Bool): Longint;
function intrflush(win: PWINDOW; bf: Bool): Longint;
function keypad(win: PWINDOW; bf: Bool): Longint;
function start_color: Longint;
function init_pair(pair: Smallint; f, b: NC_FPC_COLOR): Longint;
function curs_set(visibility: Longint): Longint;
function COLOR_PAIR(n: cint): cint;
function getmaxx(win: PWINDOW): Smallint;
function getmaxy(win: PWINDOW): Smallint;
function clear: Longint;
function erase: Longint;
function move(y, x: Smallint): Longint;
function refresh: Longint;
function mvaddch(y, x: Smallint; ch: chtype): Longint;
function wgetch(win: PWINDOW): Longint;
function getch: Longint;
function ungetch(ch: Longint): Longint;

implementation

{ The host draws the screen: cols x rows cells of two bytes, the cursor
  (column, row) and its visibility (curs_set's value). }
procedure ra_present(cells: PByte; cols, rows, cx, cy, cursor: LongInt); cdecl; external name 'ra_present';
{ The next queued key (a character or a KEY_ code), or -1 if none. }
function ra_key_take: LongInt; cdecl; external name 'ra_key_take';
{ Waits until the host has a key for the game (wgetch in blocking mode). }
procedure ra_key_wait; cdecl; external name 'ra_key_wait';

const
  MaxPairs = 256;

var
  Win: TWINDOW;
  Cells: array of chtype;
  Out: array of Byte;
  PairFg, PairBg: array[0..MaxPairs - 1] of Byte;
  Visibility: Longint = 1;
  Pushed: array[0..15] of Longint;
  PushedCount: Integer = 0;

function initscr: PWINDOW;
begin
  FillChar(Win, SizeOf(Win), 0);
  { The terminal's size: DRL's console needs 80x25. }
  Win.maxy := 25;
  Win.maxx := 80;
  SetLength(Cells, Win.maxy * Win.maxx);
  FillDWord(Cells[0], Length(Cells), Ord(' '));
  FillChar(PairFg, SizeOf(PairFg), COLOR_WHITE);
  FillChar(PairBg, SizeOf(PairBg), COLOR_BLACK);
  stdscr := @Win;
  LINES := Win.maxy;
  COLS := Win.maxx;
  Result := stdscr;
end;

function endwin: Longint;
begin
  Result := OK;
end;

function resize_term(lines_, cols_: Longint): Longint;
begin
  Win.maxy := lines_;
  Win.maxx := cols_;
  SetLength(Cells, lines_ * cols_);
  FillDWord(Cells[0], Length(Cells), Ord(' '));
  LINES := lines_;
  COLS := cols_;
  Result := OK;
end;

function raw: Longint;
begin
  Result := OK;
end;

function cbreak: Longint;
begin
  Result := OK;
end;

function noecho: Longint;
begin
  Result := OK;
end;

function nodelay(win: PWINDOW; bf: Bool): Longint;
begin
  win^.delay := not bf;
  Result := OK;
end;

function intrflush(win: PWINDOW; bf: Bool): Longint;
begin
  Result := OK;
end;

function keypad(win: PWINDOW; bf: Bool): Longint;
begin
  Result := OK;
end;

function start_color: Longint;
begin
  Result := OK;
end;

function init_pair(pair: Smallint; f, b: NC_FPC_COLOR): Longint;
begin
  if (pair <= 0) or (pair >= MaxPairs) then Exit(ERR);
  PairFg[pair] := f and 7;
  PairBg[pair] := b and 7;
  Result := OK;
end;

function curs_set(visibility: Longint): Longint;
begin
  Result := ncurses.Visibility;
  ncurses.Visibility := visibility;
end;

function COLOR_PAIR(n: cint): cint;
begin
  Result := n shl 8;
end;

function getmaxx(win: PWINDOW): Smallint;
begin
  Result := win^.maxx;
end;

function getmaxy(win: PWINDOW): Smallint;
begin
  Result := win^.maxy;
end;

function clear: Longint;
begin
  FillDWord(Cells[0], Length(Cells), Ord(' '));
  Win.cury := 0;
  Win.curx := 0;
  Result := OK;
end;

function erase: Longint;
begin
  Result := clear;
end;

function move(y, x: Smallint): Longint;
begin
  if (y < 0) or (x < 0) or (y >= Win.maxy) or (x >= Win.maxx) then Exit(ERR);
  Win.cury := y;
  Win.curx := x;
  Result := OK;
end;

function refresh: Longint;
var
  i, pair: Integer;
  c: chtype;
  fg, bg, attr: Byte;
begin
  SetLength(Out, Length(Cells) * 2);
  for i := 0 to High(Cells) do
  begin
    c := Cells[i];
    pair := (c and A_COLOR) shr 8;
    if pair = 0 then
    begin
      fg := COLOR_WHITE;
      bg := COLOR_BLACK;
    end
    else
    begin
      fg := PairFg[pair];
      bg := PairBg[pair];
    end;
    attr := fg or (bg shl 4);
    if c and A_BOLD <> 0 then attr := attr or 8;
    if c and A_ALTCHARSET <> 0 then attr := attr or $80;
    Out[i * 2] := c and A_CHARTEXT;
    Out[i * 2 + 1] := attr;
  end;
  ra_present(@Out[0], Win.maxx, Win.maxy, Win.curx, Win.cury, Visibility);
  Result := OK;
end;

function mvaddch(y, x: Smallint; ch: chtype): Longint;
begin
  if move(y, x) <> OK then Exit(ERR);
  Cells[y * Win.maxx + x] := ch;
  if x + 1 < Win.maxx then
    Win.curx := x + 1;
  Result := OK;
end;

function wgetch(win: PWINDOW): Longint;
begin
  if PushedCount > 0 then
  begin
    Dec(PushedCount);
    Exit(Pushed[PushedCount]);
  end;
  Result := ra_key_take;
  while (Result = ERR) and win^.delay do
  begin
    ra_key_wait;
    Result := ra_key_take;
  end;
end;

function getch: Longint;
begin
  Result := wgetch(stdscr);
end;

function ungetch(ch: Longint): Longint;
begin
  if PushedCount > High(Pushed) then Exit(ERR);
  Pushed[PushedCount] := ch;
  Inc(PushedCount);
  Result := OK;
end;

end.
