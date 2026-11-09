// The world's event log can hold thousands of events, and copying them to the page with every
// worker result cost more than the rest of the world (a 1 MB message, 9 ms a result on a phone).
// The page already has the events the run started from, so the worker sends only the change.
import type { WorldEvent } from "../core/index.ts";

/** Events the run dropped from the front of the log (it is capped) and those it added. */
export interface EventDelta {
  drop: number;
  added: WorldEvent[];
}

/** The change from `before` (a copy of the log as the run began) to `after`. */
export function eventDelta(before: readonly WorldEvent[], after: readonly WorldEvent[]): EventDelta {
  // The log only grows at the end and is trimmed at the front, so `after` is `before` less some
  // leading events, then new ones. Its first event, if it is an old one, says how many went.
  let drop = after.length ? before.indexOf(after[0]) : -1;
  if (drop < 0) drop = before.length;
  return { drop, added: after.slice(before.length - drop) };
}

/** The log after the run, from the one it started from. */
export function applyEventDelta(before: readonly WorldEvent[], d: EventDelta): WorldEvent[] {
  return before.slice(d.drop).concat(d.added);
}
