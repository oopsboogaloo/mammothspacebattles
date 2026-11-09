import { describe, expect, it } from "vitest";
import { fitBounds, toScreen, toWorld, worldBounds, zoomAt } from "../../src/app/camera.ts";
import { fmt, plain } from "../../src/app/format.ts";
import { assemblyCentres, flameColour, GLOW_FROM, renderFrame, wrapImages, type Ctx } from "../../src/app/render.ts";
import { createWorld, getProfile, stepInPlace } from "../../src/core/index.ts";
import { box, disc } from "../helpers.ts";

/** Records draw calls so render output can be checked without a browser. */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) => (key in target ? target[key] : (...args: unknown[]) => calls.push(`${key}(${args.map((a) => (typeof a === "number" ? Math.round(a) : a)).join(",")})`)),
    set: (target, key: string, value) => {
      target[key] = value;
      calls.push(`${key}=${value}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as Ctx, calls };
}

describe("renderer", () => {
  const vp = { width: 800, height: 600 };
  const cam = { x: 0, y: 0, zoom: 100 };

  it("TST-011 renders a world from world, camera and options alone, with no UI shell", () => {
    const w = createWorld(1, [disc("a", { position: { x: 1, y: 0 }, velocity: { x: 2, y: 0 } }), box("floor", 4, 0.5, { fixed: true, position: { x: 0, y: -1 } })]);
    const { ctx, calls } = recorder();
    renderFrame(ctx, w, cam, vp, { overlays: new Set(["velocity", "com"]), selection: new Set(["a"]), hover: null });
    expect(calls[0]).toBe("fillStyle=#070B16");
    expect(calls).toContain("arc(500,300,50,0,6)"); // disc a: 1 m right of centre, 0.5 m radius at 100 px/m
    expect(calls).toContain("setLineDash(6,4)"); // fixed bodies are dashed
    expect(calls).toContain("lineWidth=3"); // selected outline
    expect(calls.filter((c) => c.startsWith("fillText(")).map((c) => c.split(",")[0])).toEqual(["fillText(a", "fillText(floor"]); // bodies draw in id order
  });

  it("DMG-003 wreckage draws dark with a cross; the damage overlay bars each damageable part with its integrity", () => {
    const w = createWorld(1, [
      disc("a", { material: { threshold: 1, toughness: 10 }, integrity: 0.4 }),
      disc("b", { position: { x: 2, y: 0 }, integrity: 0 }),
      disc("c", { position: { x: -2, y: 0 } }),
    ]);
    const plain = recorder();
    renderFrame(plain.ctx, w, cam, vp, { overlays: new Set(), selection: new Set(), hover: null });
    expect(plain.calls).toContain("fillStyle=#0C0F18"); // b is wreckage
    expect(plain.calls.filter((c) => c.startsWith("fillText(") && c.includes("%"))).toEqual([]);
    const bars = recorder();
    renderFrame(bars.ctx, w, cam, vp, { overlays: new Set(["damage"]), selection: new Set(), hover: null });
    expect(bars.calls.filter((c) => c.startsWith("fillText(") && c.includes("%")).map((c) => c.split(",")[0])).toEqual(["fillText(40%", "fillText(0%"]); // c is whole: no bar
  });

  it("TST-011 contact overlay draws only engaged contacts; huge velocities get a capped arrow", () => {
    const w = createWorld(1, [disc("a", { restitution: 0, position: { x: 0, y: 0.5 } }), box("floor", 4, 0.5, { fixed: true, restitution: 0, position: { x: 0, y: -0.25 } })], { x: 0, y: -9.81 });
    for (let i = 0; i < 240; i++) stepInPlace(w, [], getProfile("test"));
    const { ctx, calls } = recorder();
    renderFrame(ctx, w, cam, vp, { overlays: new Set(["contacts"]), selection: new Set(), hover: null });
    expect(calls).toContain("fillStyle=#FF9F43");
    const fast = createWorld(1, [disc("b", { velocity: { x: 2000, y: 0 } })]);
    const r = recorder();
    renderFrame(r.ctx, fast, cam, vp, { overlays: new Set(["velocity"]), selection: new Set(), hover: null });
    const end = r.calls.filter((c) => c.startsWith("lineTo(")).map((c) => Number(c.slice(7).split(",")[0]));
    expect(Math.max(...end)).toBeLessThanOrEqual(400 + 240);
  });
});

describe("assembly centre of mass", () => {
  const vp = { width: 800, height: 600 };
  const cam = { x: 0, y: 0, zoom: 100 };
  it("SBX-031 the centre-of-mass overlay also marks each welded assembly's centre of mass, stores included", () => {
    // A 1 kg box at x = 0 welded to a 1 kg box at x = 2 holding 2 kg of propellant: centre at x = 1.5.
    const a = box("a", 1, 1, { position: { x: 0, y: 0 } });
    const b = { ...box("b", 1, 1, { position: { x: 2, y: 0 } }), contents: [{ resource: "o2", mass: 2, capacity: 2 }] };
    const lone = disc("lone", { position: { x: -3, y: 0 } });
    const w = createWorld(1, [a, b, lone], { x: 0, y: 0 }, { joints: [{ id: "j", a: "a", b: "b", anchorA: { x: 1, y: 0 }, anchorB: { x: -1, y: 0 } }] });
    expect(assemblyCentres(w)).toEqual([{ x: 1.5, y: 0 }]); // the lone disc is not an assembly
    const { ctx, calls } = recorder();
    renderFrame(ctx, w, cam, vp, { overlays: new Set(["com"]), selection: new Set(), hover: null });
    expect(calls).toContain("arc(550,300,10,0,6)"); // the large ring, at 1.5 m right of centre
    const off = recorder();
    renderFrame(off.ctx, w, cam, vp, { overlays: new Set(), selection: new Set(), hover: null });
    expect(off.calls).not.toContain("arc(550,300,10,0,6)");
  });
});

describe("wrapped world", () => {
  it("FLT-012 the view draws the copies of a wrapped world it overlaps, and only those", () => {
    const w = createWorld(1, [disc("a")], { x: 0, y: 0 }, { bounds: { min: { x: -10, y: -10 }, max: { x: 10, y: 10 }, wrap: true } });
    const vp = { width: 800, height: 600 };
    expect(wrapImages(w, { x: 0, y: 0, zoom: 100 }, vp)).toEqual([]); // 8 m × 6 m around the centre
    expect(wrapImages(w, { x: 9, y: 0, zoom: 100 }, vp)).toEqual([[20, 0]]); // near the right edge
    expect(wrapImages(w, { x: 9, y: 9, zoom: 100 }, vp).length).toBe(3); // a corner: right, top and diagonal
  });
});

describe("camera", () => {
  const vp = { width: 800, height: 600 };
  it("SBX-030 world ↔ screen round-trips, zoom keeps the point under the cursor, fit frames all bodies", () => {
    const c = { x: 2, y: -1, zoom: 50 };
    const p = { x: 3.25, y: 4.5 };
    const s = toScreen(c, vp, p);
    expect(toWorld(c, vp, s).x).toBeCloseTo(p.x, 12);
    const z = zoomAt(c, vp, s, 3);
    expect(toScreen(z, vp, p).x).toBeCloseTo(s.x, 9);
    expect(toScreen(z, vp, p).y).toBeCloseTo(s.y, 9);
    const w = createWorld(1, [disc("a", { position: { x: -5, y: 0 } }), disc("b", { position: { x: 5, y: 2 } })]);
    const f = fitBounds(worldBounds(w), vp, 0);
    expect(f.x).toBeCloseTo(0, 12);
    expect(toScreen(f, vp, { x: -5.5, y: 0 }).x).toBeGreaterThanOrEqual(-1e-9);
    expect(toScreen(f, vp, { x: 5.5, y: 0 }).x).toBeLessThanOrEqual(800 + 1e-9);
  });
});

describe("number formatting", () => {
  it("shows SI units with prefixes and readable significant figures", () => {
    expect(fmt(1240, "N")).toBe("1.24 kN");
    expect(fmt(0.0035, "m")).toBe("3.50 mm");
    expect(fmt(3.5, "m/s")).toBe("3.50 m/s");
    expect(fmt(0.5, "m/s")).toBe("0.500 m/s");
    expect(fmt(0, "J")).toBe("0 J");
    expect(fmt(-2.5, "m/s", 5)).toBe("-2.5000 m/s");
    expect(plain(2.5)).toBe("2.5");
    expect(plain(1)).toBe("1");
  });
});

describe("gas plume", () => {
  it("SBX-035 the plume's colours: hot gas glows white-yellow through orange and red, cooler gas is faint grey smoke", () => {
    const rgb = (T: number) => flameColour(T).colour.slice(4, -1).split(",").map(Number);
    expect(flameColour(3000).glow).toBe(true);
    expect(rgb(3000)[2]).toBeGreaterThan(180); // near white
    expect(flameColour(1300).glow).toBe(true);
    expect(rgb(1300)[0]).toBeGreaterThan(rgb(1300)[2] + 100); // red-orange
    expect(flameColour(GLOW_FROM - 1).glow).toBe(false);
    const grey = rgb(400);
    expect(Math.max(...grey) - Math.min(...grey)).toBeLessThan(20); // grey
    expect(flameColour(400).alpha).toBeLessThan(flameColour(2500).alpha); // smoke is fainter than flame
    expect(flameColour(2500).alpha).toBeGreaterThan(flameColour(1200).alpha); // hotter glows brighter
  });

  it("TST-011 SBX-035 a context that can't draw the plume (a recorder) gets dots, so rendering stays testable", () => {
    const w = createWorld(1, []);
    w.gas.parcels = [{ id: 1, mass: 0.001, composition: { h2o: 1 }, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, thermal: 3, radius: 0.05 }];
    const { ctx, calls } = recorder();
    renderFrame(ctx, w, { x: 0, y: 0, zoom: 100 }, { width: 200, height: 200 }, { overlays: new Set(), selection: new Set(), hover: null, gasStyle: "plume" });
    expect(calls.some((c) => c.startsWith("arc(100,100"))).toBe(true);
  });

  it("LND-011 a pad turned with an asteroid still draws its edge and multiplier", () => {
    const pad = box("pad-1", 6, 0.4, { position: { x: 0, y: 0 }, angle: 0.7 } as never);
    const w = createWorld(1, [pad]);
    w.challenge = { goal: { kind: "landing", ship: "pad-1", pad: "pad-1", pads: [{ id: "pad-1", multiplier: 4 }], maxSpeed: 1, maxTilt: 10 }, status: { phase: "flying", altitude: 0, vx: 0, vy: 0, tilt: 0, fuel: 0, fuelStart: 0 } };
    const { ctx, calls } = recorder();
    renderFrame(ctx, w, { x: 0, y: 0, zoom: 100 }, { width: 800, height: 600 }, { overlays: new Set(), selection: new Set(), hover: null });
    expect(calls.some((c) => c.startsWith("fillText(×4"))).toBe(true);
  });

  it("LND-033 a faint starfield drifts behind the world, slower than the camera", () => {
    const w = createWorld(1, []);
    const draw = (x: number) => {
      const { ctx, calls } = recorder();
      renderFrame(ctx, w, { x, y: 0, zoom: 20 }, { width: 800, height: 600 }, { overlays: new Set(), selection: new Set(), hover: null, stars: true });
      return calls.filter((c) => c.startsWith("fillRect(") && !c.startsWith("fillRect(0,0,800,600)"));
    };
    const here = draw(0);
    expect(here.length).toBeGreaterThan(30);
    // Moving the camera 10 m (200 px at this zoom) moves the nearest stars 15 px: parallax, not the world's 200.
    const xs = (calls: string[]) => calls.map((c) => Number(c.slice(9).split(",")[0]));
    const moved = draw(10);
    const shifts = xs(here).flatMap((a) => xs(moved).map((b) => a - b)).filter((d) => d > 0 && d < 40);
    expect(shifts.some((d) => Math.abs(d - 15) <= 1)).toBe(true);
    const { ctx, calls } = recorder();
    renderFrame(ctx, w, { x: 0, y: 0, zoom: 20 }, { width: 800, height: 600 }, { overlays: new Set(), selection: new Set(), hover: null });
    expect(calls.filter((c) => c.startsWith("fillRect(")).length).toBe(1); // no stars unless asked
  });

  it("LND-042 in the game, a ship just across a wrapped world's edge still draws in the copy, its ground as ground", () => {
    const w = createWorld(1, [disc("ship", { position: { x: -9, y: 0 } }), box("rock", 2, 1, { fixed: true, position: { x: -8, y: -2 } })], { x: 0, y: 0 }, { bounds: { min: { x: -10, y: -10 }, max: { x: 10, y: 10 }, wrap: true } });
    const { ctx, calls } = recorder();
    renderFrame(ctx, w, { x: 9, y: 0, zoom: 100 }, { width: 800, height: 600 }, { overlays: new Set(), selection: new Set(), hover: null, groundLine: true });
    // The copy of the ship, one world width (20 m = 2000 px) to the right: x = 400 + (−9 + 20 − 9) × 100 = 600.
    expect(calls).toContain("arc(600,300,50,0,6)");
    expect(calls.some((c) => c === "setLineDash(2,6)")).toBe(false); // no seam line in the game
  });
});
