// The new rockets' nozzles in flight (PRP-012): the exhaust leaves at the exit, and only the
// designer's regular rockets have one.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { component, loxodonPreset, phiomiaPreset, stegodonPreset, thrustOgPreset, thrustPreset, mastodonPreset, type Blueprint } from "../../src/app/blueprint/model.ts";
import { measureWorld } from "../../src/app/blueprint/measure.ts";
import { getProfile, mixture, stepInPlace, type World } from "../../src/core/index.ts";
import { nozzleFlow } from "../../src/core/nozzle.ts";
import { vesselShape, wallLoads } from "../../src/core/vessel.ts";

const scn = JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8"));
const sandbox = getProfile("sandbox");

/** One engine on its own: its bodies, welds and control link, with plenty of propellant. */
function alone(bp: Blueprint, id: string): Blueprint {
  const c = component(bp, id);
  const ids = new Set(c.bodies);
  const head = bp.ship.bodies.find((b) => b.id === id)!;
  return {
    ...bp,
    ship: {
      bodies: bp.ship.bodies.filter((b) => ids.has(b.id)).map((b) => (b.id === id ? { ...b, contents: [{ resource: "h2", mass: 100, capacity: 100 }, { resource: "o2", mass: 800, capacity: 800 }] } : b)),
      joints: bp.ship.joints.filter((j) => ids.has(j.a) && ids.has(j.b)),
      links: bp.ship.links.filter((l) => l.kind === "control" && ids.has((l as { to: string }).to)),
    },
    components: [{ ...c, kind: "cockpit" }],
    mix: { rules: [], rows: [{ channel: head.injector!.channel, lines: [{ control: "forward", weight: 1 }] }] },
  };
}

/** Its thrust in steady running, over ṁ·c*: the effective exhaust speed in units of c*. */
function measured(w: World, id: string): number {
  stepInPlace(w, [{ type: "control.set", channel: "forward", value: 1 }], sandbox);
  for (let i = 0; i < 120; i++) stepInPlace(w, [], sandbox);
  const momentum = () => w.bodies.reduce((s, b) => {
    const m = b.mass + (b.contents ?? []).reduce((a, c) => a + c.mass, 0) + (b.injector?.vessel?.mass ?? 0);
    return { x: s.x + m * b.velocity.x, y: s.y + m * b.velocity.y };
  }, { x: 0, y: 0 });
  const p0 = momentum();
  let cStar = 0;
  for (let i = 0; i < 240; i++) {
    stepInPlace(w, [], sandbox);
    const v = w.bodies.find((b) => b.id === id)!.injector!.vessel!;
    const g = mixture(v.composition).gamma;
    cStar += Math.sqrt(g * (g - 1) * (v.thermal / v.mass) * (2 / (g + 1))) / 240;
  }
  const p1 = momentum();
  const F = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  return F / (w.bodies.find((b) => b.id === id)!.injector!.rate * cStar);
}

describe("the new rockets' nozzles (PRP-012)", () => {
  const presets = { t1: thrustPreset(scn), steg: stegodonPreset(scn), phi: phiomiaPreset(scn), lox: loxodonPreset(scn) };

  it("PRP-012 each new rocket on its own pushes as the textbook nozzle says, within 10%, with the ledger clean", () => {
    for (const [bp, id] of [[presets.t1, "main"], [presets.steg, "eng-l"], [presets.phi, "eng-l"], [presets.lox, "eng-l"]] as const) {
      const r = component(bp, id).rocket!;
      const flare = (r.flare * Math.PI) / 180;
      const exit = r.throat + 2 * r.nozzleLength * Math.tan(flare);
      const w = measureWorld(alone(bp, id));
      const speed = measured(w, id);
      const theory = nozzleFlow(exit / r.throat, 1.33, flare).speed;
      expect(speed / theory, id).toBeGreaterThan(0.9);
      expect(speed / theory, id).toBeLessThan(1.1);
      expect(w.ledger.violations, id).toBe(0);
    }
  }, 300_000);

  it("PRP-012 only the designer's regular rockets declare a nozzle: THRUST OG's engines, the double engine and every game's ships keep the throat's jet", () => {
    const declared = (bp: Blueprint) => bp.ship.bodies.filter((b) => b.injector?.nozzle).map((b) => b.id).sort();
    expect(declared(thrustOgPreset(scn))).toEqual([]);
    expect(declared(mastodonPreset(scn))).toEqual([]);
    expect(declared(presets.steg)).toEqual(["eng-l", "eng-r"]); // its tail double engine has none
    expect(declared(presets.t1)).toEqual(["back-l", "back-r", "front-l", "front-r", "main"]);
    for (const f of readdirSync(new URL("../../scenarios/", import.meta.url))) {
      if (f.endsWith(".json")) expect(readFileSync(new URL(`../../scenarios/${f}`, import.meta.url), "utf8").includes('"nozzle"'), f).toBe(false);
    }
  });

  it("PRP-012 a nozzle that loses a wall stops counting: the jet leaves at the throat again", () => {
    const bp = alone(presets.t1, "main");
    const w = measureWorld(bp);
    const head = w.bodies.find((b) => b.id === "main")!;
    expect(vesselShape(w, head)?.nozzle).toBeDefined();
    // Break the nozzle wall's welds.
    w.joints = w.joints.filter((j) => j.a !== "main-nz-a" && j.b !== "main-nz-a");
    w.tick++;
    const shape = vesselShape(w, head);
    expect(shape?.sealed).toBe(true);
    expect(shape?.nozzle).toBeUndefined();
  });

  it("PRP-012 the nozzle's pressure loads its walls' welds: each wall pushed outward and forward, the head pulled back by as much", () => {
    const w = measureWorld(alone(presets.t1, "main"));
    stepInPlace(w, [{ type: "control.set", channel: "forward", value: 1 }], sandbox);
    for (let i = 0; i < 120; i++) stepInPlace(w, [], sandbox);
    const head = w.bodies.find((b) => b.id === "main")!;
    const loads = wallLoads(w, head, vesselShape(w, head)!, 1 / 240);
    const a = loads.get("main-nz-a")!;
    const b = loads.get("main-nz-b")!;
    // The engine fires down (−y), so forward is +y; wall a is on the left (−x), b on the right.
    expect(a.x).toBeLessThan(0);
    expect(b.x).toBeGreaterThan(0);
    expect(a.y).toBeGreaterThan(0);
    expect(b.y).toBeGreaterThan(0);
    // Equal and opposite sideways, to the chamber grid's resolution at the throat's edges.
    expect(Math.abs(a.x + b.x)).toBeLessThan(0.01 * Math.abs(a.x));
  }, 120_000);
});
