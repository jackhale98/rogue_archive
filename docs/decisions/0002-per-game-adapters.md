# 0002 — Per-game adapters over a small common API

**Context.** Roguelikes differ in rendering (terminal, tiles, custom), input, prompts, timing and saves.
**Decision.** A versioned contract covering lifecycle, capabilities, input transport, persistence and status. Games publish commands and touch layouts as data; the shell renders them generically. No shared "roguelike engine" abstraction, and no game-id branches in shared code.
**Consequences.** Some duplication between adapters is accepted. Shared packages (e.g. a terminal renderer) are extracted only when a second game needs them. The test of success: DCSS should need little or no platform change.
