// Mining by railgun (AST-008): the base scenario's rubble asteroid under Gunship 3's explosive shells.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyRoots, getProfile, initialWorld, parseScenario, stepInPlace, type World } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");

/** Asteroid "ra" from the base scenario, alone and at rest at the origin, with the base's shells. */
function target(): { w: World; shell: Record<string, unknown> } {
  const raw = readJson(join(ROOT, "scenarios", "base.json")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const ra = raw.world.asteroids.find((a: { id: string }) => a.id === "ra");
  Object.assign(ra, { position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 });
  raw.world.asteroids = [ra];
  const shell = structuredClone(raw.world.bodies.find((b: { id: string }) => b.id === "breech").magazine.shell);
  raw.world.bodies = [];
  raw.world.joints = [];
  raw.world.links = [];
  delete raw.world.duel;
  raw.world.gravity = { x: 0, y: 0 };
  Object.assign(raw, { timeline: [], probes: [], assertions: [] });
  delete raw.ui;
  const scn = parseScenario(raw);
  // The shell as the scenario resolves it: its parameters' defaults.
  const p = Object.fromEntries((raw.parameters as { id: string; default: number }[]).map((x) => [x.id, x.default]));
  const s = { ...shell, mass: p.shellMass, explosive: { charge: p.blast, fragments: p.fragments, radius: p.radius } };
  return { w: initialWorld(scn), shell: s };
}

describe("mining by railgun (AST-008)", () => {
  it("AST-008 the first hit damages locally, the next ones knock pieces off, and a few more break it into chunks to mine, losing few pieces", () => {
    const { w, shell } = target();
    const rock = () => w.bodies.filter((b) => /^ra-\d+$/.test(b.id));
    const n0 = rock().length;
    const chunks = () => {
      const roots = assemblyRoots(w);
      return new Set(rock().map((b) => roots.get(b.id))).size;
    };
    const after: { pieces: number; chunks: number; damaged: number }[] = [];
    for (let s = 0; s < 8; s++) {
      // At the biggest chunk, from 25 m, at the railgun's 96 m/s.
      const roots = assemblyRoots(w);
      const groups = new Map<string, typeof w.bodies>();
      for (const b of rock()) groups.set(roots.get(b.id)!, [...(groups.get(roots.get(b.id)!) ?? []), b]);
      const big = [...groups.values()].sort((a, b) => b.length - a.length)[0];
      const c = big.reduce((m, b) => ({ x: m.x + b.position.x / big.length, y: m.y + b.position.y / big.length }), { x: 0, y: 0 });
      stepInPlace(w, [{ type: "body.add", body: { ...shell, id: `shot-${s}`, position: { x: c.x, y: c.y - 25 }, velocity: { x: 0, y: 96 }, angle: 0, angularVelocity: 0 } as never }], sandbox);
      for (let i = 0; i < 600; i++) stepInPlace(w, [], sandbox);
      after.push({ pieces: rock().length, chunks: chunks(), damaged: rock().filter((b) => b.integrity < 1).length });
    }
    // Hit 1: damage round the hit, no piece destroyed, the rock still mostly whole.
    expect(after[0].pieces).toBe(n0);
    expect(after[0].damaged).toBeGreaterThan(0);
    expect(after[0].chunks).toBeLessThanOrEqual(3);
    // By the fourth hit it has split; by the eighth it is in several chunks.
    expect(after[3].chunks).toBeGreaterThanOrEqual(2);
    expect(after[7].chunks).toBeGreaterThanOrEqual(4);
    // And most of it is still there to mine.
    expect(after[7].pieces).toBeGreaterThanOrEqual(Math.ceil(0.75 * n0));
    expect(w.ledger.violations).toBe(0);
  }, 300_000);
});
