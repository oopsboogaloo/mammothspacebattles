// Destroyed bodies leave the world in a puff of dust (DMG-007).
//
// A body that reaches 0 integrity is gone: it leaves the world in the step it is destroyed, and
// the ledger records its mass, momentum and energy as leaving through the boundary. Where it was,
// a burst of dust drifts off and fades over 20–30 s. Dust is only something to see: it has no
// mass, touches nothing, and is outside the ledger's books. Its scatter comes from a hash of the
// body's id, not the world's random stream, so it changes nothing else.

import { add, scale, sinCos, type Vec2 } from "./math.ts";
import { bodyMass } from "./bodies.ts";
import { massProps } from "./shapes.ts";
import type { Body, World } from "./world.ts";

export type DustKind = "rock" | "gold" | "metal";

export interface Dust {
  position: Vec2;
  velocity: Vec2;
  age: number;
  /** How long it lasts, s (20–30). */
  life: number;
  /** Its size, m. */
  size: number;
  kind: DustKind;
}

/** Most dust at once; the oldest goes first. */
export const DUST_LIMIT = 6000;
/** Dust slows by this much per second (it drifts, it doesn't fly). */
const DRAG = 0.15;

/** A steady pseudo-random number in [0, 1) from a name and an index. */
function hash01(id: string, k: number): number {
  let h = 2166136261 ^ Math.imul(k + 1, 0x9e3779b9);
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** The dust a body leaves: more for a bigger body, scattered over its outline, bursting outward. */
export function burst(world: World, b: Body): void {
  const props = massProps(b.shape, 1);
  const R = Math.max(0.1, props.boundingRadius);
  const n = Math.max(10, Math.min(80, Math.round(30 * Math.sqrt(props.area))));
  const kind: DustKind = b.mineral === "gold" ? "gold" : b.material?.name === "rock" || b.compound || !b.material ? "rock" : "metal";
  const list = (world.dust ??= []);
  for (let k = 0; k < n; k++) {
    const a = 2 * Math.PI * hash01(b.id, 4 * k);
    const r = R * Math.sqrt(hash01(b.id, 4 * k + 1));
    const q = sinCos(a);
    const dir = { x: q.c, y: q.s };
    const at = add(b.position, scale(dir, r));
    // The body's motion at that point, plus a burst outward of 0.5–3 m/s.
    const spin = { x: -b.angularVelocity * (at.y - b.position.y), y: b.angularVelocity * (at.x - b.position.x) };
    const out = 0.5 + 2.5 * hash01(b.id, 4 * k + 2);
    list.push({ position: at, velocity: add(add(b.velocity, spin), scale(dir, out)), age: 0, life: 20 + 10 * hash01(b.id, 4 * k + 3), size: 0.04 + 0.08 * hash01(b.id, 4 * k + 5), kind });
  }
  if (list.length > DUST_LIMIT) list.splice(0, list.length - DUST_LIMIT);
}

/** Moves the dust on and drops what has faded out. */
export function stepDust(world: World, dt: number): void {
  const list = world.dust;
  if (!list?.length) return;
  const keep = 1 - DRAG * dt;
  const kept: Dust[] = [];
  for (const d of list) {
    d.age += dt;
    if (d.age >= d.life) continue;
    d.velocity = scale(d.velocity, keep);
    d.position = add(d.position, scale(d.velocity, dt));
    kept.push(d);
  }
  world.dust = kept;
}

/**
 * Takes destroyed bodies out of the world (DMG-007): every non-fixed body at 0 integrity, with the
 * welds and links on it, each leaving a burst of dust. Event `destroyed.removed`. Returns whether
 * anything left. The caller records what left in the ledger.
 */
export function removeDestroyed(world: World): boolean {
  const gone = world.bodies.filter((b) => b.integrity <= 0 && !b.fixed);
  if (!gone.length) return false;
  const ids = new Set(gone.map((b) => b.id));
  // A pilot destroyed with its body lets go of its controls.
  for (const b of gone) if (b.pilot) for (const ch of Object.keys(b.pilot.command)) world.controls[ch] = 0;
  for (const b of gone) {
    burst(world, b);
    world.events.push({ tick: world.tick, type: "destroyed.removed", data: { id: b.id, x: b.position.x, y: b.position.y, mass: bodyMass(b) } });
  }
  world.bodies = world.bodies.filter((b) => !ids.has(b.id));
  world.joints = world.joints.filter((j) => !ids.has(j.a) && !ids.has(j.b));
  world.links = world.links.filter((l) => !ids.has(l.to) && (l.kind !== "feed" || !ids.has(l.from)));
  world.drags = world.drags.filter((d) => !ids.has(d.id));
  world.contacts = world.contacts.filter((c) => !ids.has(c.a) && !ids.has(c.b));
  return true;
}
