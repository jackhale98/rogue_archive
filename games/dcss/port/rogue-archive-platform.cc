// SPDX-License-Identifier: GPL-2.0-or-later
/*
 * Rogue Archive platform layer for Dungeon Crawl Stone Soup (WebAssembly).
 *
 * DCSS already has a browser front end: in WebTiles builds the game sends
 * JSON describing the map, menus, messages and player state to upstream's
 * JavaScript client over a Unix datagram socket, and reads the client's key
 * and UI messages from the same socket. Run with -headless, it uses nothing
 * else (no terminal).
 *
 * This file replaces that socket with the Web Worker hosting the game, so the
 * upstream client in the page talks to the game directly, with no server:
 *
 *   socket/bind/setsockopt  succeed on a placeholder descriptor
 *   sendto                  hands each outgoing fragment to the worker
 *   recvfrom                waits (Asyncify) for the next message from the page
 *   select (zero timeout)   reports whether a message from the page is queued
 *   pselect                 waits for the next message from the page
 *   usleep                  returns at once: the client paces animations itself
 *                           from the "delay" messages the game sends
 *
 * These definitions take precedence over the C library's when linking. No
 * upstream source is modified.
 */
#include <emscripten.h>

#include <cerrno>
#include <cstring>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace
{
// The game's only socket. Must be below FD_SETSIZE; real descriptors in the
// Emscripten file system are allocated from 0 upwards and never reach it.
constexpr int RA_SOCKET = 1000;
}

// ---------------------------------------------------------------------------
// JavaScript bridge. The worker installs these hooks on `Module` before main().

EM_JS(void, ra_send, (const void *data, int length), {
    Module.raSend(HEAPU8.slice(data, data + length));
});

EM_JS(int, ra_pending, (void), {
    return Module.raPending() ? 1 : 0;
});

EM_ASYNC_JS(void, ra_wait, (void), {
    await Module.raWait();
});

// Copies the next queued message (at most `capacity` bytes) to `out`;
// returns its length. Only called when a message is queued.
EM_JS(int, ra_take, (void *out, int capacity), {
    var bytes = Module.raTake();
    var length = Math.min(bytes.length, capacity);
    HEAPU8.set(bytes.subarray(0, length), out);
    return length;
});

extern "C" {

int socket(int domain, int type, int protocol)
{
    (void) domain;
    (void) type;
    (void) protocol;
    return RA_SOCKET;
}

int bind(int fd, const struct sockaddr *address, socklen_t length)
{
    (void) address;
    (void) length;
    if (fd != RA_SOCKET)
    {
        errno = EBADF;
        return -1;
    }
    return 0;
}

int setsockopt(int fd, int level, int name, const void *value, socklen_t length)
{
    (void) level;
    (void) name;
    (void) value;
    (void) length;
    if (fd != RA_SOCKET)
    {
        errno = EBADF;
        return -1;
    }
    return 0;
}

ssize_t sendto(int fd, const void *data, size_t length, int flags,
               const struct sockaddr *address, socklen_t address_length)
{
    (void) flags;
    (void) address;
    (void) address_length;
    if (fd != RA_SOCKET)
    {
        errno = EBADF;
        return -1;
    }
    ra_send(data, (int) length);
    return (ssize_t) length;
}

ssize_t recvfrom(int fd, void *data, size_t capacity, int flags,
                 struct sockaddr *address, socklen_t *address_length)
{
    (void) flags;
    if (fd != RA_SOCKET)
    {
        errno = EBADF;
        return -1;
    }
    while (!ra_pending())
        ra_wait();
    if (address && address_length && *address_length >= sizeof(sockaddr_un))
    {
        sockaddr_un *from = reinterpret_cast<sockaddr_un *>(address);
        memset(from, 0, sizeof(*from));
        from->sun_family = AF_UNIX;
        strcpy(from->sun_path, "/rogue-archive/client");
        *address_length = sizeof(sockaddr_un);
    }
    return ra_take(data, (int) capacity);
}

// The game only selects on its socket (in headless mode it never reads stdin).
static int ready_set(int nfds, fd_set *readable, fd_set *writable, fd_set *failed)
{
    const bool watching = readable && nfds > RA_SOCKET && FD_ISSET(RA_SOCKET, readable);
    if (readable)
        FD_ZERO(readable);
    if (writable)
        FD_ZERO(writable);
    if (failed)
        FD_ZERO(failed);
    if (watching && ra_pending())
    {
        FD_SET(RA_SOCKET, readable);
        return 1;
    }
    return 0;
}

int select(int nfds, fd_set *readable, fd_set *writable, fd_set *failed, struct timeval *timeout)
{
    const bool block = !timeout || timeout->tv_sec > 0 || timeout->tv_usec > 0;
    if (block)
        while (!ra_pending())
            ra_wait();
    return ready_set(nfds, readable, writable, failed);
}

int pselect(int nfds, fd_set *readable, fd_set *writable, fd_set *failed,
            const struct timespec *timeout, const sigset_t *mask)
{
    (void) mask;
    const bool block = !timeout || timeout->tv_sec > 0 || timeout->tv_nsec > 0;
    if (block)
        while (!ra_pending())
            ra_wait();
    return ready_set(nfds, readable, writable, failed);
}

int usleep(useconds_t microseconds)
{
    (void) microseconds;
    return 0;
}

} // extern "C"
