// Tractor beam and tether (TRC-001…TRC-006).
//
// A body with a tractor projects a beam while its control channel is on: a wedge `arc` wide and
// `range` long from `origin`, along `direction` (both in the body's own frame). The beam pulls
// with a total force `force`, shared equally between the assemblies in it; within an assembly,
// between the pieces in the wedge by mass. Every pull is a pair: the piece is pulled toward the
// origin and the ship is pulled toward the piece, along the line between them, so momentum and
// angular momentum are unchanged (Newton's third law).
//
// When an assembly no bigger than the ship and at most `capture` times its mass comes within the tether's length,
// the beam stops and a tether takes it: a stiff, damped spring of rest length `length` between the
// ship's centre of mass and the cargo's. It pulls and pushes along that line only, so the cargo
// swings freely round the ship and never spins it. Past `maxTension` it breaks. Pressing the
// control again lets go; the beam comes back only once the control has been released.
//
// The spring is implicit (backward Euler along the line), with the effective mass of both whole
// assemblies, so it is stable however stiff. Beam and tether are powered by the ship: the kinetic
// energy they add or take is recorded under the ledger's `tractor` source, never hidden.

import { add, cross, dot, length, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { assemblyProps, assemblyRoots } from "./joints.ts";
import { localVertices } from "./shapes.ts";
import type { RB } from "./physics.ts";
import type { Body, World } from "./world.ts";

export interface Tether {
  /** Rest length, m. */
  length: number;
  /** Spring constant, N/m. */
  stiffness: number;
  /** Damping as a fraction of critical, for the two assemblies it joins. */
  damping: number;
  /** Largest force it carries, pulling or pushing, before it breaks, N. */
  maxTension: number;
  /**
   * How fast it comes to its length after taking cargo nearer or further than that, m/s (TRC-010).
   * It then starts at the distance the cargo was taken at and pays out, or reels in, to its length,
   * so the two aren't thrown apart or snatched together. Without it the tether is its full length at once.
   */
  payOut?: number;
  /**
   * How far off it takes cargo, m (TRC-010): further than its length, it takes cargo out there and
   * reels it in. Without it, cargo is taken within the tether's length.
   */
  reach?: number;
}

export interface Tractor {
  /** Control channel that works it, through a control link (on above 0). */
  channel: string;
  /** Where the beam starts and the tether is held, body-local, m. */
  origin: Vec2;
  /** Beam axis, body-local unit vector. */
  direction: Vec2;
  /** Beam length, m. */
  range: number;
  /** Beam width, full angle, rad. */
  arc: number;
  /** Total pull, shared between what is in the beam, N. */
  force: number;
  /**
   * The fastest the beam draws anything toward the ship, m/s (TRC-014): its pull on an assembly fades
   * in a straight line from full, while it isn't closing on the ship, to nothing at this closing
   * speed, and its reaction on the ship with it. What it brings in arrives no faster. Absent: no limit.
   */
  maxSpeed?: number;
  /** Heaviest cargo the tether takes, as a multiple of the ship's mass (its size must not exceed the ship's). */
  capture: number;
  tether: Tether;
  /**
   * The body that makes the tether (TRC-007), if it is a separate part: no tether while it is
   * gone, broken, or no longer welded to the tractor's ship. The beam works without it.
   */
  tetherFrom?: string;
  /**
   * The body that makes the beam (TRC-012), if it is a separate part: no beam, and no tether, while
   * it is gone, broken, or no longer welded to the tractor's ship.
   */
  beamFrom?: string;
  /**
   * The only bodies the beam pulls and the tether takes, by id (TRC-011). Without it, anything free
   * in the wedge.
   */
  only?: string[];
  /**
   * With `only`, the beam still pulls whatever is free in its wedge; only the tether is limited to
   * the bodies named (TRC-013).
   */
  pullAny?: boolean;
  /**
   * It can draw propellant through its beam (TRC-008): while the beam is on and a body marked
   * `siphon` is in its wedge, that body's propellant moves to the bodies named in `into` (the
   * ship's tanks), `rate` kg/s in all. The source is not pulled, whatever `only` says.
   */
  siphon?: { rate: number; into: string[] };
  /** State: the body it is drawing propellant from now. */
  siphoning?: string;
  /** State: what it is doing now. */
  mode: "off" | "beam" | "tether";
  /** State: the control was on last step (to see a fresh press). */
  held: boolean;
  /** State: a press let the cargo go; the beam stays off until the control is released. */
  latched: boolean;
  /** State: the tethered body. */
  cargo?: string;
  /** State: the tether's length now, m, while it is paying out (TRC-010). */
  paid?: number;
  /** State: last step's tether force, N (positive pulling), and the beam's targets. */
  tension: number;
  targets: string[];
}

export const TRACTOR_DEFAULTS: Omit<Tractor, "channel" | "origin" | "direction"> = {
  range: 50,
  arc: Math.PI / 6,
  force: 400,
  capture: 1.2,
  tether: { length: 15, stiffness: 2000, damping: 0.7, maxTension: 20000 },
  mode: "off",
  held: false,
  latched: false,
  tension: 0,
  targets: [],
};

/** A tractor as written in scenarios: channel, origin and direction, the rest defaulted. */
export type TractorInput = Pick<Tractor, "channel" | "origin" | "direction"> & Partial<Omit<Tractor, "channel" | "origin" | "direction" | "tether">> & { tether?: Partial<Tether> };

export function normalizeTractor(t: TractorInput): Tractor {
  return { ...TRACTOR_DEFAULTS, ...t, tether: { ...TRACTOR_DEFAULTS.tether, ...t.tether }, targets: [...(t.targets ?? [])] };
}

/** The beam's origin and unit axis in the world. */
export function tractorFrame(b: Body): { origin: Vec2; axis: Vec2 } {
  const q = sinCos(b.angle);
  const d = rotate(q, b.tractor!.direction);
  const n = length(d);
  return { origin: add(b.position, rotate(q, b.tractor!.origin)), axis: n > 0 ? scale(d, 1 / n) : { x: 0, y: -1 } };
}

export interface Group {
  root: string;
  pieces: RB[];
  mass: number;
  inertia: number;
  com: Vec2;
  /** Largest distance from its centre of mass to any of its outline, m. */
  extent: number;
}

export function groupOf(rbs: RB[], roots: ReadonlyMap<string, string>, root: string): Group {
  const pieces = rbs.filter((r) => roots.get(r.body.id) === root);
  const p = assemblyProps(pieces.map((r) => ({ mass: r.mass, inertia: r.inertia, position: r.body.position })));
  let extent = 0;
  for (const r of pieces) {
    const shape = r.body.shape;
    if (shape.kind === "disc") extent = Math.max(extent, length(sub(r.body.position, p.centreOfMass)) + shape.radius);
    else for (const v of localVertices(shape)) extent = Math.max(extent, length(sub(add(r.body.position, rotate(r.rot, v)), p.centreOfMass)));
  }
  return { root, pieces, mass: p.mass, inertia: p.inertia, com: p.centreOfMass, extent };
}

/** Applies an impulse at a point of a body (velocity only; the welds share it in the solve). */
export function push(r: RB, J: Vec2, at: Vec2): void {
  r.body.velocity = add(r.body.velocity, scale(J, r.invMass));
  r.body.angularVelocity += r.invInertia * cross(sub(at, r.body.position), J);
}

/** 1 / effective mass of an assembly along unit n at point p. */
export function invMassAlong(g: Group, p: Vec2, n: Vec2): number {
  const rn = cross(sub(p, g.com), n);
  return 1 / g.mass + (g.inertia > 0 ? (rn * rn) / g.inertia : 0);
}

/**
 * Runs every tractor for one step (TRC-001…TRC-006): updates its mode from its control, then
 * applies the beam's pulls or the tether's force as velocity changes on both ends. Events:
 * `tractor.on`, `tractor.off`, `tether.engage`, `tether.release`, `tether.break`.
 */
export function applyTractors(world: World, rbs: RB[], dt: number): void {
  const users = rbs.filter((r) => r.body.tractor && r.invMass > 0);
  // The feeds a siphon set up last step are for this step's tractors to renew: whatever isn't
  // renewed (the beam off, the source out of the wedge, the ship gone) is taken away.
  const fed = new Set<string>();
  const settle = (): void => {
    if (world.links.some((l) => l.id.startsWith(SIPHON) && !fed.has(l.id))) world.links = world.links.filter((l) => !l.id.startsWith(SIPHON) || fed.has(l.id));
  };
  if (!users.length) return settle();
  const roots = assemblyRoots(world);
  const byId = new Map(rbs.map((r) => [r.body.id, r]));
  const ev = (type: string, data: Record<string, number | string | boolean>) => world.events.push({ tick: world.tick, type, data });
  for (const ship of users) {
    const b = ship.body;
    const t = b.tractor!;
    const drawing = t.siphoning;
    t.siphoning = undefined;
    const linked = world.links.some((l) => l.kind === "control" && l.to === b.id && l.channel === t.channel && l.integrity > 0 && !l.off);
    const on = linked && b.integrity > 0 && (world.controls[t.channel] ?? 0) > 0 && partWorks(b, t.beamFrom, byId, roots);
    const pressed = on && !t.held;
    t.held = on;
    if (!on) t.latched = false;
    t.targets = [];
    t.tension = 0;

    if (t.mode === "tether") {
      const cargo = t.cargo ? byId.get(t.cargo) : undefined;
      // A fresh press lets go; so does losing the control link (TRC-001), the cargo, the ship's tail,
      // or the tether's generator (TRC-007).
      if (pressed || !linked || !cargo || b.integrity <= 0 || roots.get(cargo.body.id) === roots.get(b.id) || !tetherWorks(b, byId, roots) || !partWorks(b, t.beamFrom, byId, roots)) {
        ev("tether.release", { id: b.id, cargo: t.cargo ?? "" });
        t.mode = "off";
        t.cargo = undefined;
        t.paid = undefined;
        t.latched = pressed;
        continue;
      }
      tether(world, ship, cargo, roots, rbs, dt, ev);
      // A tether that broke with the control still on stays off until a fresh press (TRC-005, TRC-006).
      if (t.mode !== "tether") t.latched = on;
      continue;
    }

    const want = on && !t.latched;
    if (want !== (t.mode === "beam")) ev(want ? "tractor.on" : "tractor.off", { id: b.id });
    t.mode = want ? "beam" : "off";
    if (!want) {
      if (drawing) ev("siphon.off", { id: b.id, from: drawing });
      continue;
    }
    if (t.siphon) siphon(world, ship, roots, rbs, fed);
    if (drawing !== t.siphoning) {
      if (drawing) ev("siphon.off", { id: b.id, from: drawing });
      if (t.siphoning) ev("siphon.on", { id: b.id, from: t.siphoning });
    }
    beam(world, ship, roots, rbs, dt, ev, tetherWorks(b, byId, roots));
  }
  settle();
}

/** The ids of the feed links a siphon keeps start with this. */
const SIPHON = "siphon:";

/**
 * A tractor's siphon (TRC-008): the nearest body in the beam's wedge that is marked `siphon` and
 * still holds propellant is joined to the ship's tanks by feed links, which move the propellant on
 * the next step as any feed does (mass and momentum exact, the rest recorded as a transfer). The
 * rate is shared between the resources as the source holds them, and equally between the tanks.
 */
function siphon(world: World, ship: RB, roots: ReadonlyMap<string, string>, rbs: RB[], fed: Set<string>): void {
  const t = ship.body.tractor!;
  const { origin, axis } = tractorFrame(ship.body);
  const half = sinCos(t.arc / 2).c;
  const own = roots.get(ship.body.id);
  let best: { r: RB; dist: number; held: number } | null = null;
  for (const r of rbs) {
    if (!r.body.siphon || roots.get(r.body.id) === own) continue;
    const held = (r.body.contents ?? []).reduce((m, s) => m + s.mass, 0);
    if (!(held > 1e-9)) continue;
    const d = sub(nearCopy(world, origin, r.body.position), origin);
    const dist = length(d);
    if (dist > t.range || dist < 1e-6 || dot(d, axis) < dist * half) continue;
    if (!best || dist < best.dist) best = { r, dist, held };
  }
  if (!best) return;
  const src = best.r.body;
  const tanks = t.siphon!.into.filter((id) => rbs.some((r) => r.body.id === id && roots.get(id) === own));
  if (!tanks.length) return;
  t.siphoning = src.id;
  const links = world.links.filter((l) => !l.id.startsWith(`${SIPHON}${ship.body.id}:`));
  for (const s of src.contents ?? []) {
    if (!(s.mass > 0)) continue;
    for (const tank of tanks) {
      if (!rbs.some((r) => r.body.id === tank && r.body.contents?.some((c) => c.resource === s.resource))) continue;
      const id = `${SIPHON}${ship.body.id}:${src.id}:${tank}:${s.resource}`;
      fed.add(id);
      links.push({ id, kind: "feed", from: src.id, to: tank, resource: s.resource, rate: (t.siphon!.rate * (s.mass / best.held)) / tanks.length, integrity: 1 });
    }
  }
  world.links = links.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

/** A separate part the tractor needs, if it names one, is there, working, and on the tractor's ship. */
function partWorks(b: Body, id: string | undefined, byId: Map<string, RB>, roots: ReadonlyMap<string, string>): boolean {
  if (id === undefined) return true;
  const g = byId.get(id);
  return !!g && g.body.integrity > 0 && roots.get(id) === roots.get(b.id);
}

/** The tether's generator, if it has one, is there, working, and on the tractor's ship (TRC-007). */
const tetherWorks = (b: Body, byId: Map<string, RB>, roots: ReadonlyMap<string, string>): boolean => partWorks(b, b.tractor!.tetherFrom, byId, roots);

function beam(world: World, ship: RB, roots: ReadonlyMap<string, string>, rbs: RB[], dt: number, ev: (type: string, data: Record<string, number | string | boolean>) => void, canTether: boolean): void {
  const t = ship.body.tractor!;
  const { origin, axis } = tractorFrame(ship.body);
  const half = sinCos(t.arc / 2).c;
  const own = roots.get(ship.body.id);
  // Pieces in the wedge, by assembly, in body order (deterministic).
  const inBeam = new Map<string, RB[]>();
  for (const r of rbs) {
    if (r.invMass === 0 || roots.get(r.body.id) === own) continue;
    // What passes through the ship is the ship's own (its elastic shield's field, SHD-006).
    if (r.body.passes?.includes(ship.body.id)) continue;
    if (t.only && !t.pullAny && !t.only.includes(r.body.id)) continue;
    // What its siphon draws from isn't pulled (TRC-008): a fuel tank stays where it stands.
    if (t.siphon && r.body.siphon) continue;
    const d = sub(nearCopy(world, origin, r.body.position), origin);
    const dist = length(d);
    if (dist > t.range || dist < 1e-6 || dot(d, axis) < dist * half) continue;
    const root = roots.get(r.body.id)!;
    const list = inBeam.get(root) ?? [];
    list.push(r);
    inBeam.set(root, list);
  }
  if (!inBeam.size) return;
  const shipGroup = groupOf(rbs, roots, own!);
  // Capture: an assembly no heavier and no bigger than the ship whose centre of mass is within the
  // tether's length of the ship's; the nearest. The tether takes its nearest piece in the beam.
  let best: { r: RB; dist: number } | null = null;
  for (const [root, pieces] of inBeam) {
    if (!canTether) break;
    // The tether takes only what the tractor names, if it names anything (TRC-011, TRC-013).
    const named = t.only ? pieces.filter((r) => t.only!.includes(r.body.id)) : pieces;
    if (!named.length) continue;
    const g = groupOf(rbs, roots, root);
    if (g.mass > shipGroup.mass * t.capture || g.extent > shipGroup.extent * (1 + 1e-9)) continue;
    const dist = length(sub(nearCopy(world, shipGroup.com, g.com), shipGroup.com));
    if (dist > (t.tether.reach ?? t.tether.length) || (best && dist >= best.dist)) continue;
    const gap = (r: RB) => length(sub(nearCopy(world, origin, r.body.position), origin));
    const near = named.reduce((m, r) => (gap(r) < gap(m) ? r : m));
    best = { r: near, dist };
  }
  if (best) {
    t.mode = "tether";
    t.cargo = best.r.body.id;
    if (t.tether.payOut !== undefined) t.paid = best.dist;
    ev("tractor.off", { id: ship.body.id });
    ev("tether.engage", { id: ship.body.id, cargo: t.cargo, distance: best.dist });
    return;
  }
  const share = t.force / inBeam.size;
  const shipV = t.maxSpeed !== undefined ? groupVelocity(shipGroup) : null;
  for (const [root, pieces] of inBeam) {
    const m = pieces.reduce((s, r) => s + r.mass, 0);
    // How fast this assembly is closing on the beam's origin, and so how much of the pull it gets
    // (TRC-014): it fades to nothing at the top speed, and is never more than would take the closing
    // speed to it in this step (a light piece would otherwise pass it in one step), the ship
    // recoiling as it pulls.
    let pull = share * dt;
    if (shipV && t.maxSpeed !== undefined) {
      const g = groupOf(rbs, roots, root);
      const toward = sub(origin, nearCopy(world, origin, g.com));
      const L = length(toward);
      const closing = L > 1e-9 ? dot(sub(groupVelocity(g), shipV), toward) / L : 0;
      const k = t.maxSpeed > 0 ? Math.max(0, Math.min(1, 1 - closing / t.maxSpeed)) : 0;
      const room = Math.max(0, t.maxSpeed - closing) * ((g.mass * shipGroup.mass) / (g.mass + shipGroup.mass));
      pull = Math.min(k * pull, room);
    }
    if (pull <= 0) continue;
    for (const r of pieces) {
      const d = sub(origin, nearCopy(world, origin, r.body.position));
      const J = scale(d, (pull * (r.mass / m)) / length(d));
      push(r, J, r.body.position);
      push(ship, scale(J, -1), origin);
      t.targets.push(r.body.id);
    }
  }
}

/** In a wrapped world (FLT-012), the copy of `p` nearest `from`; elsewhere `p` itself. */
function nearCopy(world: World, from: Vec2, p: Vec2): Vec2 {
  const b = world.bounds;
  if (!b.wrap) return p;
  const w = b.max.x - b.min.x;
  const h = b.max.y - b.min.y;
  return { x: p.x - w * Math.round((p.x - from.x) / w), y: p.y - h * Math.round((p.y - from.y) / h) };
}

/** An assembly's velocity: its momentum over its mass. */
function groupVelocity(g: Group): Vec2 {
  let p = { x: 0, y: 0 };
  for (const r of g.pieces) p = add(p, scale(r.body.velocity, r.mass));
  return scale(p, 1 / g.mass);
}

/**
 * The tether (TRC-004): a spring between the ship's centre of mass and the cargo's, so it pulls
 * along the line through both and turns neither: the cargo swings round the ship without spinning
 * it. Each pull is applied at the centre of mass (to a part of each assembly; the welds share it).
 */
function tether(world: World, ship: RB, cargo: RB, roots: ReadonlyMap<string, string>, rbs: RB[], dt: number, ev: (type: string, data: Record<string, number | string | boolean>) => void): void {
  const t = ship.body.tractor!;
  const a = groupOf(rbs, roots, roots.get(ship.body.id)!);
  const c = groupOf(rbs, roots, roots.get(cargo.body.id)!);
  const d = sub(nearCopy(world, a.com, c.com), a.com);
  const dist = length(d);
  if (dist < 1e-9) return;
  const n = scale(d, 1 / dist);
  // Through both centres of mass: each end's effective mass is its whole mass.
  const invMu = 1 / a.mass + 1 / c.mass;
  const mu = 1 / invMu;
  const { stiffness: k, damping: zeta, maxTension } = t.tether;
  // A tether that pays out (TRC-010) is as long as it has got so far.
  const L = t.paid ?? t.tether.length;
  if (t.paid !== undefined) {
    const step = (t.tether.payOut ?? 0) * dt;
    const left = t.tether.length - t.paid;
    t.paid = Math.abs(left) <= step ? undefined : t.paid + Math.sign(left) * step;
  }
  const damp = 2 * zeta * Math.sqrt(k * mu);
  const v = dot(sub(groupVelocity(c), groupVelocity(a)), n);
  const x = dist - L;
  // Backward Euler: the force uses the end-of-step stretch and speed.
  const h = damp + k * dt;
  let J = (-dt * (k * x + h * v)) / (1 + dt * h * invMu);
  const limit = maxTension * dt;
  const broke = Math.abs(J) > limit;
  if (broke) J = Math.sign(J) * limit;
  const P = scale(n, J);
  push(cargo, P, c.com);
  push(ship, scale(P, -1), a.com);
  t.tension = -J / dt;
  if (broke) {
    ev("tether.break", { id: ship.body.id, cargo: t.cargo ?? "", tension: Math.abs(J) / dt, limit: maxTension });
    t.mode = "off";
    t.cargo = undefined;
    t.paid = undefined;
  }
  void world;
}
