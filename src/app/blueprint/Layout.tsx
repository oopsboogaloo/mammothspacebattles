// The page's layout (docs/blueprint/spec.md §2): the side panels fold to slim rails, and on a
// narrow screen (a folding phone, a small tablet) open panels float over the blueprint instead of
// squeezing it. The choice is kept in the browser.
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";

/** Below this width the panels float over the blueprint, and start folded. */
export const NARROW = 1000;

interface Layout {
  left: boolean;
  right: boolean;
  /** The performance or response table folded to its header. */
  stats: boolean;
}

const KEY = "msb.blueprint.layout.v1";

function load(): Layout {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return { left: true, right: true, stats: true, ...(JSON.parse(raw) as Partial<Layout>) };
  } catch {
    // Defaults below.
  }
  const wide = typeof window === "undefined" || window.innerWidth >= NARROW;
  return { left: wide, right: wide, stats: true };
}

/** Which panels are open. */
export const layout = signal<Layout>(load());
/** Whether the window is narrow (panels float). */
export const narrow = signal(typeof window !== "undefined" && window.innerWidth < NARROW);

export function setLayout(change: Partial<Layout>): void {
  layout.value = { ...layout.value, ...change };
  try {
    localStorage.setItem(KEY, JSON.stringify(layout.value));
  } catch {
    // Kept for this visit only.
  }
}

export function useNarrow(): void {
  useEffect(() => {
    const on = () => (narrow.value = window.innerWidth < NARROW);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
}

/** The fold button in a side panel's header. */
export function FoldButton({ side }: { side: "left" | "right" }) {
  return (
    <button class="ib sm fold" data-testid={`fold-${side}`} title="Fold this panel away (\\ for both)" aria-label={`Fold the ${side} panel`} onClick={() => setLayout({ [side]: false })}>
      {side === "left" ? "⇤" : "⇥"}
    </button>
  );
}

/** A folded panel: a slim rail with its name; tap it to open the panel again. */
export function Rail({ side, label, note }: { side: "left" | "right"; label: string; note?: string }) {
  return (
    <button class={`rail ${side}`} data-testid={`rail-${side}`} title={`Open ${label.toLowerCase()} (\\ for both)`} aria-label={`Open ${label.toLowerCase()}`} onClick={() => setLayout({ [side]: true })}>
      <span class="ricon">{side === "left" ? "⇥" : "⇤"}</span>
      <span class="rlabel">{label}</span>
      {note && <span class="rnote">{note}</span>}
    </button>
  );
}

/** The fold toggle on the performance and response tables. */
export function StatsFold() {
  const open = layout.value.stats;
  return (
    <button class="ib sm sfold" data-testid="fold-stats" title={open ? "Fold the table to its header" : "Open the table"} aria-label={open ? "Fold the table" : "Open the table"} aria-expanded={open} onClick={() => setLayout({ stats: !open })}>
      {open ? "▾" : "▸"}
    </button>
  );
}
