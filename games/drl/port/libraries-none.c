/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * The libraries of the console (text) build: none. Valkyrie's library
 * loaders (dlopen through port/wasm/dl.pas) find no SDL, SDL3_image, GL,
 * FMOD or Steam, as on a desktop without them; DRL's console mode without
 * sound needs none. The graphical build links port/libraries.c instead.
 */
#include <stddef.h>

void *ra_library_open(const char *name) {
  (void)name;
  return NULL;
}

void *ra_library_symbol(void *library, const char *name) {
  (void)library;
  (void)name;
  return NULL;
}
