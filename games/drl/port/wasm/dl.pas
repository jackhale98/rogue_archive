{ SPDX-License-Identifier: GPL-2.0-only }
{ FreePascal's dl unit for wasip1, which has none. A WebAssembly module loads
  no shared libraries: the libraries a module was linked with stand in for
  them (port/libraries.c in the graphical build: SDL 3, SDL3_image and the
  GL functions of WebGL 2, by name); every other dlopen fails, as on a
  desktop without the library (FMOD, Steam, SDL3_mixer). The console build
  links none (port/libraries-none.c). }
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

function ra_library_open(Name: PAnsiChar): Pointer; cdecl; external name 'ra_library_open';
function ra_library_symbol(Lib: Pointer; Name: PAnsiChar): Pointer; cdecl; external name 'ra_library_symbol';

function dlopen(Name: PAnsiChar; Flags: LongInt): Pointer;
begin
  Result := ra_library_open(Name);
end;

function dlsym(Lib: Pointer; Name: PAnsiChar): Pointer;
begin
  Result := ra_library_symbol(Lib, Name);
end;

function dlclose(Lib: Pointer): LongInt;
begin
  if Lib = nil then Result := -1 else Result := 0;
end;

function dlerror: PAnsiChar;
begin
  Result := 'the library is not linked into this WebAssembly module';
end;

end.
