// The base's collector (BAS-002…BAS-004): an egg cup that tethers loose cargo, reels it in and
// keeps it.
//
// A collector sits on a fixed body. Loose cargo (a free assembly with no ship parts in it, no
// bigger than `maxExtent`) with a piece within `range` of its `mouth` gets the collector's tether
// on its nearest piece. The tether is the ship's spring model (TRC-004), much softer, so it gives
// way to a ship still holding the same cargo: both act, and all three are connected. Its rest
// length starts at the distance it was taken at and shortens at `reel` m/s. Reeled in all the way,
// with the piece's edge within `capture` of the mouth, the cargo is captured: the whole assembly leaves
// the world, and its mass is added to what the collector has delivered, by mineral ("rock" for
// none). A force past `maxTension` breaks the tether.
//
// The collector is fixed, so its pull is external: the impulse and angular impulse it gives are
// returned for the ledger. The energy it adds or takes is recorded under `tractor`, as for ships.

import { add, cross, dot, length, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { assemblyRoots } from "./joints.ts";
import { bodyMass } from "./bodies.ts";
import { groupOf, invMassAlong, push } from "./tractor.ts";
import type { RB } from "./physics.ts";
import type { Body, World } from "./world.ts";

export interface Collector {
  /** The reel point, in the cup, body-local, m. */
  mouth: Vec2;
  /** Takes cargo with a piece within this of the mouth, m. */
  range: number;
  /** Largest cargo it takes: distance from its centre of mass to its far edge, m. */
  maxExtent: number;
  /** Spring constant, N/m: much softer than a ship's tether. */
  stiffness: number;
  /** Damping as a fraction of critical. */
  damping: number;
  /** Reel-in speed, m/s. */
  reel: number;
  /** Captured once reeled in with the piece's edge within this of the mouth, m. */
  capture: number;
  /** Largest force before the tether breaks, N. */
  maxTension: number;
  /** State: the tethered piece, the tether's rest length, its force (positive pulling). */
  cargo?: string;
  length: number;
  tension: number;
  /** State: a capture to take out of the world at the end of this step. */
  captured?: string;
  /** State: what it has delivered, kg by mineral ("rock" for none). */
  delivered: Record<string, number>;
}

export const COLLECTOR_DEFAULTS: Omit<Collector, "mouth"> = {
  range: 10,
  maxExtent: 3,
  stiffness: 200,
  damping: 1,
  reel: 2,
  capture: 2,
  maxTension: 5000,
  length: 0,
  tension: 0,
  delivered: {},
};

export type CollectorInput = Pick<Collector, "mouth"> & Partial<Omit<Collector, "mouth">>;

export function normalizeCollector(c: CollectorInput): Collector {
  return { ...COLLECTOR_DEFAULTS, ...c, delivered: { ...(c.delivered ?? {}) } };
}

/** The collector's reel point in the world. */
export function collectorMouth(b: Body): Vec2 {
  return add(b.position, rotate(sinCos(b.angle), b.collector!.mouth));
}

/** Ship parts the collector never takes. */
const isShipPart = (b: Body) => !!(b.tractor || b.injector || b.magazine || b.collector);

/**
 * Runs every collector for one step: takes loose cargo in range, pulls it on its tether and reels
 * it in, and marks it captured once in. Returns the external impulse and angular impulse it gave.
 * Events: `collector.engage`, `collector.break`.
 */
export function applyCollectors(world: World, rbs: RB[], dt: number): { impulse: Vec2; angular: number } {
  const out = { impulse: { x: 0, y: 0 }, angular: 0 };
  const owners = world.bodies.filter((b) => b.collector);
  if (!owners.length) return out;
  const roots = assemblyRoots(world);
  const byId = new Map(rbs.map((r) => [r.body.id, r]));
  const ev = (type: string, data: Record<string, number | string | boolean>) => world.events.push({ tick: world.tick, type, data });
  const unfit = new Set<string>();
  for (const b of world.bodies) if (isShipPart(b) || b.fixed) unfit.add(roots.get(b.id)!);
  const held = new Set(owners.map((o) => o.collector!.cargo).filter((x): x is string => !!x).map((id) => roots.get(id)));
  for (const owner of owners) {
    const c = owner.collector!;
    c.tension = 0;
    const mouth = collectorMouth(owner);
    let cargo = c.cargo ? byId.get(c.cargo) : undefined;
    if (c.cargo && (!cargo || unfit.has(roots.get(c.cargo)!))) {
      c.cargo = undefined;
      cargo = undefined;
    }
    if (!cargo) {
      // Take the nearest piece in range of loose cargo small enough for the cup.
      let best: { r: RB; d: number } | null = null;
      for (const r of rbs) {
        if (r.invMass === 0) continue;
        const root = roots.get(r.body.id)!;
        if (unfit.has(root) || held.has(root)) continue;
        const d = length(sub(r.body.position, mouth));
        if (d > c.range || (best && d >= best.d)) continue;
        if (groupOf(rbs, roots, root).extent > c.maxExtent) continue;
        best = { r, d };
      }
      if (!best) continue;
      cargo = best.r;
      c.cargo = cargo.body.id;
      c.length = best.d;
      held.add(roots.get(c.cargo));
      ev("collector.engage", { id: owner.id, cargo: c.cargo, distance: best.d });
    }
    // Reel in, then pull: the ship's implicit spring with the collector's end fixed.
    c.length = Math.max(0, c.length - c.reel * dt);
    const d = sub(cargo.body.position, mouth);
    const dist = length(d);
    // In all the way: its centre within `capture` of the mouth, plus its own reach, so a big piece
    // resting in the bowl counts.
    if (c.length === 0 && dist <= c.capture + cargo.radius) {
      c.captured = c.cargo;
      continue;
    }
    if (dist < 1e-9) continue;
    const n = scale(d, 1 / dist);
    const g = groupOf(rbs, roots, roots.get(cargo.body.id)!);
    const invMu = invMassAlong(g, cargo.body.position, n);
    const mu = 1 / invMu;
    const k = c.stiffness;
    const h = 2 * c.damping * Math.sqrt(k * mu) + k * dt;
    const v = dot(cargo.body.velocity, n);
    let J = (-dt * (k * (dist - c.length) + h * v)) / (1 + dt * h * invMu);
    const limit = c.maxTension * dt;
    const broke = Math.abs(J) > limit;
    if (broke) J = Math.sign(J) * limit;
    const P = scale(n, J);
    push(cargo, P, cargo.body.position);
    out.impulse = add(out.impulse, P);
    out.angular += cross(cargo.body.position, P);
    c.tension = -J / dt;
    if (broke) {
      ev("collector.break", { id: owner.id, cargo: c.cargo ?? "", tension: Math.abs(J) / dt, limit: c.maxTension });
      c.cargo = undefined;
    }
  }
  return out;
}

/**
 * Takes captured cargo out of the world (BAS-004): every body of its assembly, and the welds and
 * links on them. Its mass is added to the collector's `delivered`, by mineral. Event
 * `cargo.collected`. Returns whether anything left.
 */
export function collectCaptured(world: World): boolean {
  const owners = world.bodies.filter((b) => b.collector?.captured);
  if (!owners.length) return false;
  const roots = assemblyRoots(world);
  for (const owner of owners) {
    const c = owner.collector!;
    const root = roots.get(c.captured!);
    c.captured = undefined;
    c.cargo = undefined;
    c.length = 0;
    if (root === undefined) continue;
    const gone = new Set(world.bodies.filter((b) => roots.get(b.id) === root).map((b) => b.id));
    let mass = 0;
    const kinds: Record<string, number> = {};
    for (const b of world.bodies) {
      if (!gone.has(b.id)) continue;
      const kind = b.mineral ?? "rock";
      const m = bodyMass(b); // stores and all: everything that leaves the world is delivered
      kinds[kind] = (kinds[kind] ?? 0) + m;
      c.delivered[kind] = (c.delivered[kind] ?? 0) + m;
      mass += m;
    }
    world.bodies = world.bodies.filter((b) => !gone.has(b.id));
    world.joints = world.joints.filter((j) => !gone.has(j.a) && !gone.has(j.b));
    world.links = world.links.filter((l) => !gone.has(l.to) && (l.kind !== "feed" || !gone.has(l.from)));
    world.drags = world.drags.filter((d) => !gone.has(d.id));
    world.contacts = world.contacts.filter((x) => !gone.has(x.a) && !gone.has(x.b));
    world.events.push({ tick: world.tick, type: "cargo.collected", data: { id: owner.id, pieces: gone.size, mass, gold: kinds.gold ?? 0 } });
  }
  return true;
}
