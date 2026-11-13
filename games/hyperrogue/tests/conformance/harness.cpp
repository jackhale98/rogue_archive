// SPDX-License-Identifier: GPL-2.0-or-later
// Engine equivalence harness: the same HyperRogue source, run without a window
// (upstream's -nogui) natively and as WebAssembly under Node, with a fixed
// seed (upstream's -fixx). It makes moves chosen by its own fixed sequence
// through upstream's movepcto() and prints a digest of the game after each
// turn; scripts/test-engine.sh checks that both builds print the same lines.
// Not deployed.
//
// Usage: harness <seed> <turns> [dump-turn]
// With dump-turn, every cell near the player is listed after that turn.

#ifdef __EMSCRIPTEN__
// The WebAssembly harness is upstream's web build, as shipped (hyperweb.cpp,
// with the flags scripts/build.sh passes), run under Node.
#define NOMAIN
#include "hyperweb.cpp"
#else
// The native harness is upstream's desktop build without font files (the
// built-in font table, as the web build), images, sounds or OpenGL extension
// loader: nothing is drawn.
#define CAP_SDLTTF 0
#define CAP_TABFONT 1
#define CAP_SDLGFX 0
#define CAP_AUDIO 0
#define CAP_PNG 0
#define CAP_GLEW 0
#define NOMAIN
#include "hyper.cpp"
#endif

namespace hr {

static unsigned long long fnv = 1469598103934665603ULL;
static void mix(long long v) {
  for(int i = 0; i < 8; i++) {
    fnv ^= (unsigned long long)((v >> (8 * i)) & 0xff);
    fnv *= 1099511628211ULL;
  }
}

static void dump() {
  celllister cl(cwt.at, 4, 100000, nullptr);
  for(int i = 0; i < isize(cl.lst); i++) {
    cell *c = cl.lst[i];
    printf("  cell %d d=%d land=%d wall=%d item=%d monst=%d mondir=%d stuntime=%d\n", i, cl.dists[i], c->land, c->wall,
      c->item, c->monst, c->mondir, c->stuntime);
  }
}

/** Everything within four steps of the player: land, wall, item, monster. */
static unsigned long long digest() {
  fnv = 1469598103934665603ULL;
  celllister cl(cwt.at, 4, 100000, nullptr);
  for(int i = 0; i < isize(cl.lst); i++) {
    cell *c = cl.lst[i];
    mix(cl.dists[i]);
    mix(c->land);
    mix(c->wall);
    mix(c->item);
    mix(c->monst);
  }
  for(int i = 0; i < ittypes; i++) mix(items[i]);
  for(int i = 0; i < motypes; i++) mix(kills[i]);
  return fnv;
}

}

int main(int argc, char **argv) {
  using namespace hr;
  if(argc < 3) {
    fprintf(stderr, "usage: harness <seed> <turns>\n");
    return 2;
  }
  int seed = atoi(argv[1]);
  int turns = atoi(argv[2]);
  int dump_turn = argc > 3 ? atoi(argv[3]) : -1;
  std::string seedarg = std::to_string(seed);
  char *args[] = {(char *)"harness", (char *)"-nogui", (char *)"-fixx", (char *)seedarg.c_str(), nullptr};
  arg::init(4, args);
  initializeCLI();
  initAll();
  arg::read(3);
  start_game();

  unsigned state = 12345u + seed;
  printf("start land=%s cells=%llx\n", linf[cwt.at->land].name, digest());
  if(dump_turn == 0) dump();
  for(int t = 0; t < turns && canmove; t++) {
    bool moved = false;
    for(int attempt = 0; attempt < 16 && !moved; attempt++) {
      state = state * 1103515245u + 12345u;
      int d = (state >> 16) % cwt.at->type;
      moved = movepcto(d, 1);
    }
    if(!moved) movepcto(-1, 1); // wait
    printf("turn=%d land=%s treasure=%d kills=%d canmove=%d cells=%llx\n", turncount, linf[cwt.at->land].name,
      gold(), tkills(), canmove ? 1 : 0, digest());
    if(turncount == dump_turn || turncount == dump_turn + 1) dump();
  }
  return 0;
}
