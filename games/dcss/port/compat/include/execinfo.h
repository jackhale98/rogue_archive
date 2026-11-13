/* SPDX-License-Identifier: GPL-2.0-or-later */
/*
 * glibc backtrace declarations for DCSS's crash handler (crash.cc enables
 * them on every Unix-like target). WebAssembly has no native stack walking;
 * these report an empty backtrace (see compat-stubs.c).
 */
#ifndef ROGUE_ARCHIVE_EXECINFO_H
#define ROGUE_ARCHIVE_EXECINFO_H
#ifdef __cplusplus
extern "C" {
#endif
int backtrace(void **buffer, int size);
char **backtrace_symbols(void *const *buffer, int size);
void backtrace_symbols_fd(void *const *buffer, int size, int fd);
#ifdef __cplusplus
}
#endif
#endif
