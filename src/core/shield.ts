// Shields (SHD-001…SHD-005; Chloe, 14 November 2026). A shield generator is a part of a ship. While
// its channel is on and the ship's tanks it draws from hold fuel, it puts up a field: a disc that
// grows from nothing to its radius round the generator. The field is a real body, welded rigidly to
// the generator, with no material. It doesn't touch its own ship (parts of one assembly don't
// collide), and everything else meets it as a surface: debris and shells bounce off it, gas is
// pushed out by it and turned back at it, and the ship bounces off rock with it. While it is up the
// ship's engines and gun don't work. It burns fuel fast, and faster for every hit it takes.

import { assemblyRoots } from "./joints.ts";
import { bodyMass } from "./bodies.ts";
import { add, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { massProps } from "./shapes.ts";
import type { Body, BodyInput, JointInput, World } from "./world.ts";

export interface Shield {
  /** The control channel that holds it up. */
  channel: string;
  /** The field's full radius, m, and how fast it grows to it, m/s. */
  radius: number;
  grow: number;
  /** Fuel it burns while up, kg/s, from the tanks named (their stores, in proportion). */
  burn: number;
  from: string[];
  /** Fuel each hit costs, kg for each N·s of the hit's impulse, and at least `minHit` kg. */
  hitBurn: number;
  minHit: number;
  /** The control channels switched off while it is up (the ship's engines and gun). */
  blocks: string[];
  /** The field's mass, kg: light. */
  mass: number;
  /**
   * The part the field is welded to and its centre in that part's frame: the cockpit, at the ship's
   * centre of mass, so the field's knocks go into the ship's strongest part, not the small generator.
   */
  to: string;
  at: Vec2;
  /**
   * An elastic field (SHD-006; Chloe, 14 November 2026: "shrink and then rebound"): instead of a
   * rigid weld the field is held to its centre on the ship by a spring of `stiffness` N/m, damped at
   * `damping` of critical for the whole ship's mass. Struck, it gives: the ship goes on into it,
   * slowed by the spring over the field's spare width, and is pushed back out. A blow too hard for
   * that gives until the ship's own parts meet what struck it. `spread`: the spring pulls on every
   * part of the ship by its mass (the field holds all of it), not on the cockpit alone.
   */
  spring?: { stiffness: number; damping: number; spread?: boolean };
  /** State: the field's radius now, m. */
  r?: number;
}

export interface ShieldOps {
  addBody(world: World, body: BodyInput): void;
  addJoint(world: World, joint: JointInput): void;
}

/** The field body of a generator. */
export const fieldId = (gen: string) => `${gen}-field`;
const weldId = (gen: string) => `${gen}-w-field`;
/** A field starts this small, m: it grows from there. */
const SEED = 0.05;
/** Too little fuel to keep a field up, kg. */
const DRY = 1e-6;
/** The field's weld: nothing breaks it. */
const STRONG = 1e12;

/** The fuel in a generator's tanks that are still on its ship, kg. */
function fuelOf(world: World, gen: Body, roots: ReadonlyMap<string, string>): Body[] {
  return gen.shield!.from.map((id) => world.bodies.find((b) => b.id === id)).filter((b): b is Body => !!b && roots.get(b.id) === roots.get(gen.id) && (b.contents ?? []).some((c) => c.mass > DRY));
}

/** Takes `kg` of fuel from the tanks, in proportion to what each store holds. Returns what it took. */
function burnFrom(tanks: Body[], kg: number): number {
  const stores = tanks.flatMap((t) => t.contents ?? []).filter((c) => c.mass > 0);
  const total = stores.reduce((m, c) => m + c.mass, 0);
  if (!(total > 0) || !(kg > 0)) return 0;
  const take = Math.min(total, kg);
  for (const c of stores) c.mass = Math.max(0, c.mass - (take * c.mass) / total);
  return take;
}

function dropField(world: World, gen: Body): boolean {
  const id = fieldId(gen.id);
  if (!world.bodies.some((b) => b.id === id)) return false;
  world.bodies = world.bodies.filter((b) => b.id !== id);
  world.joints = world.joints.filter((j) => j.id !== weldId(gen.id));
  world.contacts = world.contacts.filter((c) => c.a !== id && c.b !== id);
  world.events.push({ tick: world.tick, type: "shield.down", data: { id: gen.id } });
  return true;
}

/**
 * The elastic field's spring for one step (SHD-006): between the field's centre and its anchor on
 * the ship, implicit (backward Euler, as the tether's, TRC-004), so it is steady however stiff.
 * Returns whether it pulled.
 */
function spring(world: World, field: Body, host: Body, s: Shield, roots: ReadonlyMap<string, string>, dt: number): boolean {
  const sp = s.spring!;
  const ship = world.bodies.filter((b) => roots.get(b.id) === roots.get(host.id) && !b.fixed);
  const M = ship.reduce((m, b) => m + bodyMass(b), 0);
  const mf = bodyMass(field);
  if (!(M > 0) || !(mf > 0)) return false;
  const r = rotate(sinCos(host.angle), s.at);
  const anchor = add(host.position, r);
  const anchorV = add(host.velocity, { x: -host.angularVelocity * r.y, y: host.angularVelocity * r.x });
  const d = sub(field.position, anchor);
  const v = sub(field.velocity, anchorV);
  const invMu = 1 / mf + 1 / M;
  const h = 2 * sp.damping * Math.sqrt(sp.stiffness * M) + sp.stiffness * dt;
  const k = -dt / (1 + dt * h * invMu);
  const J = { x: k * (sp.stiffness * d.x + h * v.x), y: k * (sp.stiffness * d.y + h * v.y) };
  if (Math.abs(J.x) + Math.abs(J.y) < 1e-12) return false;
  field.velocity = add(field.velocity, scale(J, 1 / mf));
  if (sp.spread) {
    // On every part by its mass: the ship as a whole is pushed, no part against another.
    for (const b of ship) b.velocity = sub(b.velocity, scale(J, 1 / M));
  } else {
    // On the cockpit, at the anchor: the push reaches the rest through the ship's welds.
    const mh = bodyMass(host);
    const I = massProps(host.shape, mh).inertia;
    host.velocity = sub(host.velocity, scale(J, 1 / mh));
    host.angularVelocity -= (r.x * J.y - r.y * J.x) / I;
  }
  return true;
}

/**
 * Runs every shield for one step, before the bodies move: up or down, its growth, the fuel it burns
 * and its hits, and the controls it switches off. Returns whether anything changed the world's
 * totals (the field coming or going, its fuel), for the ledger.
 */
export function runShields(world: World, dt: number, ops: ShieldOps): boolean {
  const gens = world.bodies.filter((b) => b.shield);
  const blocked = new Set<string>();
  let changed = false;
  if (gens.length) {
    const roots = assemblyRoots(world);
    for (const gen of gens) {
      const s = gen.shield!;
      const linked = world.links.some((l) => l.kind === "control" && l.to === gen.id && l.channel === s.channel && l.integrity > 0 && !l.off);
      const host = world.bodies.find((b) => b.id === s.to);
      const tanks = fuelOf(world, gen, roots);
      const held = linked && gen.integrity > 0 && !!host && roots.get(host.id) === roots.get(gen.id) && (world.controls[s.channel] ?? 0) > 0;
      if (!held || !tanks.length) {
        s.r = undefined;
        changed = dropField(world, gen) || changed;
        continue;
      }
      const id = fieldId(gen.id);
      let field = world.bodies.find((b) => b.id === id);
      if (!field) {
        s.r = SEED;
        const off = rotate(sinCos(host.angle), s.at);
        // Moving as that point of the ship moves.
        const velocity = add(host.velocity, { x: -host.angularVelocity * off.y, y: host.angularVelocity * off.x });
        const own = world.bodies.filter((b) => roots.get(b.id) === roots.get(host.id)).map((b) => b.id);
        ops.addBody(world, { id, shape: { kind: "disc", radius: SEED }, mass: s.mass, position: add(host.position, off), velocity, angle: host.angle, angularVelocity: host.angularVelocity, restitution: 0.8, friction: 0.2, ...(s.spring ? { passes: own } : {}) });
        // Rigid, it is welded to the ship (and so passes through it as one of its parts); elastic,
        // it is its own body, passing through the ship's parts, held by the spring below.
        if (!s.spring) ops.addJoint(world, { id: weldId(gen.id), a: host.id, b: id, anchorA: { ...s.at }, anchorB: { x: 0, y: 0 }, limits: { tension: STRONG, compression: STRONG, shear: STRONG, torque: STRONG } });
        field = world.bodies.find((b) => b.id === id)!;
        world.events.push({ tick: world.tick, type: "shield.up", data: { id: gen.id } });
        changed = true;
      } else {
        s.r = Math.min(s.radius, (s.r ?? SEED) + s.grow * dt);
        if (field.shape.kind === "disc" && field.shape.radius !== s.r) {
          field.shape = { kind: "disc", radius: s.r };
          changed = true;
        }
      }
      // The elastic field's spring (SHD-006).
      if (s.spring && spring(world, field, host, s, roots, dt)) changed = true;
      // Its fuel: a steady burn, and more for each hit in the step before (a new contact with the field).
      let kg = s.burn * dt;
      for (let i = world.events.length - 1; i >= 0 && world.events[i].tick >= world.tick - 1; i--) {
        const e = world.events[i];
        if (e.type !== "collision" || e.tick !== world.tick - 1 || (e.data.a !== id && e.data.b !== id)) continue;
        const hit = Math.max(s.minHit, s.hitBurn * Number(e.data.impulse ?? 0));
        kg += hit;
        world.events.push({ tick: world.tick, type: "shield.hit", data: { id: gen.id, by: e.data.a === id ? String(e.data.b) : String(e.data.a), fuel: hit } });
      }
      if (burnFrom(tanks, kg) > 0) changed = true;
      // Its ship's engines and gun don't work while it is up.
      const root = roots.get(gen.id);
      for (const l of world.links) if (l.kind === "control" && s.blocks.includes(l.channel) && roots.get(l.to) === root) blocked.add(l.id);
    }
  }
  for (const l of world.links) {
    if (blocked.has(l.id)) {
      if (!l.off) l.off = "shield";
    } else if (l.off === "shield") delete l.off;
  }
  return changed;
}
