// SPDX-License-Identifier: GPL-2.0-only
/**
 * Runs a FreePascal program built for this port (an Emscripten module whose
 * entry is ra_start, port/start.c) under Node, with host directories mounted.
 * The build uses it to run upstream's drlwad in WebAssembly, so the WAD files'
 * precompiled Lua matches the browser's Lua (bytecode records word sizes).
 *
 *   node run-node.mjs <module.cjs> --mount <host dir>=<path> ... -- <args...>
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const modulePath = path.resolve(argv.shift());
const mounts = [];
while (argv[0] === '--mount') {
  argv.shift();
  const [host, target] = argv.shift().split('=');
  mounts.push({ host: path.resolve(host), target });
}
if (argv[0] === '--') argv.shift();

const factory = require(modulePath);
const mod = await factory({
  raArgs: [path.basename(modulePath, '.cjs'), ...argv],
  preRun: [
    (M) => {
      for (const { host, target } of mounts) {
        let at = '';
        for (const part of target.split('/').filter(Boolean)) {
          at += `/${part}`;
          if (!M.FS.analyzePath(at).exists) M.FS.mkdir(at);
        }
        M.FS.mount(M.NODEFS, { root: host }, target);
      }
    },
  ],
});
let status = 0;
try {
  await mod.ccall('ra_start', null, [], [], { async: true });
} catch (error) {
  if (error?.name !== 'ExitStatus') throw error;
  status = error.status;
}
process.exit(status);
