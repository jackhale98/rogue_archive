import { describe, expect, it } from 'vitest';
import { controlsFor, DCSS_COMMANDS, PALETTE } from '../adapter/input.ts';
import { GameTracker, InputMode, parseLines, UiState } from '../adapter/state.ts';

const apply = (tracker: GameTracker, messages: object[]) => {
  for (const message of parseLines([JSON.stringify({ msg: 'multi', msgs: messages })]))
    tracker.apply(message);
};

describe('DCSS context from WebTiles messages', () => {
  it('follows character creation, the map and the main prompts', () => {
    const tracker = new GameTracker();
    expect(tracker.context()).toBe('loading');
    apply(tracker, [{ msg: 'ui-push', type: 'newgame-choice' }]);
    expect(tracker.context()).toBe('start');
    apply(tracker, [
      { msg: 'ui-pop' },
      { msg: 'map', cells: [] },
      { msg: 'input_mode', mode: InputMode.COMMAND },
    ]);
    expect(tracker.context()).toBe('map');
    apply(tracker, [{ msg: 'input_mode', mode: InputMode.MORE }]);
    expect(tracker.context()).toBe('more');
    apply(tracker, [{ msg: 'input_mode', mode: InputMode.YESNO }]);
    expect(tracker.context()).toBe('yesno');
    apply(tracker, [{ msg: 'input_mode', mode: InputMode.TARGET }]);
    expect(tracker.context()).toBe('look');
    apply(tracker, [{ msg: 'input_mode', mode: InputMode.TARGET_PATH }]);
    expect(tracker.context()).toBe('aim');
    apply(tracker, [{ msg: 'input_mode', mode: InputMode.TARGET_DIR }]);
    expect(tracker.context()).toBe('direction');
    apply(tracker, [{ msg: 'input_mode', mode: InputMode.PROMPT }]);
    expect(tracker.context()).toBe('prompt');
    apply(tracker, [{ msg: 'input_mode', mode: InputMode.NORMAL }]);
    expect(tracker.context()).toBe('busy');
  });

  it('puts menus, popups and text fields ahead of the input mode', () => {
    const tracker = new GameTracker();
    apply(tracker, [
      { msg: 'map' },
      { msg: 'input_mode', mode: InputMode.COMMAND },
      { msg: 'menu', tag: 'inventory' },
    ]);
    expect(tracker.context()).toBe('menu');
    apply(tracker, [{ msg: 'ui-push', type: 'describe-item' }]);
    expect(tracker.context()).toBe('popup');
    apply(tracker, [{ msg: 'ui-pop' }, { msg: 'menu', tag: 'prompt' }]);
    expect(tracker.context()).toBe('yesno');
    apply(tracker, [{ msg: 'close_menu' }, { msg: 'close_menu' }, { msg: 'init_input', tag: 'repeat' }]);
    expect(tracker.context()).toBe('text');
    apply(tracker, [
      { msg: 'close_input' },
      { msg: 'ui_state', state: UiState.VIEW_MAP },
      { msg: 'input_mode', mode: 0 },
    ]);
    expect(tracker.context()).toBe('level-map');
  });

  it('merges partial player updates', () => {
    const tracker = new GameTracker();
    apply(tracker, [{ msg: 'player', hp: 10, hp_max: 20, place: 'Dungeon' }]);
    apply(tracker, [{ msg: 'player', hp: 7 }]);
    expect(tracker.player).toMatchObject({ hp: 7, hp_max: 20, place: 'Dungeon' });
  });
});

describe('DCSS touch layouts', () => {
  const known = new Set([...DCSS_COMMANDS.map((command) => command.id), 'shell:palette', 'shell:keyboard']);

  it('offers every command but single moves (and the attacks the Attack latch sends) in the palette', () => {
    const commands = DCSS_COMMANDS.filter(
      (c) => !c.id.startsWith('move-') && !c.id.startsWith('attack-') && c.category !== 'Keys',
    );
    expect(PALETTE).toEqual(commands.map((c) => c.id));
  });

  it('leads with resting when badly hurt, and shows the Run latch', () => {
    const healthy = controlsFor('map', { hp: 20, hpMax: 20, run: false }).actions[0];
    const hurt = controlsFor('map', { hp: 5, hpMax: 20, run: false }).actions[0];
    const running = controlsFor('map', { hp: 20, hpMax: 20, run: true }).actions[0];
    expect(typeof healthy === 'object' && healthy.command).toBe('explore');
    expect(typeof hurt === 'object' && hurt.command).toBe('rest');
    expect(typeof running === 'object' && running.active).toBe(true);
  });

  it('only refers to known commands', () => {
    for (const context of [
      'map',
      'menu',
      'more',
      'yesno',
      'prompt',
      'aim',
      'look',
      'direction',
      'level-map',
    ] as const) {
      for (const action of controlsFor(context, { hp: 1, hpMax: 1, run: false }).actions) {
        const ids = typeof action === 'string' ? [action] : [action.command, ...(action.alternates ?? [])];
        for (const id of ids) expect(known.has(id), `${context}: ${id}`).toBe(true);
      }
    }
  });
});
