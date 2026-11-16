// The page's layout (docs/blueprint/spec.md §2): two toggles in the top bar show or hide the left
// and right panels; on a narrow screen (a folding phone, a small tablet) open panels float over the
// blueprint instead of squeezing it. The choice is kept in the browser.
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

/**
 * The top bar's two panel toggles, as most editors have them: a window outline with its left or
 * right side filled while that panel is open. Click to show or hide the panel; \ toggles both.
 */
export function PanelToggle({ side }: { side: "left" | "right" }) {
  const open = layout.value[side];
  const name = side === "left" ? "the left panel (components, controls)" : "the right panel (properties)";
  return (
    <button class={`ib ptoggle${open ? " on" : ""}`} data-testid={`toggle-${side}`} aria-pressed={open} aria-label={`${open ? "Hide" : "Show"} ${name}`} title={`${open ? "Hide" : "Show"} ${name} (\\ for both)`} onClick={() => setLayout({ [side]: !open })}>
      <svg width="20" height="16" viewBox="0 0 20 16" aria-hidden="true">
        <rect x="1" y="1.5" width="18" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" />
        <rect x={side === "left" ? 1.7 : 13.3} y="2.2" width="5" height="11.6" fill={open ? "currentColor" : "none"} />
        <line x1={side === "left" ? 7 : 13} x2={side === "left" ? 7 : 13} y1="1.5" y2="14.5" stroke="currentColor" stroke-width="1.4" />
      </svg>
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
