// Mammoth Thrust's power plant (docs/games/mammoth-thrust.md §3, Power; Chloe's drawings, 13
// November 2026). The plant powers the level's electric turrets along its power lines. A slug that
// hits it takes it offline for a while, longer for each hit while it is down; a slug in one of its
// domes also holes it, and the reactor's coolant vents through every hole (DMG-009) at a steady
// rate. With no coolant left it goes critical: a countdown, then it explodes. Where a power line
// crosses the open, two antennae carry the power across as a shock that takes a ship's controls away
// for a moment.

import { assemblyRoots } from "./joints.ts";
import { add, invRotate, length, rotate, sinCos, sub, type Vec2 } from "./math.ts";
import { createRng, nextFloat, type RngState } from "./prng.ts";
import { localVertices } from "./shapes.ts";
import type { Breach } from "./damage.ts";
import type { Body, World } from "./world.ts";

/** One side of a transmitter: an antenna fixed to the rock, the parts that must be on it, and its tip. */
export interface AntennaSpec {
  /** The fixed mount on the rock. */
  mount: string;
  /** The antenna's pieces: each must be whole and still on the mount. */
  parts: string[];
  /** Where the shock leaves it: a point on `tip.body`, in that body's frame. */
  tip: { body: string; at: Vec2 };
}

export interface TransmitterSpec {
  id: string;
  sides: [AntennaSpec, AntennaSpec];
  /** How wide the shock is, m: a ship part this near the line between the tips is shocked. */
  width: number;
  /** Game seconds a shocked ship has no control. */
  shock: number;
}

export interface PlantSpec {
  /** Every body of the plant: a slug on any of them takes it offline. */
  parts: string[];
  /** The domes: a slug in one also makes a hole, which vents the coolant (each has `vents`). */
  domes: string[];
  /** The body that holds the coolant (a gas store): the reactor. */
  core: string;
  /** The body whose explosive goes off when it blows (default the core). */
  charge?: string;
  /** The light on the plant's tower: green while it is on, red while it is off (drawn). */
  light: string;
  /** Game seconds offline after the first hit, and more for each hit while it is offline. */
  offline: { first: number; more: number };
  /** Game seconds from critical to the explosion. */
  countdown: number;
  /** The power lines, for drawing: lit while the plant is on and every transmitter they need is up. */
  lines: { points: Vec2[]; needs?: string[] }[];
  transmitters: TransmitterSpec[];
  /** The turrets it powers (their fire-control bodies), and the transmitters each needs. */
  turrets: { id: string; needs?: string[] }[];
  /** Points for leaving with the pod while it is critical (default 2000). */
  bonus?: number;
  /** Slugs in its domes per leak: the first opens a leak where it strikes, the rest make that leak bigger (default 3). */
  perLeak?: number;
  /** How fast a leak's gas leaves, m/s. */
  leakSpeed?: number;
  /** The most leaks one explosion punches in a dome at point-blank range; fewer further off, none past its reach (default 3). */
  blastLeaks?: number;
  /**
   * Below `below` of its coolant (a share), the power fails now and then for `last` game seconds
   * (a range), more often as the coolant falls: at none left, `rate` times a game second.
   */
  outages?: { below: number; rate: number; last: [number, number] };
  /** Seeds its outages. */
  seed?: number;
}

export interface PlantState {
  /** Offline until this time, s (on before it). */
  offlineUntil: number;
  /** Slugs that have hit it, slugs that have hit its domes, and the leaks in its domes. */
  hits: number;
  domeHits?: number;
  holes: number;
  /** The shells already counted (a shell's later contacts aren't new hits). */
  seen: string[];
  /** When it explodes, s, once it is critical; and whether it has. */
  critical?: number;
  blown?: boolean;
  /** The transmitters that carry power now. */
  up: Record<string, boolean>;
  /** The ship flying has no control until this time, s. */
  shockUntil?: number;
  /** Its outages' random numbers (deterministic: the same seed, the same outages). */
  rng?: RngState;
  /** The newest leak, which the next slugs make bigger: its dome and its place in the dome's holes. */
  leak?: { dome: string; index: number };
}

export const PLANT_BONUS = 2000;
/** A store holding less than one leak parcel can vent no more (damage.ts LEAK_PARCEL, or the vents' own): the coolant is gone. */
const EMPTY = 0.002;
/** The most shells remembered as counted. */
const SEEN = 64;

export function startPlant(spec: PlantSpec): PlantState {
  return { offlineUntil: 0, hits: 0, holes: 0, seen: [], up: Object.fromEntries(spec.transmitters.map((t) => [t.id, true])), rng: createRng(spec.seed ?? 1) };
}

/** A new leak of size 1 on a dome at a world point on (or near) its surface, pointing out from its centre. */
function addLeak(dome: Body, at: Vec2, speed: number | undefined): number {
  const local = invRotate(sinCos(dome.angle), sub(at, dome.position));
  const d = length(local);
  const hole: Breach = { point: local, normal: d > 1e-9 ? { x: local.x / d, y: local.y / d } : { x: 0, y: 1 }, credit: 0, count: 0, size: 1, ...(speed ? { speed } : {}) };
  dome.vents!.holes.push(hole);
  return dome.vents!.holes.length - 1;
}

/** The point of a body's outline nearest p, in the world. */
function nearestOnOutline(b: Body, p: Vec2): Vec2 {
  const q = sinCos(b.angle);
  const vs = localVertices(b.shape).map((v) => add(b.position, rotate(q, v)));
  let best = vs[0] ?? b.position;
  let bestD = Infinity;
  for (let k = 0; k < vs.length; k++) {
    const a = vs[k];
    const c = vs[(k + 1) % vs.length];
    const ab = sub(c, a);
    const L2 = ab.x * ab.x + ab.y * ab.y;
    const f = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2)) : 0;
    const on = add(a, { x: ab.x * f, y: ab.y * f });
    const d = length(sub(p, on));
    if (d < bestD) {
      bestD = d;
      best = on;
    }
  }
  return best;
}

/** Whether the plant is giving power now. */
export function plantOn(state: PlantState, now: number): boolean {
  return state.critical === undefined && !state.blown && now >= state.offlineUntil - 1e-9;
}

/** The coolant left in the reactor, kg. */
export function plantCoolant(world: World, spec: PlantSpec): number {
  const core = world.bodies.find((b) => b.id === spec.core);
  return (core?.contents ?? []).reduce((m, s) => m + s.mass, 0);
}

/** Whether a power line (or turret) with these needs has power now. */
export function powered(state: PlantState, now: number, needs: string[] | undefined): boolean {
  return plantOn(state, now) && (needs ?? []).every((id) => state.up[id]);
}

/** A transmitter's two tips, in the world, if both antennae are there. */
export function transmitterTips(world: World, t: TransmitterSpec): [Vec2, Vec2] | null {
  const tips: Vec2[] = [];
  for (const side of t.sides) {
    const b = world.bodies.find((x) => x.id === side.tip.body);
    if (!b) return null;
    tips.push(add(b.position, rotate(sinCos(b.angle), side.tip.at)));
  }
  return [tips[0], tips[1]];
}

/** Distance from p to the segment ab. */
function toSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const L2 = ab.x * ab.x + ab.y * ab.y;
  const k = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / L2)) : 0;
  return length(sub(p, add(a, { x: ab.x * k, y: ab.y * k })));
}

function reach(b: Body): number {
  if (b.shape.kind === "disc") return b.shape.radius;
  let r = 0;
  for (const v of localVertices(b.shape)) r = Math.max(r, length(v));
  return r;
}

const isPlayerShell = (id: string) => /^p\d+-.*-shell-/.test(id);

export interface PlantResult {
  changed: boolean;
  /** It exploded this step. */
  blew: boolean;
}

/**
 * Runs the plant for one step: hits and holes, the coolant, critical and the explosion, the
 * transmitters, the turrets' power, and the shock on the ship flying (prefix `p{n}-`, or null between
 * ships). Called by Mammoth Thrust's game each step.
 */
export function runPlant(world: World, spec: PlantSpec, s: PlantState, ship: string | null, dt: number): PlantResult {
  const now = world.time;
  let changed = false;
  let blew = false;
  const parts = new Set(spec.parts);
  const domes = new Set(spec.domes);

  // Hits: this step's new contacts between a player's slug and the plant.
  for (let i = world.events.length - 1; i >= 0 && world.events[i].tick >= world.tick; i--) {
    const e = world.events[i];
    if (e.type !== "collision" || e.tick !== world.tick) continue;
    const a = String(e.data.a);
    const b = String(e.data.b);
    const shell = isPlayerShell(a) && parts.has(b) ? a : isPlayerShell(b) && parts.has(a) ? b : null;
    if (!shell || s.seen.includes(shell)) continue;
    const hit = shell === a ? b : a;
    s.seen = [...s.seen, shell].slice(-SEEN);
    s.hits += 1;
    if (s.critical === undefined && !s.blown) {
      // Offline: the first hit for a while, each hit while it is down for a little longer.
      s.offlineUntil = now >= s.offlineUntil - 1e-9 ? now + spec.offline.first : s.offlineUntil + spec.offline.more;
    }
    // A slug in a dome: every `perLeak`th opens a new leak where it struck; the others make the
    // newest leak bigger. Each slug adds the same to the flow, wherever it lands.
    const dome = domes.has(hit) ? world.bodies.find((x) => x.id === hit) : undefined;
    const per = spec.perLeak ?? 3;
    const newest = s.leak ? world.bodies.find((x) => x.id === s.leak!.dome)?.vents?.holes[s.leak.index] : undefined;
    if (dome?.vents && newest && (s.domeHits ?? 0) % per !== 0) {
      newest.size = (newest.size ?? 1) + 1;
      s.domeHits = (s.domeHits ?? 0) + 1;
      changed = true;
    } else if (dome?.vents) {
      const touch = world.contacts.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
      const shellBody = world.bodies.find((x) => x.id === shell);
      const at = touch?.point ?? shellBody?.position ?? dome.position;
      s.leak = { dome: dome.id, index: addLeak(dome, at, spec.leakSpeed) };
      s.domeHits = (s.domeHits ?? 0) + 1;
      s.holes += 1;
      changed = true;
    }
    world.events.push({ tick: world.tick, type: "plant.hit", data: { part: hit, hits: s.hits, holes: s.holes, until: s.offlineUntil } });
  }

  // Explosions (Chloe, 13 November 2026): one that reaches a dome punches leaks in it, more the
  // nearer it went off (up to `blastLeaks` at point-blank range), spread round the side facing it,
  // and knocks the plant offline as a hit does.
  if (!s.blown) {
    for (let i = world.events.length - 1; i >= 0 && world.events[i].tick >= world.tick; i--) {
      const e = world.events[i];
      if (e.type !== "detonation" || e.tick !== world.tick || e.data.id === spec.charge) continue;
      const at = { x: Number(e.data.x), y: Number(e.data.y) };
      const reach = Number(e.data.radius);
      let struck = false;
      for (const id of spec.domes) {
        const dome = world.bodies.find((x) => x.id === id);
        if (!dome?.vents || !(reach > 0)) continue;
        const near = nearestOnOutline(dome, at);
        const d = length(sub(near, at));
        if (d >= reach) continue;
        const n = Math.max(1, Math.round((spec.blastLeaks ?? 3) * (1 - d / reach)));
        // Spread along the side facing the blast, a metre apart.
        const toward = d > 1e-9 ? { x: (near.x - at.x) / d, y: (near.y - at.y) / d } : { x: 0, y: -1 };
        const across = { x: -toward.y, y: toward.x };
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * 1;
          addLeak(dome, nearestOnOutline(dome, add(near, { x: across.x * off, y: across.y * off })), spec.leakSpeed);
          s.holes += 1;
        }
        struck = true;
        changed = true;
        world.events.push({ tick: world.tick, type: "plant.blast", data: { dome: id, leaks: n } });
      }
      if (struck && s.critical === undefined) s.offlineUntil = now >= s.offlineUntil - 1e-9 ? now + spec.offline.first : s.offlineUntil + spec.offline.more;
    }
  }

  // Outages (Chloe): below half its coolant, the power fails now and then, more often as it falls.
  const out = spec.outages;
  if (out && s.critical === undefined && !s.blown && plantOn(s, now)) {
    const core = world.bodies.find((b) => b.id === spec.core);
    const capacity = (core?.contents ?? []).reduce((m, c) => m + c.capacity, 0);
    const share = capacity > 0 ? plantCoolant(world, spec) / capacity : 1;
    if (share < out.below) {
      s.rng ??= createRng(spec.seed ?? 1);
      const chance = out.rate * ((out.below - share) / out.below) * dt;
      if (nextFloat(s.rng) < chance) {
        s.offlineUntil = now + out.last[0] + (out.last[1] - out.last[0]) * nextFloat(s.rng);
        world.events.push({ tick: world.tick, type: "plant.outage", data: { until: s.offlineUntil, share } });
      }
    }
  }

  // Coolant gone: critical, then the explosion.
  const parcel = Math.max(EMPTY, ...spec.domes.map((id) => world.bodies.find((x) => x.id === id)?.vents?.parcel ?? EMPTY));
  if (s.critical === undefined && !s.blown && plantCoolant(world, spec) < parcel) {
    s.critical = now + spec.countdown;
    world.events.push({ tick: world.tick, type: "plant.critical", data: { at: s.critical } });
  }
  if (s.critical !== undefined && !s.blown && now >= s.critical - 1e-9) {
    s.blown = true;
    blew = true;
    const charge = world.bodies.find((b) => b.id === (spec.charge ?? spec.core));
    if (charge) charge.integrity = 0;
    world.events.push({ tick: world.tick, type: "plant.blew", data: {} });
    changed = true;
  }

  // Transmitters: up while every piece of both antennae is whole and still on its mount.
  const roots = assemblyRoots(world);
  for (const t of spec.transmitters) {
    const up = t.sides.every((side) =>
      side.parts.every((id) => {
        const b = world.bodies.find((x) => x.id === id);
        return !!b && b.integrity > 0 && roots.get(id) === roots.get(side.mount);
      }),
    );
    if (up !== s.up[t.id]) {
      s.up = { ...s.up, [t.id]: up };
      world.events.push({ tick: world.tick, type: "plant.transmitter", data: { id: t.id, up } });
    }
  }

  // The turrets have power while the plant is on and their transmitters are up.
  for (const t of spec.turrets) {
    const c = world.bodies.find((b) => b.id === t.id);
    if (c?.turret) c.turret.powered = powered(s, now, t.needs);
  }

  // The shock: a ship part near a live transmitter's line loses the ship its control for a moment.
  if (s.shockUntil !== undefined && now >= s.shockUntil - 1e-9) {
    s.shockUntil = undefined;
    for (const l of world.links) if (l.off === "shock") delete l.off;
  }
  if (ship && s.shockUntil === undefined) {
    for (const t of spec.transmitters) {
      if (!powered(s, now, [t.id])) continue;
      const tips = transmitterTips(world, t);
      if (!tips) continue;
      const struck = world.bodies.some((b) => b.id.startsWith(ship) && !b.id.includes("-shell-") && toSegment(b.position, tips[0], tips[1]) < reach(b) + t.width / 2);
      if (!struck) continue;
      s.shockUntil = now + t.shock;
      for (const l of world.links) if (l.kind === "control" && l.to.startsWith(ship)) l.off = "shock";
      world.events.push({ tick: world.tick, type: "plant.shock", data: { id: t.id } });
      break;
    }
  }
  return { changed, blew };
}
