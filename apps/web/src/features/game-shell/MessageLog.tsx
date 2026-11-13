import type { LogEntry } from '@rogue-archive/game-api';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  entries: LogEntry[];
  onClose(): void;
}

/**
 * Scrollable history of the game's messages. It follows new messages while
 * you are at the bottom, and stays put while you scroll back to read.
 */
export function MessageLog({ open, entries, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [following, setFollowing] = useState(true);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Start at the newest message each time the log opens.
  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [open]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (open && list && following) list.scrollTop = list.scrollHeight;
  }, [entries, open, following]);

  const jumpToLatest = () => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
    setFollowing(true);
  };

  return (
    <dialog ref={dialogRef} className="message-log" aria-labelledby="message-log-title" onClose={onClose}>
      <div className="message-log__header">
        <h2 id="message-log-title">Messages</h2>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => dialogRef.current?.close()}
          autoFocus
        >
          Back to game
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="message-log__empty muted">No messages yet.</p>
      ) : (
        <ol
          ref={listRef}
          className="message-log__list"
          onScroll={(event) => {
            const list = event.currentTarget;
            setFollowing(list.scrollHeight - list.scrollTop - list.clientHeight < 24);
          }}
        >
          {entries.map((entry, i) => {
            const showGroup = entry.group !== undefined && entry.group !== entries[i - 1]?.group;
            return (
              <li key={entry.id} className="message-log__entry">
                {showGroup ? <span className="message-log__group">{entry.group}</span> : null}
                <span className="message-log__text">
                  {entry.runs.map((run, i) => (
                    <span key={i} style={run.color ? { color: run.color } : undefined}>
                      {run.text}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {!following && entries.length > 0 ? (
        <button type="button" className="button button--small message-log__latest" onClick={jumpToLatest}>
          ↓ Latest
        </button>
      ) : null}
    </dialog>
  );
}
