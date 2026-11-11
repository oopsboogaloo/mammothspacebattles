// Mammoth Lander's high scores (LND-005): the top 10 per scenario, kept in this browser.
import { scoreBoard, type BaseEntry, type Store } from "./scores.ts";
export { TABLE_SIZE, type Store } from "./scores.ts";

export interface ScoreEntry extends BaseEntry {
  landings: number;
}

export type ScoreTable = Record<string, ScoreEntry[]>;

const board = scoreBoard<ScoreEntry>("msb.lander.scores");

export const loadScores = (s?: Store | null): ScoreTable => board.load(s);

/** Whether a score would make the scenario's table. */
export const qualifies = (table: ScoreTable, scenario: string, score: number): boolean => board.qualifies(table, scenario, score);

/** Adds an entry, keeps the best 10 (an earlier entry wins a tie), saves, and returns its place (0 = top), or -1. */
export const addScore = (scenario: string, entry: ScoreEntry, s?: Store | null): number => board.add(scenario, entry, s);

export const best = (table: ScoreTable, scenario: string): ScoreEntry | undefined => board.best(table, scenario);
