// Weld loads from Try it (docs/blueprint/spec.md §6): while the blueprint flies, each weld's worst
// load as a share of its limit, and whether it broke, kept for the blueprint as it was flown. The
// weld panel shows them, and the blueprint colours its weld points by them.
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { sandbox } from "../state.ts";
import { measureKey } from "./measure.ts";
import { welds, type Blueprint } from "./model.ts";

export type LoadKind = "tension" | "compression" | "shear" | "torque";

export interface WeldLoad {
  /** The worst share of its limit seen, 0 upwards (1: at its limit). */
  peak: number;
  /** Which way it was loaded hardest. */
  kind: LoadKind;
  broke: boolean;
}

/** The last try-out's weld loads, by weld id, for the blueprint as it was then (its key). */
export const weldLoads = signal<{ key: string; welds: Record<string, WeldLoad> } | null>(null);

/** The loads recorded for this blueprint as it is now, if it has been flown since it last changed. */
export function loadsFor(bp: Blueprint): Record<string, WeldLoad> | null {
  const l = weldLoads.value;
  return l && l.key === measureKey(bp) ? l.welds : null;
}

/** A one-line summary for the page when it comes back from Try it. */
export function loadSummary(bp: Blueprint): string | null {
  const l = loadsFor(bp);
  if (!l) return null;
  const all = Object.values(l);
  if (!all.length) return null;
  const broke = all.filter((w) => w.broke).length;
  const worst = all.reduce((a, b) => (b.peak > a.peak ? b : a));
  return broke ? `In the try-out ${broke} ${broke === 1 ? "weld" : "welds"} broke. Click a weld point to see its load.` : `In the try-out the hardest-worked weld reached ${Math.round(worst.peak * 100)}% of its limit (${worst.kind}).`;
}

/** Watches the flying world each frame and keeps each weld's peak; a reset (a new world) starts afresh. */
export function useWeldLoads(bp: Blueprint): void {
  useEffect(() => {
    const key = measureKey(bp);
    const jointToWeld = new Map<string, string>();
    for (const w of welds(bp)) for (const j of w.joints) jointToWeld.set(j.id, w.id);
    let acc: Record<string, WeldLoad> = {};
    let world = sandbox.value?.world;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const w = sandbox.value?.world;
      if (!w) return;
      if (w !== world && w.time < (world?.time ?? 0)) acc = {}; // reset & refuel: a fresh flight
      world = w;
      const present = new Set<string>();
      for (const j of w.joints) {
        const weld = jointToWeld.get(j.id);
        if (!weld) continue;
        present.add(j.id);
        const lim = j.limits;
        const ld = j.load;
        if (!ld || !lim) continue;
        const kinds: LoadKind[] = ["tension", "compression", "shear", "torque"];
        const kind = kinds.reduce((a, b) => (ld[b] / lim[b] > ld[a] / lim[a] ? b : a), "tension" as LoadKind);
        const cur = acc[weld];
        if (!cur || ld.fraction > cur.peak) acc[weld] = { peak: ld.fraction, kind, broke: cur?.broke ?? false };
      }
      // A weld whose joint has gone from the world broke.
      for (const [jid, weld] of jointToWeld) if (!present.has(jid) && w.time > 0) acc[weld] = { peak: Math.max(acc[weld]?.peak ?? 1, 1), kind: acc[weld]?.kind ?? "tension", broke: true };
      if (t - last > 200) {
        last = t;
        weldLoads.value = { key, welds: { ...acc } };
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      weldLoads.value = { key, welds: { ...acc } };
    };
  }, [bp]);
}
