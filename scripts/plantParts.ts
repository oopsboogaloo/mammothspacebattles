// Mammoth Thrust's power plant and its antennae (Chloe's drawings, 13 November 2026; the game's
// rules are in src/core/plant.ts). Built of pieces as the turrets are.
//
//      ___   ___   ___  |o   light on the tower
//     |   | |   | |   | ||
//     |   | |   | |   | ||_  three domes (the middle one holds the coolant), tower, annex
//   ===========================  base, fixed on the rock
type Json = Record<string, unknown>;
type Vec = { x: number; y: number };

const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const rot = (v: Vec, a: number): Vec => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

/** Welds that nothing in the game breaks: the plant is destroyed only by its own reactor. */
const FAST = { tension: 1e9, compression: 1e9, shear: 1e9, torque: 1e9 };
/** Lander's weld (scripts/landShip.ts): an antenna's. */
const LIGHT_WELD = { tension: 7650, compression: 15300, shear: 5350, torque: 1840 };
/** Thin metal (J): one of the ship's slugs destroys a piece of an antenna. */
const ANTENNA = { name: "antenna", threshold: 30, toughness: 150 };

export interface PlantTuning {
  /** The reactor's coolant, kg (a volatile liquid that boils off: vented as steam), and how fast a leak of size 1 vents it, kg/s. */
  coolant: number;
  rate: number;
  /** Each puff of a leak, kg, and its size, m: bigger than a damage leak's, so the leaks show. */
  parcel: number;
  puff: number;
  /** The explosion when it blows: its charge, kg TNT, and its reach, m. */
  charge: number;
  radius: number;
}

/** A builder for one machine's pieces in its own frame (x along its base, y up), placed at `at` and turned by `angle`. */
function machine(name: string, at: Vec, angle: number) {
  const bodies: Json[] = [];
  const joints: Json[] = [];
  const id = (part: string) => `${name}-${part}`;
  const place = (p: Vec): Vec => {
    const r = rot(p, angle);
    return { x: round(at.x + r.x), y: round(at.y + r.y) };
  };
  const centre = new Map<string, Vec>();
  const polygon = (part: string, vertices: Vec[], mass: number, extra: Json = {}) => {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < vertices.length; k++) {
      const p = vertices[k];
      const q = vertices[(k + 1) % vertices.length];
      const c = p.x * q.y - q.x * p.y;
      a += c;
      cx += (p.x + q.x) * c;
      cy += (p.y + q.y) * c;
    }
    const c = { x: cx / (3 * a), y: cy / (3 * a) };
    centre.set(part, c);
    bodies.push({ id: id(part), shape: { kind: "polygon", vertices: vertices.map((p) => ({ x: round(p.x - c.x), y: round(p.y - c.y) })) }, mass, position: place(c), velocity: { x: 0, y: 0 }, angle: round(angle), angularVelocity: 0, restitution: 0, friction: 0.6, ...extra });
  };
  const box = (part: string, x0: number, x1: number, y0: number, y1: number, mass: number, extra: Json = {}) =>
    polygon(part, [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], mass, extra);
  const disc = (part: string, c: Vec, r: number, mass: number, extra: Json = {}) => {
    centre.set(part, c);
    bodies.push({ id: id(part), shape: { kind: "disc", radius: r }, mass, position: place(c), velocity: { x: 0, y: 0 }, angle: round(angle), angularVelocity: 0, restitution: 0, friction: 0.6, ...extra });
  };
  /** Makes a part fixed to the rock and anchored to it (TER-006). */
  const fix = (part: string, anchored: number) => {
    const b = bodies.find((x) => x.id === id(part))!;
    Object.assign(b, { fixed: true, mass: 1, anchored: { mass: anchored } });
  };
  const weld = (n: string, a: string, b: string, p: Vec, limits: Json) => {
    const local = (part: string) => ({ x: round(p.x - centre.get(part)!.x), y: round(p.y - centre.get(part)!.y) });
    joints.push({ id: id(`w-${n}`), a: id(a), b: id(b), anchorA: local(a), anchorB: local(b), limits });
  };
  return { bodies, joints, id, polygon, box, disc, fix, weld };
}

/**
 * The power plant, standing at `at` (the middle of its base's underside) on flat rock. Its pieces
 * have no material: bullets don't wear it down. A slug takes it offline, and one in a dome holes it
 * (plant.ts); the middle dome holds the coolant, which every hole vents.
 */
export function powerPlant(at: Vec, t: PlantTuning, angle = 0) {
  const m = machine("plant", at, angle);
  const top = 1;
  m.polygon("base", [{ x: -10.85, y: 0 }, { x: 10.85, y: 0 }, { x: 9.7, y: top }, { x: -9.7, y: top }], 1);
  m.fix("base", 5000);
  // The domes: tall arches, a rectangle with a half-circle on top, 9 m high.
  const dome = (part: string, x0: number, x1: number, extra: Json) => {
    const r = (x1 - x0) / 2;
    const c = { x: (x0 + x1) / 2, y: top + 9 - r };
    const v: Vec[] = [{ x: x0, y: top }, { x: x1, y: top }];
    for (let k = 0; k <= 10; k++) {
      const a = (Math.PI * k) / 10;
      v.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
    }
    m.polygon(part, v, 400, extra);
    m.weld(`${part}-a`, "base", part, { x: x0 + 0.6, y: top }, FAST);
    m.weld(`${part}-b`, "base", part, { x: x1 - 0.6, y: top }, FAST);
  };
  const vents = { from: m.id("core"), rate: t.rate, holes: [], parcel: t.parcel, radius: t.puff };
  dome("dome-l", -8.9, -3.5, { vents });
  dome("core", -3.1, 2.3, { vents, contents: [{ resource: "coolant", mass: t.coolant, capacity: t.coolant }] });
  dome("dome-r", 2.7, 8.1, { vents });
  // The tower, with its light; the annex beside it.
  m.box("tower", 8.2, 9.4, top, 12, 100);
  m.weld("tower-a", "base", "tower", { x: 8.4, y: top }, FAST);
  m.weld("tower-b", "base", "tower", { x: 9.2, y: top }, FAST);
  m.disc("light", { x: 8.8, y: 12.45 }, 0.45, 2);
  m.weld("light", "tower", "light", { x: 8.8, y: 12 }, FAST);
  m.box("annex", 9.4, 10.4, top, 6, 50);
  m.weld("annex", "base", "annex", { x: 9.9, y: top }, FAST);
  m.weld("annex-tower", "tower", "annex", { x: 9.4, y: 3.5 }, FAST);
  // The reactor's charge, inside the middle dome: what goes off when it blows.
  m.box("charge", -0.6, 0.6, 3, 4.2, 4, { explosive: { charge: t.charge, arm: 1e6, fragments: 4, radius: t.radius, whenDestroyed: true } });
  m.weld("charge", "core", "charge", { x: 0, y: 3.6 }, FAST);
  const parts = ["base", "dome-l", "core", "dome-r", "tower", "light", "annex", "charge"].map(m.id);
  return { bodies: m.bodies, joints: m.joints, parts, domes: [m.id("dome-l"), m.id("core"), m.id("dome-r")], core: m.id("core"), charge: m.id("charge"), light: m.id("light") };
}

/**
 * An antenna on the rock at `at`, its up turned by `angle` from +y (pointing across the open): a
 * fixed mount, a mast and a dish across it. One slug destroys the mast or the dish. The power
 * leaves from the mast's tip.
 */
export function antenna(name: string, at: Vec, angle: number) {
  const m = machine(name, at, angle);
  m.box("mount", -0.5, 0.5, 0, 0.5, 1);
  m.fix("mount", 20);
  m.box("mast", -0.1, 0.1, 0.5, 2.3, 1, { material: ANTENNA });
  m.box("dish", -0.7, 0.7, 1.5, 1.7, 0.5, { material: ANTENNA });
  m.weld("mast", "mount", "mast", { x: 0, y: 0.5 }, LIGHT_WELD);
  m.weld("dish", "mast", "dish", { x: 0, y: 1.6 }, LIGHT_WELD);
  return { bodies: m.bodies, joints: m.joints, mount: m.id("mount"), parts: [m.id("mast"), m.id("dish")], tip: { body: m.id("mast"), at: { x: 0, y: 0.9 } } };
}

/** A building's skin (J): plain scenery, one or two of the ship's slugs destroy a piece. */
const BUILDING = { name: "building", threshold: 200, toughness: 1500 };
/** A building's welds: strong enough to stand under gravity, broken by damage (DMG-003) not by load. */
const STRUCTURE = { tension: 1e6, compression: 2e6, shear: 1e6, torque: 1e6 };

/**
 * A building on the rock at `at` (the middle of its foot), turned by `angle` (Chloe's level 8,
 * 14 November 2026: "destructible, plain scenery"): pieces of thin skin welded to a base anchored
 * to the rock (TER-006). Shoot a piece and it breaks; break its welds and it falls.
 * "dish": a radar dish, a bowl on a post, about 15 m across and 10 m high.
 * "tower": a control tower, 33 m: a shaft, a cabin, a roof and an aerial.
 * "block": a low building, 8.5 m by 6.5 m.
 */
export function building(name: string, kind: "dish" | "tower" | "block", at: Vec, angle: number) {
  const m = machine(name, at, angle);
  const skin = { material: BUILDING };
  const mass = (w: number, h: number) => round(w * h * 20);
  const part = (p: string, x0: number, x1: number, y0: number, y1: number) => m.box(p, x0, x1, y0, y1, mass(x1 - x0, y1 - y0), skin);
  const foot = kind === "block" ? 4.25 : 2.2;
  m.box("base", -foot, foot, 0, 0.4, 1);
  m.fix("base", 2000);
  if (kind === "block") {
    part("walls", -4.25, 4.25, 0.4, 6.5);
    m.weld("walls-a", "base", "walls", { x: -3.5, y: 0.4 }, STRUCTURE);
    m.weld("walls-b", "base", "walls", { x: 3.5, y: 0.4 }, STRUCTURE);
  } else if (kind === "tower") {
    part("shaft", -1.2, 1.2, 0.4, 24);
    part("cabin", -4.5, 4.5, 24, 28);
    part("roof", -2.5, 2.5, 28, 29.5);
    part("aerial", -0.2, 0.2, 29.5, 33);
    m.weld("shaft-a", "base", "shaft", { x: -0.9, y: 0.4 }, STRUCTURE);
    m.weld("shaft-b", "base", "shaft", { x: 0.9, y: 0.4 }, STRUCTURE);
    m.weld("cabin-a", "shaft", "cabin", { x: -0.9, y: 24 }, STRUCTURE);
    m.weld("cabin-b", "shaft", "cabin", { x: 0.9, y: 24 }, STRUCTURE);
    m.weld("roof", "cabin", "roof", { x: 0, y: 28 }, STRUCTURE);
    m.weld("aerial", "roof", "aerial", { x: 0, y: 29.5 }, STRUCTURE);
  } else {
    part("post", -0.4, 0.4, 0.4, 4.5);
    m.weld("post-a", "base", "post", { x: -0.3, y: 0.4 }, STRUCTURE);
    m.weld("post-b", "base", "post", { x: 0.3, y: 0.4 }, STRUCTURE);
    // The bowl: six plates on an arc of radius 7 about a point above the post, tipped to the right as drawn.
    const c = { x: 0, y: 11.5 };
    const r = 7;
    const tilt = -0.35;
    const ends = [0, 1, 2, 3, 4, 5, 6].map((k) => {
      const a = Math.PI + 0.45 + (k / 6) * (Math.PI - 0.9) + tilt;
      return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
    });
    for (let k = 0; k < 6; k++) {
      const a = ends[k];
      const b = ends[k + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const nrm = { x: -t.y, y: t.x };
      const h = 0.25;
      m.polygon(`plate-${k + 1}`, [
        { x: a.x - nrm.x * h, y: a.y - nrm.y * h }, { x: b.x - nrm.x * h, y: b.y - nrm.y * h },
        { x: b.x + nrm.x * h, y: b.y + nrm.y * h }, { x: a.x + nrm.x * h, y: a.y + nrm.y * h },
      ], round(len * 0.5 * 20), skin);
      if (k > 0) m.weld(`plate-${k}`, `plate-${k}`, `plate-${k + 1}`, a, STRUCTURE);
    }
    // The post holds the bowl at its lowest plate, the one over it.
    const low = ends.reduce((best, p, k) => (k > 0 && k < 6 && p.y < ends[best].y ? k : best), 1);
    m.weld("bowl", "post", `plate-${low}`, { x: 0, y: 4.5 }, STRUCTURE);
  }
  return { bodies: m.bodies, joints: m.joints };
}
