/* SPDX-License-Identifier: BSD-3-Clause */
/*
 * The account Rogue runs as in the browser (Rogue Archive).
 *
 * Rogue looks up its user's home directory (the default save file goes
 * there) and shell through getpwuid(), and dereferences the result. In the
 * browser there is no user database (Emscripten's getpwuid() returns NULL),
 * so this definition, which takes precedence over the C library's when
 * linking, describes one: home is /rogue, the directory kept in IndexedDB.
 * The player's name comes from ROGUEOPTS (set by the worker), not from here.
 */
#include <pwd.h>
#include <stddef.h>
#include <sys/types.h>

static struct passwd rogue_user = {
    .pw_name = "rogue",
    .pw_passwd = "",
    .pw_uid = 0,
    .pw_gid = 0,
    .pw_gecos = "Rogue",
    .pw_dir = "/rogue",
    .pw_shell = "/bin/sh",
};

struct passwd *getpwuid(uid_t uid)
{
    (void)uid;
    return &rogue_user;
}

struct passwd *getpwnam(const char *name)
{
    (void)name;
    return &rogue_user;
}
