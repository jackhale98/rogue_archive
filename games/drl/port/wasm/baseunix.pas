{ SPDX-License-Identifier: GPL-2.0-only }
{ FreePascal's BaseUnix unit for wasip1, which has none. The WebAssembly build
  is compiled as a Unix one (-dUNIX), so that FPC Valkyrie takes the code paths
  of its Linux build (the curses console, dlopen) without patches; these are
  the names those paths use: C types in declarations (wasm32's C ABI) and
  FpFsync (vlog), on WASI's fd_sync. }
unit baseunix;

{$mode objfpc}

interface

type
  cint = LongInt;
  cuint = LongWord;
  clong = LongInt;
  culong = LongWord;
  size_t = LongWord;
  ssize_t = LongInt;
  psize_t = ^size_t;
  off_t = Int64;
  time_t = Int64;
  pid_t = LongInt;

function FpFsync(fd: cint): cint;

implementation

uses wasiapi;

function FpFsync(fd: cint): cint;
begin
  if __wasi_fd_sync(fd) = __WASI_ERRNO_SUCCESS then Result := 0 else Result := -1;
end;

end.
