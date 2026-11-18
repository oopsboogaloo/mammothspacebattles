// The blueprint designer's model (docs/blueprint/spec.md; src/app/blueprint/model.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addComponent, weldMasses, body, component, engineGeom, flipComponent, freeSpot, instantiate, jointPoint, overlaps, params, place, removeComponent, reweld, setParam, stats, thrustOgPreset, thrustPreset, welds, weldingOf, worldVertices, response } from "../../src/app/blueprint/model.ts";
import { mixerValues, steerValues } from "../../src/core/index.ts";
import { inCoreUnits } from "../helpers.ts";
import { PILOT, POWER, SHELL } from "../../src/app/blueprint/rules.ts";

const scn = inCoreUnits(JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8")));
/** THRUST OG: the game's ship as it is (the gold standard the tests below hold it to). */
const bp = thrustOgPreset(scn);
/** THRUST 1: the same ship from the regular parts. */
const regular = thrustPreset(scn);

/** The same outline, whichever vertex it starts from and whichever way round. */
const sameOutline = (p: { x: number; y: number }[], q: { x: number; y: number }[]) => {
  expect(p.length).toBe(q.length);
  for (const v of p) expect(q.some((w) => Math.hypot(v.x - w.x, v.y - w.y) < 1e-5)).toBe(true);
};

describe("blueprint model", () => {
  it("BPD-012 THRUST OG is the Thrust game's ship exactly: the same bodies, joints and links, with the game's ids", () => {
    const ship = JSON.parse(JSON.stringify(scn.world.thrust.ship).replaceAll("p{n}-", ""));
    expect(bp.ship.bodies).toEqual(ship.bodies);
    expect(bp.ship.joints).toEqual(ship.joints);
    expect(bp.ship.links).toEqual(ship.links);
    // Only the game's numbering went: every id is the game's without its "p{n}-".
    expect(bp.ship.bodies.map((b) => "p{n}-" + b.id)).toEqual(scn.world.thrust.ship.bodies.map((b: { id: string }) => b.id));
    expect(bp.preset).toBe(true);
    // Every part an OG part.
    expect(bp.components.every((c) => c.part?.endsWith("_og"))).toBe(true);
    expect(component(bp, "gun").part).toBe("railgun_og");
  });

  it("BPD-036 THRUST 1 is THRUST OG from the regular parts: the same but for the shells (rebalance v1: 40 kg at 1,200 m/s in the game), which the magazines hold (256 each) and feed to the railgun, and the pilot", () => {
    expect(regular.id).not.toBe(bp.id);
    expect(regular.components.map((c) => [c.id, c.part])).toEqual(bp.components.map((c) => [c.id, c.part!.replace(/_og$/, "")]));
    expect(body(regular, "gun").magazine!.count).toBe(0);
    expect(["mag-l", "mag-r"].map((id) => body(regular, id).ammo?.count)).toEqual([256, 256]);
    expect(body(regular, "mag-l").ammo!.shell).toEqual({ ...body(bp, "gun").magazine!.shell, shape: SHELL.shape, mass: SHELL.mass });
    expect(body(regular, "mag-l").ammo!.shell).toEqual(body(regular, "gun").magazine!.shell);
    expect(body(regular, "gun").magazine!.railgun!.speed).toBe(300); // 1,200 m/s in the game
    expect(regular.ship.links.filter((l) => l.kind === "ammo").map((l) => [l.kind === "ammo" && l.from, l.to])).toEqual([["mag-l", "gun"], ["mag-r", "gun"]]);
    // The same mass but for its smaller wing tanks (room for its engines' chambers), its welds,
    // which weigh something (THRUST OG's don't), its shells (about the same mass: 512 new for 120
    // old) and its pilot; its centre lower, the 20 kg of shells being in the magazines, not the nose.
    const [o, r] = [stats(bp), stats(regular)];
    const tanks = (b: typeof bp) => ["tank-l", "tank-r"].reduce((sum, id) => sum + body(b, id).mass + body(b, id).contents!.reduce((a, c) => a + c.mass, 0), 0);
    const weld = [...weldMasses(regular).values()].reduce((a, m) => a + m, 0);
    expect([...weldMasses(bp).values()]).toEqual([]);
    const shells = (b: typeof bp) => b.ship.bodies.reduce((a, x) => a + (x.magazine ? x.magazine.count * x.magazine.shell.mass : 0) + (x.ammo ? x.ammo.count * x.ammo.shell.mass : 0), 0);
    expect(r.mass).toBeCloseTo(o.mass - tanks(bp) + tanks(regular) + weld - shells(bp) + shells(regular) + PILOT.mass, 9);
    expect(r.pilot).toBe(PILOT.mass);
    expect(o.pilot).toBe(0);
    expect(r.com.y).toBeLessThan(o.com.y - 0.2);
    expect(Math.abs(r.com.x)).toBeLessThan(1e-9);
    // A regular magazine added later feeds the railgun too; removed, its line goes with it.
    const made = instantiate(regular, regular, "mag-l", "Magazine");
    const spot = freeSpot(regular, made.bodies, weldingOf(made.comp));
    const more = addComponent(regular, made, spot.dx, spot.dy);
    expect(more.ship.links.some((l) => l.kind === "ammo" && l.from === made.bodies[0].id && l.to === "gun")).toBe(true);
    expect(component(more, made.comp.id).part).toBe("magazine");
    expect(removeComponent(more, made.comp.id).ship.links.filter((l) => l.kind === "ammo")).toHaveLength(2);
    // Its shells are a property of the magazine.
    // What it holds follows from its size and walls (the design rules): thinner walls, more room.
    expect(params(regular, "mag-l").find((p) => p.key === "holds")?.value).toBe(256);
    expect(body(setParam(regular, "mag-l", "wall", 0.05), "mag-l").ammo!.count).toBe(430);
  });

  it("BPD-012 its wiring gives the game's engine values for every combination of controls, and its gun, tractor and shield answer Actions A, B and C", () => {
    const steps = [0, 0.5, 1];
    for (const forward of steps)
      for (const left of steps)
        for (const right of steps)
          for (const reverse of steps) {
            const c = { forward, left, right, reverse, "action-a": 1, "action-b": 0, "action-c": 1 };
            const got = mixerValues(bp.mix, c);
            for (const [ch, v] of Object.entries(steerValues(scn.world.thrust.mix, c))) expect(got[ch]).toBeCloseTo(v, 12);
            expect([got.fire, got.tractor, got.shield]).toEqual([1, 0, 1]);
          }
  });

  it("BPD-013 the parts as the player sees them: 17 components, 20 welds of 26 points, 61.2 kg, centre of mass on the middle line", () => {
    expect(bp.components.length).toBe(17);
    expect(bp.components.filter((c) => c.kind === "engine").map((c) => c.bodies.length)).toEqual([3, 3, 3, 3, 3]);
    const w = welds(bp);
    expect(w.length).toBe(20);
    expect(w.reduce((s, x) => s + x.joints.length, 0)).toBe(26);
    const st = stats(bp);
    expect(st.mass).toBeCloseTo(61.2, 3);
    expect(st.com.x).toBeCloseTo(0, 9);
    expect(st.com.y).toBeCloseTo(0.013, 3);
    expect(st.width).toBeCloseTo(5.6, 6);
    expect(st.propellant).toBeCloseTo(8.1, 9);
  });

  it("BPD-014 an engine's shape read from its parts: the main thruster's chamber, throat, walls and flare", () => {
    const g = engineGeom(bp, component(bp, "main"));
    expect(g.headWidth).toBeCloseTo(1.2, 9);
    expect(g.throat).toBeCloseTo(1.0, 9);
    expect(g.wall).toBeCloseTo(0.1, 9);
    expect(g.length).toBeCloseTo(1.1, 9);
    expect(g.flare).toBeCloseTo((Math.atan2(0.25, 1.1) * 180) / Math.PI, 9);
    // A front thruster faces the other way and reads the same way.
    const f = engineGeom(bp, component(bp, "front-r"));
    // (Its angle is stored as 3.141593, so to about 1e-6.)
    expect([f.headWidth, f.throat, f.wall, f.length]).toEqual([0.8, expect.closeTo(0.6, 5), expect.closeTo(0.1, 5), expect.closeTo(0.7, 5)]);
  });

  it("BPD-014 setting an engine's shape to what it is changes nothing: its walls and their welds come out where they were, either way up", () => {
    for (const id of ["main", "front-l", "back-r"]) {
      const c = component(bp, id);
      const again = setParam(bp, id, "length", engineGeom(bp, c).length);
      for (const bid of c.bodies) {
        sameOutline(worldVertices(body(again, bid)), worldVertices(body(bp, bid)));
      }
      for (const j of bp.ship.joints.filter((x) => c.bodies.includes(x.a) && c.bodies.includes(x.b))) {
        const k = again.ship.joints.find((x) => x.id === j.id)!;
        const p = jointPoint(bp, j);
        const q = jointPoint(again, k);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-5);
        // Its two anchors still meet.
        const onB = (() => {
          const b = body(again, k.b);
          const a = b.angle ?? 0;
          return { x: b.position.x + Math.cos(a) * k.anchorB.x - Math.sin(a) * k.anchorB.y, y: b.position.y + Math.sin(a) * k.anchorB.x + Math.cos(a) * k.anchorB.y };
        })();
        expect(Math.hypot(q.x - onB.x, q.y - onB.y)).toBeLessThan(1e-9);
      }
    }
  });

  it("BPD-014 a longer, wider nozzle: the walls grow and splay, the head stays, and the flow sets the parcel size and the head's store", () => {
    let b = setParam(bp, "main", "length", 1.5);
    b = setParam(b, "main", "flare", 20);
    const g = engineGeom(b, component(b, "main"));
    expect(g.length).toBeCloseTo(1.5, 9);
    expect(g.flare).toBeCloseTo(20, 9);
    expect(g.throat).toBeCloseTo(1.0, 9);
    expect(body(b, "main").position).toEqual(body(bp, "main").position);
    b = setParam(b, "main", "rate", 3.888);
    const inj = body(b, "main").injector!;
    expect(inj.parcelMass).toBeCloseTo(0.007776, 9);
    expect(body(b, "main").contents!.reduce((s, x) => s + x.capacity, 0)).toBeCloseTo(0.07776, 9);
  });

  it("BPD-015 rewelding by touch: a tank and generator that share a 0.8 m side weld at two points 0.1 m in from its ends, as the preset's are", () => {
    const again = reweld(bp, "gen-l");
    const was = welds(bp).find((w) => w.id === "gen-l|tank-l")!;
    const now = welds(again).find((w) => w.id === "gen-l|tank-l")!;
    const pts = (bp2: typeof bp, w: typeof was) => w.joints.map((j) => jointPoint(bp2, j)).sort((p, q) => p.y - q.y);
    const p = pts(bp, was);
    const q = pts(again, now);
    expect(q.length).toBe(2);
    for (let i = 0; i < 2; i++) expect(Math.hypot(p[i].x - q[i].x, p[i].y - q[i].y)).toBeLessThan(1e-9);
    expect(now.joints[0].limits).toEqual(was.joints[0].limits);
  });

  it("BPD-015 a tank made narrower pulls away from what it touched on its far side and stays welded on the side it still touches", () => {
    const b = setParam(bp, "tank-l", "width", 1.0);
    const ws = welds(b).filter((w) => w.a === "tank-l" || w.b === "tank-l").map((w) => w.id);
    // Centred, so it now touches nothing on either side: its welds are gone.
    expect(ws.filter((id) => id.includes("gen-l"))).toEqual([]);
    expect(stats(b).mass).toBeLessThan(stats(bp).mass);
  });

  it("BPD-016 the response table's estimate: forward pushes straight ahead, the turns turn opposite ways and as much as each other", () => {
    const st = stats(bp);
    const fwd = response(bp, { forward: 1 }, st);
    expect(fwd.ahead).toBeGreaterThan(20);
    expect(Math.abs(fwd.turn)).toBeLessThan(1e-9);
    const l = response(bp, { left: 1 }, st);
    const r = response(bp, { right: 1 }, st);
    expect(l.turn).toBeGreaterThan(0);
    expect(r.turn).toBeCloseTo(-l.turn, 6);
    expect(response(bp, { reverse: 1 }, st).ahead).toBeLessThan(0);
  });

  it("BPD-016 every component has properties to show, and a box part's size reads back as set", () => {
    for (const c of bp.components) expect(params(bp, c.id).length).toBeGreaterThan(0);
    const b = setParam(bp, "battery", "height", 0.6);
    expect(params(b, "battery").find((p) => p.key === "height")!.value).toBe(0.6);
  });
});

describe("typed numbers", () => {
  it("BPD-021 a typed value takes sums and, for metres, cm or mm; anything else is refused", async () => {
    const { parseTyped } = await import("../../src/app/blueprint/NumberControl.tsx");
    expect(parseTyped("1.2", "m")).toBe(1.2);
    expect(parseTyped("120 cm", "m")).toBeCloseTo(1.2, 12);
    expect(parseTyped("450mm", "m")).toBeCloseTo(0.45, 12);
    expect(parseTyped("1.2*2", "m")).toBeCloseTo(2.4, 12);
    expect(parseTyped("(1+2)/4", "kg")).toBe(0.75);
    expect(parseTyped("-0.5", "°")).toBe(-0.5);
    expect(parseTyped("12 kg", "kg")).toBe(12);
    expect(parseTyped("abc", "m")).toBeNull();
    expect(parseTyped("1+", "m")).toBeNull();
    expect(parseTyped("alert(1)", "m")).toBeNull();
  });
});

describe("placing parts", () => {
  it("BPD-022 a new tank dropped near where Tank R was snaps flush against Generator R, lines up, and welds at two points", () => {
    const b = removeComponent(bp, "tank-r");
    const made = instantiate(b, bp, "tank-r");
    // The template sits where Tank R was; drop it 0.15 m out and 0.1 m low.
    const p = place(b, made.bodies, weldingOf(made.comp), 0.15, -0.1);
    expect(p.snapped).toBe(true);
    expect(p.overlap).toBe(false);
    expect(p.dx).toBeCloseTo(0, 9);
    expect(p.dy).toBeCloseTo(0, 9);
    expect(p.touches).toContain("gen-r");
    const added = addComponent(b, made, p.dx, p.dy);
    const w = welds(added).find((x) => x.id === `gen-r|${made.comp.id}`)!;
    expect(w.joints.length).toBe(2);
    // It feeds every engine, and has no controls of its own.
    const feeds = added.ship.links.filter((l) => l.kind === "feed" && l.from === made.bodies[0].id);
    expect(new Set(feeds.map((l) => (l as { to: string }).to))).toEqual(new Set(["main", "back-l", "back-r", "front-l", "front-r"]));
    expect(added.mix.rows.length).toBe(bp.mix.rows.length);
  });

  it("BPD-022 a part can't be dropped into another; with snapping off it lands on the 0.05 m grid", () => {
    const made = instantiate(bp, bp, "tank-r");
    expect(place(bp, made.bodies, weldingOf(made.comp), -2.05, 0).overlap).toBe(true);
    const p = place(bp, made.bodies, weldingOf(made.comp), 2.013, 3.022, { free: true });
    expect(Math.abs((made.bodies[0].position.x + p.dx) / 0.05 - Math.round((made.bodies[0].position.x + p.dx) / 0.05))).toBeLessThan(1e-6);
    expect(overlaps([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }])).toBe(false);
  });

  it("BPD-022 a new engine gets its own channel and an empty mixer row (the player wires it), fuel from every tank, and a spot that overlaps nothing", () => {
    const made = instantiate(bp, bp, "back-l");
    const spot = freeSpot(bp, made.bodies, weldingOf(made.comp));
    const added = addComponent(bp, made, spot.dx, spot.dy);
    const head = body(added, made.comp.bodies[0]);
    expect(head.injector!.channel).toBe(made.comp.id);
    expect(added.mix.rows.find((r) => r.channel === made.comp.id)).toEqual({ channel: made.comp.id, lines: [] });
    expect(added.ship.links.filter((l) => l.kind === "feed" && l.to === head.id).length).toBe(4);
    // The Thrust ship has no side free for an engine's splayed walls, so this one lands clear of it, overlapping nothing.
    for (const id of made.comp.bodies)
      for (const o of bp.ship.bodies) expect(overlaps(worldVertices(body(added, id)), worldVertices(o))).toBe(false);
  });

  it("BPD-022 a new battery's free spot is flush against the ship, welded", () => {
    const made = instantiate(bp, bp, "battery");
    const spot = freeSpot(bp, made.bodies, weldingOf(made.comp));
    const added = addComponent(bp, made, spot.dx, spot.dy);
    expect(welds(added).some((w) => w.a === made.comp.id || w.b === made.comp.id)).toBe(true);
  });

  it("BPD-022 flipping an engine twice puts it back", () => {
    const twice = flipComponent(flipComponent(bp, "back-l"), "back-l");
    for (const id of component(bp, "back-l").bodies) {
      const p = worldVertices(body(twice, id));
      const q = worldVertices(body(bp, id));
      for (const v of p) expect(q.some((w) => Math.hypot(v.x - w.x, v.y - w.y) < 1e-5)).toBe(true);
    }
    void reweld;
  });
});

describe("pieces", () => {
  it("BPD-023 the preset is one piece; moving the battery away leaves the main thruster, welded only to it, as a second piece and the battery a third", async () => {
    const { pieces, moveComponent } = await import("../../src/app/blueprint/model.ts");
    expect(pieces(bp).length).toBe(1);
    const moved = moveComponent(bp, "battery", 0, -3);
    expect(pieces(moved).length).toBe(3);
  });
});

describe("wiring", () => {
  it("BPD-024 each row is said in words, and the checks find an unwired engine and a forward that turns", async () => {
    const { describeRow, setRow, wiringChecks } = await import("../../src/app/blueprint/model.ts");
    const names: Record<string, string> = { forward: "Forward", left: "Turn left", right: "Turn right", reverse: "Reverse" };
    const n = (id: string) => names[id] ?? id;
    expect(describeRow(regular.mix.rows.find((r) => r.channel === "bl"), n)).toBe("Fires fully on Turn right. Fires fully on Forward, except while Turn left is held.");
    expect(describeRow(regular.mix.rows.find((r) => r.channel === "fr"), n)).toBe("Fires fully on Reverse. Fires fully on Turn right, 50% less while Forward is held.");
    expect(describeRow(undefined, n)).toBe("Not wired: no control drives it.");
    const controls = Object.entries(names).map(([id, name]) => ({ id, name }));
    expect(wiringChecks(regular, controls).every((c) => c.ok)).toBe(true);
    // Unwire the back-left thruster: it is named, and forward now turns the ship.
    const b = setRow(regular, "bl", (r) => ({ ...r, lines: [] }));
    const checks = wiringChecks(b, controls).filter((c) => !c.ok).map((c) => c.text);
    expect(checks[0]).toBe("Not wired: Thruster BL");
    expect(checks.some((t) => t.startsWith("Forward also turns the ship"))).toBe(true);
  });
});

describe("measure", () => {
  it("BPD-025 Measure runs the real physics: Thrust 1 gives the design log's 36.1 m/s² forward and 9.8 reverse, turns that mirror, and no broken welds; the estimate is within 2%", async () => {
    const { measureNow, measureKey } = await import("../../src/app/blueprint/measure.ts");
    const rows: Record<string, number>[] = [{ forward: 1 }, { reverse: 1 }, { left: 1 }, { right: 1 }];
    const [f, rv, l, r] = measureNow(bp, rows);
    expect(f.ahead).toBeCloseTo(36.1, 1);
    expect(rv.ahead).toBeCloseTo(-9.8, 1);
    expect(Math.abs(f.turn)).toBeLessThan(0.1);
    expect(l.turn).toBeGreaterThan(8);
    expect(r.turn).toBeCloseTo(-l.turn, 1);
    expect([f, rv, l, r].every((x) => x.broke === 0)).toBe(true);
    const st = stats(bp);
    for (const [i, c] of rows.entries()) {
      const est = response(bp, c, st);
      const got = [f, rv, l, r][i];
      const want = i < 2 ? got.ahead : got.turn;
      expect(Math.abs((i < 2 ? est.ahead : est.turn) - want) / Math.abs(want)).toBeLessThan(0.02);
    }
    // A change to the ship or its wiring is a different measurement.
    expect(measureKey(setParam(bp, "main", "rate", 7))).not.toBe(measureKey(bp));
    expect(measureKey(structuredClone(bp))).toBe(measureKey(bp));
  }, 60_000);
});

describe("mirror", () => {
  it("BPD-027 mirroring Thruster BL, with BR removed, makes BR again: the same outline, welds and wiring, named BR", async () => {
    const { mirrorComponent, removeComponent, channelsOf, worldVertices: wv } = await import("../../src/app/blueprint/model.ts");
    const b = removeComponent(regular, "back-r");
    const r = mirrorComponent(b, "back-l");
    if ("error" in r) throw new Error(r.error);
    const c = component(r.bp, r.id);
    expect(c.label).toBe("Thruster BR");
    const want = component(regular, "back-r").bodies.flatMap((id) => wv(body(regular, id)));
    const got = c.bodies.flatMap((id) => wv(body(r.bp, id)));
    for (const v of want) expect(got.some((g) => Math.hypot(g.x - v.x, g.y - v.y) < 1e-6)).toBe(true);
    // Welded to Tank R by the touch rule: two points along their 0.8 m shared side (the preset's BR has one).
    expect(welds(r.bp).find((w) => w.id === `${r.id}|tank-r` || w.id === `tank-r|${r.id}`)?.joints.length).toBe(2);
    // Its wiring is BR's: turn left, and forward eased by turn right.
    const row = r.bp.mix.rows.find((x) => x.channel === channelsOf(r.bp, r.id)[0])!;
    expect(row.lines).toEqual(regular.mix.rows.find((x) => x.channel === "br")!.lines);
    // It exhausts downward, as the original.
    const h = body(r.bp, c.bodies[0]);
    expect(h.injector!.direction).toEqual(body(regular, "back-l").injector!.direction);
  });

  it("BPD-027 mirroring is refused, with the reason, where the other side is taken or the part is on the middle line", async () => {
    const { mirrorComponent } = await import("../../src/app/blueprint/model.ts");
    expect(mirrorComponent(bp, "tank-l")).toEqual({ error: expect.stringContaining("other side is taken") });
    expect(mirrorComponent(bp, "main")).toEqual({ error: expect.stringContaining("middle line") });
  });
});

describe("only what is welded to the cockpit answers", () => {
  it("BPD-030 a thruster off the ship stops answering: it burns off its own store, held on, and is dead; the rest still answer; the estimate leaves it out", async () => {
    const { measureWorld } = await import("../../src/app/blueprint/measure.ts");
    const { removeWeld, response, wiringChecks } = await import("../../src/app/blueprint/model.ts");
    const { getProfile, stepInPlace } = await import("../../src/core/index.ts");
    const loose = removeWeld(regular, "battery|main");
    const w = measureWorld(loose);
    const profile = getProfile("sandbox");
    stepInPlace(w, [{ type: "control.set", channel: "forward", value: 1 }], profile);
    const main = () => w.bodies.find((b) => b.id === "main")!;
    // At once its line is cut and it is held on, on a channel of its own the controls don't reach.
    expect(main().injector!.channel).toBe("main.residual");
    expect(w.controls["main.residual"]).toBe(1);
    expect(w.links.some((l) => l.kind === "feed" && l.to === "main")).toBe(false);
    // The back pair, still on the ship, answer Forward.
    expect(w.controls.bl).toBe(1);
    for (let i = 0; i < 240; i++) stepInPlace(w, [], profile);
    // Within a second its store is burned: it is dead.
    expect((main().contents ?? []).reduce((m, c) => m + c.mass, 0)).toBeLessThan(1e-4); // of 0.156 kg
    // The estimate and the checks agree.
    expect(response(loose, { forward: 1 }).throttles.main).toBe(0);
    expect(wiringChecks(loose, [{ id: "forward", name: "Forward" }]).map((c) => c.text)).toContain("Not welded to the cockpit, so they won't answer: Main thruster");
  });

  it("BPD-030 a gun knocked off loses its control; with no cockpit nothing answers", async () => {
    const { measureWorld } = await import("../../src/app/blueprint/measure.ts");
    const { removeComponent, removeWeld } = await import("../../src/app/blueprint/model.ts");
    const { getProfile, stepInPlace } = await import("../../src/core/index.ts");
    let b = removeWeld(bp, "gun|hull");
    b = removeWeld(b, "gun|shield");
    const w = measureWorld(b);
    stepInPlace(w, [], getProfile("sandbox"));
    expect(w.links.some((l) => l.kind === "control" && l.to === "gun")).toBe(false);
    const none = measureWorld(removeComponent(bp, "hull"));
    expect(none.mix).toBeUndefined();
  });
});

describe("actions and overlaps", () => {
  it("BPD-034 the actions are named on screen by the largest thing they drive, or the player's own name for them in this ship", async () => {
    const { actionLabel, setLabel, setRow } = await import("../../src/app/blueprint/model.ts");
    expect(["action-a", "action-b", "action-c"].map((c) => actionLabel(bp, c, c))).toEqual(["FIRE", "BEAM", "SHIELD"]);
    // Action A rewired: 30% to the gun, 100% to the shield: it is SHIELD.
    let b = setRow(bp, "fire", (r) => ({ ...r, lines: [{ control: "action-a", weight: 0.3 }] }));
    b = setRow(b, "shield", (r) => ({ ...r, lines: [...r.lines, { control: "action-a", weight: 1 }] }));
    expect(actionLabel(b, "action-a", "A")).toBe("SHIELD");
    // Named by the player; cleared, automatic again; wired to nothing, its own name.
    expect(actionLabel(setLabel(bp, "action-b", "grab"), "action-b", "B")).toBe("GRAB");
    expect(actionLabel(setLabel(setLabel(bp, "action-b", "grab"), "action-b", ""), "action-b", "B")).toBe("BEAM");
    expect(actionLabel(bp, "boost", "Boost")).toBe("BOOST");
  });

  it("BPD-035 components never overlap: the preset's one overlap is found, and an edit that would make a new one is refused", async () => {
    const { allOverlaps, withoutNewOverlaps } = await import("../../src/app/blueprint/model.ts");
    expect(allOverlaps(bp)).toEqual([["gun", "shield"]]);
    const wider = setParam(bp, "tank-l", "width", 1.7);
    const r = withoutNewOverlaps(bp, wider, "tank-l");
    expect(r.bp).toBe(bp);
    expect(r.blocked).toEqual(["gen-l", "mag-l"]);
    // Narrower is fine.
    expect(withoutNewOverlaps(bp, setParam(bp, "tank-l", "width", 1.4), "tank-l").blocked).toEqual([]);
  });
});

describe("Mastodon Gun Ship, double engines, trapezoids and triangles", async () => {
  const { mastodonPreset, partsTemplate, formVertices, allOverlaps, pieces, engines, engineUnits, mirrorComponent, wiringChecks } = await import("../../src/app/blueprint/model.ts");
  const { measureNow } = await import("../../src/app/blueprint/measure.ts");
  const m = mastodonPreset(scn);
  const moves = [{ id: "forward", name: "Forward" }, { id: "reverse", name: "Reverse" }, { id: "left", name: "Turn left" }, { id: "right", name: "Turn right" }];

  it("BPD-038 the Mastodon is Chloe's drawing: 14 parts in one piece, none overlapping, 6.3 × 2.45 m, four railguns fed by two magazines, wired and balanced", () => {
    expect(m.components).toHaveLength(14);
    expect(pieces(m)).toHaveLength(1);
    expect(allOverlaps(m)).toEqual([]);
    const s = stats(m);
    expect([s.width, s.height]).toEqual([6.3, 2.45]);
    expect(Math.abs(s.com.x)).toBeLessThan(1e-9);
    const guns = m.components.filter((c) => c.kind === "weapon").map((c) => c.id);
    expect(guns).toHaveLength(4);
    for (const g of guns) expect(m.ship.links.filter((l) => l.kind === "ammo" && l.to === g)).toHaveLength(2);
    // Bullet magazines (0.4 × 1.4 m): bullets take twice the room of railgun shells, so 57, not 115.
    expect(["mag-l", "mag-r"].map((id) => body(m, id).ammo!.count)).toEqual([57, 57]);
    // Each tank holds what the design rules give its inner area: the centre tank (1.2 × 0.65 m) 1.75 kg.
    const held = (id: string) => body(m, id).contents!.reduce((a, c) => a + c.mass, 0);
    expect(held("tank-c")).toBeCloseTo(4.05 * ((1.0 * 0.45) / (1.3 * 0.8)), 6);
    expect(held("tank-l")).toBeCloseTo(held("tank-r"), 9);
    expect(held("tank-l")).toBeGreaterThan(1.5);
    // Every head and gun has its control link; the wiring checks find nothing wrong.
    for (const b of m.ship.bodies.filter((x) => x.injector || x.magazine)) expect(m.ship.links.some((l) => l.kind === "control" && l.to === b.id)).toBe(true);
    expect(wiringChecks(m, moves).every((c) => c.ok)).toBe(true);
    // Every railgun welds by two points, as Thrust's does.
    for (const g of guns) expect(welds(m).filter((w) => w.a === g || w.b === g).reduce((n, w) => n + w.joints.length, 0)).toBe(2);
  });

  it("BPD-038 a double engine is one part with two heads back to back, each its own channel: the rear pushes forward, the front back", () => {
    const c = component(m, "eng-l");
    expect(c.heads).toEqual(["eng-l", "eng-l-rev"]);
    expect(engineUnits(m, c).map((u) => u.walls.length)).toEqual([2, 2]);
    expect(engines(m).filter((e) => e.id === "eng-l").map((e) => [e.channel, Math.round(e.dir.y)])).toEqual([["eng-l", 1], ["eng-l-rev", -1]]);
    expect(params(m, "eng-l").find((p) => p.key === "rate")?.label).toBe("Flow (burn rate) (each)");
    // A change to it changes both heads, and they stay back to back, welded.
    const deeper = setParam(m, "eng-l", "headHeight", 0.4);
    const [a, b] = ["eng-l", "eng-l-rev"].map((id) => body(deeper, id));
    expect(a.position.y + 0.2).toBeCloseTo(0.7, 6);
    expect(b.position.y - 0.2).toBeCloseTo(0.7, 6);
    expect(deeper.ship.joints.filter((j) => (j.a === a.id && j.b === b.id) || (j.a === b.id && j.b === a.id))).toHaveLength(2);
    const faster = setParam(m, "eng-l", "rate", 6);
    expect(["eng-l", "eng-l-rev"].map((id) => body(faster, id).injector!.rate)).toEqual([6, 6]);
  });

  it("BPD-038 measured: about 31 m/s² forward and back and 9 rad/s² turning, nothing breaking; Action A fires the four guns", () => {
    const r = measureNow(m, [{ forward: 1 }, { reverse: 1 }, { left: 1 }, { "action-a": 1 }]);
    expect(r[0].ahead).toBeGreaterThan(28);
    expect(r[1].ahead).toBeLessThan(-28);
    expect(r[2].turn).toBeGreaterThan(7);
    expect(r[2].turn).toBeLessThan(12);
    expect(r.map((x) => x.broke)).toEqual([0, 0, 0, 0]);
    expect(r[3].ahead).toBeLessThan(-5); // four guns' recoil
  }, 120_000);

  it("BPD-039 trapezoids and triangles: outlines square to the grid at every quarter turn, so they weld; resizing scales what they hold; mirroring turns them the other way", () => {
    for (const turn of [0, 90, 180, 270]) {
      const vs = formVertices({ kind: "trapezoid", base: 1.4, top: 0.7, height: 0.75, turn });
      expect(vs).toHaveLength(4);
      // One side the base (1.4) and one the top (0.7), both along an axis.
      const sides = vs.map((v, i) => [v, vs[(i + 1) % 4]]).filter(([p, q]) => p.x === q.x || p.y === q.y).map(([p, q]) => Math.hypot(q.x - p.x, q.y - p.y));
      expect(sides.sort()).toEqual([0.7, 1.4]);
    }
    const tri = formVertices({ kind: "triangle", base: 0.6, height: 0.6, apex: 0.3, turn: 0 });
    expect(tri).toContainEqual({ x: 0.3, y: 0.3 }); // a right angle over the base's end
    // The side tank, made bigger: it holds more, and still welds to the magazine and the engine.
    const t0 = body(m, "tank-l");
    const big = setParam(m, "tank-l", "fHeight", 0.75);
    expect(body(big, "tank-l").contents![1].capacity).toBeCloseTo(t0.contents![1].capacity, 9);
    const wider = setParam(m, "tank-l", "fTop", 1.05);
    expect(body(wider, "tank-l").contents![1].capacity).toBeGreaterThan(t0.contents![1].capacity);
    expect(welds(wider).filter((w) => w.a === "tank-l" || w.b === "tank-l").length).toBe(2);
    // Mirrored, the left mount becomes a right one, the same outline turned the other way.
    const noR = removeComponent(removeComponent(m, "gun-or"), "mount-r");
    const r = mirrorComponent(noR, "mount-l");
    if ("error" in r) throw new Error(r.error);
    expect(component(r.bp, r.id).form?.turn).toBe(270);
    sameOutline(worldVertices(body(r.bp, component(r.bp, r.id).bodies[0])), worldVertices(body(m, "mount-r")));
    // A triangle from the list is a frame part, with its outline's properties.
    const parts = partsTemplate();
    expect(params(parts, "triangle").map((p) => p.key)).toEqual(expect.arrayContaining(["fBase", "fHeight", "fApex", "fTurn"]));
  });

  it("BPD-040 a part added from the list has its control links, so the wiring reaches it in Try it", () => {
    for (const [tpl, from] of [[m, "eng-l"], [m, "gun-l"], [bp, "back-l"]] as const) {
      const made = instantiate(regular, tpl, from);
      const out = addComponent(regular, made, 30, 0);
      for (const b of made.bodies.filter((x) => x.injector || x.magazine)) {
        const ch = b.injector?.channel ?? b.magazine!.railgun!.channel;
        expect(out.ship.links.some((l) => l.kind === "control" && l.to === b.id && l.channel === ch)).toBe(true);
      }
    }
    // A double engine added keeps a channel for each head.
    const made = instantiate(regular, m, "eng-l");
    expect(made.comp.heads).toHaveLength(2);
    expect(new Set(made.bodies.filter((b) => b.injector).map((b) => b.injector!.channel)).size).toBe(2);
  });
});

describe("turning and resizing parts (§3.6)", async () => {
  const { rotateComponent, resizeComponent, componentAngle, componentSize, place: placeAt2, mastodonPreset } = await import("../../src/app/blueprint/model.ts");
  type BP = typeof bp;
  const box = (id: string, w: number, h: number, x: number, y: number, deg = 0) => ({ id, shape: { kind: "box" as const, width: w, height: h }, mass: 1, position: { x, y }, velocity: { x: 0, y: 0 }, angle: (deg * Math.PI) / 180, angularVelocity: 0 });
  const two = (deg: number, gap = 0): BP => {
    const r = (v: { x: number; y: number }) => ({ x: v.x * Math.cos((deg * Math.PI) / 180) - v.y * Math.sin((deg * Math.PI) / 180), y: v.x * Math.sin((deg * Math.PI) / 180) + v.y * Math.cos((deg * Math.PI) / 180) });
    const p = r({ x: 0, y: 0.75 + gap });
    return { format: 1, id: "t", name: "T", rev: 1, ship: { bodies: [box("a", 1, 1, 0, 0, deg), box("b", 1, 0.5, p.x, p.y, deg)], joints: [], links: [] }, components: [{ id: "a", kind: "frame", label: "A", bodies: ["a"] }, { id: "b", kind: "frame", label: "B", bodies: ["b"] }], mix: { rules: [], rows: [] } };
  };

  it("BPD-041 parts turned to any angle weld where their sides meet, and snap flush to each other's sides", () => {
    for (const deg of [0, 15, 30, 45, 90]) {
      const w = welds(reweld(two(deg), "b"));
      expect(w.map((x) => x.joints.length)).toEqual([2]);
    }
    // 0.1 m apart, at 30°: dragged near, it snaps flush (along the sides' normal) and would weld.
    const apart = two(30, 0.1);
    const b = body(apart, "b");
    const pl = placeAt2(apart, [b], ["b"], 0, 0, { exclude: "b" });
    expect(pl.snapped).toBe(true);
    expect(pl.touches).toEqual(["a"]);
    expect(Math.hypot(pl.dx, pl.dy)).toBeCloseTo(0.1, 5);
  });

  it("BPD-041 turning a part: about its centre, in whole degrees, back where it was after a full turn; its welds re-form", () => {
    let t = regular;
    for (const deg of [90, 180, -90, 0]) {
      t = rotateComponent(t, "battery", deg);
      expect(componentAngle(t, "battery")).toBe(deg);
    }
    expect(body(t, "battery").position).toEqual(body(regular, "battery").position);
    sameOutline(worldVertices(body(t, "battery")), worldVertices(body(regular, "battery")));
    expect(welds(t).filter((w) => w.a === "battery" || w.b === "battery").length).toBe(welds(regular).filter((w) => w.a === "battery" || w.b === "battery").length);
    // The Angle property turns it too; at 15° it no longer meets the main thruster squarely.
    const tilted = setParam(regular, "battery", "angle", 15);
    expect(componentAngle(tilted, "battery")).toBe(15);
    expect(params(tilted, "battery").find((p) => p.key === "angle")?.value).toBe(15);
  });

  it("BPD-042 resizing from a corner keeps the opposite corner where it is, at any angle; what the part holds goes with its area", () => {
    const t = body(regular, "tank-l");
    // Drag the top-right corner: the bottom-left stays.
    const th = t.shape.kind === "box" ? t.shape.height : 0;
    const fixed = { x: t.position.x - 0.75, y: t.position.y - th / 2 };
    const big = resizeComponent(regular, "tank-l", 1.8, 1.2, fixed, { x: 1, y: 1 });
    expect(componentSize(big, "tank-l")).toEqual({ w: 1.8, h: 1.2 });
    expect(body(big, "tank-l").position.x).toBeCloseTo(fixed.x + 0.9, 9);
    expect(body(big, "tank-l").position.y).toBeCloseTo(fixed.y + 0.6, 9);
    // By the design rules: its inner area, 1.6 × 1.0 against THRUST 1's 1.3 × 0.6.
    expect(body(big, "tank-l").contents![1].capacity).toBeCloseTo(t.contents![1].capacity * ((1.6 * 1.0) / (1.3 * (th - 0.2))), 8);
    // Turned 30°: the corner opposite the one dragged stays put in the ship's frame.
    const turned = rotateComponent(two(0), "b", 30);
    const bb = body(turned, "b");
    const corner = (src: BP, b: typeof bb, i: number, j: number) => {
      const s = componentSize(src, "b");
      const a = b.angle ?? 0;
      const v = { x: (i * s.w) / 2, y: (j * s.h) / 2 };
      return { x: b.position.x + v.x * Math.cos(a) - v.y * Math.sin(a), y: b.position.y + v.x * Math.sin(a) + v.y * Math.cos(a) };
    };
    const keep = corner(turned, bb, -1, -1);
    const grown = resizeComponent(turned, "b", 1.5, 0.8, keep, { x: 1, y: 1 });
    const now = corner(grown, body(grown, "b"), -1, -1);
    expect(Math.hypot(now.x - keep.x, now.y - keep.y)).toBeLessThan(1e-5);
    // A trapezoid resized along its own axes: the Mastodon's side tank, made deeper (its height runs along x).
    const m = mastodonPreset(scn);
    const s0 = componentSize(m, "tank-l");
    const r0 = body(m, "tank-l");
    const deeper = resizeComponent(m, "tank-l", s0.w + 0.25, s0.h, { x: r0.position.x + s0.w / 2, y: r0.position.y }, { x: -1, y: 0 });
    expect(component(deeper, "tank-l").form).toMatchObject({ base: 1.4, top: 0.7, height: 1 });
  });
});

describe("design rules: tanks and magazines (docs/blueprint/design-rules-proposal.md §1–3)", async () => {
  const { containerKind, WELD_PRESETS: presets, weldPresetsFor } = await import("../../src/app/blueprint/model.ts");
  const { containerSpec, innerArea, CONTAINERS } = await import("../../src/app/blueprint/rules.ts");
  const box = (w: number, h: number) => [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];

  it("BPD-043 at Thrust's sizes and 0.1 m walls the rules give Thrust's own figures: Thrust's tank, and THRUST 1's magazines (its tanks are shorter, for its engines' chambers)", () => {
    // Thrust's tank, 1.5 × 1.0 m: its 4.05 kg and 2 kg exactly.
    const tankSpec = containerSpec("tank", box(1.5, 1), 0.1);
    expect(tankSpec.holds).toBeCloseTo(4.05, 9);
    expect(tankSpec.dryMass).toBeCloseTo(2, 6);
    expect(tankSpec.material).toEqual(body(bp, "tank-l").material);
    expect(tankSpec.charge).toBeCloseTo(body(bp, "tank-l").explosive!.charge, 9);
    // THRUST 1's, 1.5 × 0.8 m, by the same rule: 1.3 × 0.6 m inside.
    for (const id of ["tank-l", "tank-r"]) expect(body(regular, id).contents!.reduce((a, c) => a + c.mass, 0)).toBeCloseTo((4.05 * (1.3 * 0.6)) / (1.3 * 0.8), 9);
    for (const id of ["mag-l", "mag-r"]) {
      const [r, o] = [body(regular, id), body(bp, id)];
      expect([r.mass, r.ammo!.count, r.explosive!.charge]).toEqual([o.mass, 256, o.explosive!.charge]);
      expect(r.material).toEqual(o.material);
    }
    // The OG parts follow no rules; the regular ones do.
    expect(containerKind(component(bp, "tank-l"))).toBeNull();
    expect(containerKind(component(regular, "tank-l"))).toBe("tank");
    // Every weld at the default walls is Standard, as in the game.
    expect(welds(regular).flatMap((w) => w.joints).filter((j) => j.limits!.tension !== 22950 && !/gun|shield/.test(j.a + j.b))).toEqual([]);
    expect(presets.map((p) => p.limits.tension)).toEqual([11475, 22950, 45900]);
  });

  it("BPD-043 inner area: each side moved in by the wall, for boxes, trapezoids and triangles; nothing inside when the walls fill it", () => {
    expect(innerArea(box(1.5, 1), 0.1)).toBeCloseTo(1.3 * 0.8, 12);
    expect(innerArea(box(0.3, 0.3), 0.2)).toBe(0);
    // A right triangle's inradius is (a + b − c) ÷ 2: walls that thick leave nothing.
    const tri = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }];
    expect(innerArea(tri, 0.5)).toBeCloseTo(6 * ((1 - 0.5) / 1) ** 2, 9);
    expect(innerArea(tri, 1.01)).toBe(0);
    // A short side the walls swallow drops out: this square with one corner cut off by 0.1 m, inside
    // 0.3 m walls, leaves the plain 0.4 m square's inside (0.6 − 0.2 wide each way), its cut corner gone.
    const cut = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.9 }, { x: 0.9, y: 1 }, { x: 0, y: 1 }];
    expect(innerArea(cut, 0.3)).toBeCloseTo(0.4 * 0.4, 12);
    // Exactly 256 shells in THRUST 1's magazine (rebalance v1), whatever floating point makes of 0.125 m² × 2,048.
    expect(containerSpec("magazine", box(0.7, 0.45), 0.1).holds).toBe(256);
    expect(CONTAINERS.magazine.perArea).toBeCloseTo(2048, 9);
  });

  it("BPD-044 wall thickness: thicker is stronger (welds and armour) and heavier, and holds less; the welds go with the thinner wall", () => {
    const thin = setParam(regular, "tank-l", "wall", 0.05);
    const thick = setParam(regular, "tank-l", "wall", 0.2);
    const held = (b: typeof bp) => body(b, "tank-l").contents!.reduce((a, c) => a + c.mass, 0);
    // THRUST 1's tank, 1.5 × 0.8 m.
    expect(held(thin)).toBeCloseTo(4.05 * ((1.4 * 0.7) / 1.04), 6); // 3.82 kg
    expect(held(thick)).toBeCloseTo(4.05 * ((1.1 * 0.4) / 1.04), 6); // 1.71 kg
    expect([body(thin, "tank-l").mass, body(thick, "tank-l").mass]).toEqual([0.956522, 3.304348]);
    expect(body(thin, "tank-l").material).toMatchObject({ threshold: 30, toughness: 250 });
    expect(body(thick, "tank-l").material).toMatchObject({ threshold: 120, toughness: 1000 });
    // Its welds to the generator: half as strong with thinner walls; no stronger with thicker (the generator's 0.1 m is then the thinner).
    const tension = (b: typeof bp) => welds(b).find((w) => [w.a, w.b].includes("tank-l") && [w.a, w.b].includes("gen-l"))!.joints[0].limits!.tension;
    expect([tension(thin), tension(regular), tension(thick)]).toEqual([11475, 22950, 22950]);
    expect(weldPresetsFor(thin, welds(thin).find((w) => [w.a, w.b].includes("tank-l") && [w.a, w.b].includes("gen-l"))!.id).map((p) => p.limits.tension)).toEqual([5737.5, 11475, 22950]);
    // No thicker than a quarter of its smaller side (0.8 m), or 0.3 m.
    expect(component(setParam(regular, "tank-l", "wall", 0.9), "tank-l").wall).toBe(0.2);
  });

  it("BPD-044 size limits: a tank 0.3 to 3 m each way, a magazine 0.3 to 2 m; a resize past them stops at them", () => {
    expect(params(regular, "tank-l").find((p) => p.key === "width")).toMatchObject({ min: 0.3, max: 3 });
    expect(params(regular, "mag-l").find((p) => p.key === "height")).toMatchObject({ min: 0.3, max: 2 });
    // Typed past the limit: refused.
    expect(setParam(regular, "mag-l", "width", 2.5)).toBe(regular);
    // Dragged past it: stops there.
    const t = body(regular, "tank-l");
    const small = resizeOk(regular, "tank-l", 0.1, 0.1, { x: t.position.x - 0.75, y: t.position.y - 0.5 });
    expect(componentSizeOf(small, "tank-l")).toEqual({ w: 0.3, h: 0.3 });
  });
});

async function importResize() {
  return await import("../../src/app/blueprint/model.ts");
}
const { resizeComponent: resizeOk0, componentSize: componentSizeOf } = await importResize();
function resizeOk(b: Parameters<typeof resizeOk0>[0], id: string, w: number, h: number, fixed: { x: number; y: number }) {
  return resizeOk0(b, id, w, h, fixed, { x: 1, y: 1 });
}

describe("design rules: power (design-rules-proposal.md §4)", async () => {
  const { powerStats, mastodonPreset } = await import("../../src/app/blueprint/model.ts");
  const { measureWorld } = await import("../../src/app/blueprint/measure.ts");
  const { getProfile, stepInPlace } = await import("../../src/core/index.ts");
  const { withBlueprint } = await import("../../src/app/playtest.ts");

  it("BPD-045 rebalance v1, real-world power: THRUST 1's battery stores 3.3 GJ (450 Wh/kg) and its generators make 25.6 MW each (12.5 kW/kg) from 7 MJ a kg of propellant, at Thrust's masses; a shot draws 72 MJ, the beam 60 MW, the tether 20 MW; the OG parts and the Mastodon have none", () => {
    // In the designer's units (the core's): energy and power ÷16,384, energy per kg ÷16.
    const E = 16384;
    expect(body(regular, "battery").power!.capacity! * E).toBeCloseTo((450 * 3600 * 2048) / 1000, 6); // kJ
    for (const id of ["gen-l", "gen-r"]) expect(body(regular, id).power!.output! * E).toBeCloseTo(12.5 * 2048, 6); // kW
    expect(body(regular, "gen-l").power!.perKg! * 16).toBe(7000);
    for (const id of ["battery", "gen-l", "gen-r"]) expect(body(regular, id).mass).toBe(body(bp, id).mass);
    // The shield: up, it drains the battery in 20 s; each hit costs the energy it brings at 25%.
    expect(body(regular, "shield").shield).toMatchObject({ draw: 202.5 / 20, hitEfficiency: 0.25 });
    expect(body(regular, "shield").shield!.hitDraw).toBeUndefined();
    // A shot: 40 kg at 1,200 m/s is 28.8 MJ; at 40%, 72 MJ.
    expect(body(regular, "gun").magazine!.railgun!.shot! * E).toBeCloseTo(72e3, 6); // kJ
    expect(body(regular, "hull").tractor!.draw! * E).toBeCloseTo(60e3, 6); // kW
    expect(body(regular, "hull").tractor!.tetherDraw! * E).toBeCloseTo(20e3, 6);
    // About 46 shots in a full battery.
    expect(Math.floor(202.5 / POWER.railgunShot)).toBe(46);
    // A faster shot draws more: its energy, at 40%.
    expect(body(setParam(regular, "gun", "speed", 150), "gun").magazine!.railgun!.shot).toBeCloseTo(POWER.railgunShot / 4, 9);
    expect(powerStats(regular)).toMatchObject({ stored: 202.5, output: 3.125, shieldDraw: 10.125 });
    expect(powerStats(regular)!.shieldSeconds).toBeCloseTo(202.5 / (10.125 - 3.125), 9); // about 29 s
    // THRUST OG is the game's ship: no power system.
    expect(powerStats(bp)).toBeNull();
    expect(body(bp, "shield").shield!.draw).toBeUndefined();
    expect(powerStats(mastodonPreset(scn))).toBeNull();
    // A bigger battery stores more, in proportion to its area.
    const big = setParam(regular, "battery", "width", 1.8);
    expect(body(big, "battery").power!.capacity).toBeCloseTo(202.5 * 1.5, 6);
    expect(params(regular, "battery").find((p) => p.key === "width")).toMatchObject({ min: 0.2, max: 2 });
  });

  it("BPD-045 rebalance v1: THRUST 1's shield, up with no hits, drains its battery in 20 s alone and lasts about 29 s with its generators running (burning their propellant)", () => {
    const run = (b: typeof bp, seconds: number) => {
      const w = measureWorld(b);
      const fuel = () => w.bodies.filter((x) => !x.injector).reduce((s, x) => s + (x.contents ?? []).reduce((a, c) => a + c.mass, 0), 0);
      const f0 = fuel();
      stepInPlace(w, [{ type: "control.set", channel: "action-c", value: 1 }], getProfile("sandbox"));
      // Until it first drops (held on, it comes back for a moment whenever the generators have made a step's worth).
      let upFor = 0;
      for (let i = 1; i < 240 * seconds && upFor === 0; i++) {
        stepInPlace(w, [], getProfile("sandbox"));
        if (!w.bodies.some((x) => x.shape.kind === "disc")) upFor = i / 240;
      }
      return { burned: f0 - fuel(), upFor };
    };
    const t1 = run(regular, 32);
    expect(t1.upFor).toBeGreaterThan(28);
    expect(t1.upFor).toBeLessThan(30);
    // The generators burn their propellant for it: 3.125 kW ÷ 437.5 kJ/kg (7 kg/s in the game) while it is up.
    expect(t1.burned).toBeGreaterThan(0.9 * (3.125 / 437.5) * t1.upFor);
    // Generators off (still welded in place, holding the wings): the battery alone, 20 s.
    const noGen = structuredClone(regular);
    for (const id of ["gen-l", "gen-r"]) delete body(noGen, id).power;
    const r = run(noGen, 22);
    expect(r.upFor).toBeGreaterThan(19.8);
    expect(r.upFor).toBeLessThan(20.2);
  }, 120_000);

  it("BPD-045 PWR-004 rebalance v1: a hit on THRUST 1's shield costs the energy it brings at 25%: a 40 kg shell at 1,200 m/s (28.8 MJ in the game) about 115 MJ; one that goes off as it hits too, by the mass it had", () => {
    for (const explosive of [undefined, { charge: 0.05, heat: 30_000_000 / 16, fragments: 0, radius: 0.6, gas: 1.5 }]) {
      const w = measureWorld(regular);
      stepInPlace(w, [{ type: "control.set", channel: "action-c", value: 1 }], getProfile("sandbox"));
      for (let i = 0; i < 240; i++) stepInPlace(w, [], getProfile("sandbox")); // the field grown to its radius
      const hull = w.bodies.find((b) => b.id === "hull")!;
      const v = 300; // 1,200 m/s in the game
      const shell = { id: "incoming", shape: { ...SHELL.shape }, mass: SHELL.mass, position: { x: hull.position.x + 20, y: hull.position.y }, velocity: { x: hull.velocity.x - v, y: hull.velocity.y }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.05, ...(explosive ? { explosive } : {}) };
      stepInPlace(w, [{ type: "body.add", body: shell }], getProfile("sandbox"));
      for (let i = 0; i < 60 && !w.events.some((e) => e.type === "shield.hit"); i++) stepInPlace(w, [], getProfile("sandbox"));
      const hit = w.events.find((e) => e.type === "shield.hit");
      expect(hit?.data.by).toBe("incoming");
      // ½ μ v² ÷ 0.25, μ the shell's mass against the whole ship's (65.7 t in the game): just under 4 × 28.8 MJ.
      const kJ = Number(hit!.data.energy) * 16384;
      expect(kJ).toBeGreaterThan(0.97 * 4 * 28_800);
      expect(kJ).toBeLessThan(4 * 28_800 * 1.001);
      if (explosive) expect(w.bodies.some((b) => b.id === "incoming")).toBe(false); // it went off
    }
  });

  it("BPD-046 a blueprint played in a game: its parts numbered as the game's ships, round its cockpit, its hull and gun named, and its wiring with the actions on the game's controls", () => {
    const thrust = withBlueprint(scn, regular) as { world: { thrust: { ship: { bodies: { id: string; position: { x: number; y: number }; injector?: { channel: string }; shield?: { from: string[]; blocks: string[] } }[]; links: { from?: string; to: string; channel?: string }[] }; hull: string; gun?: string; tractor: string; mix?: unknown }; mix: { rows: { channel: string; lines: { control: string }[] }[] } } };
    const g = thrust.world.thrust;
    expect(g.hull).toBe("p{n}-hull");
    expect(g.gun).toBe("p{n}-gun");
    expect(g.tractor).toBe("p{n}-hull");
    expect(g.mix).toBeUndefined();
    expect(g.ship.bodies.every((b) => b.id.startsWith("p{n}-"))).toBe(true);
    expect(g.ship.bodies.find((b) => b.id === "p{n}-hull")!.position).toEqual({ x: 0, y: 0 });
    // Channels are not ids: they stay as they are; ids in links and the shield's tanks are numbered.
    expect(g.ship.bodies.find((b) => b.id === "p{n}-main")!.injector!.channel).toBe("main");
    expect(g.ship.bodies.find((b) => b.id === "p{n}-shield")!.shield!.from).toEqual(["p{n}-tank-l", "p{n}-tank-r"]);
    expect(g.ship.bodies.find((b) => b.id === "p{n}-shield")!.shield!.blocks).toContain("main");
    expect(g.ship.links.every((l) => l.to.startsWith("p{n}-") && (l.from === undefined || l.from.startsWith("p{n}-")))).toBe(true);
    // Its mixer, with Action A on the game's fire control.
    expect(thrust.world.mix.rows.find((r) => r.channel === "fire")!.lines[0].control).toBe("fire");
  });
});

describe("the gun and the bullet magazine (Chloe, 16 November 2026)", async () => {
  const { mastodonPreset, powerStats } = await import("../../src/app/blueprint/model.ts");
  const { containerSpec, gunSpeed, CONTAINERS } = await import("../../src/app/blueprint/rules.ts");
  const { measureNow } = await import("../../src/app/blueprint/measure.ts");
  const m = mastodonPreset(scn);
  const box = (w: number, h: number) => [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];

  it("BPD-047 a bullet (the old railgun shell's mass, 171 kg in the game) takes twice the room of that shell: 30 in THRUST 1's magazine's size, where 60 of those shells went", () => {
    expect(containerSpec("bullets", box(0.7, 0.45), 0.1).holds).toBe(30);
    expect(CONTAINERS.bullets.perArea).toBeCloseTo(480 / 2, 9);
    expect(containerSpec("bullets", box(2, 2), 0.1).holds).toBe(Math.floor((1.8 * 1.8 * 480) / 2));
  });

  it("BPD-047 the gun needs no power; its muzzle speed comes from its barrel's length: 100 m/s at 0.7 m (the railgun's 144), as the square root", () => {
    expect(gunSpeed(0.7)).toBe(100);
    expect(gunSpeed(2.8)).toBe(200);
    const g = body(m, "gun-l");
    expect(g.magazine!.railgun).toMatchObject({ speed: 100 });
    expect(g.magazine!.railgun!.shot).toBeUndefined();
    expect(component(m, "gun-l").part).toBe("gun");
    // A longer barrel: faster, and its muzzle at the new end.
    const long = setParam(m, "gun-ol", "height", 1.4);
    expect(body(long, "gun-ol").magazine!.railgun!.speed).toBeCloseTo(141.421, 3);
    expect(body(long, "gun-ol").magazine!.at).toEqual({ x: 0, y: 0.86 });
    // The Mastodon: four guns, two bullet magazines feeding all four, and no power system.
    expect(m.components.filter((c) => c.part === "gun")).toHaveLength(4);
    expect(m.components.filter((c) => c.part === "bullet-magazine")).toHaveLength(2);
    expect(m.ship.links.filter((l) => l.kind === "ammo")).toHaveLength(8);
    expect(powerStats(m)).toBeNull();
  });

  it("BPD-047 the Mastodon's guns fire with no power: Action A empties its bullet magazines", () => {
    const [r] = measureNow(m, [{ "action-a": 1 }]);
    // Four guns firing, with a recoil in proportion to 100 m/s, not 144.
    expect(r.ahead).toBeLessThan(-4);
  }, 60_000);
});

describe("engines with chambers (design rules §5; Chloe, 16 November 2026)", async () => {
  const { engineGeom, mastodonPreset, engines } = await import("../../src/app/blueprint/model.ts");
  const { measureWorld } = await import("../../src/app/blueprint/measure.ts");
  const { getProfile, stepInPlace } = await import("../../src/core/index.ts");

  it("BPD-048 THRUST 1's engines are rockets: a chamber, a throat narrower than it, and a nozzle to the same exit, at the same mass; THRUST OG's and the double engine are as they were", () => {
    for (const id of ["main", "back-l", "back-r", "front-l", "front-r"]) {
      const c = component(regular, id);
      expect(c.rocket).toBeDefined();
      expect(c.bodies).toHaveLength(7); // head, two chamber walls, two throat pieces, two nozzle walls
      expect(c.rocket!.throat).toBeLessThan(c.rocket!.chamberWidth - 2 * c.rocket!.wall + 1e-9);
      const og = component(bp, id);
      expect(og.rocket).toBeUndefined();
      const g = engineGeom(bp, og);
      const ogExit = g.throat + 2 * g.length * Math.tan((g.flare * Math.PI) / 180);
      const r = c.rocket!;
      expect(r.throat + 2 * r.nozzleLength * Math.tan((r.flare * Math.PI) / 180)).toBeCloseTo(ogExit, 6);
      const mass = (b: typeof bp, cc: typeof c) => cc.bodies.reduce((s, x) => s + body(b, x).mass, 0);
      expect(mass(regular, c)).toBeCloseTo(mass(bp, og), 6);
    }
    expect(component(mastodonPreset(scn), "eng-l").rocket).toBeUndefined();
    // The chamber properties, and what follows from them.
    const keys = params(regular, "main").map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["chamberLength", "pressure", "ceiling", "areaRatio", "lstar", "efficiency"]));
    expect(params(regular, "main").find((p) => p.key === "pressure")!.value).toBeGreaterThan(1000); // 7.78 kg/s through 0.8 m
  });

  it("BPD-048 in flight the physics holds each chamber's gas as a sealed volume, and each engine pushes as THRUST OG's does", () => {
    const thrustOf = (b: typeof bp) => {
      const w = measureWorld(b);
      stepInPlace(w, [{ type: "control.set", channel: "forward", value: 1 }], getProfile("sandbox"));
      for (let i = 0; i < 240; i++) stepInPlace(w, [], getProfile("sandbox"));
      return { sealed: !!w.bodies.find((x) => x.id === "main")!.injector!.vessel, w };
    };
    expect(thrustOf(regular).sealed).toBe(true);
    // The estimate is the same, engine by engine, but for the light thrusters' flow: 1.51 kg/s, not
    // 1.45, so its reverse matches THRUST OG's (Chloe, 18 November 2026).
    const og = engines(bp);
    expect(og.length).toBe(5);
    og.forEach((e) => expect(e.thrust).toBeGreaterThan(0));
    engines(regular).forEach((e, i) => expect(e.thrust).toBeCloseTo(og[i].thrust * (e.id === "main" ? 1 : 1.51 / 1.45), 6));
  }, 60_000);
  it("BPD-048 in a 10 s flight, forward and turning both ways, THRUST 1's engine walls hold their angles to their heads (within 1°) and no weld breaks", () => {
    const w = measureWorld(regular);
    const profile = getProfile("sandbox");
    const welds0 = new Set(w.joints.map((j) => j.id));
    const walls = regular.components.filter((c) => c.rocket).flatMap((c) => c.bodies.slice(1).map((id) => [c.bodies[0], id] as const));
    const angle = (id: string) => w.bodies.find((b) => b.id === id)!.angle;
    const rel0 = new Map(walls.map(([h, id]) => [id, angle(id) - angle(h)]));
    const plan: Record<number, Record<string, number>> = { 0: { forward: 1 }, 720: { forward: 1, left: 1 }, 1200: { forward: 1, left: 0, right: 1 }, 1680: { forward: 1, right: 0 } };
    let worst = 0;
    for (let i = 0; i < 2400; i++) {
      const set = plan[i] ? Object.entries(plan[i]).map(([channel, value]) => ({ type: "control.set" as const, channel, value })) : [];
      stepInPlace(w, set, profile);
      for (const [h, id] of walls) {
        const d = angle(id) - angle(h) - rel0.get(id)!;
        worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))));
      }
    }
    expect((worst * 180) / Math.PI).toBeLessThan(1);
    expect([...welds0].filter((id) => !w.joints.some((j) => j.id === id))).toEqual([]);
  }, 120_000);
});

describe("the Stegodon (Chloe's sketch, 16 November 2026)", async () => {
  const { stegodonPreset, mastodonPreset, allOverlaps, pieces, wiringChecks, response, powerStats } = await import("../../src/app/blueprint/model.ts");
  const { measureNow } = await import("../../src/app/blueprint/measure.ts");
  const st = stegodonPreset(scn);
  const moves = [{ id: "forward", name: "Forward" }, { id: "reverse", name: "Reverse" }, { id: "left", name: "Turn left" }, { id: "right", name: "Turn right" }];

  it("BPD-049 a lighter gunship in one piece: the Mastodon's cockpit, main engines angled out along its slope and welded there, guns and bullet magazines, a small double engine across its tail; no power system", () => {
    expect(pieces(st)).toHaveLength(1);
    expect(allOverlaps(st)).toEqual([]);
    expect(stats(st).mass).toBeLessThan(stats(mastodonPreset(scn)).mass);
    expect(Math.abs(stats(st).com.x)).toBeLessThan(1e-9);
    // The main engines: rockets at 36.87° (the cockpit's top corners), their chambers welded along the cockpit.
    for (const [id, s] of [["eng-l", -1], ["eng-r", 1]] as const) {
      expect(component(st, id).rocket).toBeDefined();
      expect(body(st, id).angle).toBeCloseTo(s * Math.asin(0.6), 9);
      expect(welds(st).some((w) => [w.a, w.b].includes(id) && [w.a, w.b].includes("hull"))).toBe(true);
    }
    expect(component(st, "tail-l").heads).toEqual(["tail-l", "tail-r"]);
    expect(st.components.filter((c) => c.part === "gun")).toHaveLength(2);
    expect(st.components.filter((c) => c.part === "bullet-magazine")).toHaveLength(3);
    expect(powerStats(st)).toBeNull();
    expect(wiringChecks(st, moves).every((c) => c.ok)).toBe(true);
  });

  it("BPD-049 its wiring as drawn: forward fires both main engines; a turn alone, only the tail; forward and a turn, one main engine and the opposite side of the tail", () => {
    const fired = (controls: Record<string, number>) => Object.entries(response(st, controls).throttles).filter(([, v]) => v > 0).map(([k]) => k).sort();
    expect(fired({ forward: 1 })).toEqual(["eng-l", "eng-r"]);
    expect(fired({ left: 1 })).toEqual(["tail-l"]);
    expect(fired({ right: 1 })).toEqual(["tail-r"]);
    expect(fired({ forward: 1, left: 1 })).toEqual(["eng-r", "tail-l"]);
    expect(fired({ forward: 1, right: 1 })).toEqual(["eng-l", "tail-r"]);
    // And they turn it the way asked.
    expect(response(st, { left: 1 }).turn).toBeGreaterThan(0);
    expect(response(st, { forward: 1, left: 1 }).turn).toBeGreaterThan(0);
  });

  it("BPD-049 changing a main engine's nozzle or chamber keeps what is welded to its chamber walls", () => {
    const held = (bp: typeof st) => welds(bp).filter((w) => w.a.startsWith("eng-l") !== w.b.startsWith("eng-l") && [w.a, w.b].some((id) => id.startsWith("eng-l"))).map((w) => [w.a, w.b].sort().join("|")).sort();
    const before = held(st);
    expect(before.length).toBeGreaterThan(0);
    for (const key of ["flare", "throat", "wall", "chamberLength", "length"]) {
      const p = params(st, "eng-l").find((x) => x.key === key);
      expect(p, key).toBeDefined();
      const out = setParam(st, "eng-l", key, p!.value as number);
      expect(held(out), key).toEqual(before);
      expect(pieces(out), key).toHaveLength(1);
    }
  });

  it("BPD-049 a tank whose walls fill it holds nothing and has no blast; with room inside again, it has its blast again", async () => {
    const { applyContainer } = await import("../../src/app/blueprint/model.ts");
    const m = mastodonPreset(scn);
    expect(body(m, "tank-l").explosive?.charge ?? 0).toBeGreaterThan(0);
    // Walls thicker than half the tank (more than the designer allows, so set here directly).
    const bp = structuredClone(m);
    component(bp, "tank-l").wall = 2;
    applyContainer(bp, "tank-l");
    expect(body(bp, "tank-l").explosive).toBeUndefined();
    expect(body(bp, "tank-l").contents!.every((c) => c.mass === 0)).toBe(true);
    component(bp, "tank-l").wall = component(m, "tank-l").wall;
    applyContainer(bp, "tank-l");
    expect(body(bp, "tank-l").explosive).toEqual(body(m, "tank-l").explosive);
  });

  it("BPD-049 measured: about 26 m/s² forward (its nozzles working, PRP-012), 6 rad/s² turning on the tail alone, both ways alike", () => {
    const r = measureNow(st, [{ forward: 1 }, { left: 1 }, { right: 1 }]);
    expect(r[0].ahead).toBeGreaterThan(23);
    expect(r[0].ahead).toBeLessThan(29);
    expect(r[1].turn).toBeGreaterThan(5);
    expect(Math.abs(r[1].turn + r[2].turn)).toBeLessThan(0.5);
    expect(r.map((x) => x.broke)).toEqual([0, 0, 0]);
  }, 120_000);
});

describe("the Phiomia (Chloe's sketch, 16 November 2026)", async () => {
  const { phiomiaPreset, mastodonPreset, allOverlaps, pieces, wiringChecks, response, powerStats } = await import("../../src/app/blueprint/model.ts");
  const { measureNow, measureWorld } = await import("../../src/app/blueprint/measure.ts");
  const { getProfile, stepInPlace } = await import("../../src/core/index.ts");
  const ph = phiomiaPreset(scn);
  const moves = [{ id: "forward", name: "Forward" }, { id: "left", name: "Turn left" }, { id: "right", name: "Turn right" }];

  it("BPD-050 the simplest ship in one piece: the Mastodon's cockpit, a tank, a spine to a crossbar, a rocket hanging at each end; no weapon, no power system", () => {
    expect(pieces(ph)).toHaveLength(1);
    expect(allOverlaps(ph)).toEqual([]);
    expect(body(ph, "hull").shape).toEqual(body(mastodonPreset(scn), "hull").shape);
    expect(Math.abs(stats(ph).com.x)).toBeLessThan(1e-9);
    expect(ph.components.map((c) => c.kind).sort()).toEqual(["cockpit", "engine", "engine", "frame", "frame", "tank"]);
    const joined = (a: string, b: string) => welds(ph).some((w) => [w.a, w.b].includes(a) && [w.a, w.b].includes(b));
    expect([joined("hull", "tank"), joined("tank", "spine"), joined("spine", "bar"), joined("bar", "eng-l"), joined("bar", "eng-r")]).toEqual([true, true, true, true, true]);
    for (const id of ["eng-l", "eng-r"]) {
      expect(component(ph, id).rocket).toBeDefined();
      // Hanging down, firing past the cockpit's sides.
      expect(body(ph, id).angle).toBe(0);
      expect(Math.abs(body(ph, id).position.x)).toBeGreaterThan(0.6 + 0.25);
    }
    expect(powerStats(ph)).toBeNull();
    // Its turns are the other way from the other presets' (its cockpit hangs at the back), which the
    // designer's check reads as Left turning it right: those two warnings, and nothing else.
    expect(wiringChecks(ph, moves).filter((c) => !c.ok).map((c) => c.text)).toEqual(["Turn left turns the ship right", "Turn right turns the ship left"]);
  });

  it("BPD-050 its wiring: forward fires both engines; a turn, the engine on its own side, swinging the hanging cockpit that way; forward and a turn, that engine alone", () => {
    const fired = (controls: Record<string, number>) => Object.entries(response(ph, controls).throttles).filter(([, v]) => v > 0).map(([k]) => k).sort();
    expect(fired({ forward: 1 })).toEqual(["eng-l", "eng-r"]);
    expect(fired({ left: 1 })).toEqual(["eng-l"]);
    expect(fired({ right: 1 })).toEqual(["eng-r"]);
    expect(fired({ forward: 1, left: 1 })).toEqual(["eng-l"]);
    expect(fired({ forward: 1, right: 1 })).toEqual(["eng-r"]);
    // Clockwise: the engines' end goes right, the cockpit below swings left.
    expect(response(ph, { left: 1 }).turn).toBeLessThan(0);
  });

  it("BPD-050 measured: gentle, about 5.6 m/s² forward with its 4 t pilot (7.4 without; rebalance v1) and 2.5 rad/s² turning (its nozzles working, PRP-012), both ways alike; forward alone goes straight", () => {
    const r = measureNow(ph, [{ forward: 1 }, { left: 1 }, { right: 1 }]);
    expect(r[0].ahead).toBeGreaterThan(4.5);
    expect(r[0].ahead).toBeLessThan(7);
    expect(Math.abs(r[0].turn)).toBeLessThan(0.5);
    expect(Math.abs(r[0].side)).toBeLessThan(0.5);
    expect(r[1].turn).toBeLessThan(-2);
    expect(Math.abs(r[1].turn + r[2].turn)).toBeLessThan(0.5);
    expect(r.map((x) => x.broke)).toEqual([0, 0, 0]);
  }, 120_000);

  it("BPD-050 its beams hold: in a 20 s flight, forward and turning both ways (no more than 1 s at a time), no weld breaks and its parts stay within 5° of the cockpit", () => {
    const w = measureWorld(ph);
    const profile = getProfile("sandbox");
    const welds0 = w.joints.map((j) => j.id);
    const ids = ["tank", "spine", "bar", "eng-l", "eng-r"];
    const angle = (id: string) => w.bodies.find((b) => b.id === id)!.angle;
    const rel0 = new Map(ids.map((id) => [id, angle(id) - angle("hull")]));
    const plan: Record<number, Record<string, number>> = { 0: { forward: 1 }, 240: { forward: 1, left: 1 }, 480: { forward: 1, left: 0, right: 1 }, 720: { forward: 0, right: 0, left: 1 }, 960: { left: 0, right: 1 }, 1200: { right: 0 } };
    let worst = 0;
    for (let i = 0; i < 4800; i++) {
      stepInPlace(w, plan[i] ? Object.entries(plan[i]).map(([channel, value]) => ({ type: "control.set" as const, channel, value })) : [], profile);
      for (const id of ids) {
        const d = angle(id) - angle("hull") - rel0.get(id)!;
        worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))));
      }
    }
    expect((worst * 180) / Math.PI).toBeLessThan(5);
    expect(welds0.filter((id) => !w.joints.some((j) => j.id === id))).toEqual([]);
  }, 120_000);
});

describe("the Loxodon (Chloe's sketch, 16 November 2026)", async () => {
  const { loxodonPreset, mastodonPreset, stegodonPreset, phiomiaPreset, allOverlaps, pieces, wiringChecks, response, powerStats, centredShip } = await import("../../src/app/blueprint/model.ts");
  const { measureNow, measureWorld } = await import("../../src/app/blueprint/measure.ts");
  const { getProfile, stepInPlace } = await import("../../src/core/index.ts");
  const lx = loxodonPreset(scn);
  const moves = [{ id: "forward", name: "Forward" }, { id: "left", name: "Turn left" }, { id: "right", name: "Turn right" }];

  it("BPD-051 a light transport and lander in one piece: the Mastodon's cockpit; each side, a side tank, an engine outboard of it, and a top tank over both up to the cockpit's corner; no weapon, no power system", () => {
    expect(pieces(lx)).toHaveLength(1);
    expect(allOverlaps(lx)).toEqual([]);
    expect(body(lx, "hull").shape).toEqual(body(mastodonPreset(scn), "hull").shape);
    expect(Math.abs(stats(lx).com.x)).toBeLessThan(1e-9);
    expect(lx.components.map((c) => c.kind).sort()).toEqual(["cockpit", "engine", "engine", "tank", "tank", "tank", "tank"]);
    const joined = (a: string, b: string) => welds(lx).some((w) => [w.a, w.b].includes(a) && [w.a, w.b].includes(b));
    for (const s of ["l", "r"]) {
      expect([joined("hull", `side-${s}`), joined(`side-${s}`, `eng-${s}`), joined("hull", `top-${s}`), joined(`side-${s}`, `top-${s}`), joined(`eng-${s}`, `top-${s}`)]).toEqual([true, true, true, true, true]);
      expect(component(lx, `eng-${s}`).rocket).toBeDefined();
      // Every tank holds fuel: the top tanks are thin wedges, so their walls are 0.05 m.
      for (const t of [`side-${s}`, `top-${s}`]) expect(body(lx, t).contents!.reduce((a, c) => a + c.mass, 0)).toBeGreaterThan(0.1);
      expect(component(lx, `top-${s}`).wall).toBe(0.05);
    }
    // The nozzles hang below the cockpit: the legs it lands on.
    const low = (id: string) => Math.min(...component(lx, id).bodies.flatMap((b) => worldVertices(body(lx, b)).map((v) => v.y)));
    expect(low("eng-l")).toBeLessThan(low("hull") - 0.2);
    expect(powerStats(lx)).toBeNull();
    expect(wiringChecks(lx, moves).every((c) => c.ok)).toBe(true);
  });

  it("BPD-051 its wiring, gentle for landing: forward fires both engines; a turn, the far engine at 40%; forward and a turn, both, the near one at half", () => {
    const thr = (controls: Record<string, number>) => response(lx, controls).throttles;
    expect(thr({ forward: 1 })).toEqual({ "eng-l": 1, "eng-r": 1 });
    expect(thr({ left: 1 })).toEqual({ "eng-l": 0, "eng-r": 0.4 });
    expect(thr({ right: 1 })).toEqual({ "eng-l": 0.4, "eng-r": 0 });
    expect(thr({ forward: 1, left: 1 })).toEqual({ "eng-l": 0.5, "eng-r": 1 });
    expect(response(lx, { left: 1 }).turn).toBeGreaterThan(0);
  });

  it("BPD-051 measured: about 10.3 m/s² forward with its 4 t pilot (14 without; rebalance v1), going straight; 4.1 rad/s² turning, both ways alike", () => {
    const r = measureNow(lx, [{ forward: 1 }, { left: 1 }, { right: 1 }]);
    expect(r[0].ahead).toBeGreaterThan(9);
    expect(r[0].ahead).toBeLessThan(12);
    expect(Math.abs(r[0].turn)).toBeLessThan(0.3);
    expect(Math.abs(r[0].side)).toBeLessThan(0.3);
    expect(r[1].turn).toBeGreaterThan(3.5);
    expect(r[1].turn).toBeLessThan(6);
    expect(Math.abs(r[1].turn + r[2].turn)).toBeLessThan(0.3);
    expect(r.map((x) => x.broke)).toEqual([0, 0, 0]);
  }, 120_000);

  it("BPD-051 it holds: in a 20 s flight, forward and turning both ways, no weld breaks and its parts stay within 1° of the cockpit", () => {
    const w = measureWorld(lx);
    const profile = getProfile("sandbox");
    const welds0 = w.joints.map((j) => j.id);
    const ids = ["side-l", "side-r", "top-l", "top-r", "eng-l", "eng-r"];
    const angle = (id: string) => w.bodies.find((b) => b.id === id)!.angle;
    const rel0 = new Map(ids.map((id) => [id, angle(id) - angle("hull")]));
    const plan: Record<number, Record<string, number>> = { 0: { forward: 1 }, 240: { forward: 1, left: 1 }, 480: { forward: 1, left: 0, right: 1 }, 720: { forward: 0, right: 0, left: 1 }, 960: { left: 0, right: 1 }, 1200: { right: 0 } };
    let worst = 0;
    for (let i = 0; i < 4800; i++) {
      stepInPlace(w, plan[i] ? Object.entries(plan[i]).map(([channel, value]) => ({ type: "control.set" as const, channel, value })) : [], profile);
      for (const id of ids) {
        const d = angle(id) - angle("hull") - rel0.get(id)!;
        worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))));
      }
    }
    expect((worst * 180) / Math.PI).toBeLessThan(1);
    expect(welds0.filter((id) => !w.joints.some((j) => j.id === id))).toEqual([]);
  }, 120_000);

  it("BPD-051 into the physics each polygon part is about its centroid and its welds start where they were drawn: no preset jolts at rest", () => {
    for (const bp of [lx, mastodonPreset(scn), stegodonPreset(scn), phiomiaPreset(scn), regular]) {
      // The welds' two anchors meet, as the designer drew them.
      const ship = centredShip(bp.ship);
      const at = (id: string, p: { x: number; y: number }) => {
        const b = ship.bodies.find((x) => x.id === id)!;
        const a = b.angle ?? 0;
        return { x: b.position.x + p.x * Math.cos(a) - p.y * Math.sin(a), y: b.position.y + p.x * Math.sin(a) + p.y * Math.cos(a) };
      };
      for (const j of ship.joints) {
        const pa = at(j.a, j.anchorA);
        const pb = at(j.b, j.anchorB);
        expect(Math.hypot(pa.x - pb.x, pa.y - pb.y), j.id).toBeLessThan(1e-6);
      }
      // And nothing moves in the first steps.
      const w = measureWorld(bp);
      const before = w.bodies.map((b) => ({ ...b.position, a: b.angle }));
      for (let i = 0; i < 12; i++) stepInPlace(w, [], getProfile("sandbox"));
      w.bodies.forEach((b, i) => {
        expect(Math.hypot(b.position.x - before[i].x, b.position.y - before[i].y), b.id).toBeLessThan(1e-6);
        expect(Math.abs(b.angle - before[i].a), b.id).toBeLessThan(1e-6);
      });
    }
  });
});
