{ SPDX-License-Identifier: GPL-2.0-only }
{ The host of port/ncurses.pas for the native conformance build: the same
  rule as the WebAssembly harness (replay-host.mjs). Keys come from the file
  in RA_KEYS (one code per line); before each, the screen is written to the
  file in RA_OUT. The next key goes to the game once the screen has been
  unchanged for StillPolls key polls (the game polls once a frame); when the
  keys run out and the screen is still for EndPolls polls, the final screen
  is written and the program ends.

  Added to the program with -Farareplay. Not shipped. }
unit rareplay;

{$mode objfpc}{$H+}

interface

implementation

uses SysUtils, Classes;

const
  StillPolls = 40;
  EndPolls = 400;

var
  Keys: array of LongInt;
  NextKey: Integer = 0;
  Polls: Integer = 0;
  Screen: array of Byte;
  Cols, Rows: LongInt;
  Dump: TextFile;
  Opened: Boolean = False;

procedure WriteScreen(const aLabel: AnsiString);
var
  y, x: Integer;
  text, colours: AnsiString;
  c: Byte;
begin
  if not Opened then Exit;
  WriteLn(Dump, '== ', aLabel);
  for y := 0 to Rows - 1 do
  begin
    text := '';
    colours := '';
    for x := 0 to Cols - 1 do
    begin
      c := Screen[(y * Cols + x) * 2];
      if (c < 32) or (c > 126) then c := Ord('?');
      text := text + Chr(c);
      colours := colours + IntToHex(Screen[(y * Cols + x) * 2 + 1], 2);
    end;
    WriteLn(Dump, text, '|', colours);
  end;
  Flush(Dump);
end;

procedure ra_present(cells: PByte; aCols, aRows, cx, cy, cursor: LongInt); cdecl; public name 'ra_present';
begin
  if cells = nil then Exit;
  if (Length(Screen) <> aCols * aRows * 2) or (CompareByte(cells^, Screen[0], Length(Screen)) <> 0) then
  begin
    Cols := aCols;
    Rows := aRows;
    SetLength(Screen, aCols * aRows * 2);
    Move(cells^, Screen[0], Length(Screen));
    Polls := 0;
  end;
end;

function ra_key_take: LongInt; cdecl; public name 'ra_key_take';
begin
  Result := -1;
  Inc(Polls);
  if NextKey < Length(Keys) then
  begin
    if Polls < StillPolls then Exit;
    WriteScreen('key ' + IntToStr(NextKey) + ': ' + IntToStr(Keys[NextKey]));
    Result := Keys[NextKey];
    Inc(NextKey);
    Polls := 0;
  end
  else if Polls >= EndPolls then
  begin
    WriteScreen('end');
    CloseFile(Dump);
    Opened := False;
    Halt(0);
  end;
end;

procedure ra_key_wait; cdecl; public name 'ra_key_wait';
begin
  Sleep(1);
end;

procedure LoadKeys;
var
  list: TStringList;
  i: Integer;
begin
  list := TStringList.Create;
  try
    list.LoadFromFile(GetEnvironmentVariable('RA_KEYS'));
    SetLength(Keys, 0);
    for i := 0 to list.Count - 1 do
      if Trim(list[i]) <> '' then
      begin
        SetLength(Keys, Length(Keys) + 1);
        Keys[High(Keys)] := StrToInt(Trim(list[i]));
      end;
  finally
    list.Free;
  end;
end;

initialization
  if GetEnvironmentVariable('RA_KEYS') <> '' then
  begin
    LoadKeys;
    AssignFile(Dump, GetEnvironmentVariable('RA_OUT'));
    Rewrite(Dump);
    Opened := True;
  end;

finalization
  // DRL ended by itself (Exit from its main menu).
  if Opened then
  begin
    WriteScreen('end');
    CloseFile(Dump);
  end;
end.
