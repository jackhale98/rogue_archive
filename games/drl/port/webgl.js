// SPDX-License-Identifier: GPL-2.0-only
/* global GL, GLctx, raShaders, raTexBuf, raIndexed, HEAPU32, err, stringToNewUTF8, _malloc, _free */
/* global _glShaderSource, _glEnable, _glDisable, _glRenderbufferStorage, _glBindBuffer, _glBufferData */
/* global _glBufferSubData, _glBindTexture, _glDeleteBuffers */
/**
 * The differences between OpenGL 3.3 core, which DRL's graphical mode and FPC
 * Valkyrie are written for, and WebGL 2 (OpenGL ES 3.0), bridged where the
 * game meets them, so that neither DRL nor Valkyrie is patched. Linked with
 * `--js-library` into the graphical build; port/libraries.c hands these
 * functions to Valkyrie's GL loader in place of WebGL's own.
 *
 * - Shaders (glShaderSource): GLSL 3.30 becomes GLSL ES 3.00: the version
 *   line, default precisions, texture buffers as 2D integer textures,
 *   vertex-input arrays as single inputs, and the few implicit int-to-float
 *   conversions GLSL 3.30 allows and GLSL ES does not (`raShaders.fixes`:
 *   exact expressions from upstream's shaders; tests/conformance/drift.json
 *   tracks the files they come from, and the unit tests compile nothing but
 *   check each fix still matches).
 * - Texture buffers (GL_TEXTURE_BUFFER, glTexBuffer: OpenGL 3.1, not in
 *   WebGL 2), which Valkyrie's GL console uses for its cells: the buffer's
 *   data is kept here and uploaded to the texture as a 2D RGBA32UI texture,
 *   `raShaders.width` texels a row; shaders read it with texelFetch at
 *   (i % width, i / width).
 * - Per-draw-buffer blending (glEnablei/glDisablei: OpenGL 3.0) through
 *   OES_draw_buffers_indexed where the browser has it; its state is tracked
 *   here, as WebGL cannot read it back.
 * - Desktop-only forms: glClearDepth and glDepthRange take doubles (WebGL:
 *   floats); renderbuffers in the unsized GL_DEPTH_COMPONENT format
 *   (WebGL 2: sized formats only) get 24-bit depth; glEnable(GL_TEXTURE_2D),
 *   an error in OpenGL 3.3 core too, is skipped.
 * - Vertex attributes stay enabled in their vertex array object: Valkyrie
 *   disables them after each draw (vgldrawarrays.pas, the only caller, in a
 *   VAO of its own that it enables again before the next draw), and ANGLE's
 *   Vulkan back end (Chromium with SwiftShader, as in headless tests) then
 *   drew later frames from stale vertex data: missing, misplaced or
 *   stretched quads. Leaving them enabled draws the same thing everywhere.
 */
addToLibrary({
  // Valkyrie sizes the GL viewport and its framebuffers by the window size it
  // asked for, in SDL's window coordinates, which on a high-density screen
  // are fewer than the canvas's pixels (SDL_WINDOW_HIGH_PIXEL_DENSITY): as on
  // a desktop without scaling, SDL is told one pixel is one pixel here; the
  // host picks the canvas's resolution and its CSS size (adapter/tiles.ts).
  emscripten_get_device_pixel_ratio: () => 1,

  $raShaders: {
    // Texels a row of an emulated texture buffer.
    width: 256,
    header:
      '#version 300 es\n' +
      'precision highp float;\nprecision highp int;\n' +
      'precision highp sampler2D;\nprecision highp sampler3D;\n' +
      'precision highp usampler2D;\nprecision highp isampler2D;\n',
    // [from, to]: GLSL 3.30's implicit conversions in upstream's shaders.
    fixes: [
      ['oglow_color.w > 0 &&', 'oglow_color.w > 0.0 &&'], // vspriteengine.pas
      ['outline > 0 &&', 'outline > 0.0 &&'], // vspriteengine.pas
      ['tc.y < 0 ||', 'tc.y < 0.0 ||'], // vglconsole.pas
      ['tt.x = 0;', 'tt.x = 0.0;'], // vglconsole.pas
    ],
    rewrite(source) {
      const version = /^\s*#version\s+330(\s+core)?[^\n]*\n/;
      if (!version.test(source)) return source;
      let s = source.replace(version, '');
      // Texture buffers: usamplerBuffer -> usampler2D, texelFetch(b, i) -> 2D.
      const w = raShaders.width;
      for (const [, name] of s.matchAll(/\busamplerBuffer\s+(\w+)/g)) {
        s = s.replace(
          new RegExp(`texelFetch\\(\\s*${name}\\s*,\\s*([^()]*?)\\s*\\)`, 'g'),
          (_, i) => `texelFetch(${name}, ivec2((${i}) % ${w}, (${i}) / ${w}), 0)`,
        );
      }
      s = s.replace(/\busamplerBuffer\b/g, 'usampler2D');
      // Vertex inputs cannot be arrays in GLSL ES 3.00: one input per element,
      // copied into a global array of the same name at the start of main.
      const copies = [];
      s = s.replace(
        /layout\s*\(\s*location\s*=\s*(\d+)\s*\)\s*in\s+(\w+)\s+(\w+)\s*\[\s*(\d+)\s*\]\s*;/g,
        (_, location, type, name, count) => {
          const out = [];
          for (let i = 0; i < Number(count); i++) {
            out.push(`layout (location = ${Number(location) + i}) in ${type} ra_${name}_${i};`);
            copies.push(`${name}[${i}] = ra_${name}_${i};`);
          }
          out.push(`${type} ${name}[${count}];`);
          return out.join('\n');
        },
      );
      if (copies.length)
        s = s.replace(/void\s+main\s*\(\s*(void)?\s*\)\s*\{/, (m) => `${m}\n${copies.join('\n')}\n`);
      for (const [from, to] of raShaders.fixes) s = s.split(from).join(to);
      return raShaders.header + s;
    },
  },

  ra_glShaderSource__deps: ['$raShaders', 'glShaderSource', '$stringToNewUTF8', 'malloc', 'free'],
  ra_glShaderSource: (shader, count, strings, lengths) => {
    let source = '';
    for (let i = 0; i < count; i++) {
      const p = HEAPU32[(strings >> 2) + i];
      const n = lengths ? HEAP32[(lengths >> 2) + i] : -1;
      source += n < 0 ? UTF8ToString(p) : UTF8ToString(p, n);
    }
    const text = stringToNewUTF8(raShaders.rewrite(source));
    const list = _malloc(4);
    HEAPU32[list >> 2] = text;
    _glShaderSource(shader, 1, list, 0);
    _free(list);
    _free(text);
  },

  ra_glEnable__deps: ['glEnable', '$raIndexed'],
  ra_glEnable: (cap) => {
    if (cap === 0x0de1 /* GL_TEXTURE_2D */) return;
    if (cap === 0x0be2 /* GL_BLEND */) raIndexed.blend.fill(true);
    _glEnable(cap);
  },
  ra_glDisable__deps: ['glDisable', '$raIndexed'],
  ra_glDisable: (cap) => {
    if (cap === 0x0de1) return;
    if (cap === 0x0be2) raIndexed.blend.fill(false);
    _glDisable(cap);
  },

  // Per-draw-buffer blending. Without the extension, the setting for buffer 0
  // applies to all.
  $raIndexed: {
    ext: undefined,
    blend: [false, false, false, false, false, false, false, false],
    get: () => (raIndexed.ext ??= GLctx.getExtension('OES_draw_buffers_indexed')),
  },
  ra_glEnablei__deps: ['$raIndexed'],
  ra_glEnablei: (cap, index) => {
    const ext = raIndexed.get();
    if (cap === 0x0be2) raIndexed.blend[index] = true;
    if (ext) ext.enableiOES(cap, index);
    else if (index === 0) GLctx.enable(cap);
  },
  ra_glDisablei__deps: ['$raIndexed'],
  ra_glDisablei: (cap, index) => {
    const ext = raIndexed.get();
    if (cap === 0x0be2) raIndexed.blend[index] = false;
    if (ext) ext.disableiOES(cap, index);
    else if (index === 0) GLctx.disable(cap);
  },
  ra_glIsEnabledi__deps: ['$raIndexed'],
  ra_glIsEnabledi: (cap, index) => {
    if (cap === 0x0be2 && index < raIndexed.blend.length) return raIndexed.blend[index] ? 1 : 0;
    return GLctx.isEnabled(cap) ? 1 : 0;
  },

  ra_glDisableVertexAttribArray: () => {},

  ra_glClearDepth: (depth) => GLctx.clearDepth(depth),
  ra_glDepthRange: (near, far) => GLctx.depthRange(near, far),

  ra_glRenderbufferStorage__deps: ['glRenderbufferStorage'],
  ra_glRenderbufferStorage: (target, format, width, height) =>
    // GL_DEPTH_COMPONENT -> GL_DEPTH_COMPONENT24
    _glRenderbufferStorage(target, format === 0x1902 ? 0x81a6 : format, width, height),

  $raTexBuf: {
    TARGET: 0x8c2a, // GL_TEXTURE_BUFFER
    bound: 0, // the buffer bound to GL_TEXTURE_BUFFER
    texture: 0, // the texture last bound to GL_TEXTURE_BUFFER
    data: {}, // buffer -> its bytes
    textures: {}, // texture -> its buffer
    sizes: {}, // texture -> [width, height] uploaded
    upload(texture) {
      const bytes = raTexBuf.data[raTexBuf.textures[texture]];
      const tex = GL.textures[texture];
      if (!bytes || !tex) return;
      const w = raShaders.width;
      const texels = Math.max(1, Math.ceil(bytes.length / 16));
      const h = Math.ceil(texels / w);
      const pixels = new Uint32Array(w * h * 4);
      pixels.set(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >> 2));
      const previous = GLctx.getParameter(GLctx.TEXTURE_BINDING_2D);
      GLctx.bindTexture(GLctx.TEXTURE_2D, tex);
      const size = raTexBuf.sizes[texture];
      if (size && size[0] === w && size[1] === h) {
        GLctx.texSubImage2D(GLctx.TEXTURE_2D, 0, 0, 0, w, h, GLctx.RGBA_INTEGER, GLctx.UNSIGNED_INT, pixels);
      } else {
        GLctx.texParameteri(GLctx.TEXTURE_2D, GLctx.TEXTURE_MIN_FILTER, GLctx.NEAREST);
        GLctx.texParameteri(GLctx.TEXTURE_2D, GLctx.TEXTURE_MAG_FILTER, GLctx.NEAREST);
        GLctx.texImage2D(
          GLctx.TEXTURE_2D,
          0,
          GLctx.RGBA32UI,
          w,
          h,
          0,
          GLctx.RGBA_INTEGER,
          GLctx.UNSIGNED_INT,
          pixels,
        );
        raTexBuf.sizes[texture] = [w, h];
      }
      GLctx.bindTexture(GLctx.TEXTURE_2D, previous);
    },
    changed(buffer) {
      for (const texture in raTexBuf.textures)
        if (raTexBuf.textures[texture] === buffer) {
          raTexBuf.upload(Number(texture));
          // The cells of Valkyrie's GL console (four 32-bit values each:
          // foreground RGBA, background RGBA, glyph, padding): the text DRL
          // draws over its graphics, for the host (adapter/tiles.ts).
          const bytes = raTexBuf.data[buffer];
          Module['raConsole']?.(new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length >> 2));
        }
    },
  },

  ra_glBindBuffer__deps: ['$raTexBuf', 'glBindBuffer'],
  ra_glBindBuffer: (target, buffer) => {
    if (target === raTexBuf.TARGET) raTexBuf.bound = buffer;
    else _glBindBuffer(target, buffer);
  },

  ra_glBufferData__deps: ['$raTexBuf', 'glBufferData'],
  ra_glBufferData: (target, size, data, usage) => {
    if (target !== raTexBuf.TARGET) return _glBufferData(target, size, data, usage);
    const bytes = new Uint8Array(size);
    if (data) bytes.set(HEAPU8.subarray(data, data + size));
    raTexBuf.data[raTexBuf.bound] = bytes;
    raTexBuf.changed(raTexBuf.bound);
  },

  ra_glBufferSubData__deps: ['$raTexBuf', 'glBufferSubData'],
  ra_glBufferSubData: (target, offset, size, data) => {
    if (target !== raTexBuf.TARGET) return _glBufferSubData(target, offset, size, data);
    const bytes = raTexBuf.data[raTexBuf.bound];
    if (!bytes) return;
    bytes.set(HEAPU8.subarray(data, data + Math.min(size, bytes.length - offset)), offset);
    raTexBuf.changed(raTexBuf.bound);
  },

  ra_glBindTexture__deps: ['$raTexBuf', 'glBindTexture'],
  ra_glBindTexture: (target, texture) => {
    if (target === raTexBuf.TARGET) {
      raTexBuf.texture = texture;
      _glBindTexture(0x0de1 /* GL_TEXTURE_2D */, texture);
    } else _glBindTexture(target, texture);
  },

  ra_glTexBuffer__deps: ['$raTexBuf'],
  ra_glTexBuffer: (target, format, buffer) => {
    // Valkyrie's console: GL_RGBA32UI, four 32-bit values a cell.
    if (format !== 0x8d70) err(`ra: glTexBuffer format 0x${format.toString(16)} is not emulated`);
    raTexBuf.textures[raTexBuf.texture] = buffer;
    raTexBuf.upload(raTexBuf.texture);
  },

  ra_glDeleteBuffers__deps: ['$raTexBuf', 'glDeleteBuffers'],
  ra_glDeleteBuffers: (n, buffers) => {
    for (let i = 0; i < n; i++) delete raTexBuf.data[HEAPU32[(buffers >> 2) + i]];
    _glDeleteBuffers(n, buffers);
  },
});
