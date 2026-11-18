{ SPDX-License-Identifier: GPL-2.0-only }
{ One allocator in the module: the C library's malloc family (used by Lua and
  by Emscripten's C library) on the Pascal heap, which grows the WebAssembly
  memory itself. The module is linked with -sMALLOC=none; port/start.c serves
  the C library's few allocations before the Pascal program starts.

  After the Pascal heap grows the memory, the host's views of it must be
  replaced (ra_memory_grown, port/wasi-emscripten.js), as Emscripten does
  after its own sbrk grows it.

  Added to the program with -Faramalloc, so it is linked and initialized
  before any of the game's units. }
unit ramalloc;

{$mode objfpc}

interface

implementation

procedure ra_memory_grown(pages: LongInt); external name 'ra_memory_grown';

procedure GrowCallback(aGrowPages: LongInt);
begin
  ra_memory_grown(aGrowPages);
end;

const
  { malloc's alignment in Emscripten (max_align_t). }
  Align = 16;

{ Each block is over-allocated so that the C pointer is aligned; the word
  before it holds the Pascal pointer. }
function Aligned(size, alignment: PtrUInt): Pointer;
var
  p: Pointer;
begin
  p := GetMem(size + alignment);
  if p = nil then Exit(nil);
  Result := Pointer((PtrUInt(p) + alignment) and not PtrUInt(alignment - 1));
  PPointer(Result)[-1] := p;
end;

function c_malloc(size: PtrUInt): Pointer; cdecl; public name 'malloc';
begin
  Result := Aligned(size, Align);
end;

procedure c_free(p: Pointer); cdecl; public name 'free';
begin
  if p <> nil then FreeMem(PPointer(p)[-1]);
end;

function c_usable(p: Pointer): PtrUInt; cdecl; public name 'malloc_usable_size';
var
  base: Pointer;
begin
  if p = nil then Exit(0);
  base := PPointer(p)[-1];
  Result := MemSize(base) - (PtrUInt(p) - PtrUInt(base));
end;

function c_calloc(n, size: PtrUInt): Pointer; cdecl; public name 'calloc';
begin
  Result := c_malloc(n * size);
  if Result <> nil then FillChar(Result^, n * size, 0);
end;

function c_realloc(p: Pointer; size: PtrUInt): Pointer; cdecl; public name 'realloc';
var
  old: PtrUInt;
begin
  if p = nil then Exit(c_malloc(size));
  if size = 0 then
  begin
    c_free(p);
    Exit(nil);
  end;
  old := c_usable(p);
  if old >= size then Exit(p);
  Result := c_malloc(size);
  if Result <> nil then
  begin
    Move(p^, Result^, old);
    c_free(p);
  end;
end;

function c_memalign(alignment, size: PtrUInt): Pointer; cdecl; public name 'memalign';
begin
  if alignment < Align then alignment := Align;
  Result := Aligned(size, alignment);
end;

function c_aligned_alloc(alignment, size: PtrUInt): Pointer; cdecl; public name 'aligned_alloc';
begin
  Result := c_memalign(alignment, size);
end;

function c_posix_memalign(res: PPointer; alignment, size: PtrUInt): LongInt; cdecl; public name 'posix_memalign';
begin
  res^ := c_memalign(alignment, size);
  if res^ = nil then Result := 48 { ENOMEM } else Result := 0;
end;

initialization
  WasmGrowMemoryCallback := @GrowCallback;
end.
