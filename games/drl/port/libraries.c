/* SPDX-License-Identifier: GPL-2.0-only */
/*
 * The libraries of the graphical (tiles) build, for Valkyrie's run-time
 * loaders (TLibrary: dlopen and dlsym, through port/wasm/dl.pas and
 * dynlibs.pas). On a desktop they load libSDL3, libSDL3_image and libGL and
 * look each function up by name; here those are linked into the module
 * (Emscripten's SDL 3 port, SDL3_image built from source, Emscripten's WebGL
 * 2 library) and found by name in tables written from Valkyrie's own
 * loaders (scripts/libraries.mjs). Other libraries (SDL3_mixer, FMOD, Steam)
 * are not found, as on a desktop without them.
 *
 * GL: Valkyrie asks libGL for glXGetProcAddress and then for each function
 * of OpenGL 3.3 core. The answer is, in order: one of the port's own
 * functions (port/webgl.js: the differences between OpenGL 3.3 and WebGL 2
 * the game meets: GLSL 3.30 shaders, texture buffers, desktop-only formats),
 * WebGL 2's function of that name, or a stand-in that reports the name once
 * and does nothing (desktop functions WebGL 2 lacks).
 */
#include <emscripten/emscripten.h>
#include <emscripten/html5_webgl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef struct {
  const char *name;
  void *address;
} ra_symbol;

extern const ra_symbol ra_sdl3_symbols[];
extern const ra_symbol ra_sdl3_image_symbols[];
extern const ra_symbol ra_gl_absent_symbols[];

/* port/webgl.js */
extern void ra_glShaderSource(uint32_t shader, int32_t count, const char *const *strings, const int32_t *lengths);
extern void ra_glClearDepth(double depth);
extern void ra_glDepthRange(double near, double far);
extern void ra_glRenderbufferStorage(uint32_t target, uint32_t format, int32_t width, int32_t height);
extern void ra_glBindBuffer(uint32_t target, uint32_t buffer);
extern void ra_glBufferData(uint32_t target, intptr_t size, const void *data, uint32_t usage);
extern void ra_glBufferSubData(uint32_t target, intptr_t offset, intptr_t size, const void *data);
extern void ra_glBindTexture(uint32_t target, uint32_t texture);
extern void ra_glTexBuffer(uint32_t target, uint32_t format, uint32_t buffer);
extern void ra_glDeleteBuffers(int32_t n, const uint32_t *buffers);
extern void ra_glDisableVertexAttribArray(uint32_t index);
extern void ra_glEnable(uint32_t cap);
extern void ra_glDisable(uint32_t cap);
extern void ra_glEnablei(uint32_t cap, uint32_t index);
extern void ra_glDisablei(uint32_t cap, uint32_t index);
extern uint8_t ra_glIsEnabledi(uint32_t cap, uint32_t index);

static const ra_symbol gl_port[] = {
    {"glShaderSource", (void *)ra_glShaderSource},
    {"glClearDepth", (void *)ra_glClearDepth},
    {"glDepthRange", (void *)ra_glDepthRange},
    {"glRenderbufferStorage", (void *)ra_glRenderbufferStorage},
    {"glBindBuffer", (void *)ra_glBindBuffer},
    {"glBufferData", (void *)ra_glBufferData},
    {"glBufferSubData", (void *)ra_glBufferSubData},
    {"glBindTexture", (void *)ra_glBindTexture},
    {"glTexBuffer", (void *)ra_glTexBuffer},
    {"glDeleteBuffers", (void *)ra_glDeleteBuffers},
    {"glDisableVertexAttribArray", (void *)ra_glDisableVertexAttribArray},
    {"glEnable", (void *)ra_glEnable},
    {"glDisable", (void *)ra_glDisable},
    {"glEnablei", (void *)ra_glEnablei},
    {"glDisablei", (void *)ra_glDisablei},
    {"glIsEnabledi", (void *)ra_glIsEnabledi},
    {NULL, NULL},
};

static void *find(const ra_symbol *table, const char *name) {
  for (; table->name; table++)
    if (!strcmp(table->name, name)) return table->address;
  return NULL;
}

void ra_gl_absent(const char *name) {
  static const char *reported[64];
  static int count;
  for (int i = 0; i < count; i++)
    if (reported[i] == name) return;
  if (count < 64) reported[count++] = name;
  fprintf(stderr, "ra: %s is not in WebGL 2; ignored\n", name);
}

static void *gl_proc_address(const char *name) {
  void *address = find(gl_port, name);
  if (!address) address = emscripten_webgl_get_proc_address(name);
  if (!address) address = find(ra_gl_absent_symbols, name);
  return address;
}

/* libGL's glXGetProcAddress, which Valkyrie's GL loader asks for first. */
static void *ra_glXGetProcAddress(const char *name) { return gl_proc_address(name); }

enum { LIB_SDL3 = 1, LIB_SDL3_IMAGE, LIB_GL };

static int has_prefix(const char *name, const char *prefix) {
  return !strncmp(name, prefix, strlen(prefix));
}

void *ra_library_open(const char *name) {
  /* The names Valkyrie's loaders open on Linux (SDL3DefaultPath...). */
  if (has_prefix(name, "libSDL3.so")) return (void *)LIB_SDL3;
  if (has_prefix(name, "libSDL3_image.so")) return (void *)LIB_SDL3_IMAGE;
  if (has_prefix(name, "libGL.so")) return (void *)LIB_GL;
  return NULL;
}

void *ra_library_symbol(void *library, const char *name) {
  switch ((intptr_t)library) {
    case LIB_SDL3:
      return find(ra_sdl3_symbols, name);
    case LIB_SDL3_IMAGE:
      return find(ra_sdl3_image_symbols, name);
    case LIB_GL:
      if (!strcmp(name, "glXGetProcAddress")) return (void *)ra_glXGetProcAddress;
      return gl_proc_address(name);
  }
  return NULL;
}
