/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * Starting a FreePascal wasip1 program inside an Emscripten module.
 *
 * The Pascal heap is the module's only allocator: the C library's malloc
 * family is implemented over it (port/ramalloc.pas) and Emscripten links no
 * malloc of its own (-sMALLOC=none). FPC's _start takes the stack pointer at
 * entry as the start of its heap; called from JavaScript with an empty stack,
 * that is __heap_base, where Emscripten's layout (data, stack, heap) puts the
 * heap.
 *
 * Emscripten's C library allocates a little from its constructors (the
 * environment), before _start has set the Pascal heap up. Those internal
 * allocations come from a small static arena until the program starts.
 */
#include <emscripten.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>

extern void fpc_start(void) __asm__("SI_PRC_$$__START");

static unsigned char early[64 * 1024] __attribute__((aligned(16)));
static size_t early_used;
static int pascal_heap_ready;

static void *early_alloc(size_t n, size_t align) {
  size_t at = (early_used + align - 1) & ~(align - 1);
  if (at + n > sizeof early) abort();
  early_used = at + n;
  return early + at;
}

static int in_early(void *p) {
  return (unsigned char *)p >= early && (unsigned char *)p < early + sizeof early;
}

void *emscripten_builtin_malloc(size_t n) {
  return pascal_heap_ready ? malloc(n) : early_alloc(n, 16);
}

void *emscripten_builtin_memalign(size_t align, size_t n) {
  return pascal_heap_ready ? aligned_alloc(align, n) : early_alloc(n, align < 16 ? 16 : align);
}

void emscripten_builtin_free(void *p) {
  if (p && !in_early(p)) free(p);
}

void *__libc_malloc(size_t n) { return emscripten_builtin_malloc(n); }

void *__libc_calloc(size_t count, size_t n) {
  void *p = emscripten_builtin_malloc(count * n);
  if (p) memset(p, 0, count * n);
  return p;
}

void __libc_free(void *p) { emscripten_builtin_free(p); }

/* Runs the Pascal program (its units' initialization, main block and exit). */
EMSCRIPTEN_KEEPALIVE void ra_start(void) {
  pascal_heap_ready = 1;
  fpc_start();
}
