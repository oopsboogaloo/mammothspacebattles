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
// At 0 (DMG-003) a body is wreckage: it keeps its shape, mass and motion, but its injector stops
// and its joints and links break. A joint or link at 0 breaks. Damage only reads the world's
// contacts; it never pushes on anything, so the ledger is unchanged.

import { add, length, rotate, sinCos, sub, type Vec2 } from "./math.ts";
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
  if (!pairs.size) return;
  const byId = new Map(world.bodies.map((b) => [b.id, b]));
  const destroyed: string[] = [];
  for (const p of pairs.values()) {
    const at = { x: p.x / p.w, y: p.y / p.w };
    for (const id of [p.a, p.b]) {
      const body = byId.get(id);
      const m = body?.material;
      if (!body || !m || body.integrity <= 0) continue;
      const share = p.energy / 2;
      const loss = Math.min(body.integrity, Math.max(0, share - m.threshold) / m.toughness);
      if (!(loss > 0)) continue;
      body.integrity = body.integrity - loss < GONE ? 0 : body.integrity - loss;
      world.events.push({ tick: world.tick, type: "damage", data: { id, loss, integrity: body.integrity, energy: share } });
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
      if (body.integrity === 0) {
        destroyed.push(id);
        world.events.push({ tick: world.tick, type: "destroyed", data: { id } });
      }
    }
  }
  const gone = new Set(destroyed);
  const brokenJoints = world.joints.filter((j) => j.integrity === 0 || gone.has(j.a) || gone.has(j.b));
  for (const j of brokenJoints) world.events.push({ tick: world.tick, type: "joint.break", data: { id: j.id, a: j.a, b: j.b, quantity: "damage", load: 0, limit: 0 } });
  if (brokenJoints.length) world.joints = world.joints.filter((j) => !brokenJoints.includes(j));
  const brokenLinks = world.links.filter((l) => l.integrity === 0 || gone.has(l.to) || (l.kind === "feed" && gone.has(l.from)));
  for (const l of brokenLinks) world.events.push({ tick: world.tick, type: "link.break", data: { id: l.id, to: l.to } });
  if (brokenLinks.length) world.links = world.links.filter((l) => !brokenLinks.includes(l));
}
