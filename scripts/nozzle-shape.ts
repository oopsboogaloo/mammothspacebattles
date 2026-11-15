// How the shape of Mammoth Thrust's main nozzle changes its thrust (docs/ship-designs.md, "Nozzle
// shape"). The main thruster's two walls are rebuilt at other flares and lengths; everything else is
// the ship as it is (the walls keep their mass and thickness). The ship alone in empty space, no
// gravity, the sandbox profile, the main thruster alone at full throttle from rest.
//
// For each shape:
// - thrust: the ship's mean mass × its acceleration between 0.5 s and 1.5 s;
// - jet recoil: the same run with every exhaust parcel removed at the end of each step, so the ship
//   feels only the recoil of letting gas out (for a sealed chamber, the jet at c*·(1 + 1/γ) the
//   chamber model sets: src/core/vessel.ts, runVessel) and the gas's push in the step it was made;
// - the rest: thrust less the jet recoil: what the exhaust does after that, pushing on the nozzle
//   walls, the plug across the throat and the head: the part the gas simulation makes;
// - release recoil: the momentum each parcel leaves the engine with, relative to the ship, caught
//   as it is added to the gas (before the gas step moves it): for a sealed chamber, exactly the
//   formula's jet. Jet recoil less this is the gas's push in the step a parcel is made.
//   node scripts/nozzle-shape.ts [--json]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblyTotals, getProfile, initialWorld, parseScenario, stepInPlace, vesselPressure, vesselShape, type World } from "../src/core/index.ts";
import { dropParcels } from "../src/core/gas.ts";

type Vec = { x: number; y: number };
type Json = Record<string, unknown>;
const root = new URL("..", import.meta.url).pathname;
const HZ = 240;
const profile = getProfile("sandbox");
const scn = JSON.parse(readFileSync(join(root, "scenarios", "thrust-test.json"), "utf8"));
const base = JSON.parse(JSON.stringify(scn.world.thrust.ship).replaceAll("{n}", "1")) as { bodies: Json[]; joints: Json[]; links: Json[] };

// The main thruster as scripts/asteroidShip.ts builds it: head 1.2 m wide, walls 0.1 m thick.
const head = base.bodies.find((b) => b.id === "p1-main") as Json & { position: Vec; injector: Json & { chamber: { width: number; length: number } } };
const WIDTH = 1.2;
const THICK = 0.1;
const HEAD = 0.15;
const mouth: Vec = { x: head.position.x, y: head.position.y - HEAD / 2 };

/** The ship with the main nozzle's walls `length` m long, each splaying out by `flare` m (negative: in). */
function ship(flare: number, length: number) {
  const s = structuredClone(base);
  const main = s.bodies.find((b) => b.id === "p1-main") as typeof head;
  main.injector.chamber = { width: WIDTH, length: Math.round((length + 0.25) * 1e6) / 1e6 };
  for (const k of [-1, 1]) {
    const side = k < 0 ? "a" : "b";
    const top = (WIDTH / 2) * k;
    const bottom = (WIDTH / 2 + flare) * k;
    let corners: Vec[] = [
      { x: top - THICK * k, y: 0 },
      { x: top, y: 0 },
      { x: bottom, y: -length },
      { x: bottom - THICK * k, y: -length },
    ].map((p) => ({ x: mouth.x + p.x, y: mouth.y + p.y }));
    if (k > 0) corners = corners.reverse();
    // The polygon's centroid, as asteroidShip's `poly`.
    let a = 0;
    let c = { x: 0, y: 0 };
    corners.forEach((p, i) => {
      const q = corners[(i + 1) % corners.length];
      const w = p.x * q.y - q.x * p.y;
      a += w;
      c = { x: c.x + (p.x + q.x) * w, y: c.y + (p.y + q.y) * w };
    });
    c = { x: c.x / (3 * a), y: c.y / (3 * a) };
    const wall = s.bodies.find((b) => b.id === `p1-main-wall-${side}`)!;
    wall.position = c;
    wall.shape = { kind: "polygon", vertices: corners.map((p) => ({ x: p.x - c.x, y: p.y - c.y })) };
    const at = { x: mouth.x + top - (THICK / 2) * k, y: mouth.y };
    const weld = s.joints.find((j) => j.id === `p1-w-main-wall-${side}`)!;
    weld.anchorA = { x: at.x - head.position.x, y: at.y - head.position.y };
    weld.anchorB = { x: at.x - c.x, y: at.y - c.y };
  }
  return s;
}

/** Thrust from 0.5 s to 1.5 s, N, the main thruster at full throttle; with `jetOnly`, no exhaust outlives its step. */
function run(s: ReturnType<typeof ship> | null, jetOnly: boolean) {
  const bodies = s ? s.bodies : base.bodies.filter((b) => !String(b.id).includes("-wall-"));
  const ids = new Set(bodies.map((b) => b.id));
  const parts = s ?? { bodies, joints: base.joints.filter((j) => ids.has(j.a) && ids.has(j.b)), links: base.links.filter((l) => ids.has(l.to) && (!l.from || ids.has(l.from))) };
  const w0: World = initialWorld(parseScenario({ schema: 1, name: "nozzle-shape", profile: "sandbox", seed: 1, world: { gravity: { x: 0, y: 0 }, ...parts }, timeline: [], end: { steps: 1 }, probes: [], assertions: [] }));
  // Catch each parcel as an injector adds it: addParcel writes it, then raises the count by one.
  let released = 0; // N·s along the ship's axis, from 0.5 s
  let counting = false;
  let vShip = 0;
  const gas = new Proxy(w0.gas, {
    set(g, k, value) {
      if (k === "count" && counting && value === g.count + 1) released -= g.mass[g.count] * (g.vy[g.count] - vShip);
      return Reflect.set(g, k, value);
    },
  });
  const w: World = Object.assign(w0, { gas });
  const main = () => w.bodies.find((b) => b.id === "p1-main")!;
  const at: { m: number; vy: number }[] = [];
  const pressure: number[] = [];
  let shape: ReturnType<typeof vesselShape> = null;
  const steps = Math.round(1.5 * HZ);
  for (let i = 0; i <= steps; i++) {
    const a = assemblyTotals(w, "p1-hull")!;
    at.push({ m: a.mass, vy: a.velocity.y });
    vShip = a.velocity.y;
    counting = i >= 0.5 * HZ && i < steps;
    if (i >= 0.5 * HZ) {
      const b = main();
      shape = vesselShape(w, b);
      const v = b.injector!.vessel;
      if (shape && v) pressure.push(vesselPressure(v, shape.area));
    }
    if (i < steps) stepInPlace(w, i === 0 ? [{ type: "control.set", channel: "main", value: 1 }] : [], profile);
    if (jetOnly && w.gas.count) dropParcels(w.gas, new Uint8Array(w.gas.count).fill(1));
  }
  const a0 = at[Math.round(0.5 * HZ)];
  const a1 = at[steps];
  return {
    thrust: ((a0.m + a1.m) / 2) * (a1.vy - a0.vy),
    release: released / ((steps - Math.round(0.5 * HZ)) / HZ),
    enclosed: !!shape,
    throat: shape ? shape.throat : null,
    chamberArea: shape ? shape.area : null,
    pressure: pressure.length ? pressure.reduce((x, y) => x + y, 0) / pressure.length : 0,
    welds: w.events.filter((e) => e.type === "joint.break").length,
    violations: w.ledger.violations,
  };
}

function measure(flare: number | null, length: number) {
  const s = flare === null ? null : ship(flare, length);
  const full = run(s, false);
  const jet = run(s, true);
  return {
    flare,
    length,
    angle: flare === null ? null : (Math.atan2(flare, length) * 180) / Math.PI,
    exit: flare === null ? null : WIDTH - 2 * THICK + 2 * flare,
    enclosed: full.enclosed,
    throat: full.throat,
    chamberArea: full.chamberArea,
    pressure: full.pressure,
    thrust: full.thrust,
    jet: jet.thrust,
    rest: full.thrust - jet.thrust,
    release: full.release,
    welds: full.welds,
    violations: full.violations,
  };
}

// The ship's own nozzle: 1.1 m long, splaying 0.25 m (12.8° a side).
const flares = [-0.3, -0.15, 0, 0.1, 0.25, 0.4, 0.6].map((f) => measure(f, 1.1));
const lengths = [0.15, 0.3, 0.6, 1.1, 1.6, 2.2].map((l) => measure(Math.round(0.25 * (l / 1.1) * 1e6) / 1e6, l));
const none = measure(null, 0);

if (process.argv.includes("--json")) console.log(JSON.stringify({ flares, lengths, none }, null, 2));
else {
  const n = (x: number | null, d = 0) => (x === null ? "–" : x.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const table = (title: string, rows: ReturnType<typeof measure>[]) => {
    console.log(`\n${title}\n`);
    console.log("| Length | Flare (each side) | Angle | Exit width | Chamber | Throat below outlet | Thrust | Release recoil | Push in the release step | Exhaust after it | Chamber pressure |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of rows)
      console.log(`| ${r.flare === null ? "no walls" : `${n(r.length, 2)} m`} | ${r.flare === null ? "–" : `${n(r.flare, 2)} m`} | ${r.angle === null ? "–" : `${n(r.angle, 1)}°`} | ${r.exit === null ? "–" : `${n(r.exit, 2)} m`} | ${r.enclosed ? "sealed" : "open"} | ${r.throat === null ? "–" : `${n(r.throat, 2)} m`} | ${n(r.thrust)} N | ${n(r.release)} N (${n((100 * r.release) / r.thrust)}%) | ${n(r.jet - r.release)} N (${n((100 * (r.jet - r.release)) / r.thrust)}%) | ${n(r.rest)} N (${n((100 * r.rest) / r.thrust)}%) | ${n(r.pressure)} N/m |`);
  };
  table("Flare, walls 1.1 m long (the ship's: 0.25 m)", flares);
  table("Length, at the ship's angle (12.8° a side)", lengths);
  table("No walls", [none]);
  const all = [...flares, ...lengths, none];
  console.log(`\nWelds broken: ${all.reduce((k, r) => k + r.welds, 0)}; ledger violations: ${all.reduce((k, r) => k + r.violations, 0)}.`);
}
