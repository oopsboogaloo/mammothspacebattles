// Mammoth Thrust's page: the HUD's readings, where the view looks, and how the level is drawn.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { insideOutline, renderFrame, stripeHeight, type Ctx } from "../../src/app/render.ts";
import { LEVELS, lookAt, POD_LABEL, shipStatus, VIEW_HEIGHT, zoomFor } from "../../src/app/thrustHud.ts";
import { getProfile, initialWorld, parseScenario, stepInPlace, type World } from "../../src/core/index.ts";

const raw = (n: number) => JSON.parse(readFileSync(new URL(`../../scenarios/thrust-${n}.json`, import.meta.url), "utf8"));
const world = (n = 1): World => initialWorld(parseScenario(raw(n)));
const sandbox = getProfile("sandbox");

/** A canvas that writes down what is drawn, with the fill colour in force. */
function recorder(): { ctx: Ctx; calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push(`${k}(${args.map((a) => (typeof a === "number" ? Math.round(a) : String(a))).join(",")})|fill=${String(t.fillStyle)}`)),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as Ctx;
  return { ctx, calls };
}
const draw = (w: World, cam: { x: number; y: number; zoom: number }, vp = { width: 800, height: 600 }) => {
  const r = recorder();
  renderFrame(r.ctx, w, cam, vp, { overlays: new Set(), selection: new Set(), hover: null, thrust: w.thrust!.spec.view });
  return r.calls;
};

describe("Mammoth Thrust's page", () => {
  it("MTH-052 the HUD reads the ship's fuel, shells and damage, and names the pod's state", () => {
    const w = world();
    expect(shipStatus(w)).toEqual({ fuel: 1, slugs: 120, damage: 0 });
    w.bodies.find((b) => b.id === "p1-tank-l")!.integrity = 0.75;
    for (const c of w.bodies.find((b) => b.id === "p1-tank-r")!.contents!) c.mass = 0;
    const s = shipStatus(w);
    expect(s.fuel).toBeCloseTo(0.5, 6);
    expect(s.damage).toBeCloseTo(0.25, 6);
    w.thrust!.state.phase = "between";
    expect(shipStatus(w).damage).toBe(1); // a lost ship is lost
    expect(Object.keys(POD_LABEL).sort()).toEqual(["gone", "loose", "stand", "tether"]);
    expect(shipStatus(initialWorld(parseScenario(JSON.parse(readFileSync(new URL("../../scenarios/empty.json", import.meta.url), "utf8")))))).toEqual({ fuel: 0, slugs: 0, damage: 0 });
    expect(LEVELS).toBe(2);
    for (let n = 1; n <= LEVELS; n++) expect(raw(n).world.thrust.level).toBe(n);
  });

  it("MTH-052 the view follows the ship, 90 m tall, and leans toward a pod on the tether", () => {
    expect(zoomFor(720)).toBe(720 / VIEW_HEIGHT);
    expect(zoomFor(200)).toBe(3.5);
    expect(zoomFor(4000)).toBe(12);
    const w = world();
    const start = w.thrust!.spec.start;
    expect(lookAt(w, 0)!.x).toBeCloseTo(start.x, 6);
    // Moved on with the ship's speed, for smooth motion.
    for (const b of w.bodies) if (b.id.startsWith("p1-")) b.velocity = { x: 10, y: 0 };
    expect(lookAt(w, 0.1)!.x).toBeCloseTo(start.x + 1, 6);
    w.thrust!.state.pod = "tether";
    const pod = w.bodies.find((b) => b.id === "pod")!;
    expect(lookAt(w, 0)!.x).toBeCloseTo(start.x + 0.35 * (pod.position.x - start.x), 6);
    w.bodies = w.bodies.filter((b) => b.id !== "p1-hull");
    expect(lookAt(w, 0)).toBeNull();
  });

  it("MTH-053 the rock is horizontal lines of the level's colour, a line and a gap of equal height, fixed to the world, with no outline", () => {
    const w = world();
    const view = w.thrust!.spec.view!;
    // Deep in the rock at 8 px a metre: 1 m of pitch is a 4 px line and a 4 px gap.
    expect(stripeHeight(view.pitch, 8)).toBe(4);
    const calls = draw(w, { x: 0, y: -40, zoom: 8 });
    const lines = calls.filter((c) => c.startsWith("fillRect(0,") && c.endsWith(`fill=${view.colour}`));
    expect(lines.length).toBeGreaterThan(60);
    const ys = lines.map((c) => Number(c.split(",")[1])).sort((a, b) => a - b);
    expect(new Set(lines.map((c) => c.split(",")[3].split(")")[0]))).toEqual(new Set(["4"])); // every line 4 px high
    expect(new Set(ys.slice(1).map((y, i) => y - ys[i]))).toEqual(new Set([8])); // 8 px apart: a line and a gap
    // Fixed to the world: half a metre up, the lines are 4 px down the screen.
    const moved = draw(w, { x: 0, y: -39.5, zoom: 8 }).filter((c) => c.startsWith("fillRect(0,") && c.endsWith(`fill=${view.colour}`));
    const shift = Number(moved[0].split(",")[1]) - Number(lines[0].split(",")[1]);
    expect(((shift % 8) + 8) % 8).toBe(4);
    // The rock's own bodies aren't drawn, and nothing is stroked along the ground: no dashed outline.
    expect(calls.some((c) => c.startsWith("setLineDash(6,4)"))).toBe(false);
    // Far out, where the lines can't be told apart: one fill, no lines.
    expect(draw(w, { x: 0, y: 0, zoom: 2 }).filter((c) => c.startsWith("fillRect(0,") && c.endsWith(`fill=${view.colour}`))).toHaveLength(1);
  });

  it("MTH-053 stars show only in the sky: none in the rock, and none in a cave, which is plain black", () => {
    const w = world(2);
    const view = w.thrust!.spec.view!;
    expect(insideOutline(view.sky, { x: 0, y: 100 })).toBe(true);
    expect(insideOutline(view.sky, { x: 0, y: -80 })).toBe(false); // the chamber
    expect(insideOutline(view.caves[0], { x: 0, y: -80 })).toBe(true);
    expect(insideOutline(view.caves[0], { x: 100, y: -80 })).toBe(false); // rock
    const stars = (cam: { x: number; y: number; zoom: number }) => draw(w, cam).filter((c) => c.startsWith("fillRect(") && c.endsWith("fill=#dfe7ff")).length;
    expect(stars({ x: 0, y: 90, zoom: 8 })).toBeGreaterThan(20); // open sky
    expect(stars({ x: 0, y: -87, zoom: 20 })).toBe(0); // inside the chamber: 40 × 30 m of it
    expect(stars({ x: 100, y: -87, zoom: 20 })).toBe(0); // inside the rock
    // The cave and the sky are filled black over the lines.
    expect(draw(w, { x: 0, y: -87, zoom: 8 }).filter((c) => c.startsWith("fill(") && c.endsWith("fill=#000")).length).toBe(2);
  });

  it("MTH-053 the pod glows, and a protected ship flashes", () => {
    const w = world();
    const calls = draw(w, { x: 12, y: -6, zoom: 20 });
    expect(calls.filter((c) => c.startsWith("arc(")).length).toBeGreaterThanOrEqual(3); // the pod and its two rings
    // A new ship after a loss is protected, and is drawn faint on alternate tenths of a second.
    stepInPlace(w, [{ type: "control.set", channel: "destruct", value: 1 }], sandbox);
    for (let i = 0; i < 700; i++) stepInPlace(w, [], sandbox);
    expect(w.thrust!.state.n).toBe(2);
    expect(w.thrust!.state.graceUntil).toBeDefined();
  });
});
