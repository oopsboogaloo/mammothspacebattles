// Mammoth Thrust's page: the HUD's readings, where the view looks, and how the level is drawn.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { insideOutline, LAMP_OFF, LAMP_ON, LINE_OFF, LINE_ON, RECOIL_TIME, recoilOf, renderFrame, stripeHeight, type Ctx } from "../../src/app/render.ts";
import { coolantStatus, easeLean, LEAN_TIME, LEVELS, lookAt, lookParts, POD_LABEL, shipStatus, VIEW_HEIGHT, zoomFor } from "../../src/app/thrustHud.ts";
import { getProfile, initialWorld, parseScenario, stepInPlace, type World } from "../../src/core/index.ts";

const raw = (n: number) => JSON.parse(readFileSync(new URL(`../../scenarios/thrust-${n}.json`, import.meta.url), "utf8"));
const world = (n = 1): World => initialWorld(parseScenario(raw(n)));
const sandbox = getProfile("sandbox");

/** A canvas that writes down what is drawn, with the fill colour in force. */
function recorder(): { ctx: Ctx; calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push(`${k}(${args.map((a) => (typeof a === "number" ? Math.round(a) : String(a))).join(",")})|stroke=${String(t.strokeStyle)}|fill=${String(t.fillStyle)}`)),
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
    expect(LEVELS).toBe(5);
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

  it("MTH-052 the view leans toward the pod on the tether by easing, never a jump, and eases back when the pod is let go", () => {
    const w = world();
    expect(lookParts(w, 0)!.lean).toEqual({ x: 0, y: 0 });
    w.thrust!.state.pod = "tether";
    const to = lookParts(w, 0)!.lean;
    expect(Math.abs(to.x) + Math.abs(to.y)).toBeGreaterThan(5);
    // One frame moves it a little; the time constant closes 63% of the gap; in the end it is there.
    let lean = easeLean({ x: 0, y: 0 }, to, 1 / 60);
    expect(lean.x / to.x).toBeCloseTo(1 - Math.exp(-1 / 60 / LEAN_TIME), 6);
    expect(lean.x / to.x).toBeLessThan(0.05);
    lean = { x: 0, y: 0 };
    for (let i = 0; i < Math.round(LEAN_TIME * 60); i++) lean = easeLean(lean, to, 1 / 60);
    expect(lean.x / to.x).toBeCloseTo(1 - Math.exp(-1), 2);
    for (let i = 0; i < 600; i++) lean = easeLean(lean, to, 1 / 60);
    expect(lean.x).toBeCloseTo(to.x, 6);
    // A long frame (a stall) is still a small step.
    expect(easeLean({ x: 0, y: 0 }, to, 5).x / to.x).toBeLessThan(0.25);
    // Back again.
    expect(Math.abs(easeLean(to, { x: 0, y: 0 }, 1 / 60).x)).toBeLessThan(Math.abs(to.x));
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

  it("TER-004 craters are drawn as open space: plain black discs cut into the rock's lines", () => {
    const w = world();
    const view = { ...w.thrust!.spec.view!, craters: [{ x: 0, y: -40, r: 3 }, { x: 500, y: -40, r: 3 }] };
    const r = recorder();
    renderFrame(r.ctx, w, { x: 0, y: -40, zoom: 8 }, { width: 800, height: 600 }, { overlays: new Set(), selection: new Set(), hover: null, thrust: view });
    // The one in view: a 24 px disc at the middle of the screen, filled black. The one far off isn't drawn.
    expect(r.calls.filter((c) => c.startsWith("arc(400,300,24,") && c.endsWith("fill=#000"))).toHaveLength(1);
    const black = r.calls.filter((c) => c.startsWith("fill(") && c.endsWith("fill=#000")).length;
    const plain = draw(w, { x: 0, y: -40, zoom: 8 }).filter((c) => c.startsWith("fill(") && c.endsWith("fill=#000")).length;
    expect(black).toBe(plain + 1);
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
  it("MTH-072 an electric turret's outer barrel is drawn folded back into the breech when it fires, and slides out again", () => {
    const w = world(3);
    const barrel = w.bodies.find((b) => b.id === "t6-barrel")!;
    const mag = w.bodies.find((b) => b.id === "t6-breech")!.magazine!;
    expect(barrel.recoil).toEqual({ gun: "t6-breech", travel: 0.7 });
    // Before its first shot it is out.
    expect(recoilOf(w, barrel)).toBe(0);
    // At the shot it is all the way back; halfway through, half; then out.
    mag.loaded = 1;
    mag.timer = 0;
    expect(recoilOf(w, barrel)).toBeCloseTo(0.7, 9);
    mag.timer = RECOIL_TIME / 2;
    expect(recoilOf(w, barrel)).toBeCloseTo(0.35, 9);
    mag.timer = RECOIL_TIME * 2;
    expect(recoilOf(w, barrel)).toBe(0);
  });
  it("MTH-085 the power lines are white while they carry power and dark while they don't; the plant's light is green or red; the shock shows only while it carries power", () => {
    const w = world(4); // the winding cave
    const strokes = (calls: string[]) => calls.filter((c) => c.startsWith("stroke(")).map((c) => c.split("|stroke=")[1].split("|fill=")[0]);
    const fills = (calls: string[]) => calls.filter((c) => c.startsWith("fill(")).map((c) => c.split("|fill=")[1]);
    // Over the antennae: both lines there, and the shock between them.
    const cam = { x: -18, y: -50, zoom: 8 };
    let calls = draw(w, cam);
    expect(strokes(calls).filter((c) => c === LINE_ON).length).toBe(7);
    expect(strokes(calls)).not.toContain(LINE_OFF);
    expect(strokes(calls)).toContain("#eaf6ff");
    // The plant offline: every line dark, no shock, and its light red.
    w.thrust!.state.plant!.offlineUntil = w.time + 10;
    calls = draw(w, cam);
    expect(strokes(calls).filter((c) => c === LINE_OFF).length).toBe(7);
    expect(strokes(calls)).not.toContain("#eaf6ff");
    const plant = { x: 61, y: 10, zoom: 8 };
    expect(fills(draw(w, plant))).toContain(LAMP_OFF);
    w.thrust!.state.plant!.offlineUntil = 0;
    expect(fills(draw(w, plant))).toContain(LAMP_ON);
    // The transmitter down: only the line beyond it is dark.
    w.thrust!.state.plant!.up = { tx: false };
    calls = draw(w, cam);
    expect(strokes(calls).filter((c) => c === LINE_OFF).length).toBe(1);
    expect(strokes(calls)).not.toContain("#eaf6ff");
  });
  it("MTH-086 the HUD's coolant gauge reads the share of the reactor's coolant left, on a level with a plant only", () => {
    expect(coolantStatus(world(1))).toBeNull();
    const w = world(3);
    expect(coolantStatus(w)).toEqual({ share: 1, holes: 0 });
    const core = w.bodies.find((b) => b.id === "plant-core")!;
    core.contents![0].mass = 3; // of 12 kg
    w.thrust!.state.plant!.holes = 4;
    const c = coolantStatus(w)!;
    expect(c.share).toBeCloseTo(0.25, 9);
    expect(c.holes).toBe(4);
  });
});
