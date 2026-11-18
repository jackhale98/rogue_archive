{ SPDX-License-Identifier: GPL-2.0-only }
{ FreePascal's video unit (rtl-console) for wasip1, which has none. DRL's
  drlio lists it (for colour names and a screen effect that is commented
  out); the console itself is drawn through curses (port/ncurses.pas), so
  this has FPC's declarations and draws nothing. }
unit video;

{$mode objfpc}

interface

type
  PVideoMode = ^TVideoMode;
  TVideoMode = record
    Col, Row: Word;
    Color: Boolean;
  end;
  TVideoCell = Word;
  PVideoCell = ^TVideoCell;
  TVideoBuf = array[0..32759] of TVideoCell;
  PVideoBuf = ^TVideoBuf;

const
  Black = 0;
  Blue = 1;
  Green = 2;
  Cyan = 3;
  Red = 4;
  Magenta = 5;
  Brown = 6;
  LightGray = 7;
  DarkGray = 8;
  LightBlue = 9;
  LightGreen = 10;
  LightCyan = 11;
  LightRed = 12;
  LightMagenta = 13;
  Yellow = 14;
  White = 15;
  Blink = 128;

  crHidden = 0;
  crUnderLine = 1;
  crBlock = 2;
  crHalfBlock = 3;

var
  ScreenWidth: Word = 0;
  ScreenHeight: Word = 0;
  ScreenColor: Boolean = True;
  CursorX: Word = 0;
  CursorY: Word = 0;
  VideoBuf: PVideoBuf = nil;
  OldVideoBuf: PVideoBuf = nil;
  VideoBufSize: Longint = 0;

procedure InitVideo;
procedure DoneVideo;
procedure ClearScreen;
procedure UpdateScreen(Force: Boolean);
procedure SetCursorPos(NewCursorX, NewCursorY: Word);
procedure SetCursorType(NewType: Word);
procedure GetVideoMode(var Mode: TVideoMode);
function SetVideoMode(const Mode: TVideoMode): Boolean;

implementation

procedure InitVideo;
begin
end;

procedure DoneVideo;
begin
end;

procedure ClearScreen;
begin
end;

procedure UpdateScreen(Force: Boolean);
begin
end;

procedure SetCursorPos(NewCursorX, NewCursorY: Word);
begin
  CursorX := NewCursorX;
  CursorY := NewCursorY;
end;

procedure SetCursorType(NewType: Word);
begin
end;

procedure GetVideoMode(var Mode: TVideoMode);
begin
  Mode.Col := ScreenWidth;
  Mode.Row := ScreenHeight;
  Mode.Color := ScreenColor;
end;

function SetVideoMode(const Mode: TVideoMode): Boolean;
begin
  Result := False;
end;

end.
