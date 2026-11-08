import { describe, expect, it } from "vitest";
import { addScore, best, loadScores, qualifies, TABLE_SIZE, type Store } from "../../src/app/landerScores.ts";

const memory = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};
const entry = (initials: string, score: number) => ({ initials, score, landings: 1, date: "2026-11-08" });

describe("Mammoth Lander high scores", () => {
  it("LND-005 keeps the top 10 per scenario, best first, and survives a reload", () => {
    const s = memory();
    for (let i = 1; i <= 12; i++) addScore("lander-easy", entry(`P${i}`, i * 100), s);
    const table = loadScores(s);
    expect(table["lander-easy"]).toHaveLength(TABLE_SIZE);
    expect(best(table, "lander-easy")?.score).toBe(1200);
    expect(table["lander-easy"].at(-1)?.score).toBe(300);
    expect(table["lander-medium"]).toBeUndefined();
  });

  it("LND-005 a score qualifies only if it beats the 10th, and an earlier equal score stays ahead", () => {
    const s = memory();
    for (let i = 1; i <= 10; i++) addScore("lander-easy", entry(`P${i}`, i * 100), s);
    const t = loadScores(s);
    expect(qualifies(t, "lander-easy", 100)).toBe(false);
    expect(qualifies(t, "lander-easy", 150)).toBe(true);
    expect(qualifies(t, "lander-hard", 1)).toBe(true);
    expect(qualifies(t, "lander-hard", 0)).toBe(false);
    expect(addScore("lander-easy", entry("NEW", 1000), s)).toBe(1); // after the earlier 1000
  });

  it("LND-005 a corrupt store reads as empty", () => {
    const s = memory();
    s.setItem("msb.lander.scores", "{not json");
    expect(loadScores(s)).toEqual({});
  });
});
