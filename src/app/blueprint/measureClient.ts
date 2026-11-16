// Starts and tracks Measure (docs/blueprint/spec.md §7): in a worker, or a slice at a time on the page
// where there are no workers. Results are kept by what they measured, so going back to a design
// shows its measurement again.
import { signal } from "@preact/signals";
import { measure, measureKey, type MeasuredRow } from "./measure.ts";
import { RESPONSE_ROWS, type Blueprint } from "./model.ts";

/** Measurements by blueprint key. */
export const measured = signal<Record<string, MeasuredRow[]>>({});
/** A measurement running: how far along, 0–1, and for which key. */
export const measuring = signal<{ key: string; progress: number } | null>(null);

let worker: Worker | null = null;
let next = 1;

export function measurementOf(bp: Blueprint): MeasuredRow[] | null {
  return measured.value[measureKey(bp)] ?? null;
}

export function startMeasure(bp: Blueprint): void {
  const key = measureKey(bp);
  if (measuring.value) return;
  const rows = RESPONSE_ROWS.map((r) => r.controls);
  const id = next++;
  measuring.value = { key, progress: 0 };
  const finish = (result: MeasuredRow[] | null) => {
    measuring.value = null;
    if (result) measured.value = { ...measured.value, [key]: result };
  };
  if (typeof Worker !== "undefined") {
    try {
      worker ??= new Worker(new URL("./measureWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (e: MessageEvent<{ id: number; progress?: { done: number; total: number }; rows?: MeasuredRow[]; error?: string }>) => {
        if (e.data.id !== id) return;
        if (e.data.progress) measuring.value = { key, progress: e.data.progress.done / e.data.progress.total };
        else finish(e.data.rows ?? null);
      };
      worker.onerror = () => finish(null);
      worker.postMessage({ id, bp: JSON.parse(JSON.stringify(bp)), rows });
      return;
    } catch {
      worker = null;
    }
  }
  // No workers: a slice at a time between frames.
  const g = measure(bp, rows, 12);
  const step = () => {
    const r = g.next();
    if (r.done) return finish(r.value);
    measuring.value = { key, progress: r.value.done / r.value.total };
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
