// SPDX-License-Identifier: GPL-2.0-only
/**
 * Web Worker hosting DRL's WebAssembly module in its console (text) mode;
 * the host itself is adapter/host.ts, which the graphical mode runs on the
 * page instead.
 */
import type { FromWorker, ToWorker } from './protocol.ts';
import { createHost } from './host.ts';

const scope = self as unknown as {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
};

const host = createHost({ post: (message, transfer) => scope.postMessage(message, transfer ?? []) });
scope.onmessage = (event: MessageEvent<ToWorker>) => host.receive(event.data);
