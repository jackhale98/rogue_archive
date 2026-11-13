# Sil-Q — feasibility report

Status: **port implemented** (catalog status `experimental`). Licensing is reported separately in [`games/sil-q/LICENSES.md`](../../games/sil-q/LICENSES.md); how the port works is in [`games/sil-q/PORTING.md`](../../games/sil-q/PORTING.md).

## The three release-readiness questions

| Question | Answer | Evidence |
|---|---|---|
| Can it technically run in a browser? | **Yes.** | Upstream v1.5.0 compiles unmodified to WebAssembly with a browser display module; new character, item prompts, message log, save, reload and continue pass end-to-end tests in Chromium; native and WebAssembly builds produce identical screens, messages and savefiles for seeded games. |
| Can Rogue Archive legally redistribute everything it ships? | **Yes**, under GPL-2.0-only (one of the two licences upstream offers), with source availability. The graphics, sounds and fonts with other terms are not shipped. | See the license report. |
| Can it deliver a polished experience? | **On desktop, yes: it is Sil's own 80×24 interface. On phones, plausible but unverified on real devices.** | The phone layout passes in emulation only. Sil is keyboard-driven; the dock follows what the game is waiting for and turns lettered choices and item prompts into buttons. Hence `experimental`, not `playable`. |

## Upstream

| Item | Value |
|---|---|
| Repository | https://github.com/sil-quirk/sil-q |
| Pinned release | `v1.5.0`, commit `09a53ab8b167660742add9ed7842b4c2301737fd` (latest stable release; `v1.5.1-beta1` exists) |
| Language / build | C (about 140,000 lines), plain makefiles per platform (`src/Makefile.std` for Unix) |
| Dependencies | None beyond the C library; front ends use curses, X11, Win32 or Cocoa |
| Front ends | `main-gcu.c` (curses), `main-x11.c`, `main-win.c`, `main-cocoa.m`, selected at startup through `main.c` |
| Prior browser work | None found for Sil-Q. Angband 4.2 has had browser builds; their approach (a term front end) is the natural one here too. |

## Platform boundary

Angband 3.0's term interface is the boundary: the game draws through `Term_*` calls and reads keys through `inkey()`, and a front end implements a handful of hooks. Files (data, saves, scores, dumps) go through stdio under `lib/`. A browser front end is about 400 lines; nothing in the game needs changing.

## Findings

- **Build:** the source list comes from upstream's `Makefile.std`; no makefile changes are needed. Upstream's `main.c` is used unchanged by naming our module as its "gcu" entry at compile time.
- **Privileges:** the Unix build gives up setuid/setgid privileges at startup and quits if it can't; the browser has none to give up. Link-time definitions of the four calls make them succeed.
- **Size:** 1.1 MB of WebAssembly and 0.4 MB of game data (the PDF manuals, sounds, fonts and tile sheets are left out). About 1.6 MB per first visit, then cached by the service worker.
- **Seeding:** Sil seeds its generator from the clock and the process id. The conformance harness fixes both; the deployed game keeps them.
- **Saves:** savefiles are named `<uid>.<name>` in `lib/save`, the same format as desktop Sil-Q of the same version; the uid is 0 in the browser.
- **Phones:** the 80×24 screen is too small to read whole on a phone. The map is shown at a readable size around the player, the sidebar becomes a status band, and lists drawn over the map open as sheets.

## Risks

| Risk | Mitigation |
|---|---|
| Sil-Q changes key bindings or screen layout | `key-coverage.ts` fails on moved bindings; the context detection reads Sil's prompts and is covered by unit tests; weekly canary against the latest release and `master`. |
| Upstream development is slow (latest stable release January 2022) | The port needs no upstream changes; a newer release is picked up by moving the pin. |
| Prompt detection relies on text | Prompts come from a small set of functions (`get_check`, `get_aim_dir`, `get_item`, `target_set_interactive`); unit tests pin each form. |
