// Mammoth Asteroids' page: the arena's shape, the HUD's readings, the high scores, and the view.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { arenaFor, shipStatus } from "../../src/app/asteroidsHud.ts";
import { scoreBoard, TABLE_SIZE, type Store } from "../../src/app/scores.ts";
import { COLORS, renderFrame, type Ctx } from "../../src/app/render.ts";
import { getProfile, initialWorld, parseScenario, stepInPlace } from "../../src/core/index.ts";

const raw = JSON.parse(readFileSync(new URL("../../scenarios/asteroids.json", import.meta.url), "utf8"));
const world = () => initialWorld(parseScenario(structuredClone(raw)));
const memory = (): Store => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

/** A canvas that writes down what is drawn, with the fill and stroke colours in force. */
function recorder(): { ctx: Ctx; calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push(`${k}(${args.map((a) => (typeof a === "number" ? Math.round(a) : String(a))).join(",")})|fill=${String(t.fillStyle)}|stroke=${String(t.strokeStyle)}|alpha=${String(t.globalAlpha ?? 1)}`)),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as Ctx;
  return { ctx, calls };
}

describe("Mammoth Asteroids' page", () => {
  it("MAS-010 the arena is 160 m high and the screen's shape, within 1.2 to 2.2 times as wide", () => {
    expect(arenaFor(1600, 900)).toEqual({ width: 160 * (16 / 9), height: 160 });
    expect(arenaFor(1180, 820).width).toBeCloseTo(230.2, 1); // an iPad in landscape, less its bars
    expect(arenaFor(600, 900).width).toBe(192); // a tall phone: 1.2 at the least
    expect(arenaFor(3440, 1000).width).toBe(352); // an ultrawide: 2.2 at the most
    expect(arenaFor(800, 0).height).toBe(160);
  });

  it("MAS-051 the HUD reads the flying ship's fuel, slugs and worst-hit part", () => {
    const w = world();
    expect(shipStatus(w)).toEqual({ fuel: 1, slugs: 40, damage: 0 });
    // Burn, fire, and a damaged generator.
    const sandbox = getProfile("sandbox");
    for (let i = 0; i < 240; i++) stepInPlace(w, i === 0 ? [{ type: "control.set", channel: "left", value: 1 }, { type: "control.set", channel: "right", value: 1 }, { type: "control.set", channel: "fire", value: 1 }] : [], sandbox);
    w.bodies.find((b) => b.id === "p1-gen-l")!.integrity = 0.6;
    const s = shipStatus(w);
    expect(s.fuel).toBeGreaterThan(0.9);
    expect(s.fuel).toBeLessThan(1);
    expect(s.slugs).toBe(40 - w.arcade!.state.stats.shots);
    expect(s.slugs).toBeLessThan(40);
    expect(s.damage).toBeCloseTo(0.4, 9);
    // A bent weld counts too; a lost ship reads 100%.
    w.joints.find((j) => j.a.startsWith("p1-") && j.b.startsWith("p1-"))!.integrity = 0.3;
    expect(shipStatus(w).damage).toBeCloseTo(0.7, 9);
    w.arcade!.state.lost = true;
    expect(shipStatus(w).damage).toBe(1);
  });

  it("MAS-005 high scores: the top 10 with initials, score, level and date, under the game's own key, kept through a reload", () => {
    const s = memory();
    const board = scoreBoard<{ initials: string; score: number; level: number; date: string }>("msb.asteroids.scores");
    for (let i = 1; i <= 12; i++) board.add("asteroids", { initials: `P${i}`, score: i * 100, level: i, date: "2026-11-11" }, s);
    const table = board.load(s); // as a reload reads it
    expect(table.asteroids).toHaveLength(TABLE_SIZE);
    expect(table.asteroids[0]).toEqual({ initials: "P12", score: 1200, level: 12, date: "2026-11-11" });
    expect(board.qualifies(table, "asteroids", 250)).toBe(false);
    expect(board.qualifies(table, "asteroids", 350)).toBe(true);
    expect(board.qualifies({}, "asteroids", 0)).toBe(false);
    expect(board.add("asteroids", { initials: "NEW", score: 650, level: 3, date: "2026-11-11" }, s)).toBe(6);
    // Lander's table is another key: nothing of it here.
    expect(s.getItem("msb.lander.scores")).toBeNull();
  });

  it("MAS-011 an object over an edge is drawn the same on both sides: its copy in gold too, with no seam line", () => {
    const w = world();
    const gold = w.bodies.find((b) => b.mineral === "gold")!;
    delete gold.compound;
    const W = w.bounds.max.x - w.bounds.min.x;
    gold.position = { x: w.bounds.max.x - 1, y: 20 }; // over the right edge
    const zoom = 800 / W;
    const { ctx, calls } = recorder();
    renderFrame(ctx, w, { x: 0, y: 0, zoom }, { width: 800, height: 450 }, { overlays: new Set(), selection: new Set(), hover: null, labels: false, arcade: true, stars: "still" });
    const goldFills = (list: string[]) => list.filter((c) => c.startsWith("fill(") && c.includes(`fill=${COLORS.gold}`)).length;
    const pieces = w.bodies.filter((b) => b.mineral === "gold" && !b.compound).length;
    // Every gold piece is filled in gold in the arena and again in each copy of it in view.
    expect(calls.some((c) => c.startsWith("setLineDash(2,6)"))).toBe(false); // no seam
    expect(calls[0]).toContain("fill=#000"); // black space
    // In the sandbox's view the copy is plain, and the seam shows.
    const plain = recorder();
    renderFrame(plain.ctx, w, { x: 0, y: 0, zoom }, { width: 800, height: 450 }, { overlays: new Set(), selection: new Set(), hover: null, labels: false });
    expect(goldFills(plain.calls)).toBe(pieces);
    expect(goldFills(calls)).toBeGreaterThanOrEqual(2 * pieces);
    expect(goldFills(calls) % pieces).toBe(0);
    expect(plain.calls.some((c) => c.startsWith("setLineDash(2,6)"))).toBe(true);
  });

  it("MAS-034 a protected ship flashes, and a beam ring shows where it came in", () => {
    const w = world();
    w.arcade!.state.graceUntil = 1;
    w.arcade!.state.beams = [{ at: 0, x: 0, y: 0, r: 4 }];
    const draw = (time: number) => {
      w.time = time;
      w.tick = Math.round(time * 240);
      const { ctx, calls } = recorder();
      renderFrame(ctx, w, { x: 0, y: 0, zoom: 4 }, { width: 800, height: 450 }, { overlays: new Set(), selection: new Set(), hover: null, labels: false, arcade: true });
      return calls;
    };
    // Dimmed in one tenth of a second, full in the next.
    expect(draw(0.05).some((c) => c.startsWith("fill(") && c.includes("alpha=0.3"))).toBe(true);
    expect(draw(0.15).some((c) => c.startsWith("fill(") && c.includes("alpha=0.3"))).toBe(false);
    // The ring: a white circle at the centre of the view, growing.
    const ring = (calls: string[]) => calls.find((c) => c.startsWith("arc(400,225,") && c.includes("stroke=#fff"))!;
    const r = (c: string) => Number(c.split(",")[2]);
    expect(r(ring(draw(0.3)))).toBeGreaterThan(r(ring(draw(0.05))));
  });
});
