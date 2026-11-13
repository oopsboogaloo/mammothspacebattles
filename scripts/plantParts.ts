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
  /** The reactor's coolant, kg of steam, and how fast each hole vents it, kg/s. */
  coolant: number;
  rate: number;
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
export function powerPlant(at: Vec, t: PlantTuning) {
  const m = machine("plant", at, 0);
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
  const vents = { from: m.id("core"), rate: t.rate, holes: [] };
  dome("dome-l", -8.9, -3.5, { vents });
  dome("core", -3.1, 2.3, { vents, contents: [{ resource: "h2o", mass: t.coolant, capacity: t.coolant }] });
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
