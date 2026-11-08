// Mammoth Lander's high scores (LND-005): the top 10 per scenario, kept in this browser.

export interface ScoreEntry {
  initials: string;
  score: number;
  landings: number;
  /** When it was set, as an ISO date (yyyy-mm-dd). */
  date: string;
}

export type ScoreTable = Record<string, ScoreEntry[]>;

const KEY = "msb.lander.scores";
export const TABLE_SIZE = 10;

/** Something that stores strings by key: localStorage in the browser, a plain object in tests. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const store = (): Store | null => (typeof localStorage !== "undefined" ? localStorage : null);

export function loadScores(s: Store | null = store()): ScoreTable {
  try {
    const raw = s?.getItem(KEY);
    const t = raw ? (JSON.parse(raw) as ScoreTable) : {};
    return t && typeof t === "object" ? t : {};
  } catch {
    return {};
  }
}

/** Whether a score would make the scenario's table. */
export function qualifies(table: ScoreTable, scenario: string, score: number): boolean {
  if (score <= 0) return false;
  const list = table[scenario] ?? [];
  return list.length < TABLE_SIZE || score > list[list.length - 1].score;
}

/** Adds an entry, keeps the best 10 (an earlier entry wins a tie), saves, and returns its place (0 = top), or -1. */
export function addScore(scenario: string, entry: ScoreEntry, s: Store | null = store()): number {
  const table = loadScores(s);
  const list = [...(table[scenario] ?? []), entry].sort((a, b) => b.score - a.score);
  const kept = list.slice(0, TABLE_SIZE);
  table[scenario] = kept;
  try {
    s?.setItem(KEY, JSON.stringify(table));
  } catch {
    // Storage full or blocked: the table still shows this session.
  }
  return kept.indexOf(entry);
}

export const best = (table: ScoreTable, scenario: string): ScoreEntry | undefined => table[scenario]?.[0];
