// Where a turret's bolts land (WPN-014): for working out, as a level is built, the bearings at
// which a turret would hit something it mustn't (Mammoth Thrust's power plant).
//
// A bolt is followed from the muzzle along its flight under the level's gravity (its uniform pull,
// and any rock that pulls as a ball, FLT-015), round the level's sides if it wraps, until it
// strikes rock or one of the targets, leaves the level or has flown `time` game seconds. Slugs
// that burst count as hitting a target within `reach` m of it (the bolt's blast).
import { localVertices, rotate, sinCos, type Body, type Vec2, type World } from "../src/core/index.ts";

type Poly = { box: [number, number, number, number]; vs: Vec2[] };

function poly(b: Body): Poly | null {
  if (b.shape.kind === "disc") {
    const r = b.shape.radius;
    const vs = Array.from({ length: 12 }, (_, k) => ({ x: b.position.x + r * Math.cos((k * Math.PI) / 6), y: b.position.y + r * Math.sin((k * Math.PI) / 6) }));
    return { box: [b.position.x - r, b.position.y - r, b.position.x + r, b.position.y + r], vs };
  }
  const q = sinCos(b.angle);
  const vs = localVertices(b.shape).map((v) => {
    const r = rotate(q, v);
    return { x: b.position.x + r.x, y: b.position.y + r.y };
  });
  const xs = vs.map((v) => v.x);
  const ys = vs.map((v) => v.y);
  return { box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], vs };
}

function inside(p: Poly, x: number, y: number, pad = 0): boolean {
  if (x < p.box[0] - pad || x > p.box[2] + pad || y < p.box[1] - pad || y > p.box[3] + pad) return false;
  let c = false;
  const vs = p.vs;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    if (vs[i].y > y !== vs[j].y > y && x < ((vs[j].x - vs[i].x) * (y - vs[i].y)) / (vs[j].y - vs[i].y) + vs[i].x) c = !c;
  }
  if (c || pad <= 0) return c;
  // Within `pad` of an edge.
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const a = vs[j];
    const b = vs[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
    if ((a.x + t * dx - x) ** 2 + (a.y + t * dy - y) ** 2 <= pad * pad) return true;
  }
  return false;
}

/**
 * The bearings of turret `carriage` (its joint's angle, rad) whose bolts would land on one of
 * `targets`, tried every `step` rad, then widened by `margin` either way: ranges, merged.
 */
export function bearingsOnto(world: World, carriage: Body, targets: readonly string[], opts: { margin: number; step?: number; time?: number; dt?: number; reach?: number }): [number, number][] {
  const t = carriage.turret;
  const joint = t && world.joints.find((j) => j.id === t.joint);
  const arc = joint && world.bodies.find((b) => b.id === joint.a);
  const gun = t && world.bodies.find((b) => b.id === t.gun);
  const mag = gun?.magazine;
  if (!t || !joint?.turn || !arc || !gun || !mag?.railgun) return [];
  const step = opts.step ?? Math.PI / 180;
  const T = opts.time ?? 15;
  const dt = opts.dt ?? 1 / 120;
  const reach = opts.reach ?? 0.6;
  const pivot = { x: arc.position.x + rotate(sinCos(arc.angle), joint.anchorA).x, y: arc.position.y + rotate(sinCos(arc.angle), joint.anchorA).y };
  const m = rotate(sinCos(gun.angle), mag.at);
  const muzzle = Math.hypot(gun.position.x + m.x - pivot.x, gun.position.y + m.y - pivot.y);
  const speed = mag.railgun.speed;
  // The rock, and the targets, as polygons in a grid of 10 m cells.
  const CELL = 10;
  const grid = new Map<string, Poly[]>();
  const key = (x: number, y: number) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
  for (const b of world.bodies) {
    if (!b.fixed || !b.id.startsWith("rock-") || b.gravity) continue;
    const p = poly(b);
    if (!p) continue;
    for (let i = Math.floor(p.box[0] / CELL); i <= Math.floor(p.box[2] / CELL); i++)
      for (let j = Math.floor(p.box[1] / CELL); j <= Math.floor(p.box[3] / CELL); j++) {
        const k = `${i},${j}`;
        const list = grid.get(k) ?? [];
        list.push(p);
        grid.set(k, list);
      }
  }
  const aims = targets.map((id) => world.bodies.find((b) => b.id === id)).filter((b): b is Body => !!b).map(poly).filter((p): p is Poly => !!p);
  const sources = world.bodies.filter((b) => b.gravity && b.gravity.mu > 0);
  const b = world.bounds;
  const W = b.max.x - b.min.x;
  const hits = (th: number): boolean => {
    const bore = rotate(sinCos(arc.angle + th), { x: 0, y: 1 });
    let x = pivot.x + bore.x * muzzle;
    let y = pivot.y + bore.y * muzzle;
    let vx = bore.x * speed;
    let vy = bore.y * speed;
    for (let s = 0; s < T / dt; s++) {
      let ax = world.gravity.x;
      let ay = world.gravity.y;
      for (const g of sources) {
        const dx = g.position.x - x;
        const dy = g.position.y - y;
        const r3 = Math.hypot(dx, dy) ** 3;
        const R3 = (g.gravity!.radius ?? 0) ** 3;
        const k = g.gravity!.mu / Math.max(r3, R3, 1e-9);
        ax += k * dx;
        ay += k * dy;
      }
      vx += ax * dt;
      vy += ay * dt;
      x += vx * dt;
      y += vy * dt;
      if (b.wrap) x = b.min.x + ((((x - b.min.x) % W) + W) % W);
      if (y < b.min.y || y > b.max.y || (!b.wrap && (x < b.min.x || x > b.max.x))) return false;
      if (aims.some((p) => inside(p, x, y, reach))) return true;
      if ((grid.get(key(x, y)) ?? []).some((p) => inside(p, x, y))) return false;
    }
    return false;
  };
  const { min, max } = joint.turn;
  const bad: number[] = [];
  for (let th = min; th <= max + 1e-9; th += step) if (hits(th)) bad.push(th);
  const out: [number, number][] = [];
  for (const th of bad) {
    const lo = Math.max(min, th - opts.margin);
    const hi = Math.min(max, th + opts.margin);
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1e-9) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out.map(([lo, hi]) => [Math.round(lo * 1e4) / 1e4, Math.round(hi * 1e4) / 1e4]);
}
