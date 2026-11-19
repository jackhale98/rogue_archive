{ SPDX-License-Identifier: GPL-2.0-only }
{ FreePascal's dynlibs unit for wasip1, which has none: the same libraries
  as the dl unit (port/wasm/dl.pas): those the module was linked with, by
  name, and no others. }
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

uses dl;

function LoadLibrary(const Name: RawByteString): TLibHandle;
begin
  Result := TLibHandle(dlopen(PAnsiChar(Name), RTLD_LAZY));
end;

function SafeLoadLibrary(const Name: RawByteString): TLibHandle;
begin
  Result := LoadLibrary(Name);
end;

function GetProcedureAddress(Lib: TLibHandle; const ProcName: AnsiString): Pointer;
begin
  if Lib = NilHandle then Exit(nil);
  Result := dlsym(Pointer(Lib), PAnsiChar(ProcName));
end;

function GetProcAddress(Lib: TLibHandle; const ProcName: AnsiString): Pointer;
begin
  Result := nil;
end;

function UnloadLibrary(Lib: TLibHandle): Boolean;
begin
  Result := dlclose(Pointer(Lib)) = 0;
end;

function FreeLibrary(Lib: TLibHandle): Boolean;
begin
  Result := UnloadLibrary(Lib);
end;

function GetLoadErrorStr: string;
begin
  Result := 'the library is not linked into this WebAssembly module';
end;

end.
