# The Tiles display's rendering check (evidence)

Screenshots from the check that DRL's graphical mode draws on WebGL 2 as on a desktop (docs/games/drl-feasibility.md, "The graphical mode"). They show DRL's art: CC BY-SA 4.0, art by Derek Yu, modified and extended by Łukasz Śliwiński (games/drl/licenses/DRL-graphics-ATTRIBUTION.txt). Not shipped.

| File | What |
|---|---|
| `level-seed4242-native.png` | Native Linux build of the same sources (FreePascal 3.3.1, upstream's libSDL3 3.4.2 from `ext/linux`, SDL3_image 3.4.0 built from the same source, Mesa llvmpipe OpenGL 3.3 core under Xvfb): seeded game 4242, the first level after the intro, 1280×800 |
| `level-seed4242-webkit.png` | The same keys in Playwright's WebKit (WPE, Linux), WebGL 2: 0.004% of pixels differ from the native picture |
| `level-seed4242-chromium.png` | The same in headless Chromium (ANGLE on SwiftShader): 0.13% of pixels differ, all in the edges of text glyphs |
| `level-seed4242-chromium-vs-native-diff.png` | The difference, amplified ×8 |
| `main-menu-*.jpg` | DRL's main menu: native, WebKit, Chromium (ANGLE on SwiftShader, and on Mesa's OpenGL) |
| `inventory-webkit.png` | The inventory over the level, WebKit |
| `before-fix-credits-chromium-swiftshader.jpg` | Chromium with SwiftShader before port/webgl.js kept vertex arrays enabled: the title art missing, the logo drawn from stale vertices |

The web pictures were read from the canvas at a frame boundary (`preserveDrawingBuffer`, `toDataURL` in an animation frame); the native ones with ImageMagick's `import` from Xvfb.

`native.sh` builds and runs the native reference (`native.sh 1280x800 <out dir> wait:8000 Return@3000 shot:menu.png`; steps as `xkeys.py` reads them); the browser side was driven with Playwright through the same keys (DRL's seeded game: New game, Seeded game, 4242, the defaults, a name, the intro skipped).
