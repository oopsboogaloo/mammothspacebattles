// Mammoth Thrust's power plant (docs/games/mammoth-thrust.md §3, Power; Chloe's drawings, 13
// November 2026). The plant powers the level's electric turrets along its power lines. A slug that
// hits it takes it offline for a while, longer for each hit while it is down; a slug in one of its
// domes also holes it, and the reactor's coolant vents through every hole (DMG-009) at a steady
// rate. With no coolant left it goes critical: a countdown, then it explodes. Where a power line
// crosses the open, two antennae carry the power across as a shock that takes a ship's controls away
// for a moment.

import { assemblyRoots } from "./joints.ts";
import { add, invRotate, length, rotate, sinCos, sub, type Vec2 } from "./math.ts";
import { localVertices } from "./shapes.ts";
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
}

export interface PlantState {
  /** Offline until this time, s (on before it). */
  offlineUntil: number;
  /** Slugs that have hit it, and the holes in its domes. */
  hits: number;
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
}

export const PLANT_BONUS = 2000;
/** A store holding less than one leak parcel can vent no more (damage.ts LEAK_PARCEL): the coolant is gone. */
const EMPTY = 0.002;
/** The most shells remembered as counted. */
const SEEN = 64;

export function startPlant(spec: PlantSpec): PlantState {
  return { offlineUntil: 0, hits: 0, holes: 0, seen: [], up: Object.fromEntries(spec.transmitters.map((t) => [t.id, true])) };
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
export function runPlant(world: World, spec: PlantSpec, s: PlantState, ship: string | null): PlantResult {
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
    // A slug in a dome holes it, where it struck: the coolant vents from there.
    const dome = domes.has(hit) ? world.bodies.find((x) => x.id === hit) : undefined;
    if (dome?.vents) {
      const touch = world.contacts.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
      const shellBody = world.bodies.find((x) => x.id === shell);
      const at = touch?.point ?? shellBody?.position ?? dome.position;
      const local = invRotate(sinCos(dome.angle), sub(at, dome.position));
      const d = length(local);
      dome.vents.holes.push({ point: local, normal: d > 1e-9 ? { x: local.x / d, y: local.y / d } : { x: 0, y: 1 }, credit: 0, count: 0 });
      s.holes += 1;
      changed = true;
    }
    world.events.push({ tick: world.tick, type: "plant.hit", data: { part: hit, hits: s.hits, holes: s.holes, until: s.offlineUntil } });
  }

  // Coolant gone: critical, then the explosion.
  if (s.critical === undefined && !s.blown && plantCoolant(world, spec) < EMPTY) {
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
    for (const l of world.links) if (l.off) delete l.off;
  }
  if (ship && s.shockUntil === undefined) {
    for (const t of spec.transmitters) {
      if (!powered(s, now, [t.id])) continue;
      const tips = transmitterTips(world, t);
      if (!tips) continue;
      const struck = world.bodies.some((b) => b.id.startsWith(ship) && !b.id.includes("-shell-") && toSegment(b.position, tips[0], tips[1]) < reach(b) + t.width / 2);
      if (!struck) continue;
      s.shockUntil = now + t.shock;
      for (const l of world.links) if (l.kind === "control" && l.to.startsWith(ship)) l.off = true;
      world.events.push({ tick: world.tick, type: "plant.shock", data: { id: t.id } });
      break;
    }
  }
  return { changed, blew };
}
