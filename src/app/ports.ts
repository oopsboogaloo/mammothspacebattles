// Attachment ports and placement for the Attach tool (SBX-014). No DOM.
import {
  add,
  assemblyRoots,
  collide,
  cross,
  dot,
  length,
  localVertices,
  normalizeBody,
  rotate,
  sinCos,
  sub,
  type Body,
  type BodyInput,
  type Command,
  type Shape,
  type Vec2,
  type World,
} from "../core/index.ts";

export interface Port {
  index: number;
  local: Vec2; // body-local point on the surface, m
  normal: Vec2; // outward unit normal, body-local
}

/** Spacing of extra ports along a long face, and how close to a corner one may sit, m (SBX-024). */
const PORT_SPACING = 1;
const PORT_CORNER_CLEARANCE = 0.25;

/**
 * Ports: four rim points for discs. For boxes and polygons, each face's midpoint, plus a port every
 * metre out from it while at least 0.25 m from the corners, so a 3 m wing has ports at −1, 0 and +1 m.
 */
export function ports(shape: Shape): Port[] {
  if (shape.kind === "disc") {
    const r = shape.radius;
    return [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ].map((n, index) => ({ index, local: { x: n.x * r, y: n.y * r }, normal: n }));
  }
  const vs = localVertices(shape);
  const out: Port[] = [];
  vs.forEach((v, i) => {
    const w = vs[(i + 1) % vs.length];
    const e = sub(w, v);
    const l = length(e);
    const u = { x: e.x / l, y: e.y / l };
    const normal = { x: u.y, y: -u.x };
    const mid = { x: (v.x + w.x) / 2, y: (v.y + w.y) / 2 };
    // Offsets from the midpoint, in face order: …, −1, 0, +1, …
    const reach = Math.floor((l / 2 - PORT_CORNER_CLEARANCE) / PORT_SPACING + 1e-9);
    for (let k = -Math.max(0, reach); k <= Math.max(0, reach); k++) {
      out.push({ index: out.length, local: { x: mid.x + u.x * k * PORT_SPACING, y: mid.y + u.y * k * PORT_SPACING }, normal });
    }
  });
  return out;
}

export const worldPort = (b: Body, p: Port) => {
  const q = sinCos(b.angle);
  return { point: add(b.position, rotate(q, p.local)), normal: rotate(q, p.normal) };
};

/** Ports already holding a joint. */
export function usedPorts(world: World, id: string): Set<number> {
  const b = world.bodies.find((x) => x.id === id);
  const used = new Set<number>();
  if (!b) return used;
  const ps = ports(b.shape);
  for (const j of world.joints) {
    const anchor = j.a === id ? j.anchorA : j.b === id ? j.anchorB : null;
    if (!anchor) continue;
    for (const p of ps) if (length(sub(p.local, anchor)) < 1e-6) used.add(p.index);
  }
  return used;
}

export interface Placement {
  target: string;
  targetPort: Port;
  partPort: Port;
  position: Vec2;
  angle: number;
  valid: boolean;
  reason: string;
  /** The joint's anchors, in target and part local coordinates. */
  anchorTarget: Vec2;
  anchorPart: Vec2;
}

/** The port on the nearest body within `reach` of `p`, ignoring `exclude`. */
export function nearestPort(world: World, p: Vec2, reach: number, exclude?: string): { body: Body; port: Port } | null {
  let best: { body: Body; port: Port; d: number } | null = null;
  for (const b of world.bodies) {
    if (b.id === exclude) continue;
    for (const port of ports(b.shape)) {
      const d = length(sub(worldPort(b, port).point, p));
      if (d < reach && (!best || d < best.d)) best = { body: b, port, d };
    }
  }
  return best && { body: best.body, port: best.port };
}

/**
 * Where a part goes when its port meets a target port: flush, facing outward.
 * The part port used is the one whose normal best faces the target port, so a
 * box joins by a face rather than a corner.
 */
export function place(world: World, part: { id: string; shape: Shape }, target: Body, targetPort: Port, slop: number): Placement {
  const tp = worldPort(target, targetPort);
  const tAngle = Math.atan2(tp.normal.y, tp.normal.x);
  // Prefer the part port that keeps the part upright relative to the target (smallest rotation).
  // Among ports on that face (a long face has several), the one nearest the part's centre, so a wing hangs centred.
  let best: { port: Port; angle: number; turn: number; off: number } | null = null;
  for (const port of ports(part.shape)) {
    const angle = tAngle + Math.PI - Math.atan2(port.normal.y, port.normal.x);
    const turn = Math.abs(Math.atan2(Math.sin(angle - target.angle), Math.cos(angle - target.angle)));
    const off = length(port.local);
    if (!best || turn < best.turn - 1e-9 || (turn < best.turn + 1e-9 && off < best.off - 1e-9)) best = { port, angle, turn, off };
  }
  // Same orientation, but within half a turn of the target's angle (so 0°, not 360°).
  const angle = target.angle + Math.atan2(Math.sin(best!.angle - target.angle), Math.cos(best!.angle - target.angle));
  const position = sub(tp.point, rotate(sinCos(angle), best!.port.local));
  const result: Placement = {
    target: target.id,
    targetPort,
    partPort: best!.port,
    position,
    angle,
    valid: true,
    reason: `Valid: ${target.id} port ${targetPort.index + 1}`,
    anchorTarget: targetPort.local,
    anchorPart: best!.port.local,
  };
  if (usedPorts(world, target.id).has(targetPort.index)) return { ...result, valid: false, reason: `Blocked: that port on ${target.id} already holds a joint` };
  const ghost = { shape: part.shape, position, rot: sinCos(angle) };
  for (const b of world.bodies) {
    if (b.id === part.id) continue;
    const m = collide(ghost, { shape: b.shape, position: b.position, rot: sinCos(b.angle) }, 0, slop);
    const overlap = m ? -Math.min(...m.points.map((pt) => pt.separation)) : 0;
    // The target face touches by design; anything deeper than the slop is an overlap.
    if (overlap > 4 * slop) return { ...result, valid: false, reason: `Blocked: would overlap ${b.id} by ${(overlap * 100).toFixed(1)} cm` };
  }
  return result;
}

/** Commands that attach `part` (new if `isNew`) at `pl`, with velocity matching the target's motion there. */
export function attachCommands(world: World, part: BodyInput, pl: Placement, jointId: string, isNew: boolean): Command[] {
  const target = world.bodies.find((b) => b.id === pl.target)!;
  const r = sub(pl.position, target.position);
  const velocity = add(target.velocity, { x: -target.angularVelocity * r.y, y: target.angularVelocity * r.x });
  const motion = { position: pl.position, angle: pl.angle, velocity, angularVelocity: target.angularVelocity };
  const cmds: Command[] = isNew ? [{ type: "body.add", body: { ...part, ...motion } }] : [{ type: "body.set", id: part.id, patch: motion }];
  cmds.push({ type: "joint.add", joint: { id: jointId, a: pl.target, b: part.id, anchorA: pl.anchorTarget, anchorB: pl.anchorPart } });
  return cmds;
}

/** Bodies in the same assembly as `id`. */
export function assemblyIds(world: World, id: string): string[] {
  const roots = assemblyRoots(world);
  const root = roots.get(id);
  return world.bodies.filter((b) => roots.get(b.id) === root).map((b) => b.id);
}

/** A saved assembly, relative to its first body, for prefabs (SBX-021). */
export interface Prefab {
  name: string;
  bodies: BodyInput[];
  joints: { id: string; a: string; b: string; anchorA: Vec2; anchorB: Vec2; limits?: Record<string, number> }[];
}

export function makePrefab(world: World, id: string, name: string): Prefab {
  const ids = new Set(assemblyIds(world, id));
  const bodies = world.bodies.filter((b) => ids.has(b.id));
  const origin = bodies[0].position;
  return {
    name,
    bodies: bodies.map((b) => ({ ...structuredClone(b), position: sub(b.position, origin), velocity: { x: 0, y: 0 }, angularVelocity: 0 })),
    joints: world.joints.filter((j) => ids.has(j.a) && ids.has(j.b)).map((j) => ({ id: j.id, a: j.a, b: j.b, anchorA: j.anchorA, anchorB: j.anchorB, limits: { ...j.limits } })),
  };
}

/** Commands that spawn a copy of a prefab at `at`, with fresh ids from `fresh`. */
export function prefabCommands(prefab: Prefab, at: Vec2, fresh: (base: string) => string): Command[] {
  const ids = new Map(prefab.bodies.map((b) => [b.id, fresh(b.id.replace(/-\d+$/, ""))]));
  const cmds: Command[] = prefab.bodies.map((b) => ({ type: "body.add", body: { ...structuredClone(b), id: ids.get(b.id)!, position: add(b.position, at) } }));
  for (const j of prefab.joints) cmds.push({ type: "joint.add", joint: { id: fresh("joint"), a: ids.get(j.a)!, b: ids.get(j.b)!, anchorA: j.anchorA, anchorB: j.anchorB, limits: j.limits } });
  return cmds;
}

/**
 * Commands that attach a whole prefab at `pl`, a placement worked out for its mount body: every
 * body keeps its offset from the mount, turned with it, and moves with the target. Returns the
 * mount's new id.
 */
export function attachPrefabCommands(world: World, prefab: Prefab & { mount: string }, pl: Placement, fresh: (base: string) => string): { commands: Command[]; mountId: string } {
  const target = world.bodies.find((b) => b.id === pl.target)!;
  const mount = prefab.bodies.find((b) => b.id === prefab.mount)!;
  const q = sinCos(pl.angle);
  const ids = new Map(prefab.bodies.map((b) => [b.id, fresh(b.id.replace(/-\d+$/, ""))]));
  const commands: Command[] = prefab.bodies.map((b) => {
    const position = add(pl.position, rotate(q, sub(b.position, mount.position)));
    const r = sub(position, target.position);
    const velocity = add(target.velocity, { x: -target.angularVelocity * r.y, y: target.angularVelocity * r.x });
    return { type: "body.add", body: { ...structuredClone(b), id: ids.get(b.id)!, position, angle: pl.angle + b.angle, velocity, angularVelocity: target.angularVelocity } };
  });
  for (const j of prefab.joints) commands.push({ type: "joint.add", joint: { id: fresh("joint"), a: ids.get(j.a)!, b: ids.get(j.b)!, anchorA: j.anchorA, anchorB: j.anchorB, limits: j.limits } });
  commands.push({ type: "joint.add", joint: { id: fresh("joint"), a: pl.target, b: ids.get(prefab.mount)!, anchorA: pl.anchorTarget, anchorB: pl.anchorPart } });
  return { commands, mountId: ids.get(prefab.mount)! };
}

export { cross, dot, normalizeBody };
