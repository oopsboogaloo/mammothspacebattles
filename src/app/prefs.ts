// Per-browser preferences (UX-005). Storage can be unavailable or throw
// (private windows, blocked site data), so every access is guarded and the
// app works without it.

const KEY = "msb.prefs.v1";

export interface Prefs {
  overlays?: string[];
  drawerOpen?: boolean;
  collapsed?: Record<string, boolean>;
  graphWindow?: number | "all";
  lastExperiment?: { title: string; json: string };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* storage unavailable: preferences just don't persist */
  }
}
