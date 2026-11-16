// The blueprint designer's model (docs/blueprint/spec.md): a ship as the player edits it. No DOM.
//
// A blueprint keeps the ship in the scenario format (bodies, joints, links), so it flies unchanged,
// plus how its bodies group into components and its wiring (a core Mixer). Edits are pure: each
// returns a new blueprint. The Thrust 1 preset is the Thrust game's ship exactly, until edited.
import type { BodyInput, JointInput, LinkInput, Mixer, MixerRow, Shape, Vec2 } from "../../core/index.ts";
import { bodyMass, inertiaOf, mixerValues, polygonArea, steerMixer } from "../../core/index.ts";

export type Kind = "cockpit" | "engine" | "tank" | "storage" | "weapon" | "generator" | "battery" | "utility";

export const KINDS: { kind: Kind; label: string; short: string }[] = [
  { kind: "cockpit", label: "Cockpits", short: "CO" },
  { kind: "engine", label: "Engines", short: "EN" },
  { kind: "tank", label: "Tanks", short: "TA" },
  { kind: "storage", label: "Storage", short: "ST" },
  { kind: "weapon", label: "Weapons", short: "WE" },
  { kind: "generator", label: "Generators", short: "GE" },
  { kind: "battery", label: "Batteries", short: "BA" },
  { kind: "utility", label: "Utilities", short: "UT" },
];

export interface Component {
  id: string;
  kind: Kind;
  label: string;
  /** Its bodies' ids; the first is its main body (an engine's head, which carries the injector). */
  bodies: string[];
}

export interface Ship {
  bodies: BodyInput[];
  joints: JointInput[];
  links: LinkInput[];
}

export interface Blueprint {
  format: 1;
  id: string;
  name: string;
  /** Presets ship with the game and are never changed: editing one makes a copy. */
  preset?: boolean;
  rev: number;
  ship: Ship;
  components: Component[];
  mix: Mixer;
}

/** A weld as the player sees it: every joint between two components. */
export interface Weld {
  id: string;
  a: string;
  b: string;
  joints: JointInput[];
}

// ---------- geometry ----------

const rot = (v: Vec2, a: number): Vec2 => {
  if (a === 0) return { x: v.x, y: v.y };
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

export function shapeVertices(shape: Shape): Vec2[] {
  if (shape.kind === "box") {
    const w = shape.width / 2;
    const h = shape.height / 2;
    return [
      { x: -w, y: -h },
      { x: w, y: -h },
      { x: w, y: h },
      { x: -w, y: h },
    ];
  }
  if (shape.kind === "polygon") return shape.vertices.map((v) => ({ ...v }));
  const r = shape.radius;
  return Array.from({ length: 16 }, (_, i) => ({ x: r * Math.cos((i * Math.PI) / 8), y: r * Math.sin((i * Math.PI) / 8) }));
}

/** A body's outline in the ship's frame. */
export function worldVertices(b: BodyInput): Vec2[] {
  const a = b.angle ?? 0;
  return shapeVertices(b.shape).map((v) => {
    const r = rot(v, a);
    return { x: b.position.x + r.x, y: b.position.y + r.y };
  });
}

export function worldPoint(b: BodyInput, local: Vec2): Vec2 {
  const r = rot(local, b.angle ?? 0);
  return { x: b.position.x + r.x, y: b.position.y + r.y };
}

export function localPoint(b: BodyInput, p: Vec2): Vec2 {
  return rot({ x: p.x - b.position.x, y: p.y - b.position.y }, -(b.angle ?? 0));
}

export interface Box2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundsOf(points: Vec2[]): Box2 {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

// ---------- lookups ----------

export function body(bp: Blueprint, id: string): BodyInput {
  const b = bp.ship.bodies.find((x) => x.id === id);
  if (!b) throw new Error(`No body ${id}`);
  return b;
}

export function component(bp: Blueprint, id: string): Component {
  const c = bp.components.find((x) => x.id === id);
  if (!c) throw new Error(`No component ${id}`);
  return c;
}

export function componentOfBody(bp: Blueprint, bodyId: string): Component | undefined {
  return bp.components.find((c) => c.bodies.includes(bodyId));
}

export function componentBounds(bp: Blueprint, c: Component): Box2 {
  return boundsOf(c.bodies.flatMap((id) => worldVertices(body(bp, id))));
}

/** The welds between components, each with its joints; joints inside a component (an engine's) are not welds. */
export function welds(bp: Blueprint): Weld[] {
  const of = new Map<string, string>();
  for (const c of bp.components) for (const id of c.bodies) of.set(id, c.id);
  const out = new Map<string, Weld>();
  for (const j of bp.ship.joints) {
    const a = of.get(j.a);
    const b = of.get(j.b);
    if (!a || !b || a === b) continue;
    const [p, q] = a < b ? [a, b] : [b, a];
    const id = `${p}|${q}`;
    let w = out.get(id);
    if (!w) out.set(id, (w = { id, a: p, b: q, joints: [] }));
    w.joints.push(j);
  }
  return [...out.values()];
}

/** Where a joint is, in the ship's frame (its anchor on a). */
export function jointPoint(bp: Blueprint, j: JointInput): Vec2 {
  return worldPoint(body(bp, j.a), j.anchorA);
}

// ---------- the Thrust 1 preset ----------

const THRUST_PARTS: Record<string, [Kind, string]> = {
  hull: ["cockpit", "Cockpit"],
  "tank-l": ["tank", "Tank L"],
  "tank-r": ["tank", "Tank R"],
  "gen-l": ["generator", "Generator L"],
  "gen-r": ["generator", "Generator R"],
  battery: ["battery", "Battery"],
  "mag-l": ["storage", "Magazine L"],
  "mag-r": ["storage", "Magazine R"],
  gun: ["weapon", "Railgun"],
  main: ["engine", "Main thruster"],
  "back-l": ["engine", "Thruster BL"],
  "back-r": ["engine", "Thruster BR"],
  "front-l": ["engine", "Thruster FL"],
  "front-r": ["engine", "Thruster FR"],
  tractor: ["utility", "Tractor projector"],
  tether: ["utility", "Tether winch"],
  shield: ["utility", "Shield emitter"],
};

const strip = <T>(x: T): T => JSON.parse(JSON.stringify(x).replaceAll("p{n}-", "")) as T;

/** The ship of the Thrust game's first level, its ids without the game's `p{n}-` (ids are a ship's own here). */
export function thrustShip(scenario: { world: { thrust: { ship: { bodies: BodyInput[]; joints?: JointInput[]; links?: LinkInput[] }; mix: Parameters<typeof steerMixer>[0] } } }): { ship: Ship; mix: Mixer } {
  const s = scenario.world.thrust.ship;
  const ship = strip({ bodies: s.bodies, joints: s.joints ?? [], links: s.links ?? [] });
  const mix = steerMixer(scenario.world.thrust.mix);
  // The gun, tractor and shield answer their controls directly: their channels are the controls' names.
  for (const ch of ["fire", "tractor", "shield"]) mix.rows.push({ channel: ch, lines: [{ control: ch, weight: 1 }] });
  return { ship, mix };
}

/** Groups a ship's bodies into components: an engine is its head and the walls welded only to it. */
export function groupComponents(ship: Ship, names: Record<string, [Kind, string]> = {}): Component[] {
  const jointsOf = (id: string) => ship.joints.filter((j) => j.a === id || j.b === id);
  const taken = new Set<string>();
  const out: Component[] = [];
  for (const b of ship.bodies) {
    if (!b.injector || taken.has(b.id)) continue;
    const walls = jointsOf(b.id)
      .map((j) => (j.a === b.id ? j.b : j.a))
      .filter((w) => jointsOf(w).every((j) => j.a === b.id || j.b === b.id));
    const [kind, label] = names[b.id] ?? ["engine", b.id];
    out.push({ id: b.id, kind, label, bodies: [b.id, ...walls] });
    taken.add(b.id);
    for (const w of walls) taken.add(w);
  }
  for (const b of ship.bodies) {
    if (taken.has(b.id)) continue;
    const [kind, label] = names[b.id] ?? [guessKind(b), b.id];
    out.push({ id: b.id, kind, label, bodies: [b.id] });
  }
  // In the ship's own order, by each component's main body.
  const order = new Map(ship.bodies.map((b, i) => [b.id, i]));
  return out.sort((p, q) => order.get(p.bodies[0])! - order.get(q.bodies[0])!);
}

function guessKind(b: BodyInput): Kind {
  if (b.tractor) return "cockpit";
  if (b.magazine) return "weapon";
  if (b.contents?.length) return "tank";
  return "utility";
}

export function thrustPreset(scenario: Parameters<typeof thrustShip>[0]): Blueprint {
  const { ship, mix } = thrustShip(scenario);
  return { format: 1, id: "preset-thrust-1", name: "THRUST 1", preset: true, rev: 1, ship, components: groupComponents(ship, THRUST_PARTS), mix };
}

// ---------- stats ----------

/**
 * Effective exhaust speed for the instant thrust estimate, m/s: thrust ÷ flow as measured on the
 * Thrust ship's engines (docs/ship-designs.md, "Nozzle walls": 206–207 m/s with walls, whatever
 * their shape; about 76 m/s without, the chamber then being loose parcels). Measure gives the real figure.
 */
export const EXHAUST_SPEED = 206;
export const EXHAUST_SPEED_OPEN = 76;

/** An engine's estimated exhaust speed: its walls enclosing a chamber, or not. */
export const exhaustSpeed = (c: Component) => (c.bodies.length >= 3 ? EXHAUST_SPEED : EXHAUST_SPEED_OPEN);

export interface EngineInfo {
  id: string;
  channel: string;
  /** Where its push acts (the head's centre) and its direction (opposite the exhaust), ship frame. */
  at: Vec2;
  dir: Vec2;
  /** Estimated thrust at full, N. */
  thrust: number;
}

export function engines(bp: Blueprint): EngineInfo[] {
  return bp.components
    .filter((c) => c.kind === "engine")
    .map((c) => {
      const h = body(bp, c.bodies[0]);
      const inj = h.injector!;
      const d = rot(inj.direction ?? { x: 0, y: -1 }, h.angle ?? 0);
      return { id: c.id, channel: inj.channel, at: { ...h.position }, dir: { x: -d.x, y: -d.y }, thrust: (inj.rate ?? 0) * exhaustSpeed(c) };
    });
}

export interface Stats {
  mass: number;
  com: Vec2;
  /** Moment of inertia about the centre of mass, kg·m². */
  inertia: number;
  width: number;
  height: number;
  parts: number;
  welds: number;
  weldPoints: number;
  propellant: number;
  /** How many separate pieces the welds make (1: the ship holds together). */
  pieces: number;
}

/** The ship's separate pieces: components joined by welds, each piece a list of component ids. */
export function pieces(bp: Blueprint): string[][] {
  const parent = new Map(bp.components.map((c) => [c.id, c.id]));
  const find = (x: string): string => {
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const w of welds(bp)) parent.set(find(w.a), find(w.b));
  const groups = new Map<string, string[]>();
  for (const c of bp.components) {
    const r = find(c.id);
    groups.set(r, [...(groups.get(r) ?? []), c.id]);
  }
  return [...groups.values()];
}

/** The components welded, directly or through others, to the (first) cockpit: the ship the controls reach. */
export function joinedToCockpit(bp: Blueprint): Set<string> {
  const cockpit = bp.components.find((c) => c.kind === "cockpit");
  if (!cockpit) return new Set();
  return new Set(pieces(bp).find((p) => p.includes(cockpit.id)) ?? [cockpit.id]);
}

export function stats(bp: Blueprint): Stats {
  let m = 0;
  let mx = 0;
  let my = 0;
  let propellant = 0;
  const parts = bp.ship.bodies.map((b) => {
    const mass = bodyMass(b as Parameters<typeof bodyMass>[0]);
    m += mass;
    mx += mass * b.position.x;
    my += mass * b.position.y;
    propellant += (b.injector ? 0 : 1) * (b.contents ?? []).reduce((s, c) => s + c.mass, 0);
    return { b, mass };
  });
  const com = m > 0 ? { x: mx / m, y: my / m } : { x: 0, y: 0 };
  let inertia = 0;
  for (const { b, mass } of parts) {
    const dx = b.position.x - com.x;
    const dy = b.position.y - com.y;
    inertia += inertiaOf(b.shape, mass) + mass * (dx * dx + dy * dy);
  }
  const box = boundsOf(bp.ship.bodies.flatMap(worldVertices));
  const ws = welds(bp);
  return {
    mass: m,
    com,
    inertia,
    width: bp.ship.bodies.length ? box.maxX - box.minX : 0,
    height: bp.ship.bodies.length ? box.maxY - box.minY : 0,
    parts: bp.components.length,
    welds: ws.length,
    weldPoints: ws.reduce((s, w) => s + w.joints.length, 0),
    propellant,
    pieces: pieces(bp).length,
  };
}

/** What holding these controls does, estimated: acceleration ahead (+y) and sideways (+x), m/s², and turn, rad/s² (+ anticlockwise). */
export function response(bp: Blueprint, controls: Record<string, number>, st: Stats = stats(bp)): { ahead: number; side: number; turn: number; throttles: Record<string, number> } {
  const values = mixerValues(bp.mix, controls);
  // Only what is welded to the cockpit answers the controls (shipRules.ts).
  const joined = joinedToCockpit(bp);
  let fx = 0;
  let fy = 0;
  let tau = 0;
  const throttles: Record<string, number> = {};
  for (const e of engines(bp)) {
    const t = joined.has(e.id) ? (values[e.channel] ?? 0) : 0;
    throttles[e.id] = t;
    const f = { x: e.dir.x * e.thrust * t, y: e.dir.y * e.thrust * t };
    fx += f.x;
    fy += f.y;
    tau += (e.at.x - st.com.x) * f.y - (e.at.y - st.com.y) * f.x;
  }
  const m = st.mass || 1;
  return { ahead: fy / m, side: fx / m, turn: st.inertia ? tau / st.inertia : 0, throttles };
}

/** The controls the response table shows, in order. */
export const RESPONSE_ROWS: { label: string; controls: Record<string, number> }[] = [
  { label: "Forward", controls: { forward: 1 } },
  { label: "Reverse", controls: { reverse: 1 } },
  { label: "Turn left", controls: { left: 1 } },
  { label: "Turn right", controls: { right: 1 } },
];

// ---------- properties ----------

export type Tab = "shape" | "fuel" | "build" | "function";

export interface Param {
  key: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  tab: Tab;
  readonly?: boolean;
  note?: string;
}

interface EngineGeom {
  headWidth: number;
  headHeight: number;
  throat: number;
  wall: number;
  length: number;
  flare: number; // degrees
}

const DEG = Math.PI / 180;

/** An engine's shape, read from its head and its two walls (in the head's frame, exhaust along −y). */
export function engineGeom(bp: Blueprint, c: Component): EngineGeom {
  const h = body(bp, c.bodies[0]);
  if (h.shape.kind !== "box") throw new Error("An engine's head is a box");
  const walls = c.bodies.slice(1).map((id) => body(bp, id));
  // Each wall's outline in the head's frame.
  const local = walls.map((w) => worldVertices(w).map((p) => localPoint(h, p)));
  const right = local.find((vs) => vs.reduce((s, v) => s + v.x, 0) > 0) ?? local[0];
  const top = Math.max(...right.map((v) => v.y));
  const bottom = Math.min(...right.map((v) => v.y));
  const topXs = right.filter((v) => Math.abs(v.y - top) < 1e-6).map((v) => v.x);
  const botXs = right.filter((v) => Math.abs(v.y - bottom) < 1e-6).map((v) => v.x);
  const thick = Math.max(...topXs) - Math.min(...topXs);
  const topMid = (Math.max(...topXs) + Math.min(...topXs)) / 2;
  const botMid = (Math.max(...botXs) + Math.min(...botXs)) / 2;
  const length = top - bottom;
  return {
    headWidth: h.shape.width,
    headHeight: h.shape.height,
    throat: 2 * Math.min(...topXs),
    wall: thick,
    length,
    flare: Math.atan2(botMid - topMid, length) / DEG,
  };
}

/** Rebuilds an engine's walls and their welds to the head from its shape. Bodies keep their ids, masses and materials. */
function buildEngine(bp: Blueprint, c: Component, g: EngineGeom): Blueprint {
  const out = clone(bp);
  const h = body(out, c.bodies[0]);
  h.shape = { kind: "box", width: g.headWidth, height: g.headHeight };
  const inj = h.injector!;
  inj.outlet = { x: 0, y: -g.headHeight / 2 - 0.05 };
  inj.chamber = { width: g.headWidth, length: g.length + 0.25 };
  inj.width = Math.min(inj.width ?? g.throat * 0.75, g.throat - 0.02);
  const dx = g.length * Math.tan(g.flare * DEG);
  const wallIds = c.bodies.slice(1);
  // Which wall is which side: keep each on the side it was.
  const sides = wallIds.map((id) => (localPoint(h, body(out, id).position).x < 0 ? -1 : 1));
  wallIds.forEach((id, k) => {
    const s = sides[k];
    const w = body(out, id);
    const topMid = { x: s * (g.throat / 2 + g.wall / 2), y: -g.headHeight / 2 };
    const centre = { x: topMid.x + (s * dx) / 2, y: topMid.y - g.length / 2 };
    const t = g.wall / 2;
    // In the wall's own frame (turned as the head is), centred on its centroid.
    const tv = { x: (-s * dx) / 2, y: g.length / 2 };
    const verts = [
      { x: -tv.x - t, y: -g.length / 2 },
      { x: -tv.x + t, y: -g.length / 2 },
      { x: tv.x + t, y: g.length / 2 },
      { x: tv.x - t, y: g.length / 2 },
    ];
    w.shape = { kind: "polygon", vertices: verts };
    w.angle = h.angle ?? 0;
    w.position = worldPoint(h, centre);
    const j = out.ship.joints.find((x) => (x.a === h.id && x.b === id) || (x.b === h.id && x.a === id));
    if (j) {
      const onHead = topMid;
      const onWall = { x: tv.x, y: tv.y };
      if (j.a === h.id) {
        j.anchorA = onHead;
        j.anchorB = onWall;
      } else {
        j.anchorA = onWall;
        j.anchorB = onHead;
      }
    }
  });
  return out;
}

const round = (x: number, d = 6) => Math.round(x * 10 ** d) / 10 ** d;

export function params(bp: Blueprint, compId: string): Param[] {
  const c = component(bp, compId);
  const b = body(bp, c.bodies[0]);
  const ps: Param[] = [];
  const mass = (tab: Tab = "build"): Param => ({ key: "mass", label: "Mass", unit: "kg", value: c.bodies.reduce((s, id) => s + body(bp, id).mass, 0), min: 0.05, max: 500, step: 0.1, decimals: 2, tab });
  if (c.kind === "engine") {
    const g = engineGeom(bp, c);
    const inj = b.injector!;
    ps.push(
      { key: "headWidth", label: "Chamber width", unit: "m", value: g.headWidth, min: 0.2, max: 4, step: 0.05, decimals: 2, tab: "shape" },
      { key: "headHeight", label: "Head depth", unit: "m", value: g.headHeight, min: 0.05, max: 1, step: 0.01, decimals: 2, tab: "shape" },
      { key: "throat", label: "Throat width", unit: "m", value: g.throat, min: 0.1, max: 4, step: 0.05, decimals: 2, tab: "shape" },
      { key: "wall", label: "Wall thickness", unit: "m", value: g.wall, min: 0.02, max: 0.5, step: 0.01, decimals: 2, tab: "shape" },
      { key: "length", label: "Nozzle wall length", unit: "m", value: g.length, min: 0.1, max: 4, step: 0.05, decimals: 2, tab: "shape" },
      { key: "flare", label: "Nozzle flare", unit: "°", value: g.flare, min: -10, max: 45, step: 0.5, decimals: 1, tab: "shape" },
      { key: "rate", label: "Flow (burn rate)", unit: "kg/s", value: inj.rate ?? 0, min: 0.05, max: 20, step: 0.05, decimals: 3, tab: "fuel" },
      { key: "economy", label: "Fuel efficiency", unit: "×", value: inj.economy ?? 1, min: 1, max: 200, step: 1, decimals: 0, tab: "fuel" },
      { key: "injWidth", label: "Injector width", unit: "m", value: inj.width ?? 0, min: 0.05, max: 4, step: 0.05, decimals: 2, tab: "fuel" },
      { key: "thrust", label: "Thrust (est.)", unit: "N", value: (inj.rate ?? 0) * exhaustSpeed(c), min: 0, max: 1e5, step: 1, decimals: 0, tab: "fuel", readonly: true, note: `flow × ${exhaustSpeed(c)} m/s; Measure gives the real figure` },
      { ...mass(), key: "headMass", label: "Head mass", value: b.mass },
      { key: "wallMass", label: "Wall mass (each)", unit: "kg", value: c.bodies.length > 1 ? body(bp, c.bodies[1]).mass : 0, min: 0.01, max: 100, step: 0.05, decimals: 2, tab: "build" },
    );
    return ps;
  }
  if (b.shape.kind === "box") {
    ps.push(
      { key: "width", label: "Width", unit: "m", value: b.shape.width, min: 0.05, max: 10, step: 0.05, decimals: 2, tab: "shape" },
      { key: "height", label: "Height", unit: "m", value: b.shape.height, min: 0.05, max: 10, step: 0.05, decimals: 2, tab: "shape" },
    );
  } else if (b.shape.kind === "polygon") {
    const box = boundsOf(b.shape.vertices);
    ps.push(
      { key: "pw", label: "Width", unit: "m", value: box.maxX - box.minX, min: 0.2, max: 10, step: 0.05, decimals: 2, tab: "shape", readonly: true, note: "Cockpit shape editing comes later" },
      { key: "ph", label: "Height", unit: "m", value: box.maxY - box.minY, min: 0.2, max: 10, step: 0.05, decimals: 2, tab: "shape", readonly: true },
    );
  }
  for (const s of b.contents ?? []) {
    ps.push({ key: `cap:${s.resource}`, label: `${s.resource === "h2" ? "H₂" : s.resource === "o2" ? "O₂" : s.resource} capacity`, unit: "kg", value: s.capacity, min: 0, max: 100, step: 0.05, decimals: 3, tab: "fuel" });
  }
  if (b.magazine) {
    ps.push({ key: "count", label: "Shells", unit: "", value: b.magazine.count, min: 0, max: 1000, step: 1, decimals: 0, tab: "function" });
    if (b.magazine.railgun) ps.push({ key: "speed", label: "Muzzle speed", unit: "m/s", value: b.magazine.railgun.speed, min: 1, max: 1000, step: 1, decimals: 0, tab: "function" });
    ps.push({ key: "reload", label: "Reload", unit: "s", value: b.magazine.reload, min: 0.01, max: 10, step: 0.005, decimals: 3, tab: "function" });
  }
  if (b.tractor) {
    ps.push(
      { key: "range", label: "Beam range", unit: "m", value: b.tractor.range ?? 0, min: 1, max: 200, step: 1, decimals: 0, tab: "function" },
      { key: "force", label: "Beam force", unit: "N", value: b.tractor.force ?? 0, min: 0, max: 10000, step: 10, decimals: 0, tab: "function" },
    );
  }
  if (b.shield) ps.push({ key: "radius", label: "Shield radius", unit: "m", value: b.shield.radius, min: 0.5, max: 20, step: 0.05, decimals: 2, tab: "function" });
  ps.push(mass());
  return ps;
}

const clone = (bp: Blueprint): Blueprint => structuredClone(bp);

/** Changes one property. A change to a part's outline rewelds it to whatever it then touches. */
export function setParam(bp: Blueprint, compId: string, key: string, value: number): Blueprint {
  const c = component(bp, compId);
  if (c.kind === "engine") {
    if (["headWidth", "headHeight", "throat", "wall", "length", "flare"].includes(key)) {
      const g = { ...engineGeom(bp, c), [key]: value };
      g.throat = Math.min(g.throat, g.headWidth + 2);
      const out = buildEngine(bp, c, g);
      return key === "headWidth" || key === "headHeight" ? reweld(out, compId) : out;
    }
    const out = clone(bp);
    const h = body(out, c.bodies[0]);
    const inj = h.injector!;
    if (key === "rate") {
      const was = inj.rate ?? value;
      inj.rate = value;
      inj.parcelMass = round(value * 0.002, 9);
      const mix = inj.mixture ?? { h2: 1 / 9, o2: 8 / 9 };
      if (h.contents) for (const s of h.contents) s.capacity = round(value * 0.02 * (mix[s.resource] ?? 0), 9);
      // Feed lines keep their headroom over what the engine draws.
      if (was > 0) for (const l of out.ship.links) if (l.kind === "feed" && l.to === h.id) l.rate = round(l.rate * (value / was), 9);
    } else if (key === "economy") inj.economy = value;
    else if (key === "injWidth") inj.width = value;
    else if (key === "headMass") {
      h.mass = value;
      if (h.explosive) h.explosive.charge = round(value * 0.008, 9);
    } else if (key === "wallMass") for (const id of c.bodies.slice(1)) body(out, id).mass = value;
    return out;
  }
  const out = clone(bp);
  const b = body(out, c.bodies[0]);
  if ((key === "width" || key === "height") && b.shape.kind === "box") {
    const old = b.shape.width * b.shape.height;
    b.shape = { ...b.shape, [key]: value };
    // The same stuff, bigger or smaller: mass and what it holds go with its area.
    const k = (b.shape.width * b.shape.height) / old;
    b.mass = round(b.mass * k);
    for (const s of b.contents ?? []) {
      s.capacity = round(s.capacity * k, 9);
      s.mass = round(s.mass * k, 9);
    }
    return reweld(out, compId);
  }
  if (key.startsWith("cap:")) {
    const s = b.contents?.find((x) => x.resource === key.slice(4));
    if (s) {
      s.capacity = value;
      s.mass = value; // full at the start
    }
  } else if (key === "mass") b.mass = value;
  else if (key === "count" && b.magazine) b.magazine.count = Math.round(value);
  else if (key === "speed" && b.magazine?.railgun) b.magazine.railgun.speed = value;
  else if (key === "reload" && b.magazine) b.magazine.reload = value;
  else if (key === "range" && b.tractor) b.tractor.range = value;
  else if (key === "force" && b.tractor) b.tractor.force = value;
  else if (key === "radius" && b.shield) b.shield.radius = value;
  return out;
}

// ---------- welding ----------

export const WELD_PRESETS: { name: string; limits: JointInput["limits"] & object; yield: number }[] = [
  { name: "Light", limits: { tension: 11475, compression: 22950, shear: 8025, torque: 2760 }, yield: 0.3 },
  { name: "Standard", limits: { tension: 22950, compression: 45900, shear: 16050, torque: 5520 }, yield: 0.3 },
  { name: "Heavy", limits: { tension: 45900, compression: 91800, shear: 32100, torque: 11040 }, yield: 0.3 },
];

interface Edge {
  a: Vec2;
  b: Vec2;
  /** The way the side faces, out of its body (a unit vector along x or y). */
  out?: Vec2;
}

/** A body's sides that run along x or y, in the ship's frame. */
function straightEdges(b: BodyInput): Edge[] {
  let vs = worldVertices(b);
  if (polygonArea(vs) < 0) vs = [...vs].reverse(); // anticlockwise, so each side's outside is on its right
  const out: Edge[] = [];
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const c = vs[(i + 1) % vs.length];
    if (Math.abs(a.x - c.x) < 1e-6 || Math.abs(a.y - c.y) < 1e-6) {
      const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
      out.push({ a, b: c, out: { x: Math.round((c.y - a.y) / len), y: Math.round(-(c.x - a.x) / len) } });
    }
  }
  return out;
}

/** Two sides that face each other (so the parts would meet there, not overlap). */
const facing = (e: Edge, f: Edge) => !!e.out && !!f.out && e.out.x === -f.out.x && e.out.y === -f.out.y;

const TOUCH = 1e-3;

/** Where two bodies touch side to side: the shared stretches, in the ship's frame. */
export function touching(p: BodyInput, q: BodyInput): Edge[] {
  const out: Edge[] = [];
  for (const e of straightEdges(p)) {
    for (const f of straightEdges(q)) {
      const vertical = Math.abs(e.a.x - e.b.x) < 1e-6;
      if (vertical !== Math.abs(f.a.x - f.b.x) < 1e-6 || !facing(e, f)) continue;
      if (vertical) {
        if (Math.abs(e.a.x - f.a.x) > TOUCH) continue;
        const lo = Math.max(Math.min(e.a.y, e.b.y), Math.min(f.a.y, f.b.y));
        const hi = Math.min(Math.max(e.a.y, e.b.y), Math.max(f.a.y, f.b.y));
        if (hi - lo > 0.02) out.push({ a: { x: e.a.x, y: lo }, b: { x: e.a.x, y: hi } });
      } else {
        if (Math.abs(e.a.y - f.a.y) > TOUCH) continue;
        const lo = Math.max(Math.min(e.a.x, e.b.x), Math.min(f.a.x, f.b.x));
        const hi = Math.min(Math.max(e.a.x, e.b.x), Math.max(f.a.x, f.b.x));
        if (hi - lo > 0.02) out.push({ a: { x: lo, y: e.a.y }, b: { x: hi, y: e.a.y } });
      }
    }
  }
  return out;
}

/** Weld points along a shared stretch: one in the middle if it is under 0.3 m, else two, 0.1 m in from its ends. */
export function weldPoints(e: Edge): Vec2[] {
  const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
  if (len < 0.3) return [{ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }];
  const u = { x: (e.b.x - e.a.x) / len, y: (e.b.y - e.a.y) / len };
  return [
    { x: e.a.x + u.x * 0.1, y: e.a.y + u.y * 0.1 },
    { x: e.b.x - u.x * 0.1, y: e.b.y - u.y * 0.1 },
  ];
}

/** The bodies of a component that weld to others: an engine welds by its head only. */
const weldingBodies = (c: Component) => (c.kind === "engine" ? c.bodies.slice(0, 1) : c.bodies);

/**
 * Remakes a component's welds from where it now touches the others (§3.2): its old welds go, and
 * each component it touches is welded at points along each shared side, as strong as the weld
 * between them was (Standard if there was none).
 */
export function reweld(bp: Blueprint, compId: string): Blueprint {
  const out = clone(bp);
  const c = component(out, compId);
  const old = welds(out).filter((w) => w.a === compId || w.b === compId);
  const strength = new Map(old.map((w) => [w.a === compId ? w.b : w.a, { limits: w.joints[0].limits, yield: w.joints[0].yield }]));
  const oldIds = new Set(old.flatMap((w) => w.joints.map((j) => j.id)));
  out.ship.joints = out.ship.joints.filter((j) => !oldIds.has(j.id));
  const std = WELD_PRESETS[1];
  for (const other of out.components) {
    if (other.id === compId) continue;
    let k = 0;
    for (const pid of weldingBodies(c)) {
      for (const qid of weldingBodies(other)) {
        const p = body(out, pid);
        const q = body(out, qid);
        for (const e of touching(p, q)) {
          for (const pt of weldPoints(e)) {
            const s = strength.get(other.id) ?? { limits: std.limits, yield: std.yield };
            out.ship.joints.push({ id: `w-${compId}-${other.id}-${k++}`, a: pid, b: qid, anchorA: rounded(localPoint(p, pt)), anchorB: rounded(localPoint(q, pt)), limits: { ...s.limits! }, yield: s.yield } as JointInput);
          }
        }
      }
    }
  }
  return out;
}

const rounded = (p: Vec2): Vec2 => ({ x: round(p.x), y: round(p.y) });

/** Sets a weld's strength (every point of it). */
export function setWeld(bp: Blueprint, weldId: string, limits: Partial<NonNullable<JointInput["limits"]>>, yieldFraction?: number): Blueprint {
  const out = clone(bp);
  const w = welds(out).find((x) => x.id === weldId);
  if (!w) return out;
  const ids = new Set(w.joints.map((j) => j.id));
  for (const j of out.ship.joints) {
    if (!ids.has(j.id)) continue;
    j.limits = { ...(j.limits ?? WELD_PRESETS[1].limits), ...limits } as NonNullable<JointInput["limits"]>;
    if (yieldFraction !== undefined) j.yield = yieldFraction;
  }
  return out;
}

/** Removes a weld: the parts stay where they are, unjoined. */
export function removeWeld(bp: Blueprint, weldId: string): Blueprint {
  const out = clone(bp);
  const w = welds(out).find((x) => x.id === weldId);
  if (!w) return out;
  const ids = new Set(w.joints.map((j) => j.id));
  out.ship.joints = out.ship.joints.filter((j) => !ids.has(j.id));
  return out;
}

/** Removes a component: its bodies, every joint and link to them, and its mixer row. */
export function removeComponent(bp: Blueprint, compId: string): Blueprint {
  const out = clone(bp);
  const c = component(out, compId);
  const gone = new Set(c.bodies);
  const channels = new Set(c.bodies.map((id) => body(out, id).injector?.channel).filter((x): x is string => !!x));
  out.ship.bodies = out.ship.bodies.filter((b) => !gone.has(b.id));
  out.ship.joints = out.ship.joints.filter((j) => !gone.has(j.a) && !gone.has(j.b));
  out.ship.links = out.ship.links.filter((l) => !("to" in l && gone.has(l.to as string)) && !("from" in l && gone.has((l as { from: string }).from)));
  out.components = out.components.filter((x) => x.id !== compId);
  out.mix = { ...out.mix, rows: out.mix.rows.filter((r: MixerRow) => !channels.has(r.channel)) };
  return out;
}

/** Moves a component by (dx, dy): its welds break and re-form wherever it lands. */
export function moveComponent(bp: Blueprint, compId: string, dx: number, dy: number): Blueprint {
  const out = clone(bp);
  for (const id of component(out, compId).bodies) {
    const b = body(out, id);
    b.position = { x: round(b.position.x + dx), y: round(b.position.y + dy) };
  }
  return reweld(out, compId);
}

/** A ship's area, m² (for the blueprint's thumbnail scale). */
export function shipArea(bp: Blueprint): number {
  return bp.ship.bodies.reduce((s, b) => s + Math.abs(polygonArea(shapeVertices(b.shape))), 0);
}


// ---------- placing: snapping, adding, flipping (§3.1, §3.2) ----------

/** How close an edge must come to snap, m (the view passes at least 16 screen pixels' worth). */
export const SNAP = 0.25;
/** Where a part lands when snapping is off, m. */
export const GRID = 0.05;

export interface Placement {
  dx: number;
  dy: number;
  snapped: boolean;
  /** It would overlap another part: it can't go there. */
  overlap: boolean;
  /** The components it would weld to, and where. */
  touches: string[];
  points: Vec2[];
  /** Lines to draw: what it lined up with. */
  guides: Edge[];
}

const shifted = (b: BodyInput, dx: number, dy: number): BodyInput => ({ ...b, position: { x: b.position.x + dx, y: b.position.y + dy } });

/** Whether two convex outlines overlap by more than a hair (separating axes). */
export function overlaps(p: Vec2[], q: Vec2[], eps = 1e-4): boolean {
  for (const poly of [p, q]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const n = { x: -(b.y - a.y), y: b.x - a.x };
      const len = Math.hypot(n.x, n.y) || 1;
      const proj = (vs: Vec2[]) => vs.map((v) => (v.x * n.x + v.y * n.y) / len);
      const pp = proj(p);
      const qq = proj(q);
      if (Math.min(Math.max(...pp), Math.max(...qq)) - Math.max(Math.min(...pp), Math.min(...qq)) <= eps) return false;
    }
  }
  return true;
}

/**
 * Where moving bodies (a component, or one being added) land if dropped moved by (dx, dy): snapped
 * flush to the nearest side within `tol` and lined up with its ends or middle, or on the grid if
 * `free`. Says what it would weld to and whether it would overlap anything.
 */
export function place(bp: Blueprint, moving: BodyInput[], welding: string[], dx: number, dy: number, opts: { tol?: number; free?: boolean; exclude?: string } = {}): Placement {
  const tol = opts.tol ?? SNAP;
  const others = bp.components.filter((c) => c.id !== opts.exclude);
  const otherWeld = others.flatMap((c) => weldingBodies(c).map((id) => body(bp, id)));
  const otherAll = others.flatMap((c) => c.bodies.map((id) => body(bp, id)));
  let cx = 0;
  let cy = 0;
  let snapped = false;
  const guides: Edge[] = [];
  if (opts.free) {
    const ref = moving[0].position;
    cx = Math.round((ref.x + dx) / GRID) * GRID - (ref.x + dx);
    cy = Math.round((ref.y + dy) / GRID) * GRID - (ref.y + dy);
  } else {
    const mov = moving.filter((b) => welding.includes(b.id)).map((b) => shifted(b, dx, dy));
    // Flush against a side: the smallest move that makes a side of ours meet a side of theirs.
    let bestX: { d: number; f: Edge; e: Edge } | null = null;
    let bestY: { d: number; f: Edge; e: Edge } | null = null;
    for (const m of mov)
      for (const e of straightEdges(m))
        for (const o of otherWeld)
          for (const f of straightEdges(o)) {
            const vert = Math.abs(e.a.x - e.b.x) < 1e-6;
            if (vert !== Math.abs(f.a.x - f.b.x) < 1e-6 || !facing(e, f)) continue;
            const [ea, eb, fa, fb] = vert ? [e.a.y, e.b.y, f.a.y, f.b.y] : [e.a.x, e.b.x, f.a.x, f.b.x];
            const gap = Math.max(Math.min(ea, eb), Math.min(fa, fb)) - Math.min(Math.max(ea, eb), Math.max(fa, fb));
            if (gap > -0.02) continue; // not alongside each other: they must share some length, not just a corner
            const d = vert ? f.a.x - e.a.x : f.a.y - e.a.y;
            if (Math.abs(d) > tol) continue;
            if (vert ? !bestX || Math.abs(d) < Math.abs(bestX.d) : !bestY || Math.abs(d) < Math.abs(bestY.d)) {
              if (vert) bestX = { d, e, f };
              else bestY = { d, e, f };
            }
          }
    if (bestX) cx = bestX.d;
    if (bestY) cy = bestY.d;
    snapped = !!(bestX || bestY);
    // Lined up along the side it meets: its end or middle with theirs, if near.
    const align = (best: { e: Edge; f: Edge } | null, vert: boolean) => {
      if (!best) return 0;
      const along = (q: Edge) => (vert ? [Math.min(q.a.y, q.b.y), Math.max(q.a.y, q.b.y)] : [Math.min(q.a.x, q.b.x), Math.max(q.a.x, q.b.x)]);
      const [e0, e1] = along(best.e);
      const [f0, f1] = along(best.f);
      const options = [f0 - e0, f1 - e1, (f0 + f1) / 2 - (e0 + e1) / 2];
      const pick = options.filter((o) => Math.abs(o) <= tol).sort((p, q) => Math.abs(p) - Math.abs(q))[0];
      if (pick !== undefined) guides.push(best.f);
      return pick ?? 0;
    };
    if (bestX && !bestY) cy = align(bestX, true);
    else if (bestY && !bestX) cx = align(bestY, false);
    else if (bestX && bestY) guides.push(bestX.f, bestY.f);
  }
  const fx = dx + cx;
  const fy = dy + cy;
  const landed = moving.map((b) => shifted(b, fx, fy));
  const overlap = landed.some((m) => otherAll.some((o) => overlaps(worldVertices(m), worldVertices(o))));
  const touches = new Set<string>();
  const points: Vec2[] = [];
  for (const m of landed.filter((b) => welding.includes(b.id)))
    for (const c of others)
      for (const id of weldingBodies(c))
        for (const e of touching(m, body(bp, id))) {
          touches.add(c.id);
          points.push(...weldPoints(e));
        }
  return { dx: round(fx), dy: round(fy), snapped, overlap, touches: [...touches], points, guides };
}

/** The bodies of a component that weld to others (an engine's head only). */
export function weldingOf(c: Component): string[] {
  return weldingBodies(c);
}

function uniqueId(bp: Blueprint, base: string): string {
  const used = new Set([...bp.ship.bodies.map((b) => b.id), ...bp.components.map((c) => c.id), ...bp.mix.rows.map((r) => r.channel)]);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** A copy of a template's component (from a preset), as new bodies with new ids, unplaced. */
export function instantiate(bp: Blueprint, tpl: Blueprint, compId: string, label?: string): { comp: Component; bodies: BodyInput[]; joints: JointInput[] } {
  const c = component(tpl, compId);
  const base = compId.replace(/-(l|r)$/, "");
  const id = uniqueId(bp, base === "hull" ? "cockpit" : base);
  const rename = (old: string) => (old === compId ? id : old.startsWith(compId) ? id + old.slice(compId.length) : `${id}-${old}`);
  const bodies = c.bodies.map((bid) => {
    const b = structuredClone(body(tpl, bid));
    b.id = rename(bid);
    if (b.injector) b.injector.channel = id;
    if (b.magazine?.railgun) b.magazine.railgun.channel = id;
    if (b.tractor) delete b.tractor; // a cockpit's beam belongs with the projector and winch it was built with
    if (b.shield) b.shield = { ...b.shield, channel: id, from: [], blocks: [] };
    return b;
  });
  const joints = tpl.ship.joints.filter((j) => c.bodies.includes(j.a) && c.bodies.includes(j.b)).map((j) => ({ ...structuredClone(j), id: `${id}-${j.id}`, a: rename(j.a), b: rename(j.b) }));
  return { comp: { id, kind: c.kind, label: uniqueLabel(bp, label ?? c.label.replace(/ (L|R|BL|BR|FL|FR)$/, "")), bodies: bodies.map((b) => b.id) }, bodies, joints };
}

function uniqueLabel(bp: Blueprint, base: string): string {
  const used = new Set(bp.components.map((c) => c.label));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Fuel lines: every engine draws from every tank, with room to spare over what it burns. */
function refeed(bp: Blueprint): void {
  const tanks = bp.components.filter((c) => c.kind === "tank").map((c) => body(bp, c.bodies[0]));
  const engs = bp.components.filter((c) => c.kind === "engine").map((c) => body(bp, c.bodies[0]));
  for (const e of engs) {
    const inj = e.injector!;
    const mix = inj.mixture ?? { h2: 1 / 9, o2: 8 / 9 };
    for (const t of tanks) {
      for (const s of t.contents ?? []) {
        const frac = mix[s.resource] ?? 0;
        if (!frac) continue;
        if (bp.ship.links.some((l) => l.kind === "feed" && l.from === t.id && l.to === e.id && l.resource === s.resource)) continue;
        bp.ship.links.push({ id: `feed-${s.resource}-${e.id}-${t.id}`, kind: "feed", from: t.id, to: e.id, resource: s.resource, rate: round(((inj.rate ?? 0) * frac * 2) / (inj.economy ?? 1) / Math.max(1, tanks.length), 9) } as LinkInput);
      }
    }
  }
}

/** Adds a made component where it was placed: welded where it touches, fed if it is an engine or a tank, with a mixer row (no lines: the player wires it). */
export function addComponent(bp: Blueprint, made: { comp: Component; bodies: BodyInput[]; joints: JointInput[] }, dx: number, dy: number): Blueprint {
  const out = clone(bp);
  for (const b of made.bodies) out.ship.bodies.push(shifted(b, dx, dy));
  out.ship.joints.push(...made.joints);
  out.components.push(made.comp);
  for (const b of made.bodies) {
    const ch = b.injector?.channel ?? b.magazine?.railgun?.channel ?? b.shield?.channel;
    if (ch && !out.mix.rows.some((r) => r.channel === ch)) out.mix = { ...out.mix, rows: [...out.mix.rows, { channel: ch, lines: [] }] };
  }
  // A new shield emitter burns from the ship's tanks, lifts the cockpit and stops its engines and guns.
  for (const b of made.bodies) {
    if (!b.shield) continue;
    const s = body(out, b.id).shield!;
    const cockpit = out.components.find((c) => c.kind === "cockpit");
    s.from = out.components.filter((c) => c.kind === "tank").map((c) => c.bodies[0]);
    if (cockpit) s.to = cockpit.bodies[0];
    s.blocks = out.ship.bodies.map((x) => x.injector?.channel ?? x.magazine?.railgun?.channel).filter((x): x is string => !!x);
  }
  refeed(out);
  return reweld(out, made.comp.id);
}

/** A free spot for a new part: flush against some side of the ship, nearest its centre of mass, overlapping nothing. */
export function freeSpot(bp: Blueprint, moving: BodyInput[], welding: string[]): { dx: number; dy: number } {
  if (!bp.ship.bodies.length) {
    const c = moving[0].position;
    return { dx: -c.x, dy: -c.y };
  }
  const st = stats(bp);
  // Its welding side (an engine's head) goes flush against a side of the ship.
  const mine = boundsOf(moving.filter((b) => welding.includes(b.id)).flatMap(worldVertices));
  const mw = mine.maxX - mine.minX;
  const mh = mine.maxY - mine.minY;
  const mcx = (mine.minX + mine.maxX) / 2;
  const mcy = (mine.minY + mine.maxY) / 2;
  let best: { dx: number; dy: number; d: number } | null = null;
  for (const c of bp.components) {
    const b = componentBounds(bp, c);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const spots = [
      { x: b.maxX + mw / 2, y: cy },
      { x: b.minX - mw / 2, y: cy },
      { x: cx, y: b.maxY + mh / 2 },
      { x: cx, y: b.minY - mh / 2 },
    ];
    for (const s of spots) {
      const p = place(bp, moving, welding, s.x - mcx, s.y - mcy);
      if (p.overlap) continue;
      const d = Math.hypot(s.x - st.com.x, s.y - st.com.y) + (p.touches.length ? 0 : 1000); // welded beats nearer
      if (!best || d < best.d) best = { dx: p.dx, dy: p.dy, d };
    }
  }
  if (best) return best;
  const all = boundsOf(bp.ship.bodies.flatMap(worldVertices));
  return { dx: all.maxX + 0.5 + mw / 2 - mcx, dy: (all.minY + all.maxY) / 2 - mcy };
}

/** Turns a component round end for end about its main body (an engine to face the other way). */
export function flipComponent(bp: Blueprint, compId: string): Blueprint {
  const out = clone(bp);
  const c = component(out, compId);
  const centre = { ...body(out, c.bodies[0]).position };
  for (const id of c.bodies) {
    const b = body(out, id);
    b.position = { x: round(2 * centre.x - b.position.x), y: round(2 * centre.y - b.position.y) };
    b.angle = ((b.angle ?? 0) + Math.PI) % (2 * Math.PI);
  }
  return reweld(out, compId);
}

/** Moves a component to where `place` put it, without its old welds; rewelded where it lands. */
export function moveTo(bp: Blueprint, compId: string, p: Placement): Blueprint {
  return moveComponent(bp, compId, p.dx, p.dy);
}

// ---------- wiring (§10) ----------

/** The channels a component's bodies answer to: an engine's injector, a gun, a shield, a tractor. */
export function channelsOf(bp: Blueprint, compId: string): string[] {
  const out: string[] = [];
  for (const id of component(bp, compId).bodies) {
    const b = body(bp, id);
    for (const ch of [b.injector?.channel, b.magazine?.railgun?.channel, b.shield?.channel, b.tractor?.channel]) if (ch && !out.includes(ch)) out.push(ch);
  }
  return out;
}

/** Which component a driven channel belongs to. */
export function componentOfChannel(bp: Blueprint, channel: string): Component | undefined {
  return bp.components.find((c) => channelsOf(bp, c.id).includes(channel));
}

/** Changes the row driving a channel (making it if there is none). */
export function setRow(bp: Blueprint, channel: string, change: (row: MixerRow) => MixerRow): Blueprint {
  const out = clone(bp);
  const rows = out.mix.rows;
  const i = rows.findIndex((r) => r.channel === channel);
  const row = i >= 0 ? rows[i] : { channel, lines: [] };
  const next = change(structuredClone(row));
  out.mix = { ...out.mix, rows: i >= 0 ? rows.map((r, k) => (k === i ? next : r)) : [...rows, next] };
  return out;
}

export function setRules(bp: Blueprint, rules: NonNullable<Mixer["rules"]>): Blueprint {
  return { ...clone(bp), mix: { ...bp.mix, rules: structuredClone(rules) } };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A row in words, as the properties panel says it: "Fires fully on Turn right. Fires on Forward, except while Turn left is held." */
export function describeRow(row: MixerRow | undefined, name: (control: string) => string): string {
  if (!row || !row.lines.length) return "Not wired: no control drives it.";
  const parts = row.lines.map((l) => {
    const how = l.weight >= 1 ? "fully" : `at ${pct(l.weight)}`;
    if (!l.ease) return `Fires ${how} on ${name(l.control)}.`;
    if (l.ease.amount >= 1) return `Fires ${how} on ${name(l.control)}, except while ${name(l.ease.control)} is held.`;
    return `Fires ${how} on ${name(l.control)}, ${pct(l.ease.amount)} less while ${name(l.ease.control)} is held.`;
  });
  const combine = row.combine === "sum" ? " Lines add up." : row.combine === "min" ? " The least line wins." : "";
  const limit = row.limit !== undefined && row.limit < 1 ? ` Never above ${pct(row.limit)}.` : "";
  return parts.join(" ") + combine + limit;
}

/** The checks under the response table: helpful warnings, never refusals. */
export function wiringChecks(bp: Blueprint, controls: { id: string; name: string }[]): { ok: boolean; text: string }[] {
  const out: { ok: boolean; text: string }[] = [];
  const name = (id: string) => controls.find((c) => c.id === id)?.name ?? id;
  const joined = joinedToCockpit(bp);
  if (!bp.components.some((c) => c.kind === "cockpit")) out.push({ ok: false, text: "No cockpit: nothing answers the controls" });
  const loose = bp.components.filter((c) => channelsOf(bp, c.id).length && !joined.has(c.id));
  if (loose.length && joined.size) out.push({ ok: false, text: `Not welded to the cockpit, so they won't answer: ${loose.map((c) => c.label).join(", ")}` });
  const unwired = bp.components.filter((c) => channelsOf(bp, c.id).some((ch) => !bp.mix.rows.find((r) => r.channel === ch)?.lines.length));
  out.push(unwired.length ? { ok: false, text: `Not wired: ${unwired.map((c) => c.label).join(", ")}` } : { ok: true, text: "Every engine and device is driven by a control" });
  out.sort((a, b) => Number(a.ok) - Number(b.ok));
  const st = stats(bp);
  for (const c of ["forward", "reverse"]) {
    const r = response(bp, { [c]: 1 }, st);
    if (Math.abs(r.turn) > 0.05) out.push({ ok: false, text: `${name(c)} also turns the ship (${r.turn.toFixed(2)} rad/s²)` });
  }
  const l = response(bp, { left: 1 }, st).turn;
  const r = response(bp, { right: 1 }, st).turn;
  if (l <= 0 && Math.abs(l) > 1e-6) out.push({ ok: false, text: `${name("left")} turns the ship right` });
  if (r >= 0 && Math.abs(r) > 1e-6) out.push({ ok: false, text: `${name("right")} turns the ship left` });
  if (l > 0 && r < 0 && Math.abs(l + r) > 0.05 * Math.max(Math.abs(l), Math.abs(r))) out.push({ ok: false, text: `${name("left")} and ${name("right")} turn unequally (${l.toFixed(2)} / ${(-r).toFixed(2)} rad/s²)` });
  if (out.length === 1 && out[0].ok) out.push({ ok: true, text: "Forward and Reverse don't turn the ship; the turns mirror each other" });
  return out;
}

// ---------- mirror (§5) ----------

/** The other side's name: "Thruster BL" ↔ "Thruster BR", "Tank L" ↔ "Tank R". */
function mirrorLabel(label: string): string {
  const m = /^(.*?)(\s)(L|R|BL|BR|FL|FR)$/.exec(label);
  if (!m) return `${label} (mirror)`;
  const swap: Record<string, string> = { L: "R", R: "L", BL: "BR", BR: "BL", FL: "FR", FR: "FL" };
  return `${m[1]}${m[2]}${swap[m[3]]}`;
}

/**
 * A mirror image of a component on the other side of the ship's middle line (x = 0, the cockpit's
 * axis): its shape reflected, welded where it then touches, fed if an engine, and wired as the
 * mirror of its own wiring (turn left and turn right swapped). Returns null, with the reason, if the
 * other side is taken or the part sits on the middle line.
 */
export function mirrorComponent(bp: Blueprint, compId: string, controls: { left: string; right: string } = { left: "left", right: "right" }): { bp: Blueprint; id: string } | { error: string } {
  const c = component(bp, compId);
  const box = componentBounds(bp, c);
  if (box.minX < -1e-6 && box.maxX > 1e-6) return { error: `${c.label} sits across the ship's middle line: there is no other side to mirror it to.` };
  const made = instantiate(bp, bp, compId, mirrorLabel(c.label));
  for (const b of made.bodies) {
    b.position = { x: round(-b.position.x), y: b.position.y };
    b.angle = b.angle ? round(-b.angle, 9) : 0;
    // Reflected across the body's own vertical axis, then turned back to anticlockwise.
    if (b.shape.kind === "polygon") b.shape = { kind: "polygon", vertices: b.shape.vertices.map((v) => ({ x: -v.x, y: v.y })).reverse() };
    for (const a of ["outlet", "direction"] as const) {
      const v = b.injector?.[a];
      if (v && b.injector) b.injector[a] = { x: 0 - v.x || 0, y: v.y }; // no −0
    }
  }
  for (const j of made.joints) {
    j.anchorA = { x: -j.anchorA.x, y: j.anchorA.y };
    j.anchorB = { x: -j.anchorB.x, y: j.anchorB.y };
  }
  const others = bp.components.flatMap((o) => o.bodies.map((id) => body(bp, id)));
  if (made.bodies.some((m) => others.some((o) => overlaps(worldVertices(m), worldVertices(o))))) return { error: `The other side is taken: a mirrored ${c.label} would overlap a part there.` };
  let out = addComponent(bp, made, 0, 0);
  // Its wiring: the original's lines with left and right swapped.
  const swap = (k: string) => (k === controls.left ? controls.right : k === controls.right ? controls.left : k);
  const from = channelsOf(bp, compId);
  const to = channelsOf(out, made.comp.id);
  from.forEach((ch, i) => {
    const row = bp.mix.rows.find((r) => r.channel === ch);
    if (!row || !to[i]) return;
    out = setRow(out, to[i], () => ({ ...structuredClone(row), channel: to[i], lines: row.lines.map((l) => ({ ...l, control: swap(l.control), ...(l.ease ? { ease: { ...l.ease, control: swap(l.ease.control) } } : {}) })) }));
  });
  return { bp: out, id: made.comp.id };
}
