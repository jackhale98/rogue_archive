// SPDX-License-Identifier: GPL-2.0-or-later
/*
 * Conformance-test platform layer for the native build: the same socket
 * replacement as port/rogue-archive-platform.cc, but driven by a key script
 * instead of a browser. Linked into upstream's native objects by
 * scripts/test-engine.sh; the WebAssembly side runs the real platform layer
 * with tests/conformance/replay-hooks.js providing the same script.
 *
 *   RA_REPLAY_KEYS  comma-separated key codes, one delivered each time the
 *                   game waits for input (after the initial "attach")
 *   RA_REPLAY_OUT   file receiving every complete message the game sends
 *
 * When the script runs out the process exits, so both builds stop at the
 * same point. A key is only ever offered while the game is blocked waiting,
 * never to its non-blocking checks, so timing cannot change the game.
 */
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <string>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace
{
constexpr int RA_SOCKET = 1000;
std::deque<std::string> inbox;
std::deque<std::string> keys;
std::string partial;
FILE *out = nullptr;
bool loaded = false;

void load()
{
    if (loaded)
        return;
    loaded = true;
    inbox.push_back("{\"msg\":\"attach\",\"primary\":true}");
    const char *list = getenv("RA_REPLAY_KEYS");
    std::string all = list ? list : "";
    size_t start = 0;
    while (start < all.size())
    {
        size_t comma = all.find(',', start);
        if (comma == std::string::npos)
            comma = all.size();
        if (comma > start)
            keys.push_back("{\"msg\":\"key\",\"keycode\":" + all.substr(start, comma - start) + "}");
        start = comma + 1;
    }
    const char *path = getenv("RA_REPLAY_OUT");
    out = fopen(path ? path : "/dev/null", "w");
}

// The game is blocked waiting for input: offer the next key, or stop.
void wait_for_input()
{
    load();
    if (!inbox.empty())
        return;
    if (keys.empty())
    {
        fflush(out);
        _exit(0);
    }
    inbox.push_back(keys.front());
    keys.pop_front();
}
}

extern "C" {

int socket(int, int, int) { return RA_SOCKET; }
int bind(int fd, const struct sockaddr *, socklen_t) { return fd == RA_SOCKET ? 0 : -1; }
int setsockopt(int fd, int, int, const void *, socklen_t) { return fd == RA_SOCKET ? 0 : -1; }

ssize_t sendto(int fd, const void *data, size_t length, int, const struct sockaddr *, socklen_t)
{
    if (fd != RA_SOCKET)
        return -1;
    load();
    partial.append(static_cast<const char *>(data), length);
    size_t newline;
    while ((newline = partial.find('\n')) != std::string::npos)
    {
        std::string line = partial.substr(0, newline);
        partial.erase(0, newline + 1);
        // Messages for a WebTiles server ("*...") are not game output.
        if (!line.empty() && line[0] != '*')
            fprintf(out, "%s\n", line.c_str());
    }
    return static_cast<ssize_t>(length);
}

ssize_t recvfrom(int fd, void *data, size_t capacity, int, struct sockaddr *address, socklen_t *address_length)
{
    if (fd != RA_SOCKET)
        return -1;
    wait_for_input();
    if (address && address_length && *address_length >= sizeof(sockaddr_un))
    {
        sockaddr_un *from = reinterpret_cast<sockaddr_un *>(address);
        memset(from, 0, sizeof(*from));
        from->sun_family = AF_UNIX;
        strcpy(from->sun_path, "/rogue-archive/client");
        *address_length = sizeof(sockaddr_un);
    }
    std::string message = inbox.front();
    inbox.pop_front();
    size_t length = message.size() < capacity ? message.size() : capacity;
    memcpy(data, message.data(), length);
    return static_cast<ssize_t>(length);
}

static int ready_set(int nfds, fd_set *readable, fd_set *writable, fd_set *failed)
{
    const bool watching = readable && nfds > RA_SOCKET && FD_ISSET(RA_SOCKET, readable);
    if (readable)
        FD_ZERO(readable);
    if (writable)
        FD_ZERO(writable);
    if (failed)
        FD_ZERO(failed);
    if (watching && !inbox.empty())
    {
        FD_SET(RA_SOCKET, readable);
        return 1;
    }
    return 0;
}

int select(int nfds, fd_set *readable, fd_set *writable, fd_set *failed, struct timeval *timeout)
{
    load();
    if (!timeout || timeout->tv_sec > 0 || timeout->tv_usec > 0)
        wait_for_input();
    return ready_set(nfds, readable, writable, failed);
}

int pselect(int nfds, fd_set *readable, fd_set *writable, fd_set *failed,
            const struct timespec *timeout, const sigset_t *)
{
    load();
    if (!timeout || timeout->tv_sec > 0 || timeout->tv_nsec > 0)
        wait_for_input();
    return ready_set(nfds, readable, writable, failed);
}

int usleep(useconds_t) { return 0; }

} // extern "C"
