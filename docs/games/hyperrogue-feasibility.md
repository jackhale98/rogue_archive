# HyperRogue — feasibility report

Status: **port implemented** (catalog status `experimental`). Licensing is reported separately in [`games/hyperrogue/LICENSES.md`](../../games/hyperrogue/LICENSES.md); how the port works is in [`games/hyperrogue/PORTING.md`](../../games/hyperrogue/PORTING.md).

## The three release-readiness questions

| Question | Answer | Evidence |
|---|---|---|
| Can it technically run in a browser? | **Yes.** | Upstream maintains a web build (`hyperweb.cpp`). It builds from the pinned source with the project's pinned Emscripten, unmodified; start, moves, menus, message log and saving pass end-to-end tests in Chromium; a native desktop build and the shipped web build play identical seeded games (three seeds, 400 turns each). |
| Can Rogue Archive legally redistribute everything it ships? | **Yes**, under GPL-2.0-or-later. | The web build ships only compiled code and the built-in font table (DejaVu licence); music and sounds are not used. See the license report. |
| Can it deliver a polished experience? | **On desktop, yes: it is HyperRogue's own interface. On phones, plausible but unverified on real devices.** | Touch play follows upstream's mobile version and passes in emulation; frame rate on phones is unmeasured. Hence `experimental`, not `playable`. |

## Upstream

| Item | Value |
|---|---|
| Repository | https://github.com/zenorogue/hyperrogue |
| Pinned release | `v13.1p`, commit `70453170074a0695a52f11ce7a806ac3f782a48c` (the head of `master` on its release date) |
| Language / build | C++ (about 160,000 lines of game code, plus 100,000 of translations), built as one translation unit; Makefile and `mymake`; generated headers (`makeh`, `langen`) |
| Dependencies | SDL 1.2 or 2, OpenGL, zlib, optionally SDL_ttf, SDL_mixer, libpng, GLEW |
| Prior browser work | Upstream's own web version (an online demo with a start menu of highlights, no saving). |
| Mobile | Upstream's Android app (`hyperroid/`) with its own touch interface (`mobile.cpp`): tap to move, long-press, corner buttons, an on-screen compass. |

## Findings

- **Main thread, not a worker:** the web build doesn't block (one frame per animation frame) and draws with WebGL into the page's canvas, so it runs on the page; the other ports' worker/Asyncify design is not needed.
- **Saving:** off in upstream's web build (`CAP_SAVE`, `CAP_CONFIG`); upstream's switches turn it back on without patching. HyperRogue's own save rule applies (Orb of Safety or casual mode); the Android app's background save records the score when the page is left.
- **Mobile interface:** `mobile.cpp` is built around the Android app's platform code (fonts, sound, its own draw loop; `fake-mobile.cpp` draws without OpenGL). Building it for the browser would mean writing an Android-like platform layer. The port follows its interaction model instead (tap to move, slide to choose, long-press) on top of the web build's own click handling, plus the shell's dock and pad.
- **Engine equivalence:** upstream can't be built without SDL, but its `-nogui` mode runs headless; a small harness drives seeded games natively and in Node. One seed (7) diverges after 324 turns on a single monster's choice between two equally good cells; not yet explained.
- **Performance:** each frame takes about a second in headless Chromium's software WebGL (not representative); on real hardware the GPU draws. Needs a real-phone check.
- **Size:** about 9.1 MB of WebAssembly (2.6 MB gzipped) and 0.15 MB of JavaScript (0.04 MB gzipped).

## Risks

| Risk | Mitigation |
|---|---|
| Phones too slow at full resolution | Rendering resolution capped at twice CSS pixels; HyperRogue's own detail settings (menu `v`) apply. To be measured on devices. |
| Players expect a game to resume after leaving | The resume hint and known limitations explain HyperRogue's rule (Orb of Safety, casual mode). |
| Upstream changes its web main file | The drift check names the functions the port relies on. |
