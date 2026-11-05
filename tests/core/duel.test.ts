// Combat duel, mini game 3 (DUEL-001…DUEL-003): the player's Gunship 3 against an AI hunter.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getProfile, initialWorld, parseScenario, stepInPlace } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const raw = () => readJson(join(ROOT, "scenarios", "ai-duel.json")) as { world: { duel: Record<string, unknown>; bodies: Record<string, unknown>[] } };

describe("combat duel (AI-3)", () => {
  it("DUEL-001 DUEL-002 the AI hunter closes in and knocks out a player who does nothing: lost, with health falling and the ledger clean", () => {
    const w = initialWorld(parseScenario(raw()));
    expect(w.duel!.status).toMatchObject({ phase: "fighting", player: 1, enemies: { "e1-hull": 1 } });
    for (let i = 0; i < 240 * 40 && w.duel!.status.phase === "fighting"; i++) stepInPlace(w, [], sandbox);
    const s = w.duel!.status;
    expect(s.phase).toBe("lost");
    expect(s.player).toBeLessThan(0.5);
    expect(s.enemies["e1-hull"]).toBe(1);
    expect(w.events.some((e) => e.type === "duel.lost")).toBe(true);
    expect(w.bodies.find((b) => b.id === "e1-hull")!.pilot!.combat!.shots).toBeGreaterThan(0);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("DUEL-001 knocking out the enemy wins, with a score; the verdict then stays", () => {
    const w = initialWorld(parseScenario(raw()));
    stepInPlace(w, [], sandbox);
    w.bodies.find((b) => b.id === "e1-hull")!.integrity = 0;
    stepInPlace(w, [], sandbox);
    const s = w.duel!.status;
    expect(s.phase).toBe("won");
    expect(s.enemies["e1-hull"]).toBe(0);
    expect(s.score).toBeGreaterThan(900); // whole, and quick
    const at = s.at;
    w.bodies.find((b) => b.id === "hull")!.integrity = 0;
    stepInPlace(w, [], sandbox);
    expect(w.duel!.status).toMatchObject({ phase: "won", at });
  });

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
