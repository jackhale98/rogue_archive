{ SPDX-License-Identifier: GPL-2.0-only }
{ FreePascal's dl unit for wasip1, which has none: a WebAssembly module loads
  no shared libraries, so every dlopen fails, as on a desktop without the
  library. DRL's console mode without sound needs none (SDL, FMOD and Steam
  are optional). }
unit dl;

{$mode objfpc}

interface

const
  RTLD_LAZY = $001;
  RTLD_NOW = $002;
  RTLD_BINDING_MASK = $003;
  RTLD_GLOBAL = $100;
  RTLD_LOCAL = 0;

function dlopen(Name: PAnsiChar; Flags: LongInt): Pointer;
function dlsym(Lib: Pointer; Name: PAnsiChar): Pointer;
function dlclose(Lib: Pointer): LongInt;
function dlerror: PAnsiChar;

implementation

function dlopen(Name: PAnsiChar; Flags: LongInt): Pointer;
begin
  Result := nil;
end;

function dlsym(Lib: Pointer; Name: PAnsiChar): Pointer;
begin
  Result := nil;
end;

function dlclose(Lib: Pointer): LongInt;
begin
  Result := -1;
end;

function dlerror: PAnsiChar;
begin
  Result := 'shared libraries are not available in WebAssembly';
end;

end.
