// Measure (docs/blueprint/spec.md §7): a blueprint's response to each control, measured by running
// the real physics, as the design log measures ships (docs/ship-designs.md): the ship alone in
// empty space, no gravity, the sandbox profile, the control held from rest; acceleration between
// 0.5 s and 1.5 s (when the chambers are up), turn between 0.5 s and 1.0 s. No DOM: a worker runs it.
import { assemblyTotals, getProfile, initialWorld, parseScenario, stepInPlace, type World } from "../../core/index.ts";
import { physicsShip, type Blueprint } from "./model.ts";

export const HZ = 240;
const T0 = 0.5;
const T1 = 1.5;
const TURN_T1 = 1.0;

export interface MeasuredRow {
  /** The controls held, as for `response`. */
  controls: Record<string, number>;
  /** Acceleration ahead (+y of the ship) and sideways (+x), m/s², and turn, rad/s² (+ anticlockwise). */
  ahead: number;
  side: number;
  turn: number;
  /** Welds that broke while it ran. */
  broke: number;
}

/**
 * The wiring and the damage rules as Try it has them: the controls reach only what is welded to the
 * cockpit, and with no cockpit nothing answers (shipRules.ts).
 */
export function shipControls(bp: Blueprint): Record<string, unknown> {
  const cockpit = bp.components.find((c) => c.kind === "cockpit")?.bodies[0];
  return cockpit ? { mix: bp.mix, shipRules: { hull: cockpit, ship: { bodies: bp.ship.bodies, links: bp.ship.links } } } : {};
}

/** The world a measurement runs in: the blueprint's ship alone, at rest, with its wiring. */
export function measureWorld(bp: Blueprint): World {
  const ship = physicsShip(bp);
  for (const b of ship.bodies) {
    b.velocity = { x: 0, y: 0 };
    b.angularVelocity = 0;
  }
  return initialWorld(
    parseScenario({
      schema: 1,
      name: "blueprint-measure",
      profile: "sandbox",
      seed: 1,
      world: { gravity: { x: 0, y: 0 }, bodies: ship.bodies, joints: ship.joints, links: ship.links, ...shipControls(bp) },
      timeline: [],
      end: { steps: 1 },
      probes: [],
      assertions: [],
    }),
  );
}

/** The body the ship is measured by: its cockpit, else its first part. */
const rootOf = (bp: Blueprint) => bp.components.find((c) => c.kind === "cockpit")?.bodies[0] ?? bp.ship.bodies[0]?.id;

/** Steps in one control's run. */
export const STEPS_PER_ROW = Math.round(T1 * HZ);

/**
 * Measures each set of controls in turn. A generator: it yields after every `chunk` steps (so a
 * worker can report progress, and a page without workers can run it a slice at a time), and returns
 * the rows.
 */
export function* measure(bp: Blueprint, rows: Record<string, number>[], chunk = 24): Generator<{ done: number; total: number }, MeasuredRow[]> {
  const profile = getProfile("sandbox");
  const root = rootOf(bp);
  const total = rows.length * STEPS_PER_ROW;
  const out: MeasuredRow[] = [];
  let done = 0;
  for (const controls of rows) {
    const w = measureWorld(bp);
    const commands = Object.entries(controls).map(([channel, value]) => ({ type: "control.set" as const, channel, value }));
    const at = (t: number) => Math.round(t * HZ);
    const samples = new Map<number, { v: { x: number; y: number }; w: number; angle: number }>();
    const keep = new Set([at(T0), at(TURN_T1), at(T1), at((T0 + T1) / 2)]);
    const startAngle = w.bodies.find((b) => b.id === root)?.angle ?? 0;
    for (let i = 0; i <= STEPS_PER_ROW; i++) {
      if (keep.has(i) && root) {
        const a = assemblyTotals(w, root);
        const r = w.bodies.find((b) => b.id === root);
        if (a && r) samples.set(i, { v: a.velocity, w: a.angularVelocity, angle: r.angle - startAngle });
      }
      if (i < STEPS_PER_ROW) stepInPlace(w, i === 0 ? commands : [], profile);
      if (++done % chunk === 0) yield { done, total };
    }
    const a = samples.get(at(T0));
    const b = samples.get(at(T1));
    const m = samples.get(at((T0 + T1) / 2));
    const t = samples.get(at(TURN_T1));
    if (!a || !b || !m || !t) {
      // The cockpit came off or was destroyed: nothing to measure by.
      out.push({ controls, ahead: NaN, side: NaN, turn: NaN, broke: w.events.filter((e) => e.type === "joint.break").length });
      continue;
    }
    // Acceleration in the world's frame, turned into the ship's as it was halfway through.
    const ax = (b.v.x - a.v.x) / (T1 - T0);
    const ay = (b.v.y - a.v.y) / (T1 - T0);
    const c = Math.cos(-m.angle);
    const s = Math.sin(-m.angle);
    out.push({
      controls,
      side: ax * c - ay * s,
      ahead: ax * s + ay * c,
      turn: (t.w - a.w) / (TURN_T1 - T0),
      broke: w.events.filter((e) => e.type === "joint.break").length,
    });
  }
  return out;
}

/** Runs a measurement to the end at once (tests, scripts). */
export function measureNow(bp: Blueprint, rows: Record<string, number>[]): MeasuredRow[] {
  const g = measure(bp, rows, 1e9);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}

/** What a measurement belongs to: the ship and its wiring as they were (a changed blueprint needs measuring again). */
export function measureKey(bp: Blueprint): string {
  const s = JSON.stringify([bp.ship, bp.mix]);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36) + ":" + s.length;
}
