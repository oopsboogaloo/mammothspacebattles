// Damage (DMG-001…DMG-003, DMG-005): integrity, a declared damage rule, and what failing does.
//
// Every body, joint and link has an integrity from 1 (whole) to 0 (failed). A body takes damage
// only if it declares a material; without one it can't be damaged, so worlds written before M5
// behave as they did.
//
// The damage rule (DMG-002), applied after every step:
//   1. Each contact pair's energy lost this step (COL-006, the kinetic energy it turned into
//      heat) is split equally between its two bodies.
//   2. A body with a material loses (share − threshold) ÷ toughness of integrity, if positive.
//   3. Each weld on that body loses the same, scaled down with distance from the hit: in full at
//      the struck point, nothing a body radius away. A weld's limits scale with its integrity.
//   4. Each link to or from that body loses the same.
// Armour (DMG-005) is just a material with a high threshold and toughness. Whatever hits it
// touches it, not the part behind, so the armour takes the damage first.
//
// A damaged body holding gas leaks it (DMG-004) through a breach where it was first hit: see
// leakRate. At 0 (DMG-003) a body is wreckage: it keeps its shape, mass and motion, but its injector stops
// and its joints and links break. A joint or link at 0 breaks. Damage only reads the world's
// contacts; it never pushes on anything, so the ledger is unchanged.

import { add, invRotate, length, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { SPECIES } from "./gas.ts";
import { localVertices } from "./shapes.ts";
import type { Body, World } from "./world.ts";

/** How a body takes damage (DMG-002): energies per contact per step, J. */
export interface Material {
  /** A name for people, e.g. "armour". */
  name?: string;
  /** Energy a hit must deliver to this body before it does any damage, J. */
  threshold: number;
  /** Energy beyond the threshold that takes all of the body's integrity, J. */
  toughness: number;
}

/** Example materials: what the sandbox offers and RS-11 uses. */
export const MATERIALS: Record<string, Material> = {
  hull: { name: "hull", threshold: 50, toughness: 600 },
  tank: { name: "tank", threshold: 20, toughness: 100 },
  armour: { name: "armour", threshold: 100, toughness: 4000 },
};

/** Where a damaged body leaks (DMG-004), in its own frame: a point on its surface and the outward direction. */
export interface Breach {
  point: Vec2;
  normal: Vec2;
  /** Leaked mass owed but not yet emitted, kg; parcels emitted so far. */
  credit: number;
  count: number;
}

/**
 * The leak rule (DMG-004). A store's pressure is proportional to how full it is (a fixed volume at a
 * fixed temperature), and the breach widens as integrity falls, so a body leaks
 *   LEAK_RATE × (1 − integrity) × (gas mass ÷ gas capacity)   kg/s,
 * through its breach, as parcels of LEAK_PARCEL kg moving out at LEAK_SPEED, spread across the
 * breach's width, BREACH_WIDTH × (1 − integrity). A full store fully breached empties with a time
 * constant of capacity ÷ LEAK_RATE. Only stores of gas species leak.
 */
export const LEAK_RATE = 0.5; // kg/s
export const BREACH_WIDTH = 0.5; // m
export const LEAK_PARCEL = 0.002; // kg
export const LEAK_RADIUS = 0.05; // m
export const LEAK_SPEED = 10; // m/s, relative to the breach

/** Gas mass and capacity in a body's stores (only gas species leak), kg. */
export function gasStores(b: Body): { mass: number; capacity: number } {
  let mass = 0;
  let capacity = 0;
  for (const s of b.contents ?? []) {
    if (!SPECIES[s.resource]) continue;
    mass += s.mass;
    capacity += s.capacity;
  }
  return { mass, capacity };
}

/** How fast a body leaks now, kg/s (DMG-004). */
export function leakRate(b: Body): number {
  if (b.integrity >= 1 || b.fixed) return 0;
  const g = gasStores(b);
  return g.capacity > 0 && g.mass > 0 ? LEAK_RATE * (1 - b.integrity) * (g.mass / g.capacity) : 0;
}

/** A breach for a body damaged without a hit (set by hand): the top of its outline. */
export function defaultBreach(b: Body): Breach {
  const top = b.shape.kind === "disc" ? b.shape.radius : Math.max(...localVertices(b.shape).map((v) => v.y));
  return { point: { x: 0, y: top }, normal: { x: 0, y: 1 }, credit: 0, count: 0 };
}

/** Integrity below this counts as 0, so rounding never leaves a part hanging on at 10⁻¹⁶. */
const GONE = 1e-9;

function radius(b: Body): number {
  if (b.shape.kind === "disc") return b.shape.radius;
  let r = 0;
  for (const v of localVertices(b.shape)) r = Math.max(r, length(v));
  return r;
}

const anchorAt = (b: Body, local: Vec2): Vec2 => add(b.position, rotate(sinCos(b.angle), local));

/**
 * Applies this step's contact damage (DMG-002, DMG-005) and what failing does (DMG-003).
 * Events: `damage` per body hurt, `destroyed` when one reaches 0, `joint.break` with quantity
 * "damage", `link.break`.
 */
export function applyDamage(world: World): void {
  // Energy and an impulse-weighted point per pair, in contact order (deterministic).
  const pairs = new Map<string, { a: string; b: string; energy: number; x: number; y: number; w: number }>();
  for (const c of world.contacts) {
    if (!(c.energyLost > 0)) continue;
    const k = `${c.a}\u0000${c.b}`;
    let p = pairs.get(k);
    if (!p) pairs.set(k, (p = { a: c.a, b: c.b, energy: 0, x: 0, y: 0, w: 0 }));
    p.energy += c.energyLost;
    const w = Math.max(c.normalImpulse, 1e-12);
    p.x += w * c.point.x;
    p.y += w * c.point.y;
    p.w += w;
  }
  const byId = new Map(world.bodies.map((b) => [b.id, b]));
  for (const p of pairs.values()) {
    const at = { x: p.x / p.w, y: p.y / p.w };
    for (const id of [p.a, p.b]) {
      const body = byId.get(id);
      if (body) damageBody(world, body, p.energy / 2, at);
    }
  }
  breakWreckage(world);
}

/**
 * One hit (DMG-002 steps 2–4): `energy` J delivered to `body` at world point `at`. Its integrity, the
 * welds near the point and its links lose (energy − threshold) ÷ toughness; the first hit on a body
 * holding gas opens its breach there. Contacts and blasts (WPN) both damage through this.
 */
export function damageBody(world: World, body: Body, energy: number, at: Vec2): void {
  const m = body.material;
  if (!m || body.integrity <= 0) return;
  const id = body.id;
  const loss = Math.min(body.integrity, Math.max(0, energy - m.threshold) / m.toughness);
  if (!(loss > 0)) return;
  body.integrity = body.integrity - loss < GONE ? 0 : body.integrity - loss;
  // The first hit on a body holding gas opens its breach there (DMG-004).
  if (!body.breach && gasStores(body).capacity > 0) {
    const q = sinCos(body.angle);
    const local = invRotate(q, sub(at, body.position));
    const d = length(local);
    body.breach = { point: local, normal: d > 1e-9 ? scale(local, 1 / d) : { x: 0, y: 1 }, credit: 0, count: 0 };
  }
  world.events.push({ tick: world.tick, type: "damage", data: { id, loss, integrity: body.integrity, energy } });
  const r = radius(body);
  for (const j of world.joints) {
    if (j.a !== id && j.b !== id) continue;
    const anchor = anchorAt(body, j.a === id ? j.anchorA : j.anchorB);
    const near = Math.max(0, 1 - length(sub(anchor, at)) / r);
    j.integrity = Math.max(0, j.integrity - loss * near);
    if (j.integrity < GONE) j.integrity = 0;
  }
  for (const l of world.links) {
    if (l.to !== id && !(l.kind === "feed" && l.from === id)) continue;
    l.integrity = Math.max(0, l.integrity - loss);
    if (l.integrity < GONE) l.integrity = 0;
  }
  if (body.integrity === 0) world.events.push({ tick: world.tick, type: "destroyed", data: { id } });
}

/** Wreckage holds nothing, however it got to 0: a hit, or integrity set by hand (DMG-003, DMG-006). */
export function breakWreckage(world: World): void {
  const gone = new Set(world.bodies.filter((b) => b.integrity <= 0).map((b) => b.id));
  if (!gone.size && !world.joints.some((j) => j.integrity <= 0) && !world.links.some((l) => l.integrity <= 0)) return;
  const brokenJoints = world.joints.filter((j) => j.integrity === 0 || gone.has(j.a) || gone.has(j.b));
  for (const j of brokenJoints) world.events.push({ tick: world.tick, type: "joint.break", data: { id: j.id, a: j.a, b: j.b, quantity: "damage", load: 0, limit: 0 } });
  if (brokenJoints.length) world.joints = world.joints.filter((j) => !brokenJoints.includes(j));
  const brokenLinks = world.links.filter((l) => l.integrity === 0 || gone.has(l.to) || (l.kind === "feed" && gone.has(l.from)));
  for (const l of brokenLinks) world.events.push({ tick: world.tick, type: "link.break", data: { id: l.id, to: l.to } });
  if (brokenLinks.length) world.links = world.links.filter((l) => !brokenLinks.includes(l));
}
