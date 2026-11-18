// What Mammoth Thrust's nozzle walls are worth (docs/ship-designs.md, "Nozzle walls"): the ship's
// thrust from each engine group with its nozzle walls and with them removed (the ten wall bodies
// and their welds). The ship alone in empty space, no gravity, the sandbox profile; full throttle
// from rest; thrust = the ship's mean mass × its acceleration between 0.5 s and 1.5 s, as the rest
// of the design log.
//   node scripts/nozzle-walls.ts [--json]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblyTotals, getProfile, initialWorld, parseScenario, stepInPlace, type Command, type World } from "../src/core/index.ts";

const root = new URL("..", import.meta.url).pathname;
const HZ = 240;
const profile = getProfile("sandbox");
const scn = JSON.parse(readFileSync(join(root, "scenarios", "thrust-test.json"), "utf8"));
type Part = { id: string; injector?: { channel: string; rate: number } };
const ship = JSON.parse(JSON.stringify(scn.world.thrust.ship).replaceAll("{n}", "1")) as { bodies: Part[]; joints: { a: string; b: string }[]; links: { from?: string; to: string }[] };

/** The ship alone, with or without its nozzle walls. */
function world(walls: boolean): World {
  const bodies = ship.bodies.filter((b) => walls || !b.id.includes("-wall-"));
  const ids = new Set(bodies.map((b) => b.id));
  const joints = ship.joints.filter((j) => ids.has(j.a) && ids.has(j.b));
  const links = ship.links.filter((l) => ids.has(l.to) && (!l.from || ids.has(l.from)));
  return initialWorld(parseScenario({ schema: 1, name: "nozzle-walls", profile: "sandbox", seed: 1, world: { gravity: { x: 0, y: 0 }, bodies, joints, links }, timeline: [], end: { steps: 1 }, probes: [], assertions: [] }, {}, { coreUnits: true }));
}

const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });

function run(walls: boolean, channels: string[], seconds = 2.5) {
  const w = world(walls);
  const s: { m: number; vy: number }[] = [];
  const steps = Math.round(seconds * HZ);
  for (let i = 0; i <= steps; i++) {
    const a = assemblyTotals(w, "p1-hull")!;
    s.push({ m: a.mass, vy: a.velocity.y });
    if (i < steps) stepInPlace(w, i === 0 ? channels.map((c) => set(c, 1)) : [], profile);
  }
  /** Thrust along the ship's axis between t0 and t1, N, and the acceleration, m/s². */
  const between = (t0: number, t1: number) => {
    const a = s[Math.round(t0 * HZ)];
    const b = s[Math.round(t1 * HZ)];
    const acc = (b.vy - a.vy) / (t1 - t0);
    return { thrust: ((a.m + b.m) / 2) * acc, acc };
  };
  // Steadiness: thrust in quarter-second windows from 0.25 s to 2.25 s.
  const windows = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25].map((t) => between(t - 0.125, t + 0.125).thrust);
  return {
    ...between(0.5, 1.5),
    mass: s[0].m,
    spread: (Math.max(...windows) - Math.min(...windows)) / Math.abs(between(0.5, 1.5).thrust),
    welds: w.events.filter((e) => e.type === "joint.break").length,
    violations: w.ledger.violations,
  };
}

const flow = (channels: string[]) => ship.bodies.filter((b) => b.injector && channels.includes(b.injector.channel)).reduce((f, b) => f + b.injector!.rate, 0);
const groups: [string, string[]][] = [
  ["Main thruster", ["main"]],
  ["Back pair", ["bl", "br"]],
  ["Main + back pair (forward)", ["main", "bl", "br"]],
  ["Front pair (braking)", ["fl", "fr"]],
];
const rows = groups.map(([name, channels]) => {
  const on = run(true, channels);
  const off = run(false, channels);
  return { name, channels, flow: flow(channels), on, off };
});

if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  const n = (x: number, d = 0) => x.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  console.log(`Ship with walls ${n(rows[0].on.mass, 1)} kg, without ${n(rows[0].off.mass, 1)} kg.\n`);
  console.log("| Engines | Flow (kg/s) | Thrust, walls | Thrust, no walls | Ratio | Exhaust speed, walls / none | Acceleration, walls / none |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.name} | ${n(r.flow, 2)} | ${n(r.on.thrust)} N | ${n(r.off.thrust)} N | ${n(r.on.thrust / r.off.thrust, 2)}× | ${n(Math.abs(r.on.thrust) / r.flow)} / ${n(Math.abs(r.off.thrust) / r.flow)} m/s | ${n(r.on.acc, 1)} / ${n(r.off.acc, 1)} m/s² |`);
  }
  const worst = Math.max(...rows.flatMap((r) => [r.on.spread, r.off.spread]));
  const welds = rows.reduce((k, r) => k + r.on.welds + r.off.welds, 0);
  const violations = rows.reduce((k, r) => k + r.on.violations + r.off.violations, 0);
  console.log(`\nThrust steady to ${n(worst * 100, 1)}% (quarter-second windows, 0.25–2.25 s); welds broken: ${welds}; ledger violations: ${violations}.`);
}
