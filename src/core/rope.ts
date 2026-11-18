// Ropes (ROP-001…ROP-008; docs/games/moon-mammoth-design.md §9): a segmented rope between a body
// that holds it and a point on something it has caught. Moon Mammoth's grappling hook.
//
// A rope is a chain of light points a fixed distance apart, from its far end to the body holding
// it. Each step the points fall, are pulled back to within a stretch's length of their neighbours,
// and are pushed out of whatever they are in: so the rope hangs, drapes over things and wraps round
// corners. It can only pull. Its holder is then kept within the rope's length of its far end,
// measured along the rope as it lies, by taking away whatever of the holder's motion would stretch
// it. The rope is light: the holder moves it, and only the rope's length moves the holder.
//
// A rope is cast (its far end flies free, paying out), holds (its far end is on a body), or comes
// back (let go, or cast too far: it is reeled in fast, and is gone when all of it is in).
// The step records what a rope does to its holder under `tractor`.

import { collideDisc } from "./collide.ts";
import { add, powPos, rotate, sinCos, type Vec2 } from "./math.ts";
import { boundingRadiusOf } from "./shapes.ts";
import type { Body, World } from "./world.ts";

export interface Rope {
  id: string;
  /** The body at its near end: the one that cast it. */
  holder: string;
  /** Cast: its far end flying free. Held: its far end on a body. Back: coming in. */
  mode: "cast" | "held" | "back";
  /** Held: what its far end is on, and where on it, in that body's own frame. */
  anchor?: { body: string; local: Vec2 };
  /**
   * Its points, from the far end (the first) toward the holder, and their velocities. Cast, there
   * is one: the far end. Held, the first is on the anchor.
   */
  points: Vec2[];
  velocities: Vec2[];
  /** The length of a stretch between two points, m, and of the last one, between the last point and the holder. */
  stretch: number;
  last: number;
  /** A point's radius against what it touches, m. */
  radius: number;
  /** The longest it reaches, cast or paid out, m; and the shortest it reels in to, held. */
  range: number;
  least: number;
  /** Held: how fast it is being paid out (above 0) or reeled in (below), m/s. */
  reel: number;
  /** How fast it comes back, m/s. */
  retract: number;
  /** Steps left for which it counts as pulled tight: it was holding its holder back this step or a few before. */
  taut?: number;
  /** Ids it passes through, beside its holder: bodies whose id starts with one of these. */
  ignores?: string[];
}

/** What a rope is cast with. */
export interface RopeSpec {
  /** How fast its far end leaves, m/s, and how far it reaches, m. */
  speed: number;
  range: number;
  /** The length of a stretch, m (default 0.5), and a point's radius (default 0.08). */
  stretch?: number;
  radius?: number;
  /** The shortest it reels in to, m (default 1.5), and how fast it comes back, m/s (default 120). */
  least?: number;
  retract?: number;
}

/** How many times a step the rope's stretches and touches are put right. */
const PASSES = 12;
/** The share of a point's speed it keeps over a second: the rope loses its wriggle, not its swing. */
const KEEP = 0.2;
/** A rope that held its holder back counts as pulled tight for this many steps after. */
const TAUT = 12;
/** A cast end moves no further than this between tests for a hit, m: it is small and fast. */
const SWEEP = 0.2;
/** The holder held back by more than this, m, is caught on something: the rope isn't reeled in against it. */
const STUCK = 0.3;

/** The rope's length as it is: every stretch and the last. */
export const ropeLength = (r: Rope): number => (r.points.length - 1) * r.stretch + r.last;

/** Where the rope's far end is. */
export const ropeEnd = (r: Rope): Vec2 => r.points[0];

/** The pull of gravity at a point: the uniform field and every source (FLT-011, FLT-015), m/s². */
export function gravityAt(world: World, p: Vec2): Vec2 {
  let ax = world.gravity.x;
  let ay = world.gravity.y;
  for (const s of world.bodies) {
    const g = s.gravity;
    if (!g || !(g.mu > 0)) continue;
    const dx = s.position.x - p.x;
    const dy = s.position.y - p.y;
    const r2 = dx * dx + dy * dy + (g.radius ? 0 : g.core * g.core);
    const r3 = r2 * Math.sqrt(r2);
    const ball3 = g.radius ? g.radius * g.radius * g.radius : 0;
    const k = g.mu / (ball3 > r3 ? ball3 : r3);
    ax += k * dx;
    ay += k * dy;
  }
  return { x: ax, y: ay };
}

/** Casts a rope from a body: its far end leaves the body's centre along `dir` (a unit vector) at the spec's speed, on top of the body's own. */
export function castRope(world: World, id: string, holder: Body, dir: Vec2, spec: RopeSpec, ignores?: string[]): Rope {
  const rope: Rope = {
    id,
    holder: holder.id,
    mode: "cast",
    points: [{ ...holder.position }],
    velocities: [{ x: holder.velocity.x + dir.x * spec.speed, y: holder.velocity.y + dir.y * spec.speed }],
    stretch: spec.stretch ?? 0.5 * (world.units?.length ?? 1),
    last: 0,
    radius: spec.radius ?? 0.08 * (world.units?.length ?? 1),
    range: spec.range,
    least: spec.least ?? 1.5 * (world.units?.length ?? 1),
    reel: 0,
    retract: spec.retract ?? 120 * (world.units?.length ?? 1),
    ...(ignores?.length ? { ignores: [...ignores] } : {}),
  };
  world.ropes = [...(world.ropes ?? []), rope];
  return rope;
}

/** Lets a rope go: it comes back to its holder and is gone (ROP-006). */
export function releaseRope(rope: Rope): void {
  if (rope.mode === "back") return;
  rope.mode = "back";
  delete rope.anchor;
  rope.reel = 0;
}

/** The length of (x, y), by the pinned square root. */
const far = (x: number, y: number): number => Math.sqrt(x * x + y * y);

const passes = (r: Rope, b: Body): boolean => b.id === r.holder || !!r.ignores?.some((p) => b.id.startsWith(p));

/** The bodies a rope could touch this step: those near the box round its points and its holder. */
function near(world: World, r: Rope, holder: Body, reach: number): Body[] {
  let x0 = holder.position.x;
  let x1 = x0;
  let y0 = holder.position.y;
  let y1 = y0;
  for (const p of r.points) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  const out: Body[] = [];
  for (const b of world.bodies) {
    if (passes(r, b)) continue;
    const k = boundingRadiusOf(b.shape) + reach;
    if (b.position.x < x0 - k || b.position.x > x1 + k || b.position.y < y0 - k || b.position.y > y1 + k) continue;
    out.push(b);
  }
  return out;
}

const placed = (b: Body) => ({ shape: b.shape, position: b.position, rot: sinCos(b.angle) });

/** Pushes a point out of whatever of `bodies` it is in. Returns the body it touched last, if any. */
function pushOut(p: Vec2, radius: number, bodies: { shape: Body["shape"]; position: Vec2; rot: { c: number; s: number } }[], from: Body[]): Body | null {
  let hit: Body | null = null;
  const disc = { shape: { kind: "disc" as const, radius }, position: p, rot: { c: 1, s: 0 } };
  for (let k = 0; k < bodies.length; k++) {
    const b = bodies[k];
    const reach = boundingRadiusOf(b.shape) + radius;
    const dx = b.position.x - p.x;
    const dy = b.position.y - p.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    const m = collideDisc(disc, b, 0);
    if (!m) continue;
    let deepest = 0;
    for (const q of m.points) if (q.separation < deepest) deepest = q.separation;
    if (deepest >= 0) continue;
    // The normal runs from the point to the body: back along it by how far in it is.
    p.x += m.normal.x * deepest;
    p.y += m.normal.y * deepest;
    hit = from[k];
  }
  return hit;
}

/** Brings b to within `most` of a. `share` is how much of the move a takes (0: only b moves). */
function pull(a: Vec2, b: Vec2, most: number, share: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d <= most || d === 0) return;
  const k = (d - most) / d;
  a.x += dx * k * share;
  a.y += dy * k * share;
  b.x -= dx * k * (1 - share);
  b.y -= dy * k * (1 - share);
}

/** Sets the points out again along the line they lie on (from the first, through each, to `end`), a stretch apart. The first stays. */
function setOut(pts: Vec2[], end: Vec2, stretch: number): void {
  const line = [...pts.map((p) => ({ x: p.x, y: p.y })), end];
  let k = 0;
  let from = 0;
  let piece = far(line[1].x - line[0].x, line[1].y - line[0].y);
  for (let i = 1; i < pts.length; i++) {
    const at = i * stretch;
    while (k + 2 < line.length && from + piece < at) {
      from += piece;
      k++;
      piece = far(line[k + 1].x - line[k].x, line[k + 1].y - line[k].y);
    }
    const t = piece > 0 ? Math.min(1, (at - from) / piece) : 0;
    pts[i].x = line[k].x + (line[k + 1].x - line[k].x) * t;
    pts[i].y = line[k].y + (line[k + 1].y - line[k].y) * t;
  }
}

/** A cast rope's far end flies on, and catches the first thing it hits (ROP-002, ROP-003). */
function stepCast(world: World, r: Rope, holder: Body, dt: number): void {
  const p = r.points[0];
  const v = r.velocities[0];
  const g = gravityAt(world, p);
  v.x += g.x * dt;
  v.y += g.y * dt;
  const speed = Math.sqrt(v.x * v.x + v.y * v.y);
  const n = Math.max(1, Math.ceil((speed * dt) / (SWEEP * (world.units?.length ?? 1))));
  const bodies = near(world, r, holder, speed * dt + r.radius);
  const shapes = bodies.map(placed);
  for (let k = 0; k < n; k++) {
    p.x += (v.x * dt) / n;
    p.y += (v.y * dt) / n;
    const hit = pushOut(p, r.radius, shapes, bodies);
    if (hit) return catchOn(r, holder, hit);
    const dx = p.x - holder.position.x;
    const dy = p.y - holder.position.y;
    if (dx * dx + dy * dy > r.range * r.range) {
      // Cast too far: it comes back from where it got to.
      r.last = Math.sqrt(dx * dx + dy * dy);
      return releaseRope(r);
    }
  }
}

/** The far end has hit a body: the rope holds there, laid straight from it to the holder. */
function catchOn(r: Rope, holder: Body, on: Body): void {
  const end = r.points[0];
  const q = sinCos(on.angle);
  const d = { x: end.x - on.position.x, y: end.y - on.position.y };
  r.anchor = { body: on.id, local: { x: q.c * d.x + q.s * d.y, y: -q.s * d.x + q.c * d.y } };
  r.mode = "held";
  const dx = holder.position.x - end.x;
  const dy = holder.position.y - end.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const n = Math.max(1, Math.ceil(length / r.stretch));
  r.points = [];
  r.velocities = [];
  for (let i = 0; i < n; i++) {
    const t = length > 0 ? (i * r.stretch) / length : 0;
    r.points.push({ x: end.x + dx * t, y: end.y + dy * t });
    r.velocities.push({ x: 0, y: 0 });
  }
  r.last = length - (n - 1) * r.stretch;
}

/**
 * A held rope, or one coming back: its points fall and are put right, and (held) its holder is kept
 * within its length (ROP-001, ROP-004…ROP-006). Returns false when a rope coming back is all in.
 */
function stepChain(world: World, r: Rope, holder: Body, dt: number): boolean {
  let pin: Vec2 | null = null;
  if (r.mode === "held") {
    const on = world.bodies.find((b) => b.id === r.anchor!.body);
    // What it was on is gone (destroyed): it lets go.
    if (!on) releaseRope(r);
    else pin = add(on.position, rotate(sinCos(on.angle), r.anchor!.local));
  }
  const held = r.mode === "held";
  const pts = r.points;
  const n = pts.length;
  const keep = powPos(KEEP, dt);
  // Where each point would be, left to itself.
  const next: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const v = r.velocities[i];
    const g = gravityAt(world, pts[i]);
    next.push({ x: pts[i].x + (v.x * keep + g.x * dt) * dt, y: pts[i].y + (v.y * keep + g.y * dt) * dt });
  }
  // The holder, where it would be this step (its moves and gravity are already in its velocity).
  const h = { x: holder.position.x + holder.velocity.x * dt, y: holder.position.y + holder.velocity.y * dt };
  const taut = !!pin && (r.taut ?? 0) > 0;
  const bodies = near(world, r, holder, 2 * r.stretch);
  const shapes = bodies.map(placed);
  for (let pass = 0; pass < PASSES; pass++) {
    if (pin) {
      next[0].x = pin.x;
      next[0].y = pin.y;
    }
    // Out from the far end, each point to within a stretch of the one before; then back from the
    // holder, each to within a stretch of the one after. The holder is heavy and the rope light:
    // the points come to the holder, not the holder to them. A rope pulled tight between the two
    // comes straight in a pass or two this way, so the holder is then held along a straight line.
    for (let i = 1; i < n; i++) pull(next[i - 1], next[i], r.stretch, 0);
    if (n > 1 || !pin) pull(next[n - 1], h, r.last, 1);
    for (let i = n - 1; i > (pin ? 1 : 0); i--) pull(next[i - 1], next[i], r.stretch, 1);
    // Pulled tight, a rope is straight but where something is in its way: each point goes halfway
    // to the middle of its neighbours (and is then pushed back out of what it is in). Without this
    // the points' own weight bows a rope that is holding its holder, and it holds it askew.
    if (taut)
      for (let i = 1; i < n; i++) {
        const a = next[i - 1];
        const b = i + 1 < n ? next[i + 1] : h;
        next[i].x += 0.5 * ((a.x + b.x) / 2 - next[i].x);
        next[i].y += 0.5 * ((a.y + b.y) / 2 - next[i].y);
      }
    for (let i = pin ? 1 : 0; i < n; i++) pushOut(next[i], r.radius, shapes, bodies);
  }
  // The holder is kept within the rope's length of its far end, along the rope as it lies: the
  // length of the line from the far end through every point to the holder. What of the holder's
  // motion would make that longer than the rope is taken away, along the rope's last stretch. The
  // points are then set out again along that line, a stretch apart.
  let pulled = 0;
  if (pin && !holder.fixed) {
    next[0].x = pin.x;
    next[0].y = pin.y;
    let path = 0;
    for (let i = 1; i < n; i++) path += far(next[i].x - next[i - 1].x, next[i].y - next[i - 1].y);
    const over = path + far(h.x - next[n - 1].x, h.y - next[n - 1].y) - ropeLength(r);
    if (over > 0) {
      // Back along the rope's last stretch: from the last point that isn't on top of the holder
      // (the last stretch may have no length, the rope a whole number of stretches long).
      let j = n - 1;
      while (j > 0 && far(h.x - next[j].x, h.y - next[j].y) < 0.1 * r.stretch) j--;
      const dx = h.x - next[j].x;
      const dy = h.y - next[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0) {
        pulled = Math.min(over, d);
        const k = pulled / d;
        holder.velocity = { x: holder.velocity.x - (dx * k) / dt, y: holder.velocity.y - (dy * k) / dt };
        setOut(next, { x: h.x - dx * k, y: h.y - dy * k }, r.stretch);
      }
    }
  }
  r.taut = pulled > 0 ? TAUT : Math.max(0, (r.taut ?? 0) - 1);
  for (let i = 0; i < n; i++) {
    r.velocities[i] = { x: (next[i].x - pts[i].x) / dt, y: (next[i].y - pts[i].y) / dt };
    pts[i] = next[i];
  }
  // Reeling: the last stretch grows or shrinks, and a point is added or taken as it passes a stretch's length.
  const rate = held ? r.reel : -r.retract;
  if (rate !== 0 && !(rate < 0 && held && pulled > STUCK * (world.units?.length ?? 1))) {
    let length = ropeLength(r) + rate * dt;
    if (held) length = Math.min(r.range, Math.max(r.least, length));
    r.last = length - (r.points.length - 1) * r.stretch;
    while (r.last < 0 && r.points.length > 1) {
      r.points.pop();
      r.velocities.pop();
      r.last += r.stretch;
    }
    while (r.last > r.stretch) {
      // A new point, a stretch on from the last toward the holder.
      const a = r.points[r.points.length - 1];
      const dx = holder.position.x - a.x;
      const dy = holder.position.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const k = Math.min(1, r.stretch / d);
      r.points.push({ x: a.x + dx * k, y: a.y + dy * k });
      r.velocities.push({ ...holder.velocity });
      r.last -= r.stretch;
    }
    if (!held && r.last <= 0) return false;
  }
  return true;
}

/**
 * Every rope's step (ROP-001…ROP-006): after gravity and the holder's own moves, before the
 * contacts. A rope whose holder is gone, or that has come all the way back, leaves the world.
 */
export function stepRopes(world: World, dt: number): void {
  const ropes = world.ropes;
  if (!ropes?.length) return;
  const kept: Rope[] = [];
  for (const r of ropes) {
    const holder = world.bodies.find((b) => b.id === r.holder);
    if (!holder) continue;
    if (r.mode === "cast") {
      stepCast(world, r, holder, dt);
      kept.push(r);
    } else if (stepChain(world, r, holder, dt)) kept.push(r);
  }
  world.ropes = kept;
}
