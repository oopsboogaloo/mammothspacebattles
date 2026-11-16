// Runs a blueprint's measurement off the page's thread (measure.ts), reporting progress.
import { measure } from "./measure.ts";
import type { Blueprint } from "./model.ts";

self.onmessage = (e: MessageEvent<{ id: number; bp: Blueprint; rows: Record<string, number>[] }>) => {
  const { id, bp, rows } = e.data;
  try {
    const g = measure(bp, rows, 24);
    for (;;) {
      const r = g.next();
      if (r.done) {
        self.postMessage({ id, rows: r.value });
        return;
      }
      self.postMessage({ id, progress: r.value });
    }
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
