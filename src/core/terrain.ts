// Ground that can be cratered (TER-001…TER-005; docs/games/mammoth-thrust-design.md §11).
//
// The ground is one closed outline of the open space above and inside it (the sky and every cave
// joined to it), running clockwise, so the rock is on the left of the way it runs. The rock itself is
// a crust of fixed bodies along that outline on its rock side, as scripts/terrain.ts first made it.
//
// A crater is a disc of open space added to that. The open space is then the outline together with
// every crater, and its boundary is every stretch of the outline that lies outside all the craters,
// and every stretch of a crater's rim that lies in rock. Each such stretch gets its piece of crust.
// Nothing needs the boundary as one ordered loop, so tunnels, islands of rock and craters on craters
// all come out of the same rule. Behind any new surface the crust is made afresh, so the rock is as
// deep as anyone digs.

import { burst } from "./dust.ts";
import { cross, length, sinCos, sub, type Vec2 } from "./math.ts";
import { localVertices } from "./shapes.ts";
import type { Body, BodyInput, JointInput, World } from "./world.ts";

/** How the ground adds to the world: the world's own ways, handed in by the step. */
export interface TerrainOps {
  addBody(world: World, body: BodyInput): void;
  addJoint(world: World, joint: JointInput): void;
}

export interface TerrainSpec {
  /** The open space: a closed outline, clockwise, the rock on its left. */
  outline: Vec2[];
  /**
   * Islands of rock inside it (TER-007): each a closed outline running counter-clockwise, so its rock
   * is on its left too. An asteroid floating in the open is one.
   */
  islands?: Vec2[][];
  /** The rock bodies' ids start with this (default "rock-"). */
  prefix?: string;
  /**
   * What leaves a crater, and how big (TER-002, TER-003). An explosion leaves one of radius `blast`
   * × the reach of its blast (the charge's declared `radius`), no bigger than `most`, m; one that
   * would be smaller than `least` leaves none. A shell with no charge that strikes the rock is
   * spent, and leaves a crater of radius `bullet`, or none if that is 0. No more than `limit`
   * craters are kept, and of those no more than `small` under 1 m (the ground's bodies cost step
   * time). Absent: the ground can't be cratered.
   */
  craters?: { blast?: number; bullet?: number; least?: number; most?: number; limit?: number; small?: number };
}

/** A crater: a disc of open space, cut as a polygon of `n` sides turned by `turn`. */
export interface Crater {
  x: number;
  y: number;
  r: number;
  n: number;
  turn: number;
}

export interface Terrain {
  /** The outline, with its long stretches cut into pieces; and the islands', the same. */
  outline: Vec2[];
  islands?: Vec2[][];
  prefix: string;
  craters?: Required<NonNullable<TerrainSpec["craters"]>>;
  /** The craters so far, in the order they were made. */
  holes: Crater[];
  /**
   * A wrapped world's edges (FLT-012, TER-008): stretches of the outline that lie along them are
   * where the open space goes on round to the other side, not rock, so they get no crust.
   */
  edges?: { min: Vec2; max: Vec2 };
}

export const TERRAIN_DEFAULTS = { blast: 0.6, bullet: 0.5, least: 0.5, most: 8, limit: 250, small: 150 };
/** A crater under this radius is a small one, m. */
const SMALL = 1;
/** How deep the crust goes, m, and the longest piece of it (a long wall is cut up, so each piece has a small box). */
const CRUST = 15;
const LONGEST = 40;
/**
 * How deep the crust round a crater goes, m: enough that nothing gets through it (a shell moves
 * 0.6 m a step), and little enough that a new crater has few old ones' crust to make again.
 */
const RIM_CRUST = 4;
/** The thinnest a piece of crust is, m, and the shortest stretch of boundary that gets one. */
const THINNEST = 0.05;
const SHORTEST = 1e-3;

type Seg = [Vec2, Vec2];

const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The outline with every stretch longer than `longest` cut into equal pieces. */
function cut(outline: Vec2[], longest: number): Vec2[] {
  const out: Vec2[] = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const n = Math.max(1, Math.ceil(length(sub(b, a)) / longest));
    for (let k = 0; k < n; k++) out.push(lerp(a, b, k / n));
  });
  return out;
}

/** A crater's rim: a polygon of n sides, clockwise, so the rock is on its left as for the outline. */
function rim(h: Crater): Vec2[] {
  const out: Vec2[] = [];
  for (let k = 0; k < h.n; k++) {
    const q = sinCos(h.turn - (2 * Math.PI * k) / h.n);
    out.push({ x: h.x + h.r * q.c, y: h.y + h.r * q.s });
  }
  return out;
}

/** Whether p is strictly inside a clockwise convex polygon. */
function insideRim(vs: Vec2[], p: Vec2): boolean {
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % vs.length];
    if (cross(sub(b, a), sub(p, a)) > -1e-9) return false;
  }
  return true;
}

/** Every stretch of boundary the ground starts with: the outline's and each island's, in order. */
function segments(t: Terrain): Seg[] {
  const out: Seg[] = [];
  for (const loop of [t.outline, ...(t.islands ?? [])]) for (let i = 0; i < loop.length; i++) out.push([loop[i], loop[(i + 1) % loop.length]]);
  return out;
}

/** Whether p is in the ground's open space at the start: inside the outline and outside every island (even-odd over them all). */
function insideOpen(t: Terrain, p: Vec2): boolean {
  let inside = false;
  for (const loop of [t.outline, ...(t.islands ?? [])]) if (insideOutline(loop, p)) inside = !inside;
  return inside;
}

/** Whether p is inside a closed outline (even-odd). */
function insideOutline(outline: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

/** Where along p→q (0 to 1, ends excluded) it crosses a→b, or -1. */
function crossing(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(q, p);
  const e = sub(b, a);
  const den = cross(d, e);
  if (den === 0) return -1;
  const w = sub(a, p);
  const t = cross(w, e) / den;
  const u = cross(w, d) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1 ? t : -1;
}

/** How far it is from p along unit vector u to the nearest of the segments, or Infinity. */
function reach(p: Vec2, u: Vec2, segs: Seg[]): number {
  let best = Infinity;
  for (const [a, b] of segs) {
    const e = sub(b, a);
    const den = cross(u, e);
    if (den === 0) continue;
    const w = sub(a, p);
    const t = cross(w, e) / den;
    const k = cross(w, u) / den;
    if (t > 1e-6 && k >= 0 && k <= 1) best = Math.min(best, t);
  }
  return best;
}

/** How near point c is to segment a→b. */
function distance(c: Vec2, a: Vec2, b: Vec2): number {
  const e = sub(b, a);
  const L2 = e.x * e.x + e.y * e.y;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((c.x - a.x) * e.x + (c.y - a.y) * e.y) / L2)) : 0;
  return length(sub(c, lerp(a, b, t)));
}

/** What the rest of the code needs of the terrain's geometry near a place. */
interface Near {
  /** The outline's stretches and the craters' rims that could bound the rock there. */
  walls: Seg[];
  holes: { h: Crater; vs: Vec2[]; index: number }[];
}

function near(t: Terrain, at: Vec2, within: number): Near {
  const holes: Near["holes"] = [];
  t.holes.forEach((h, index) => {
    if (length(sub(at, h)) <= within + h.r) holes.push({ h, vs: rim(h), index });
  });
  const walls: Seg[] = [];
  for (const [a, b] of segments(t)) if (distance(at, a, b) <= within) walls.push([a, b]);
  for (const { vs } of holes) for (let e = 0; e < vs.length; e++) walls.push([vs[e], vs[(e + 1) % vs.length]]);
  return { walls, holes };
}

/**
 * The crust for one stretch a→b of boundary whose rock is on its left: a fixed quad on its rock
 * side, as deep as the crust goes, or less where the rock is thinner, so no crust reaches through
 * into open space.
 */
function crust(id: string, a: Vec2, b: Vec2, walls: Seg[], deepest: number, from?: Vec2): BodyInput | null {
  const L = length(sub(b, a));
  if (L < SHORTEST) return null;
  const u = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
  let depth = deepest;
  for (let k = 0; k <= 8; k++) depth = Math.min(depth, 0.98 * reach(lerp(a, b, k / 8), u, walls));
  // Rays miss what lies between them (a small crater under a long stretch). So also: every wall
  // that passes over this stretch, clear of it, limits the depth by its nearest point.
  const t = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  for (const [c, d] of walls) {
    let s0 = (c.x - a.x) * t.x + (c.y - a.y) * t.y;
    let s1 = (d.x - a.x) * t.x + (d.y - a.y) * t.y;
    let h0 = (c.x - a.x) * u.x + (c.y - a.y) * u.y;
    let h1 = (d.x - a.x) * u.x + (d.y - a.y) * u.y;
    // Round a crater the crust fans out past the stretch's ends, by up to a third of its depth.
    const side = from ? 0.35 * deepest : 0;
    if ((s0 < -side && s1 < -side) || (s0 > L + side && s1 > L + side)) continue;
    // The part of it over the stretch.
    if (s0 !== s1) {
      const clip = (s: number) => h0 + ((h1 - h0) * (s - s0)) / (s1 - s0);
      const lo = Math.max(-side, Math.min(s0, s1));
      const hi = Math.min(L + side, Math.max(s0, s1));
      [h0, h1] = [clip(lo), clip(hi)];
      [s0, s1] = [lo, hi];
    }
    // (One that touches this stretch, at an end where the two meet, is left to the rays.)
    if (h0 > 1e-3 && h1 > 1e-3) depth = Math.min(depth, 0.98 * Math.min(h0, h1));
  }
  depth = Math.max(depth, THINNEST);
  // Round a crater the crust fans out from its centre, so the pieces along its rim meet side to
  // side and leave no gaps at the rim's corners. Along the outline it goes straight in.
  const out = (p: Vec2): Vec2 => {
    if (!from) return { x: p.x + u.x * depth, y: p.y + u.y * depth };
    const d = sub(p, from);
    const n = length(d);
    return { x: p.x + (d.x / n) * depth, y: p.y + (d.y / n) * depth };
  };
  const vertices = [a, b, out(b), out(a)].map((v) => ({ x: round(v.x), y: round(v.y) }));
  return { id, fixed: true, mass: 1, friction: 0.9, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape: { kind: "polygon", vertices } } as BodyInput;
}

/**
 * The stretches of a→b that are boundary: it is cut wherever it crosses one of `cutters`, and each
 * piece is kept if `keep` says its middle is on the boundary.
 */
function pieces(a: Vec2, b: Vec2, cutters: Seg[], keep: (mid: Vec2) => boolean): Seg[] {
  const ts = [0, 1];
  for (const [c, d] of cutters) {
    const t = crossing(a, b, c, d);
    if (t >= 0) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: Seg[] = [];
  for (let k = 0; k + 1 < ts.length; k++) {
    if (ts[k + 1] - ts[k] < 1e-9) continue;
    if (keep(lerp(a, b, (ts[k] + ts[k + 1]) / 2))) out.push([lerp(a, b, ts[k]), lerp(a, b, ts[k + 1])]);
  }
  return out;
}

/** Whether stretch a→b lies along one of a wrapped world's edges. */
function onEdge(e: { min: Vec2; max: Vec2 }, a: Vec2, b: Vec2): boolean {
  const at = (u: number, v: number, k: number) => Math.abs(u - k) < 1e-6 && Math.abs(v - k) < 1e-6;
  return at(a.x, b.x, e.min.x) || at(a.x, b.x, e.max.x) || at(a.y, b.y, e.min.y) || at(a.y, b.y, e.max.y);
}

/** The crust along stretch i of the outline: what is left of it outside every crater. */
function outlineCrust(t: Terrain, i: number): BodyInput[] {
  const [a, b] = segments(t)[i];
  if (t.edges && onEdge(t.edges, a, b)) return [];
  const mid = lerp(a, b, 0.5);
  const n = near(t, mid, length(sub(b, a)) / 2 + CRUST + 1);
  const own = (s: Seg) => s[0] === a && s[1] === b;
  const rims = n.holes.flatMap(({ vs }) => vs.map((v, e): Seg => [v, vs[(e + 1) % vs.length]]));
  const kept = pieces(a, b, rims, (p) => !n.holes.some(({ vs }) => insideRim(vs, p)));
  const walls = n.walls.filter((s) => !own(s));
  return kept.map(([p, q], k) => crust(`${t.prefix}s${i}-${k}`, p, q, walls, CRUST)).filter((x): x is BodyInput => !!x);
}

/** The crust round crater c: the parts of its rim that lie in rock, outside the open space and every other crater. */
function craterCrust(t: Terrain, c: number): BodyInput[] {
  const h = t.holes[c];
  const n = near(t, h, h.r + RIM_CRUST + 1);
  const vs = n.holes.find((o) => o.index === c)!.vs;
  const others = n.holes.filter((o) => o.index !== c);
  const outline: Seg[] = segments(t).filter(([p, q]) => distance(h, p, q) <= h.r + 1e-6);
  const cutters: Seg[] = [...outline, ...others.flatMap(({ vs: o }) => o.map((v, e): Seg => [v, o[(e + 1) % o.length]]))];
  const out: BodyInput[] = [];
  for (let e = 0; e < vs.length; e++) {
    const a = vs[e];
    const b = vs[(e + 1) % vs.length];
    const kept = pieces(a, b, cutters, (p) => !insideOpen(t, p) && !others.some(({ vs: o }) => insideRim(o, p)));
    const walls = n.walls.filter((s) => !(s[0] === a && s[1] === b) && !vs.includes(s[0]));
    kept.forEach(([p, q], k) => {
      const body = crust(`${t.prefix}c${c}-${e}-${k}`, p, q, walls, RIM_CRUST, h);
      if (body) out.push(body);
    });
  }
  return out;
}

/** Takes rock bodies out of the world, with the contacts on them. */
function takeOut(world: World, gone: (b: Body) => boolean): void {
  const ids = new Set(world.bodies.filter(gone).map((b) => b.id));
  if (!ids.size) return;
  world.bodies = world.bodies.filter((b) => !ids.has(b.id));
  world.contacts = world.contacts.filter((c) => !ids.has(c.a) && !ids.has(c.b));
}

/** The ground at the start: the crust along the whole outline. */
export function startTerrain(world: World, spec: TerrainSpec, ops: TerrainOps): Terrain {
  const t: Terrain = {
    outline: cut(spec.outline, LONGEST).map((p) => ({ x: p.x, y: p.y })),
    ...(spec.islands?.length ? { islands: spec.islands.map((loop) => cut(loop, LONGEST).map((p) => ({ x: p.x, y: p.y }))) } : {}),
    prefix: spec.prefix ?? "rock-",
    ...(spec.craters ? { craters: { ...TERRAIN_DEFAULTS, ...spec.craters } } : {}),
    holes: [],
    ...(world.bounds.wrap ? { edges: { min: { ...world.bounds.min }, max: { ...world.bounds.max } } } : {}),
  };
  const n = segments(t).length;
  for (let i = 0; i < n; i++) for (const b of outlineCrust(t, i)) ops.addBody(world, b);
  return t;
}

/**
 * Cuts a crater of radius r at a point (TER-001): the rock inside it is gone, and the crust is made
 * afresh round it. Returns whether the ground changed: a crater wholly in open space, or inside one
 * already there, changes nothing and isn't kept. What stood on the rock it cut comes loose (TER-006):
 * `beforeLoose` is called once, just before the first thing does, for the ledger.
 */
export function cutCrater(world: World, at: Vec2, r: number, ops: TerrainOps, beforeLoose?: () => void): boolean {
  const addBody = ops.addBody;
  const t = world.terrain;
  if (!t?.craters || !(r > 0) || t.holes.length >= t.craters.limit) return false;
  if (r < SMALL && t.holes.filter((h) => h.r < SMALL).length >= t.craters.small) return false;
  if (t.holes.some((h) => length(sub(at, h)) + r <= 0.95 * h.r)) return false;
  const c = t.holes.length;
  const h: Crater = { x: at.x, y: at.y, r, n: r < 1 ? 8 : r < 3 ? 12 : 16, turn: 0.37 * (c + 1) };
  t.holes = [...t.holes, h];
  const fresh = craterCrust(t, c);
  // Which of what is there now it touches: the outline's stretches, and the craters, near enough for
  // their boundary or their crust's depth to change.
  const reach0 = r + CRUST + 1;
  const stretches: number[] = [];
  segments(t).forEach(([a, b], i) => {
    if (distance(h, a, b) <= reach0) stretches.push(i);
  });
  const craters: number[] = [];
  for (let k = 0; k < c; k++) if (length(sub(h, t.holes[k])) <= r + RIM_CRUST + 1 + t.holes[k].r) craters.push(k);
  // In open space already (or wholly inside other craters): none of its rim is in rock.
  if (!fresh.length) {
    t.holes = t.holes.slice(0, c);
    return false;
  }
  const mine = new Set<string>();
  for (const i of stretches) mine.add(`${t.prefix}s${i}-`);
  for (const k of craters) mine.add(`${t.prefix}c${k}-`);
  takeOut(world, (b) => b.fixed && b.id.startsWith(t.prefix) && [...mine].some((p) => b.id.startsWith(p)));
  for (const i of stretches) for (const b of outlineCrust(t, i)) addBody(world, b);
  for (const k of craters) for (const b of craterCrust(t, k)) addBody(world, b);
  for (const b of fresh) addBody(world, b);
  // The rock that was there leaves as dust (only drawn).
  burst(world, { id: `${t.prefix}dust-${c}`, shape: { kind: "disc", radius: r }, position: { x: at.x, y: at.y }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 } as Body);
  world.events.push({ tick: world.tick, type: "terrain.crater", data: { x: at.x, y: at.y, r, craters: t.holes.length } });
  loosen(world, h, ops, beforeLoose);
  return true;
}

/** How near a crater's edge must come to an anchored body's outline to count as cutting its footing, m. */
const FOOTING = 0.1;

/** How near point c is to a body's outline: 0 inside it. Discs by their radius. */
function gap(b: Body, c: Vec2): number {
  if (b.shape.kind === "disc") return Math.max(0, length(sub(c, b.position)) - b.shape.radius);
  const q = sinCos(b.angle);
  const vs = localVertices(b.shape).map((v) => ({ x: b.position.x + q.c * v.x - q.s * v.y, y: b.position.y + q.s * v.x + q.c * v.y }));
  let inside = true;
  let sign = 0;
  let best = Infinity;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const d = vs[(i + 1) % vs.length];
    best = Math.min(best, distance(c, a, d));
    const s = cross(sub(d, a), sub(c, a));
    if (s !== 0) {
      if (sign && Math.sign(s) !== sign) inside = false;
      sign = Math.sign(s);
    }
  }
  return inside ? 0 : best;
}

/**
 * What stood on the rock a crater cut comes loose (TER-006): every anchored fixed body whose outline
 * the crater reaches, and the others of its group, become free bodies of their declared mass, at
 * rest where they are. Their welds are kept, so what is built on them goes with them, and from
 * there the physics decides: a turret whose ground is half gone tips into the hole; one on a roof
 * falls. Those of a group are welded to the first of them.
 */
function loosen(world: World, h: Crater, ops: TerrainOps, before?: () => void): void {
  const cut = world.bodies.filter((b) => b.fixed && b.anchored && gap(b, h) <= h.r + FOOTING);
  if (!cut.length) return;
  const groups = new Set(cut.map((b) => b.anchored!.group).filter((g): g is string => g !== undefined));
  const loose = world.bodies.filter((b) => b.fixed && b.anchored && (cut.includes(b) || (b.anchored.group !== undefined && groups.has(b.anchored.group))));
  before?.();
  const ids = new Set(loose.map((b) => b.id));
  // Each is taken out and put back as a free body: the step keeps what it knows of fixed bodies by
  // the body itself, so a new one is the sure way to be seen as free.
  world.bodies = world.bodies.filter((b) => !ids.has(b.id));
  world.contacts = world.contacts.filter((c) => !ids.has(c.a) && !ids.has(c.b));
  const first = new Map<string, Body>();
  for (const b of loose) {
    const { anchored, ...rest } = b;
    ops.addBody(world, { ...rest, fixed: false, mass: anchored!.mass, velocity: { x: 0, y: 0 }, angularVelocity: 0 } as BodyInput);
    world.events.push({ tick: world.tick, type: "terrain.loose", data: { id: b.id, x: b.position.x, y: b.position.y } });
    const g = anchored!.group;
    if (g === undefined) continue;
    const head = first.get(g);
    if (!head) {
      first.set(g, b);
      continue;
    }
    // Welded to the first of its group, at the point half way between them.
    const mid = { x: (head.position.x + b.position.x) / 2, y: (head.position.y + b.position.y) / 2 };
    const local = (o: Body): Vec2 => {
      const q = sinCos(o.angle);
      const d = sub(mid, o.position);
      return { x: q.c * d.x + q.s * d.y, y: -q.s * d.x + q.c * d.y };
    };
    ops.addJoint(world, { id: `${head.id}+${b.id}`, a: head.id, b: b.id, anchorA: local(head), anchorB: local(b) });
  }
}

/** The radius of the crater an explosion leaves, m, from how far its blast reaches: 0 if it is too small to leave one. */
export function craterRadius(t: Terrain, reach: number): number {
  const c = t.craters;
  if (!c || !(reach > 0)) return 0;
  const r = c.blast * reach;
  return r < c.least ? 0 : Math.min(c.most, r);
}

/**
 * Runs the ground for one step, after everything has moved (TER-002, TER-003): a crater where each
 * of this step's explosions went off, and a small one where each solid shell struck the rock. The
 * shell is spent: it is taken out of the world. Returns whether a shell was (for the ledger);
 * `beforeSpent` is called once, just before the first is, so the ledger's totals need working out
 * only on the steps a shell leaves.
 */
export function runTerrain(world: World, ops: TerrainOps, beforeSpent?: () => void): boolean {
  const t = world.terrain;
  if (!t?.craters) return false;
  let spent = false;
  // The ledger's totals are worked out once, before the first thing that changes them: a shell
  // spent, or something that stood on the rock coming loose.
  const before = (): void => {
    if (!spent) beforeSpent?.();
    spent = true;
  };
  for (let i = world.events.length - 1; i >= 0 && world.events[i].tick >= world.tick; i--) {
    const e = world.events[i];
    if (e.tick !== world.tick) continue;
    if (e.type === "detonation") {
      cutCrater(world, { x: Number(e.data.x), y: Number(e.data.y) }, craterRadius(t, Number(e.data.radius)), ops, before);
    } else if (e.type === "collision") {
      const a = String(e.data.a);
      const b = String(e.data.b);
      const id = a.includes("-shell-") && b.startsWith(t.prefix) ? a : b.includes("-shell-") && a.startsWith(t.prefix) ? b : null;
      const shell = id ? world.bodies.find((x) => x.id === id) : undefined;
      // A shell with a charge goes off by itself, and its explosion makes the crater.
      if (!shell || shell.explosive) continue;
      // Where it touched the rock: the crater is a bowl in the surface there.
      const touch = world.contacts.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
      before();
      cutCrater(world, touch ? touch.point : shell.position, t.craters.bullet, ops, before);
      world.bodies = world.bodies.filter((x) => x !== shell);
      world.contacts = world.contacts.filter((c) => c.a !== shell.id && c.b !== shell.id);
    }
  }
  return spent;
}
