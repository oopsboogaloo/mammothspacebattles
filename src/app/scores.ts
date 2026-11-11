// A game's high scores: the top 10 for each of its tables, kept in this browser under the game's
// own key (Mammoth Lander: LND-005, a table per scenario; Mammoth Asteroids: MAS-005, one table).

export interface BaseEntry {
  initials: string;
  score: number;
  /** When it was set, as an ISO date (yyyy-mm-dd). */
  date: string;
}

export const TABLE_SIZE = 10;

/** Something that stores strings by key: localStorage in the browser, a plain object in tests. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const browserStore = (): Store | null => (typeof localStorage !== "undefined" ? localStorage : null);

/** The score tables kept under `key`, with entries of type E (the game's own columns besides initials, score and date). */
export function scoreBoard<E extends BaseEntry>(key: string) {
  type Table = Record<string, E[]>;
  const load = (s: Store | null = browserStore()): Table => {
    try {
      const raw = s?.getItem(key);
      const t = raw ? (JSON.parse(raw) as Table) : {};
      return t && typeof t === "object" ? t : {};
    } catch {
      return {};
    }
  };
  return {
    load,
    /** Whether a score would make the table. */
    qualifies(table: Table, name: string, score: number): boolean {
      if (score <= 0) return false;
      const list = table[name] ?? [];
      return list.length < TABLE_SIZE || score > list[list.length - 1].score;
    },
    /** Adds an entry, keeps the best 10 (an earlier entry wins a tie), saves, and returns its place (0 = top), or -1. */
    add(name: string, entry: E, s: Store | null = browserStore()): number {
      const table = load(s);
      const list = [...(table[name] ?? []), entry].sort((a, b) => b.score - a.score);
      const kept = list.slice(0, TABLE_SIZE);
      table[name] = kept;
      try {
        s?.setItem(key, JSON.stringify(table));
      } catch {
        // Storage full or blocked: the table still shows this session.
      }
      return kept.indexOf(entry);
    },
    best: (table: Table, name: string): E | undefined => table[name]?.[0],
  };
}
