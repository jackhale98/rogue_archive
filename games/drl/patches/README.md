# DRL patches

DRL's own source is compiled unmodified (`patches/drl/` is empty). The port adds files instead (`port/`): the console's curses and the few FreePascal units WebAssembly lacks. Three small patches are needed elsewhere, each to a dependency, none touching gameplay. `scripts/build.sh` applies them in order (`NNNN-*.patch` per directory); `scripts/ensure-fpc.sh` applies the compiler's.

## `fpc/0001-wasm32-c-varargs.patch` (FreePascal compiler)

**Why:** FreePascal's WebAssembly backend could not call C functions with variable arguments. A call to a `varargs` function with any variable argument stopped the compiler ("Internal error 2021091801": the evaluation stack did not balance, because the call's function type left the variable arguments out), and the backend passed them as extra WebAssembly parameters, which is not clang's ABI. FPC Valkyrie calls `luaL_error` and `lua_pushfstring` with variable arguments in about 50 places.

**What:** clang's ABI for variadic functions on wasm32: one extra `i32` parameter after the fixed ones, the address of a buffer in linear memory holding the variable arguments after the default promotions (which FreePascal already applies), each at its natural alignment. `twasmcallnode` (`compiler/wasm32/nwasmcal.pas`) stores the arguments in a temp and passes its address; every varargs function type gets the extra parameter (`symcpu.pas`); and the variable arguments' parameter offsets continue after the fixed ones instead of restarting at 0 (`cpupara.pas`), so they are pushed after them.

**Gameplay:** none (a compiler change). **Test:** a Pascal call of C's `printf` with a string, an integer, a 64-bit integer, a double and a character formats them correctly; Valkyrie's Lua errors reach Lua with their formatted messages. **Upstream:** not submitted (the project does not take AI-generated submissions from us); worth reporting to FreePascal by a maintainer.

## `fpcvalkyrie/0001-vutil-tansistringarray-fpc-3.3.patch`

**Why:** FreePascal 3.3's `SysUtils` defines `TAnsiStringArray`, as Valkyrie's `vutil` does. In a unit that uses both (`vstoreinterface`, `vsteam`), the implementation section sees `SysUtils`' type and the interface `vutil`'s: "Function header doesn't match any method". Upstream builds with FreePascal 3.2.2, which has no such type.

**What:** with FreePascal 3.3 or later, `vutil.TAnsiStringArray` is `SysUtils.TAnsiStringArray` (the same type under both names); earlier compilers are unaffected. **Gameplay:** none.

## `lua/0001-lua-integer-64-bit.patch` (Lua 5.1.5)

**Why:** FPC Valkyrie declares `lua_Integer` as `Int64` (`libs/vluatypes.inc`), which Lua 5.1's `ptrdiff_t` is on the 64-bit desktops DRL is built for, but not on wasm32 (32 bits): `wasm-ld` reported signature mismatches for `lua_tointeger` and `lua_pushinteger`, which would trap when called.

**What:** `LUA_INTEGER` is `long long`, so Lua and the game agree, and integers behave as on the desktop builds. **Gameplay:** none (it makes WebAssembly match the desktop).
