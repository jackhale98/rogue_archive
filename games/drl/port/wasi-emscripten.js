// SPDX-License-Identifier: GPL-2.0-only
/* global raWasi */
/**
 * The WASI calls FreePascal's wasip1 run-time library makes that Emscripten
 * does not provide outside its standalone mode, implemented over
 * Emscripten's own file system (so IDBFS, MEMFS and NODEFS mounts work for
 * the Pascal code as for C). Linked with `--js-library`.
 *
 * Emscripten's errno values are WASI's, so an FS error's `errno` is returned
 * as it is. Paths are resolved against the directory stream the RTL passes
 * (a preopened directory: `Module.raPreopens`, opened as fds 3, 4... on
 * first use; the first is the program's working directory).
 *
 * Also: the program's arguments (`Module.raArgs`), sleeping (`poll_oneoff`
 * with clock subscriptions, through the host's `Module.raSleep(ms)`, which
 * may return a Promise: an Asyncify suspension) and refreshing the heap views
 * after the Pascal heap grows the memory (`ra_memory_grown`).
 */
addToLibrary({
  $raWasi__deps: ['$FS', '$PATH'],
  $raWasi: {
    /** fd -> path of the preopened directories. */
    preopens: null,
    /**
     * Opens the preopened directories as fds 3, 4... as the RTL expects (it
     * asks from fd 3 until one is not a preopen): `Module.raPreopens`, by
     * default only "/". The first is the program's working directory.
     */
    preopen() {
      if (raWasi.preopens) return;
      raWasi.preopens = {};
      for (const path of Module['raPreopens'] ?? ['/']) {
        const stream = FS.open(path, 0);
        const expected = 3 + Object.keys(raWasi.preopens).length;
        if (stream.fd !== expected)
          throw new Error(`the WASI directory ${path} got fd ${stream.fd}, not ${expected}`);
        raWasi.preopens[stream.fd] = path;
      }
    },
    resolve(dirfd, path, len) {
      const rel = UTF8ToString(path, len);
      if (rel.startsWith('/')) return PATH.normalize(rel);
      const dir = FS.getStream(dirfd);
      if (!dir) throw new FS.ErrnoError(8 /* EBADF */);
      return PATH.normalize(`${dir.path}/${rel}`);
    },
    errno(e) {
      if (typeof FS == 'undefined' || !(e?.name === 'ErrnoError')) throw e;
      return e.errno;
    },
    filestat(buf, stat) {
      const type = FS.isDir(stat.mode)
        ? 3
        : FS.isFile(stat.mode)
          ? 4
          : FS.isLink(stat.mode)
            ? 7
            : FS.isChrdev(stat.mode)
              ? 2
              : 0;
      const ns = (t) => BigInt(Math.floor((t instanceof Date ? t.getTime() : Number(t)) || 0)) * 1000000n;
      HEAP64[buf >> 3] = BigInt(stat.dev);
      HEAP64[(buf + 8) >> 3] = BigInt(stat.ino);
      HEAP8[buf + 16] = type;
      HEAP64[(buf + 24) >> 3] = BigInt(stat.nlink);
      HEAP64[(buf + 32) >> 3] = BigInt(stat.size);
      HEAP64[(buf + 40) >> 3] = BigInt(ns(stat.atime));
      HEAP64[(buf + 48) >> 3] = BigInt(ns(stat.mtime));
      HEAP64[(buf + 56) >> 3] = BigInt(ns(stat.ctime));
    },
  },

  args_sizes_get__deps: ['$lengthBytesUTF8'],
  args_sizes_get: (pargc, pbufsize) => {
    const args = Module['raArgs'] ?? ['program'];
    HEAP32[pargc >> 2] = args.length;
    HEAP32[pbufsize >> 2] = args.reduce((n, a) => n + lengthBytesUTF8(a) + 1, 0);
    return 0;
  },
  args_get__deps: ['$stringToUTF8', '$lengthBytesUTF8'],
  args_get: (argv, buf) => {
    const args = Module['raArgs'] ?? ['program'];
    args.forEach((arg, i) => {
      HEAP32[(argv + i * 4) >> 2] = buf;
      const n = lengthBytesUTF8(arg) + 1;
      stringToUTF8(arg, buf, n);
      buf += n;
    });
    return 0;
  },

  fd_prestat_get__deps: ['$raWasi', '$lengthBytesUTF8'],
  fd_prestat_get: (fd, buf) => {
    raWasi.preopen();
    const path = raWasi.preopens[fd];
    if (path === undefined) return 8; /* EBADF */
    HEAP8[buf] = 0;
    HEAP32[(buf + 4) >> 2] = lengthBytesUTF8(path);
    return 0;
  },
  fd_prestat_dir_name__deps: ['$raWasi', '$stringToUTF8Array', '$lengthBytesUTF8'],
  fd_prestat_dir_name: (fd, buf, len) => {
    raWasi.preopen();
    const path = raWasi.preopens[fd];
    if (path === undefined) return 8; /* EBADF */
    const bytes = [];
    stringToUTF8Array(path, bytes, 0, lengthBytesUTF8(path) + 1);
    HEAPU8.set(bytes.slice(0, Math.min(len, bytes.length - 1)), buf);
    return 0;
  },

  path_open__deps: ['$raWasi'],
  path_open__i53abi: true,
  path_open__sig: 'iiipiijjip',
  path_open: (dirfd, dirflags, path, len, oflags, rights, inheriting, fdflags, pfd) => {
    try {
      const full = raWasi.resolve(dirfd, path, len);
      // WASI rights: fd_read (bit 1), fd_write (bit 6).
      const read = (rights & 2) !== 0;
      const write = (rights & 64) !== 0;
      let flags = write ? (read ? 2 : 1) : 0;
      if (oflags & 1) flags |= 64; // O_CREAT
      if (oflags & 2) flags |= 65536; // O_DIRECTORY
      if (oflags & 4) flags |= 128; // O_EXCL
      if (oflags & 8) flags |= 512; // O_TRUNC
      if (fdflags & 1) flags |= 1024; // O_APPEND
      if (oflags & 2) {
        const node = FS.lookupPath(full).node;
        if (!FS.isDir(node.mode)) return 54; /* ENOTDIR */
      }
      const stream = FS.open(full, flags, 0o666);
      HEAP32[pfd >> 2] = stream.fd;
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },

  fd_filestat_get__deps: ['$raWasi'],
  fd_filestat_get: (fd, buf) => {
    try {
      const stream = FS.getStream(fd);
      if (!stream) return 8; /* EBADF */
      raWasi.filestat(buf, stream.node.node_ops.getattr ? FS.fstat(fd) : FS.stat(stream.path));
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  path_filestat_get__deps: ['$raWasi'],
  path_filestat_get: (dirfd, flags, path, len, buf) => {
    try {
      const full = raWasi.resolve(dirfd, path, len);
      raWasi.filestat(buf, flags & 1 ? FS.stat(full) : FS.lstat(full));
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  fd_filestat_set_size__i53abi: true,
  fd_filestat_set_size__sig: 'iij',
  fd_filestat_set_size__deps: ['$raWasi'],
  fd_filestat_set_size: (fd, size) => {
    try {
      FS.ftruncate(fd, size);
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  fd_filestat_set_times__i53abi: true,
  fd_filestat_set_times__sig: 'iijji',
  fd_filestat_set_times__deps: ['$raWasi'],
  fd_filestat_set_times: (fd, atim, mtim, flags) => {
    try {
      const stream = FS.getStream(fd);
      if (!stream) return 8; /* EBADF */
      // Flags: ATIM 1, ATIM_NOW 2, MTIM 4, MTIM_NOW 8.
      const now = Date.now();
      const st = FS.stat(stream.path);
      const a = flags & 2 ? now : flags & 1 ? atim / 1e6 : st.atime.getTime();
      const m = flags & 8 ? now : flags & 4 ? mtim / 1e6 : st.mtime.getTime();
      FS.utime(stream.path, a, m);
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  path_filestat_set_times__i53abi: true,
  path_filestat_set_times__sig: 'iiipijji',
  path_filestat_set_times__deps: ['$raWasi'],
  path_filestat_set_times: (dirfd, lookup, path, len, atim, mtim, flags) => {
    try {
      const full = raWasi.resolve(dirfd, path, len);
      const now = Date.now();
      const st = FS.stat(full);
      const a = flags & 2 ? now : flags & 1 ? atim / 1e6 : st.atime.getTime();
      const m = flags & 8 ? now : flags & 4 ? mtim / 1e6 : st.mtime.getTime();
      FS.utime(full, a, m);
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  fd_tell__deps: ['$raWasi'],
  fd_tell: (fd, poffset) => {
    const stream = FS.getStream(fd);
    if (!stream) return 8; /* EBADF */
    HEAP64[poffset >> 3] = BigInt(stream.position);
    return 0;
  },
  fd_readdir__i53abi: true,
  fd_readdir__sig: 'iipijp',
  fd_readdir__deps: ['$raWasi', '$lengthBytesUTF8', '$stringToUTF8Array'],
  fd_readdir: (fd, buf, len, cookie, pused) => {
    try {
      const stream = FS.getStream(fd);
      if (!stream) return 8; /* EBADF */
      const names = FS.readdir(stream.path);
      let used = 0;
      for (let i = cookie; i < names.length && used < len; i++) {
        const name = names[i];
        const bytes = [];
        stringToUTF8Array(name, bytes, 0, lengthBytesUTF8(name) + 1);
        bytes.pop();
        let type = 0;
        try {
          const st = FS.lstat(PATH.join2(stream.path, name));
          type = FS.isDir(st.mode) ? 3 : FS.isFile(st.mode) ? 4 : FS.isLink(st.mode) ? 7 : 0;
        } catch {
          // Unknown type (WASI's 0), as for an entry gone since the listing.
        }
        const entry = new Uint8Array(24 + bytes.length);
        const view = new DataView(entry.buffer);
        view.setBigUint64(0, BigInt(i + 1), true);
        view.setUint32(16, bytes.length, true);
        view.setUint8(20, type);
        entry.set(bytes, 24);
        const n = Math.min(entry.length, len - used);
        HEAPU8.set(entry.subarray(0, n), buf + used);
        used += n;
      }
      HEAP32[pused >> 2] = used;
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  path_create_directory__deps: ['$raWasi'],
  path_create_directory: (dirfd, path, len) => {
    try {
      FS.mkdir(raWasi.resolve(dirfd, path, len));
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  path_remove_directory__deps: ['$raWasi'],
  path_remove_directory: (dirfd, path, len) => {
    try {
      FS.rmdir(raWasi.resolve(dirfd, path, len));
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  path_unlink_file__deps: ['$raWasi'],
  path_unlink_file: (dirfd, path, len) => {
    try {
      FS.unlink(raWasi.resolve(dirfd, path, len));
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  path_readlink__deps: ['$raWasi', '$stringToUTF8Array', '$lengthBytesUTF8'],
  path_readlink: (dirfd, path, len, buf, buflen, pused) => {
    try {
      const target = FS.readlink(raWasi.resolve(dirfd, path, len));
      const bytes = [];
      stringToUTF8Array(target, bytes, 0, lengthBytesUTF8(target) + 1);
      bytes.pop();
      const n = Math.min(bytes.length, buflen);
      HEAPU8.set(bytes.slice(0, n), buf);
      HEAP32[pused >> 2] = n;
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },
  path_rename__deps: ['$raWasi'],
  path_rename: (dirfd, path, len, newfd, newpath, newlen) => {
    try {
      FS.rename(raWasi.resolve(dirfd, path, len), raWasi.resolve(newfd, newpath, newlen));
      return 0;
    } catch (e) {
      return raWasi.errno(e);
    }
  },

  /** Clock subscriptions only (sleeping): waits for the longest one. */
  poll_oneoff__async: true,
  poll_oneoff: (subs, events, n, pcount) =>
    Asyncify.handleSleep((wakeUp) => {
      let ms = 0;
      for (let i = 0; i < n; i++) {
        const sub = subs + i * 48;
        if (HEAP8[sub + 8] !== 0) continue;
        const timeout = Number(HEAP64[(sub + 24) >> 3]) / 1e6;
        ms = Math.max(ms, timeout);
      }
      const done = () => {
        for (let i = 0; i < n; i++) {
          const sub = subs + i * 48;
          const ev = events + i * 32;
          HEAP64[ev >> 3] = HEAP64[sub >> 3];
          HEAP16[(ev + 8) >> 1] = 0;
          HEAP8[ev + 10] = HEAP8[sub + 8];
        }
        HEAP32[pcount >> 2] = n;
        wakeUp(0);
      };
      const wait = Module['raSleep'] ? Module['raSleep'](ms) : new Promise((r) => setTimeout(r, ms));
      Promise.resolve(wait).then(done);
    }),

  ra_memory_grown: () => {
    updateMemoryViews();
  },
});
