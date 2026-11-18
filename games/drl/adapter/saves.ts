// SPDX-License-Identifier: GPL-2.0-only
// The player's DRL folder (the worker's /home), as files move in and out.

/** Where an imported file goes in the DRL folder: a file on its own as desktop DRL keeps it in user/drl/. */
export function importPath(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part.startsWith('.'))) return null;
  if (parts.length === 1) {
    if (parts[0] === 'settings.lua' || parts[0] === 'drl.prc') return parts[0];
    if (parts[0] === 'runtime.log' || parts[0] === 'config.lua') return null;
    return `user/drl/${parts[0]}`;
  }
  return parts[0] === 'user' && parts.length >= 3 ? parts.join('/') : null;
}
