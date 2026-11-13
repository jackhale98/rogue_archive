/**
 * Session lifecycle state machine shared by the launcher and the shell.
 * It enforces the order initialize -> start -> stop and rejects anything else,
 * so the UI can never claim a game is running when it is not.
 */

export type LifecycleState =
  'created' | 'initializing' | 'ready' | 'running' | 'stopping' | 'stopped' | 'failed';

export type LifecycleTransition = 'initialize' | 'initialized' | 'start' | 'stop' | 'stopped' | 'fail';

const TRANSITIONS: Record<LifecycleState, Partial<Record<LifecycleTransition, LifecycleState>>> = {
  created: { initialize: 'initializing', stop: 'stopped', fail: 'failed' },
  initializing: { initialized: 'ready', stop: 'stopping', fail: 'failed' },
  ready: { start: 'running', stop: 'stopping', fail: 'failed' },
  running: { stop: 'stopping', fail: 'failed' },
  stopping: { stopped: 'stopped', fail: 'failed' },
  stopped: {},
  failed: { stop: 'stopping', stopped: 'stopped' },
};

export class LifecycleMachine {
  #state: LifecycleState = 'created';
  readonly #listeners = new Set<(state: LifecycleState) => void>();

  get state(): LifecycleState {
    return this.#state;
  }

  can(transition: LifecycleTransition): boolean {
    return TRANSITIONS[this.#state][transition] !== undefined;
  }

  transition(transition: LifecycleTransition): LifecycleState {
    const next = TRANSITIONS[this.#state][transition];
    if (!next) {
      throw new Error(`Invalid lifecycle transition "${transition}" from "${this.#state}"`);
    }
    this.#state = next;
    for (const listener of this.#listeners) listener(next);
    return next;
  }

  subscribe(listener: (state: LifecycleState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
