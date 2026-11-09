// Explosive shells (WPN): a charge that detonates on impact into blast gas, shrapnel and blast damage.
//
// A shell may carry an explosive charge, part of its mass, holding chemical energy E = charge × heat
// (divided by the world's gas scale, as all chemical energy is). It is armed once it has left the
// gun that loaded it, and detonates when an armed shell strikes something hard enough (a contact
// whose impulse would change the shell's speed by more than `arm`). Detonating, the shell becomes:
//   - Shrapnel: its casing (mass − charge) split into fragments along its outline, thrown outward at
//     the Gurney speed for a cylinder, u = √(2·G·E / (M + C/2)), with G = GURNEY of the energy.
//     They are bodies, and do their damage by hitting things.
//   - Blast gas: the charge as gas parcels within the shell's footprint, moving out at u, holding the rest of E as heat.
//     They push what is near, as gas does.
//   - Blast damage: every body with a material whose outline is within `radius` takes a share of E:
//     the fraction of the view from the blast its outline covers, fading to nothing at `radius`.
//     It damages through the ordinary rule (DMG-002), welds and links near the hit included.
// Mass is exact; momentum is exact (fragments and parcels come in opposite pairs); the energy the
// gas carries as heat is whatever E leaves after the fragments' and gas's motion, so energy is exact.
// The shell's spin, and the shift of mass from its centre, change angular momentum a little: that is
// recorded as a transfer.

import { breakWreckage, damageBody } from "./damage.ts";
import { bodyMass, bodiesById } from "./bodies.ts";
import { collide } from "./collide.ts";
import { storeChemical, storeThermal, type Parcel } from "./gas.ts";
import { add, dot, length, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { localVertices, massProps, polygonArea } from "./shapes.ts";
import { compareIds, type Body, type World } from "./world.ts";

export interface Explosive {
  /** Explosive in the shell, kg; part of the shell's mass. */
  charge: number;
  /** Chemical energy per kg, J (before the gas scale). Default TNT's, 4.2 MJ/kg. */
  heat?: number;
  /**
   * Fragments the casing breaks into (rounded up to even), at most 8: smaller, faster pieces amid the
   * blast gas are more than the gas step can follow. Default 6; 0 for none.
   */
  fragments?: number;
  /** Blast damage reaches this far, m. Default 2. */
  radius?: number;
  /** Strikes slower than this don't set it off, m/s. Default 5. */
  arm?: number;
  /** State: the body that loaded it (its gun), and whether it has left that gun's assembly. */
  from?: string;
  armed?: boolean;
  /** Set to make it go off at the next step whatever it touches (a lander's tank in a crash, LND-021). */
  trigger?: boolean;
}

/** Share of a charge's energy that drives the casing outward (the Gurney energy); the rest goes with the gas. */
export const GURNEY = 0.7;
const BLAST_PARCEL_RADIUS = 0.035;
export const MAX_FRAGMENTS = 8;
/** Blast gas waiting to come out (the step after its shell burst), moving with the shell. */
export interface Blast {
  position: Vec2;
  velocity: Vec2;
  mass: number;
  /** Its energy beyond its bulk motion (heat and spreading), J. */
  energy: number;
  angle: number;
  /** Where its parcels start, in the shell's frame, in opposite pairs. */
  spots: Vec2[];
}

/** Share of a held blast's energy that becomes the gas's outward motion; the rest is heat. */
const BLAST_SPREAD = 0.5;

/**
 * Releases blast gas held since last step: parcels at the shell's footprint (moved on with it), none
 * inside a body (pairs dropped), moving outward; the gas's energy is exact.
 */
export function releaseBlasts(world: World, dt: number): number {
  const blasts = world.blasts;
  if (!blasts?.length) return 0;
  world.blasts = [];
  for (const b of blasts) {
    const at = add(b.position, scale(b.velocity, dt));
    const q = sinCos(b.angle);
    const solid = (p: Vec2) => {
      const x = add(at, rotate(q, p));
      return world.bodies.some((o) => length(sub(o.position, x)) < massProps(o.shape, 1).boundingRadius + BLAST_PARCEL_RADIUS && near(o, x, BLAST_PARCEL_RADIUS));
    };
    const half = b.spots.length / 2;
    const free: Vec2[] = [];
    for (let k = 0; k < half; k++) if (!solid(b.spots[k]) && !solid(b.spots[k + half])) free.push(b.spots[k]);
    // At least one pair, a parcel's width either side of the centre.
    const pts = free.length ? [...free, ...free.map((p) => scale(p, -1))] : [{ x: BLAST_PARCEL_RADIUS, y: 0 }, { x: -BLAST_PARCEL_RADIUS, y: 0 }];
    const pm = b.mass / pts.length;
    const u = Math.sqrt((2 * BLAST_SPREAD * Math.max(0, b.energy)) / b.mass);
    const parcels: Parcel[] = pts.map((p) => {
      const d = length(p) > 1e-9 ? scale(rotate(q, p), 1 / length(p)) : { x: 1, y: 0 };
      return { id: world.gas.nextId++, mass: pm, composition: { co2: 1 }, position: add(at, rotate(q, p)), velocity: add(b.velocity, scale(d, u)), thermal: 0, radius: BLAST_PARCEL_RADIUS };
    });
    // Heat is what the held energy leaves after the parcels' motion (beyond the bulk motion it had).
    let ke = 0;
    for (const p of parcels) ke += 0.5 * p.mass * dot(p.velocity, p.velocity);
    const heat = b.energy + 0.5 * b.mass * dot(b.velocity, b.velocity) - ke;
    for (const p of parcels) p.thermal = heat / parcels.length;
    world.gas.parcels.push(...parcels);
  }
  return blasts.length;
}

/** A charge's chemical energy, J, in the world's gas scale. */
export const explosiveEnergy = (e: Explosive, scale = 1): number => (e.charge * (e.heat ?? 4.2e6)) / scale;

/** Arms shells that have cleared their gun, and detonates armed shells that struck something hard. Returns the shells that went off. */
export function detonate(world: World, roots: ReadonlyMap<string, string> | null, dt: number): string[] {
  const shells = world.bodies.filter((b) => b.explosive);
  if (!shells.length) return [];
  const byId = bodiesById(world);
  const reach = (b: Body) => massProps(b.shape, 1).boundingRadius;
  // Arm: no part of the gun's assembly within reach any more.
  for (const s of shells) {
    const e = s.explosive!;
    if (e.armed) continue;
    const gun = e.from ? byId.get(e.from) : undefined;
    const root = gun ? (roots?.get(gun.id) ?? gun.id) : undefined;
    const near = root !== undefined && world.bodies.some((o) => o !== s && (roots?.get(o.id) ?? o.id) === root && length(sub(o.position, s.position)) < reach(o) + reach(s) + 0.2);
    if (!near) e.armed = true;
  }
  // Strikes this step: armed shells with a contact whose impulse would change their speed by more than `arm`.
  const struck: Body[] = [];
  for (const s of shells) {
    const e = s.explosive!;
    if (!e.armed) continue;
    let J = 0;
    for (const c of world.contacts) if (c.a === s.id || c.b === s.id) J = Math.max(J, c.normalImpulse);
    if (e.trigger || J > (e.arm ?? 5) * bodyMass(s)) struck.push(s);
  }
  for (const s of struck) burst(world, s, dt);
  if (struck.length) breakWreckage(world);
  return struck.map((s) => s.id);
}

/** Points along the outline shrunk to `f` of its size, in opposite pairs about the centre (body frame). */
function ringPoints(b: Body, n: number, f: number): Vec2[] {
  const half: Vec2[] = [];
  if (b.shape.kind === "disc") {
    for (let k = 0; k < n / 2; k++) {
      const q = sinCos((Math.PI * k) / (n / 2));
      half.push({ x: q.c * b.shape.radius * f, y: q.s * b.shape.radius * f });
    }
  } else {
    // Walk the outline by arc length, half way round; the other half mirrors it.
    const vs = localVertices(b.shape).map((v) => scale(v, f));
    const edges = vs.map((v, i) => length(sub(vs[(i + 1) % vs.length], v)));
    const total = edges.reduce((a, x) => a + x, 0);
    for (let k = 0; k < n / 2; k++) {
      let t = ((k + 0.5) / n) * total;
      let i = 0;
      while (t > edges[i] && i < edges.length - 1) t -= edges[i++];
      const a = vs[i];
      const c = vs[(i + 1) % vs.length];
      half.push(add(a, scale(sub(c, a), t / edges[i])));
    }
  }
  return [...half, ...half.map((p) => scale(p, -1))];
}

/** Grid points inside the outline shrunk to `f`, at spacing `h`, in opposite pairs about the centre (body frame). */
function corePoints(b: Body, h: number, f: number): Vec2[] {
  const R = massProps(b.shape, 1).boundingRadius * f;
  const inside = (p: Vec2) => {
    if (b.shape.kind === "disc") return length(p) <= b.shape.radius * f;
    const vs = localVertices(b.shape).map((v) => scale(v, f));
    return vs.every((v, i) => {
      const w = vs[(i + 1) % vs.length];
      return (w.x - v.x) * (p.y - v.y) - (w.y - v.y) * (p.x - v.x) >= 0;
    });
  };
  const out: Vec2[] = [];
  const n = Math.floor(R / h);
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      // Half the grid (and not the centre); the other half mirrors it.
      if (i < 0 || (i === 0 && j <= 0)) continue;
      const p = { x: (i - 0.5 * Math.sign(i)) * h, y: (j - 0.5 * Math.sign(j)) * h };
      if (inside(p) && inside(scale(p, -1))) out.push(p);
    }
  return [...out, ...out.map((p) => scale(p, -1))];
}

function burst(world: World, s: Body, dt: number): void {
  const e = s.explosive!;
  const gs = world.gas.scale ?? 1;
  const E = explosiveEnergy(e, gs);
  const M = Math.max(0, s.mass - e.charge); // casing
  const q = sinCos(s.angle);
  const before = energyOf(s);
  // Remove the shell: what it was goes into fragments and gas below.
  world.bodies = world.bodies.filter((b) => b !== s);
  world.contacts = world.contacts.filter((c) => c.a !== s.id && c.b !== s.id);
  // Shrapnel: small squares along the outline, unless they would land inside something.
  let n = Math.min(MAX_FRAGMENTS, Math.max(0, Math.ceil((e.fragments ?? 6) / 2) * 2));
  const made: Body[] = [];
  if (n > 0 && M > 0) {
    const area = s.shape.kind === "disc" ? Math.PI * s.shape.radius ** 2 : polygonArea(localVertices(s.shape));
    // Small squares at the rim, leaving the middle for the blast gas.
    const side = Math.min(0.55 * Math.sqrt(area / n), (0.7 * 2 * Math.PI * massProps(s.shape, 1).boundingRadius * 0.85) / n);
    const pts = ringPoints(s, n, 0.85);
    n = pts.length;
    const m = M / n;
    pts.forEach((p, k) => {
      const at = add(s.position, rotate(q, p));
      const d = length(p) > 1e-9 ? scale(rotate(q, p), 1 / length(p)) : { x: 1, y: 0 };
      const frag: Body = {
        id: `${s.id}-f${k + 1}`,
        shape: { kind: "box", width: side, height: side },
        mass: m,
        fixed: false,
        restitution: 0.2,
        friction: 0.5,
        position: at,
        velocity: d, // direction for now; speed below
        angle: s.angle,
        angularVelocity: 0,
        integrity: 1,
      };
      made.push(frag);
    });
    // A fragment that would start inside another body (the one struck, say) isn't made; the casing
    // is shared among those that are.
    const placed = (b: Body) => ({ shape: b.shape, position: b.position, rot: sinCos(b.angle) });
    const kept: Body[] = [];
    for (let k = 0; k < made.length / 2; k++) {
      const pair = [made[k], made[k + made.length / 2]];
      if (pair.every((f) => !world.bodies.some((o) => collide(placed(f), placed(o), 0, 0)?.points.some((pt) => pt.separation < 0)))) kept.push(...pair);
    }
    made.length = 0;
    made.push(...kept.slice(0, kept.length / 2), ...kept.slice(kept.length / 2));
  }
  // The casing flies as fragments; the charge (and the casing, if no fragment could fly) is the blast gas.
  for (const f of made) {
    f.mass = M / made.length;
    world.bodies.push(f);
  }
  world.bodies.sort((a, b) => compareIds(a.id, b.id));
  // What it held (a lander's propellant, say) goes up with the charge: its mass joins the blast gas,
  // and the heat and chemical energy it stored become the blast's heat.
  const held = s.contents ?? [];
  const heldMass = held.reduce((m, st) => m + st.mass, 0);
  const heldEnergy = held.reduce((x, st) => x + storeThermal(st, gs) + storeChemical(st, gs), 0);
  const gasMass = (made.length ? s.mass - M : s.mass) + heldMass;
  // Fragments take GURNEY of E as outward motion. The gas step takes bodies as already moved this step
  // and rewinds them by their velocity (§9.4): put each fragment where it ends the step.
  const u = made.length ? Math.sqrt((2 * GURNEY * E) / M) : 0;
  for (const f of made) {
    f.velocity = add(s.velocity, scale(f.velocity, u));
    f.position = add(f.position, scale(f.velocity, dt));
  }
  // The blast gas comes out next step, once the fragments are clear of where it starts: gas pressed
  // against fragments flying apart is more than the gas step can follow. Until then it is held, moving
  // with the shell, with the rest of the energy (counted in the ledger).
  let fragmentKE = 0;
  for (const f of made) fragmentKE += energyOf(f);
  const blast: Blast = {
    position: s.position,
    velocity: s.velocity,
    mass: gasMass,
    energy: before + E + heldEnergy - fragmentKE - 0.5 * gasMass * dot(s.velocity, s.velocity),
    angle: s.angle,
    spots: corePoints(s, 2 * BLAST_PARCEL_RADIUS, 0.85),
  };
  (world.blasts ??= []).push(blast);
  world.events.push({ tick: world.tick, type: "detonation", data: { id: s.id, energy: E, fragments: made.length, gas: gasMass, x: s.position.x, y: s.position.y } });
  // Blast damage: a share of E to each damageable body near enough.
  const R = e.radius ?? 2;
  for (const b of world.bodies) {
    if (!b.material || made.includes(b)) continue;
    const r = massProps(b.shape, 1).boundingRadius;
    const dist = length(sub(b.position, s.position));
    const gap = Math.max(0, dist - r);
    if (gap >= R) continue;
    const view = Math.min(0.5, r / (Math.PI * Math.max(dist, r)));
    const at = dist > 1e-9 ? add(b.position, scale(sub(s.position, b.position), Math.min(1, r / dist))) : b.position;
    damageBody(world, b, E * view * (1 - gap / R), at);
  }
}

/** Is world point `p` inside body `o`, or within `r` of its outline? */
function near(o: Body, p: Vec2, r: number): boolean {
  if (o.shape.kind === "disc") return length(sub(p, o.position)) < o.shape.radius + r;
  const q = sinCos(o.angle);
  const vs = localVertices(o.shape).map((v) => add(o.position, rotate(q, v)));
  // Inside the outline grown by r: within r of every edge's inner side.
  return vs.every((v, i) => {
    const w = vs[(i + 1) % vs.length];
    const e = sub(w, v);
    const len = length(e);
    return ((e.x * (p.y - v.y) - e.y * (p.x - v.x)) / len) > -r;
  });
}

/** A body's kinetic energy, J. */
function energyOf(b: Body): number {
  const m = bodyMass(b);
  return 0.5 * m * dot(b.velocity, b.velocity) + 0.5 * massProps(b.shape, m).inertia * b.angularVelocity ** 2;
}
