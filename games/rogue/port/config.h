/* SPDX-License-Identifier: BSD-3-Clause */
/*
 * Build configuration for Rogue in the browser (Rogue Archive), in place of
 * the config.h upstream's configure script would generate (selected with
 * -DHAVE_CONFIG_H; see config.h.in for every option).
 *
 * The browser has no fork, shell, terminal database, users or signals worth
 * handling; files live in Emscripten's file system (/rogue, kept in
 * IndexedDB).
 */
#define HAVE_SYS_TYPES_H 1
#define HAVE_PWD_H 1
#define HAVE_GETPWUID 1
#define HAVE_GETUID 1
#define HAVE_UNISTD_H 1
#define HAVE_FCNTL_H 1
#define HAVE_LIMITS_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_MEMSET 1
#define HAVE_STRCHR 1
#define HAVE_STRERROR 1
#define HAVE_VPRINTF 1
#define HAVE_ERASECHAR 1
#define HAVE_KILLCHAR 1
#define STDC_HEADERS 1
#define RETSIGTYPE void

/* The scoreboard keeps every game's score (as upstream's default build). */
#define ALLSCORES 1
#define NUMSCORES 10
#define NUMNAME "Ten"
#ifndef SCOREFILE /* the native conformance build points these elsewhere */
#define SCOREFILE "/rogue/rogue54.scr"
#define LOCKFILE "/rogue/rogue54.lck"
#endif

#define PACKAGE_NAME "rogue"
#define PACKAGE_VERSION "5.4.4"
