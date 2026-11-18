{ SPDX-License-Identifier: GPL-2.0-only }
{ FreePascal's Unix unit for wasip1, which has none (see baseunix.pas): the
  names FPC Valkyrie's and DRL's Unix code paths use from it. }
unit unix;

{$mode objfpc}

interface

uses baseunix;

type
  size_t = baseunix.size_t;
  ssize_t = baseunix.ssize_t;

{ Flushes a file to storage (vlog, in Valkyrie's development branch). }
function FpFsync(fd: LongInt): LongInt;
{ Runs a shell command (DRL opens web links with xdg-open): there is no
  shell, as when the command is not found. }
function fpSystem(const Command: RawByteString): LongInt;

implementation

function FpFsync(fd: LongInt): LongInt;
begin
  Result := baseunix.FpFsync(fd);
end;

function fpSystem(const Command: RawByteString): LongInt;
begin
  Result := 127 shl 8;
end;

end.
