{ SPDX-License-Identifier: GPL-2.0-only }
{ FreePascal's dynlibs unit for wasip1, which has none: a WebAssembly module
  loads no shared libraries. DRL's console mode without sound loads none
  either (SDL, FMOD and Steam are optional and found missing, as on a desktop
  without them). }
unit dynlibs;

{$mode objfpc}

interface

type
  TLibHandle = PtrInt;
  TOrdinalEntry = SizeUInt;

const
  NilHandle = TLibHandle(0);
  SharedSuffix = 'wasm';

function LoadLibrary(const Name: RawByteString): TLibHandle;
function SafeLoadLibrary(const Name: RawByteString): TLibHandle;
function GetProcedureAddress(Lib: TLibHandle; const ProcName: AnsiString): Pointer;
function GetProcAddress(Lib: TLibHandle; const ProcName: AnsiString): Pointer;
function UnloadLibrary(Lib: TLibHandle): Boolean;
function FreeLibrary(Lib: TLibHandle): Boolean;
function GetLoadErrorStr: string;

implementation

function LoadLibrary(const Name: RawByteString): TLibHandle;
begin
  Result := NilHandle;
end;

function SafeLoadLibrary(const Name: RawByteString): TLibHandle;
begin
  Result := NilHandle;
end;

function GetProcedureAddress(Lib: TLibHandle; const ProcName: AnsiString): Pointer;
begin
  Result := nil;
end;

function GetProcAddress(Lib: TLibHandle; const ProcName: AnsiString): Pointer;
begin
  Result := nil;
end;

function UnloadLibrary(Lib: TLibHandle): Boolean;
begin
  Result := Lib = NilHandle;
end;

function FreeLibrary(Lib: TLibHandle): Boolean;
begin
  Result := UnloadLibrary(Lib);
end;

function GetLoadErrorStr: string;
begin
  Result := 'shared libraries are not available in WebAssembly';
end;

end.
