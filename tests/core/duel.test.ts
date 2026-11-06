// Combat duel, mini game 3 (DUEL-001…DUEL-004): the player's Gunship 3 against an AI hunter.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, getProfile, initialWorld, parseScenario, stepInPlace, type World } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const raw = () => readJson(join(ROOT, "scenarios", "ai-duel.json")) as { world: { duel: Record<string, unknown>; bodies: Record<string, unknown>[] } };
const duel = (values: Record<string, number> = {}) => initialWorld(parseScenario(raw(), values));
const knockOut = (w: World, id: string) => {
  w.bodies.find((b) => b.id === id)!.integrity = 0;
  stepInPlace(w, [], sandbox);
};
const steps = (w: World, s: number) => {
  for (let i = 0; i < Math.round(s * 240); i++) stepInPlace(w, [], sandbox);
};

describe("combat duel (AI-3)", () => {
  it("DUEL-001 DUEL-002 the AI hunter closes in and knocks out a player who does nothing: lost, with health falling and the ledger clean", () => {
    const w = duel({ kills: 1 });
    expect(w.duel!.status).toMatchObject({ phase: "fighting", player: 1, enemies: { "e1-hull": 1 } });
    for (let i = 0; i < 240 * 45 && w.duel!.status.phase === "fighting"; i++) stepInPlace(w, [], sandbox);
    const s = w.duel!.status;
    expect(s.phase).toBe("lost");
    expect(s.kills).toEqual({ player: 0, enemies: 1 });
    expect(w.events.some((e) => e.type === "duel.lost")).toBe(true);
    expect(w.bodies.find((b) => b.id === "e1-hull")!.pilot!.combat!.shots).toBeGreaterThan(0);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("DUEL-001 knocking out the enemy wins, with a score, after a few seconds to watch the explosion; the verdict then stays", () => {
    const w = duel({ kills: 1 });
    stepInPlace(w, [], sandbox);
    knockOut(w, "e1-hull");
    expect(w.duel!.status.phase).toBe("fighting"); // decided, not yet declared
    expect(w.duel!.status.kills.player).toBe(1);
    steps(w, 2.9);
    expect(w.duel!.status.phase).toBe("fighting");
    steps(w, 0.2);
    const s = w.duel!.status;
    expect(s.phase).toBe("won");
    expect(s.score).toBeGreaterThan(1000);
    const at = s.at;
    knockOut(w, "hull");
    expect(w.duel!.status).toMatchObject({ phase: "won", at });
    expect(w.ledger.violations).toBe(0);
  });

  it("DUEL-004 first to 3: a knocked-out ship bursts and comes back fresh, 90 m from the survivor, clear of rocks; the third kill decides it", () => {
    const w = duel(); // first to 3
    stepInPlace(w, [], sandbox);
    for (let k = 1; k <= 2; k++) {
      knockOut(w, "e1-hull");
      const s = w.duel!.status;
      expect(s.kills).toEqual({ player: k, enemies: 0 });
      expect(s.phase).toBe("fighting");
      expect(s.decided).toBeUndefined();
      // Back, whole, at rest, 90 m from the player.
      const e = assemblyTotals(w, "e1-hull")!;
      const me = assemblyTotals(w, "hull")!;
      expect(Math.hypot(e.centre.x - me.centre.x, e.centre.y - me.centre.y)).toBeGreaterThan(80);
      expect(Math.hypot(e.velocity.x, e.velocity.y)).toBeLessThan(1e-9);
      expect(w.duel!.status.enemies["e1-hull"]).toBe(1);
      expect(w.events.filter((x) => x.type === "duel.respawn")).toHaveLength(k);
      expect(w.dust!.length).toBeGreaterThan(0); // the old one went up in dust
      steps(w, 1);
      expect(w.bodies.find((b) => b.id === "e1-hull")!.pilot!.intent).not.toBe(""); // flying again
    }
    // The player is knocked out once: they come back away from the enemy.
    knockOut(w, "hull");
    expect(w.duel!.status.kills).toEqual({ player: 2, enemies: 1 });
    expect(w.bodies.some((b) => b.id === "hull")).toBe(true);
    knockOut(w, "e1-hull");
    expect(w.duel!.status.kills).toEqual({ player: 3, enemies: 1 });
    expect(w.duel!.status.decided?.phase).toBe("won");
    expect(w.events.filter((x) => x.type === "duel.respawn")).toHaveLength(3); // the last one stays down
    steps(w, 3.1);
    expect(w.duel!.status.phase).toBe("won");
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("DUEL-003 a duel names bodies in the world", () => {
    const r = raw();
    r.world.duel.enemies = ["nobody"];
    expect(() => parseScenario(r)).toThrow();
    const q = raw();
    q.world.duel.player = 3;
    expect(() => parseScenario(q)).toThrow();
    expect(() => parseScenario(raw())).not.toThrow();
  });
});
