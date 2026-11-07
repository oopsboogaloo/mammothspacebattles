// The stress test's spawn button (ui.spawn, src/core/spawn.ts): copies of a ship template with their
// own ids, channels and side, round the ship you fly.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCommands, assemblyTotals, getProfile, initialWorld, parseScenario, spawnCommands, stepInPlace } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

describe("spawned ships", () => {
  const scn = parseScenario(readJson(join(ROOT, "scenarios", "stress-test.json")));
  const profile = getProfile(scn.profile);

  it("SCN-010 each copy has its own ids, channels and side, appears round the Mammoth, and flies and shoots", () => {
    const w = initialWorld(scn);
    const n0 = w.bodies.length;
    const t = scn.ui!.spawn!;
    for (let n = 1; n <= 3; n++) applyCommands(w, spawnCommands(t, n, assemblyTotals(w, "cockpit")!.centre), profile);
    expect(w.bodies.length).toBe(n0 + 3 * t.bodies.length);
    expect(new Set(w.bodies.map((b) => b.id)).size).toBe(w.bodies.length);
    expect(new Set(w.links.filter((l) => l.kind === "control").map((l) => l.channel)).size).toBeGreaterThan(3 * 2);
    expect(new Set([1, 2, 3].map((n) => w.bodies.find((b) => b.id === `s${n}-hull`)!.pilot!.side))).toEqual(new Set(["s1", "s2", "s3"]));
    // 70 m out, round the Mammoth.
    const c = assemblyTotals(w, "cockpit")!.centre;
    for (let n = 1; n <= 3; n++) expect(Math.hypot(assemblyTotals(w, `s${n}-hull`)!.centre.x - c.x, assemblyTotals(w, `s${n}-hull`)!.centre.y - c.y)).toBeCloseTo(70, -1);
    const start = [1, 2, 3].map((n) => ({ ...assemblyTotals(w, `s${n}-hull`)!.centre }));
    for (let s = 0; s < Math.round(10 / profile.timestep); s++) stepInPlace(w, [], profile); // the first shot comes at about 7 s
    // They fly: each one still there has moved off its spot.
    const moved = [1, 2, 3].filter((n, i) => {
      const a = assemblyTotals(w, `s${n}-hull`);
      return a && Math.hypot(a.centre.x - start[i].x, a.centre.y - start[i].y) > 2;
    });
    expect(moved.length).toBeGreaterThan(0);
    // And shoot: some gun's magazine has fewer shells than it started with.
    const full = (t.bodies.find((b) => b.id === "s{n}-breech") as unknown as { magazine: { count: number } }).magazine.count;
    expect([1, 2, 3].some((n) => (w.bodies.find((b) => b.id === `s${n}-breech`)?.magazine?.count ?? 0) < full)).toBe(true);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);
});
