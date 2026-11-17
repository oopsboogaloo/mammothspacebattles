// The blueprint designer's model (docs/blueprint/spec.md): a ship as the player edits it. No DOM.
//
// A blueprint keeps the ship in the scenario format (bodies, joints, links), so it flies unchanged,
// plus how its bodies group into components and its wiring (a core Mixer). Edits are pure: each
// returns a new blueprint. The Thrust 1 preset is the Thrust game's ship exactly, until edited.
import type { BodyInput, JointInput, LinkInput, Mixer, MixerRow, Shape, Vec2 } from "../../core/index.ts";
import { bodyMass, inertiaOf, mixerValues, normalizePolygon, polygonArea, steerMixer } from "../../core/index.ts";
import { BULLET, burnEfficiency, CONTAINERS, containerSpec, GUN, gunSpeed, holdPressure, MIXTURE, maxWall, POWER, PRESSURE, powerSpec, WALL, weldLimits, type ContainerKind, type PowerKind } from "./rules.ts";

export type Kind = "cockpit" | "engine" | "tank" | "storage" | "weapon" | "generator" | "battery" | "utility" | "frame";

export const KINDS: { kind: Kind; label: string; short: string }[] = [
  { kind: "cockpit", label: "Cockpits", short: "CO" },
  { kind: "engine", label: "Engines", short: "EN" },
  { kind: "tank", label: "Tanks", short: "TA" },
  { kind: "storage", label: "Storage", short: "ST" },
  { kind: "weapon", label: "Weapons", short: "WE" },
  { kind: "generator", label: "Generators", short: "GE" },
  { kind: "battery", label: "Batteries", short: "BA" },
  { kind: "utility", label: "Utilities", short: "UT" },
  { kind: "frame", label: "Frames", short: "FR" },
];

export interface Component {
  id: string;
  kind: Kind;
  label: string;
  /** Its bodies' ids; the first is its main body (an engine's head, which carries the injector). */
  bodies: string[];
  /**
   * Which catalogue part it was made from, e.g. "railgun", or "railgun_og": the original Thrust
   * ship's parts are kept as they are (THRUST OG) while the regular parts are improved.
   */
  part?: string;
  /** A double engine's heads (an engine has one, its first body, when this is absent). */
  heads?: string[];
  /** Wall thickness, m: a container's setting (the design rules, §1); every other part is 0.1. */
  wall?: number;
  /** A regular engine's shape (design rules §5): a chamber, a throat, and a nozzle. See `buildRocket`. */
  rocket?: Rocket;
  /** A trapezoid or triangle part: its outline as the player sets it (§16). */
  form?: Form;
  /** A container's blast while it can hold nothing (its body then has none), kept for when it can again. */
  blast?: NonNullable<BodyInput["explosive"]>;
}

/**
 * A trapezoid or a triangle, in its body's frame: the base along the bottom (y = −height/2), the
 * top (a trapezoid's) or the apex (a triangle's, `apex` along from the middle) at the top; then
 * turned anticlockwise by `turn` (0, 90, 180 or 270°), so its sides stay square to the grid.
 */
export type Form = { kind: "trapezoid"; base: number; top: number; height: number; turn: number } | { kind: "triangle"; base: number; height: number; apex: number; turn: number };

/** A form's outline, anticlockwise, centred on its bounding box. */
export function formVertices(f: Form): Vec2[] {
  const h = f.height / 2;
  const raw = f.kind === "trapezoid" ? [{ x: -f.base / 2, y: -h }, { x: f.base / 2, y: -h }, { x: f.top / 2, y: h }, { x: -f.top / 2, y: h }] : [{ x: -f.base / 2, y: -h }, { x: f.base / 2, y: -h }, { x: f.apex, y: h }];
  const box = boundsOf(raw);
  const cx = (box.minX + box.maxX) / 2;
  const t = (((Math.round(f.turn / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  // Exact quarter turns: no rounding error, so sides stay exactly square to the grid and weld.
  const turn = (v: Vec2): Vec2 => [v, { x: -v.y, y: v.x }, { x: -v.x, y: -v.y }, { x: v.y, y: -v.x }][t];
  return raw.map((v) => turn({ x: round(v.x - cx), y: v.y })).map((v) => ({ x: round(v.x) || 0, y: round(v.y) || 0 }));
}

export interface Ship {
  bodies: BodyInput[];
  joints: JointInput[];
  links: LinkInput[];
}

export interface Blueprint {
  format: 1;
  /** What the player's actions are called on screen in this ship (by control id), where the player has named them. */
  labels?: Record<string, string>;
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

const THRUST_PARTS: Record<string, [Kind, string, string]> = {
  hull: ["cockpit", "Cockpit", "cockpit"],
  "tank-l": ["tank", "Tank L", "tank"],
  "tank-r": ["tank", "Tank R", "tank"],
  "gen-l": ["generator", "Generator L", "generator"],
  "gen-r": ["generator", "Generator R", "generator"],
  battery: ["battery", "Battery", "battery"],
  "mag-l": ["storage", "Magazine L", "magazine"],
  "mag-r": ["storage", "Magazine R", "magazine"],
  gun: ["weapon", "Railgun", "railgun"],
  main: ["engine", "Main thruster", "main-thruster"],
  "back-l": ["engine", "Thruster BL", "light-thruster"],
  "back-r": ["engine", "Thruster BR", "light-thruster"],
  "front-l": ["engine", "Thruster FL", "light-thruster"],
  "front-r": ["engine", "Thruster FR", "light-thruster"],
  tractor: ["utility", "Tractor projector", "tractor-projector"],
  tether: ["utility", "Tether winch", "tether-winch"],
  shield: ["utility", "Shield emitter", "shield-emitter"],
};

const strip = <T>(x: T): T => JSON.parse(JSON.stringify(x).replaceAll("p{n}-", "")) as T;

/** The ship of the Thrust game's first level, its ids without the game's `p{n}-` (ids are a ship's own here). */
export function thrustShip(scenario: { world: { thrust: { ship: { bodies: BodyInput[]; joints?: JointInput[]; links?: LinkInput[] }; mix: Parameters<typeof steerMixer>[0] } } }): { ship: Ship; mix: Mixer } {
  const s = scenario.world.thrust.ship;
  const ship = strip({ bodies: s.bodies, joints: s.joints ?? [], links: s.links ?? [] });
  const mix = steerMixer(scenario.world.thrust.mix);
  // The gun, the tractor beam and the shield on the player's actions A, B and C (the game's keys).
  for (const [ch, action] of [["fire", "action-a"], ["tractor", "action-b"], ["shield", "action-c"]]) mix.rows.push({ channel: ch, lines: [{ control: action, weight: 1 }] });
  return { ship, mix };
}

/** Groups a ship's bodies into components: an engine is its head and the walls welded only to it. */
export function groupComponents(ship: Ship, names: Record<string, [Kind, string, string?]> = {}): Component[] {
  const jointsOf = (id: string) => ship.joints.filter((j) => j.a === id || j.b === id);
  const taken = new Set<string>();
  const out: Component[] = [];
  for (const b of ship.bodies) {
    if (!b.injector || taken.has(b.id)) continue;
    const walls = jointsOf(b.id)
      .map((j) => (j.a === b.id ? j.b : j.a))
      .filter((w) => jointsOf(w).every((j) => j.a === b.id || j.b === b.id));
    const [kind, label, part] = names[b.id] ?? ["engine", b.id];
    out.push({ id: b.id, kind, label, bodies: [b.id, ...walls], ...(part ? { part } : {}) });
    taken.add(b.id);
    for (const w of walls) taken.add(w);
  }
  for (const b of ship.bodies) {
    if (taken.has(b.id)) continue;
    const [kind, label, part] = names[b.id] ?? [guessKind(b), b.id];
    out.push({ id: b.id, kind, label, bodies: [b.id], ...(part ? { part } : {}) });
  }
  // In the ship's own order, by each component's main body.
  const order = new Map(ship.bodies.map((b, i) => [b.id, i]));
  return out.sort((p, q) => order.get(p.bodies[0])! - order.get(q.bodies[0])!);
}

function guessKind(b: BodyInput): Kind {
  if (b.tractor) return "cockpit";
  if (b.magazine) return "weapon";
  if (b.ammo) return "storage";
  if (b.contents?.length) return "tank";
  return "utility";
}

/**
 * THRUST OG: the Thrust game's ship exactly as it is, every part an "_og" part (railgun_og,
 * cockpit_og, …). Kept untouched as the regular parts are improved; not for the final game's list.
 */
export function thrustOgPreset(scenario: Parameters<typeof thrustShip>[0]): Blueprint {
  const { ship, mix } = thrustShip(scenario);
  const names = Object.fromEntries(Object.entries(THRUST_PARTS).map(([id, [kind, label, part]]) => [id, [kind, `${label} OG`, `${part}_og`] as [Kind, string, string]]));
  return { format: 1, id: "preset-thrust-og", name: "THRUST OG", preset: true, rev: 1, ship, components: groupComponents(ship, names), mix };
}

/**
 * THRUST 1: the same ship built from the regular parts, which differ from the OG ones where they
 * have been improved. So far: the magazines hold the shells (60 each) and pass them to the railgun
 * through ammo links (WPN-015), and go off when destroyed only while they hold some; the railgun
 * holds none of its own, and stands on the shield emitter instead of through it.
 */
export function thrustPreset(scenario: Parameters<typeof thrustShip>[0]): Blueprint {
  const { ship, mix } = thrustShip(scenario);
  const gun = ship.bodies.find((b) => b.id === "gun");
  const mags = ship.bodies.filter((b) => b.id === "mag-l" || b.id === "mag-r");
  if (gun?.magazine && mags.length) {
    const each = Math.floor(gun.magazine.count / mags.length);
    for (const m of mags) m.ammo = { count: each, shell: structuredClone(gun.magazine.shell) };
    gun.magazine.count -= each * mags.length;
  }
  let bp: Blueprint = { format: 1, id: "preset-thrust-1", name: "THRUST 1", preset: true, rev: 1, ship, components: groupComponents(ship, THRUST_PARTS), mix };
  // Its tanks, magazines, battery, generators and what draws power, from the design rules: at Thrust's sizes, Thrust's figures.
  for (const c of bp.components) applyRules(bp, c.id);
  reammo(bp);
  // The railgun stands on the shield emitter, not through it (in the game it overlaps it by 0.12 m).
  const lift = overlapLift(bp, "gun");
  if (lift > 0) bp = moveComponent(bp, "gun", 0, lift);
  // Engines with real chambers (Chloe, 16 November 2026; design rules §5). The wing tanks give up
  // 0.2 m of their height to make room for the light thrusters' chambers; those move in with the
  // tanks' faces. Each engine keeps its exit and its mass.
  for (const side of ["l", "r"]) {
    const tank = body(bp, `tank-${side}`);
    if (tank.shape.kind !== "box") continue;
    const cut = (tank.shape.height - THRUST_TANK_HEIGHT) / 2;
    bp = setParam(bp, `tank-${side}`, "height", THRUST_TANK_HEIGHT);
    bp = moveComponent(bp, `back-${side}`, 0, cut);
    bp = moveComponent(bp, `front-${side}`, 0, -cut);
  }
  for (const c of bp.components.filter((x) => x.kind === "engine")) bp = toRocket(bp, c.id, c.id === "main" ? { chamberLength: 0.2, throat: 0.8 } : { chamberLength: LIGHT_CHAMBER, throat: 0.5 });
  for (const c of bp.components) bp = reweld(bp, c.id);
  return bp;
}

/** THRUST 1's wing tanks, m tall (THRUST OG's are 1.0): room for the light thrusters' chambers. */
const THRUST_TANK_HEIGHT = 0.8;
/**
 * THRUST 1's light thrusters' chambers, m long: 0.8 m wide over their 0.5 m throats, L* 0.304 m, just
 * over the L* rule's 0.3 m, so they burn completely (Chloe's choice B, 17 November 2026; 0.1 m before).
 */
const LIGHT_CHAMBER = 0.19;

/**
 * An engine of THRUST OG's kind (a head and two flared walls) rebuilt as a rocket with a chamber of
 * the given length and a throat of the given width, keeping its head, its nozzle's length and exit,
 * its walls' thickness and its total mass (the head gives up what the new walls weigh).
 */
function toRocket(bp: Blueprint, compId: string, shape: { chamberLength: number; throat: number }): Blueprint {
  const c = component(bp, compId);
  const g = engineGeom(bp, c);
  const total = c.bodies.reduce((s, id) => s + body(bp, id).mass, 0);
  const exit = g.throat + 2 * g.length * Math.tan(g.flare * DEG);
  const wall = round(g.wall, 6);
  const r: Rocket = {
    chamberWidth: g.headWidth,
    headHeight: g.headHeight,
    chamberLength: shape.chamberLength,
    throat: shape.throat,
    nozzleLength: round(g.length, 6),
    flare: round(Math.atan((exit - shape.throat) / (2 * g.length)) / DEG, 6),
    wall,
    nozzleMass: body(bp, c.bodies[1]).mass,
  };
  const out = buildRocket(bp, compId, r);
  const oc = component(out, compId);
  const head = body(out, oc.bodies[0]);
  head.mass = round(total - oc.bodies.slice(1).reduce((s, id) => s + body(out, id).mass, 0), 6);
  return out;
}

// ---------- the Mastodon Gun Ship (Chloe's sketch, 16 November 2026) ----------

/**
 * The Mastodon Gun Ship, from Chloe's drawing (1 m to its scale bar): a cockpit over a fuel tank,
 * a magazine each side with a railgun on top, a trapezoid fuel tank, a double engine (two heads back
 * to back: the rear nozzle drives it forward, the front one back), and a trapezoid mount out to an
 * outer railgun. Its parts are the regular ones (Thrust's materials, railgun, magazine and engine
 * settings), with trapezoids for the shapes Thrust has no part for.
 */
export function mastodonPreset(scenario: Parameters<typeof thrustShip>[0]): Blueprint {
  const t = thrustShip(scenario).ship;
  const src = (id: string): BodyInput => structuredClone(t.bodies.find((b) => b.id === id)!);
  const place = (b: BodyInput, id: string, x: number, y: number, angle = 0): BodyInput => ({ ...b, id, position: { x, y }, velocity: { x: 0, y: 0 }, angle, angularVelocity: 0 });
  const bodies: BodyInput[] = [];
  const joints: JointInput[] = [];
  const components: Component[] = [];
  const part = (c: Component, ...bs: BodyInput[]) => {
    bodies.push(...bs);
    components.push(c);
  };
  const scaled = (b: BodyInput, k: number) => {
    b.mass = round(b.mass * k);
    for (const st of b.contents ?? []) {
      st.capacity = round(st.capacity * k, 9);
      st.mass = round(st.mass * k, 9);
    }
    return b;
  };
  // Chemically propelled guns and bullet magazines (Chloe, 16 November 2026): it carries no power for railguns.
  const gunBody = src("gun");
  const shell = structuredClone(BULLET);

  // The cockpit (Thrust's, without the tractor beam), over the centre tank.
  const hull = src("hull");
  delete hull.tractor;
  hull.shape = { kind: "polygon", vertices: [{ x: -0.6, y: -0.375 }, { x: 0.6, y: -0.375 }, { x: 0.6, y: 0.375 }, { x: 0.3, y: 0.775 }, { x: -0.3, y: 0.775 }, { x: -0.6, y: 0.375 }] };
  part({ id: "hull", kind: "cockpit", label: "Cockpit", part: "cockpit", bodies: ["hull"] }, place(hull, "hull", 0, 1.025));
  const tank = src("tank-l");
  const tankArea = 1.5; // Thrust's tank: 1.5 × 1 m
  // A copy: scaling mutates what it is given, and the side tanks are made from the same source.
  const centre = scaled({ ...structuredClone(tank), shape: { kind: "box", width: 1.2, height: 0.65 } }, (1.2 * 0.65) / tankArea);
  part({ id: "tank-c", kind: "tank", label: "Centre tank", part: "tank", bodies: ["tank-c"] }, place(centre, "tank-c", 0, 0.325));

  const mag = src("mag-l");
  for (const [s, l] of [[-1, "L"], [1, "R"]] as const) {
    const side = l.toLowerCase();
    // Magazine: 0.4 × 1.4 m, Thrust's per area; 100 shells each for four guns.
    const m = scaled({ ...structuredClone(mag), shape: { kind: "box", width: 0.4, height: 1.4 } }, (0.4 * 1.4) / (0.7 * 0.45));
    m.ammo = { count: 0, shell: structuredClone(shell) };
    part({ id: `mag-${side}`, kind: "storage", label: `Bullet magazine ${l}`, part: "bullet-magazine", bodies: [`mag-${side}`] }, place(m, `mag-${side}`, s * 0.8, 0.7));
    // The railguns: on the magazine, and out on the mount. No shells of their own: the magazines feed them.
    for (const [id, label, x, y] of [[`gun-${side}`, `Gun ${l}`, s * 0.75, 1.75], [`gun-o${side}`, `Outer gun ${l}`, s * 3.0, 0.7]] as const) {
      const g = structuredClone(gunBody);
      g.magazine = { ...g.magazine!, count: 0, shell: structuredClone(shell), railgun: { ...g.magazine!.railgun!, channel: id } };
      part({ id, kind: "weapon", label, part: "gun", bodies: [id] }, place(g, id, x, y));
    }
    // The side tank: a trapezoid, its long side (1.4 m) on the magazine, its short (0.7 m) on the engine.
    const form: Form = { kind: "trapezoid", base: 1.4, top: 0.7, height: 0.75, turn: s < 0 ? 90 : 270 };
    const st = scaled({ ...structuredClone(tank), shape: { kind: "polygon", vertices: formVertices(form) } }, ((1.4 + 0.7) / 2) * 0.75 / tankArea);
    part({ id: `tank-${side}`, kind: "tank", label: `Tank ${l}`, part: "trapezoid-tank", bodies: [`tank-${side}`], form }, place(st, `tank-${side}`, s * 1.375, 0.7));
    // The double engine: two heads back to back across y = 0.7, each with its own walls.
    const cx = s * 2.05;
    const head = src("main");
    const wall = src("main-wall-a");
    const ids = { rear: `eng-${side}`, front: `eng-${side}-rev` };
    const heads: BodyInput[] = [];
    for (const [id, y, angle] of [[ids.rear, 0.525, 0], [ids.front, 0.875, Math.PI]] as const) {
      const h = place(structuredClone(head), id, cx, y, angle);
      h.shape = { kind: "box", width: 0.6, height: 0.35 };
      h.mass = 1.2;
      h.explosive = { ...h.explosive!, charge: round(1.2 * 0.008, 9) };
      h.injector = { ...h.injector!, channel: id };
      heads.push(h);
      for (const [w, x] of [["a", -0.25], ["b", 0.25]] as const) {
        const wb = place(structuredClone(wall), `${id}-w${w}`, 0, 0, angle);
        wb.mass = 0.4;
        wb.position = worldPoint(h, { x, y: -0.5 });
        bodies.push(wb);
        joints.push({ id: `${id}-w${w}`, a: id, b: wb.id, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 0 }, limits: { ...WELD_PRESETS[1].limits }, yield: WELD_PRESETS[1].yield });
      }
    }
    part({ id: ids.rear, kind: "engine", label: `Engine ${l}`, part: "double-engine", bodies: [ids.rear, `${ids.rear}-wa`, `${ids.rear}-wb`, ids.front, `${ids.front}-wa`, `${ids.front}-wb`], heads: [ids.rear, ids.front] }, ...heads);
    // The mount: a trapezoid from the engine (0.7 m) to the outer gun (0.35 m).
    const mf: Form = { kind: "trapezoid", base: 0.7, top: 0.35, height: 0.5, turn: s < 0 ? 90 : 270 };
    const mount: BodyInput = { id: `mount-${side}`, shape: { kind: "polygon", vertices: formVertices(mf) }, mass: 1.2, position: { x: s * 2.6, y: 0.7 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.3, material: { ...hull.material! } };
    part({ id: `mount-${side}`, kind: "frame", label: `Mount ${l}`, part: "trapezoid", bodies: [`mount-${side}`], form: mf }, mount);
  }
  // In the ship's order: middle first, then out to each side.
  let bp: Blueprint = { format: 1, id: "preset-mastodon", name: "MASTODON GUN SHIP", preset: true, rev: 1, ship: { bodies, joints, links: [] }, components, mix: { rules: structuredClone(thrustShip(scenario).mix.rules ?? []), rows: [] } };
  for (const c of components.filter((x) => x.kind === "engine")) {
    for (const u of engineUnits(bp, c)) {
      const h = body(bp, u.head);
      h.injector = { ...h.injector!, rate: 0, economy: h.injector!.economy };
    }
    bp = buildEngine(bp, c, { headWidth: 0.6, headHeight: 0.35, throat: 0.4, wall: 0.1, length: 0.7, flare: 9 });
    bp = setParam(bp, c.id, "rate", MASTODON_FLOW);
  }
  for (const c of components) applyRules(bp, c.id);
  for (const c of components) bp = reweld(bp, c.id);
  refeed(bp);
  reammo(bp);
  relink(bp);
  // Its wiring: each engine's rear nozzle forward, its front one back; turning, one forward and the
  // other back, at a quarter (about Thrust's turn); the four railguns on Action A.
  const row = (channel: string, lines: [string, number][]): MixerRow => ({ channel, lines: lines.map(([control, weight]) => ({ control, weight })) });
  bp.mix.rows = [
    row("eng-l", [["forward", 1], ["right", MASTODON_TURN]]),
    row("eng-l-rev", [["reverse", 1], ["left", MASTODON_TURN]]),
    row("eng-r", [["forward", 1], ["left", MASTODON_TURN]]),
    row("eng-r-rev", [["reverse", 1], ["right", MASTODON_TURN]]),
    ...["gun-l", "gun-r", "gun-ol", "gun-or"].map((g) => row(g, [["action-a", 1]])),
  ];
  return bp;
}

/** Each nozzle's flow at full, kg/s; and how hard the engines work to turn the ship. */
const MASTODON_FLOW = 5.4;
const MASTODON_TURN = 0.25;

// ---------- the Stegodon (Chloe's sketch, 16 November 2026) ----------

/**
 * The Stegodon: a lighter gunship, from Chloe's drawing, with the cockpit of the Mastodon's size for
 * scale. Down the middle: the cockpit, a bullet magazine across the ship, a fuel tank tapering to a
 * boom, and a small double engine across the tail, firing left and right to steer. Each side: a main
 * engine angled out at the slope of the cockpit's top corners (its chamber lying along them), a
 * triangular bullet magazine in the wedge between engine and cockpit, and a gun outboard of the
 * engine on a triangular mount. Forward fires both main engines; turning alone fires the tail;
 * forward and a turn fire one main engine and the opposite side of the tail.
 */
export function stegodonPreset(scenario: Parameters<typeof thrustShip>[0]): Blueprint {
  const t = thrustShip(scenario).ship;
  const src = (id: string): BodyInput => structuredClone(t.bodies.find((b) => b.id === id)!);
  const at = (b: BodyInput, id: string, x: number, y: number, angle = 0): BodyInput => ({ ...b, id, position: { x: round(x), y: round(y) }, velocity: { x: 0, y: 0 }, angle, angularVelocity: 0 });
  const hull = src("hull");
  delete hull.tractor;
  const plate = (id: string, shape: Shape, mass: number, x: number, y: number): BodyInput => ({ id, shape, mass, position: { x: round(x), y: round(y) }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.3, material: { ...hull.material! } });
  const bodies: BodyInput[] = [];
  const components: Component[] = [];
  const add = (c: Component, ...bs: BodyInput[]) => {
    bodies.push(...bs);
    components.push(c);
  };
  // Down the middle: the cockpit (the Mastodon's), its bottom at y = 0.
  hull.shape = { kind: "polygon", vertices: [{ x: -0.6, y: -0.375 }, { x: 0.6, y: -0.375 }, { x: 0.6, y: 0.375 }, { x: 0.3, y: 0.775 }, { x: -0.3, y: 0.775 }, { x: -0.6, y: 0.375 }] };
  add({ id: "hull", kind: "cockpit", label: "Cockpit", part: "cockpit", bodies: ["hull"] }, at(hull, "hull", 0, 0.375));
  const mag = src("mag-l");
  const bulletMag = (id: string, shape: Shape, x: number, y: number): BodyInput => ({ ...at(structuredClone(mag), id, x, y), shape, ammo: { count: 0, shell: structuredClone(BULLET) } });
  add({ id: "mag-c", kind: "storage", label: "Bullet magazine", part: "bullet-magazine", bodies: ["mag-c"] }, bulletMag("mag-c", { kind: "box", width: 1.2, height: 0.3 }, 0, -0.15));
  const tank = src("tank-l");
  add({ id: "tank", kind: "tank", label: "Tank", part: "tank", bodies: ["tank"] }, { ...at(tank, "tank", 0, -0.775), shape: { kind: "box", width: 1.2, height: 0.95 } });
  const taper: Form = { kind: "trapezoid", base: 1.2, top: 0.3, height: 0.2, turn: 180 };
  add({ id: "taper", kind: "frame", label: "Taper", part: "trapezoid", bodies: ["taper"], form: taper }, plate("taper", { kind: "polygon", vertices: formVertices(taper) }, 0.6, 0, -1.35));
  const boom: Form = { kind: "trapezoid", base: 0.3, top: 0.3, height: 0.9, turn: 0 };
  add({ id: "boom", kind: "frame", label: "Boom", part: "trapezoid", bodies: ["boom"], form: boom }, plate("boom", { kind: "polygon", vertices: formVertices(boom) }, 1.0, 0, -1.9));
  // Each side.
  const slope = { x: 0.6, y: 0.8 }; // the cockpit's top corners, and the main engines' axis: 36.87° from upright
  const engine: Rocket = { chamberWidth: 0.8, chamberLength: 0.6, headHeight: 0.15, throat: 0.25, nozzleLength: 1.0, flare: round(Math.atan((0.8 - 2 * 0.1 - 0.25) / 2 / 1.0) / DEG, 6), wall: 0.1, nozzleMass: 0.6 };
  const gunBody = src("gun");
  for (const [s, l] of [[-1, "L"], [1, "R"]] as const) {
    const side = l.toLowerCase();
    // The main engine: its inner side along the cockpit's slope, its head's back at the cockpit's top corner.
    const u = { x: -s * slope.x, y: slope.y }; // from the nozzle to the head
    const inward = { x: -s * slope.y, y: -slope.x }; // its inner side's way, toward the cockpit
    const corner = { x: s * 0.3, y: 1.15 };
    const centre = { x: corner.x - u.x * (engine.headHeight / 2) - inward.x * (engine.chamberWidth / 2), y: corner.y - u.y * (engine.headHeight / 2) - inward.y * (engine.chamberWidth / 2) };
    const head = at(src("main"), `eng-${side}`, centre.x, centre.y, s === -1 ? -Math.asin(0.6) : Math.asin(0.6));
    head.shape = { kind: "box", width: engine.chamberWidth, height: engine.headHeight };
    head.mass = 1.0;
    head.injector = { ...head.injector!, channel: `eng-${side}` };
    add({ id: `eng-${side}`, kind: "engine", label: `Engine ${l}`, part: "main-thruster", bodies: [`eng-${side}`], rocket: engine }, head);
    // The side magazine: a triangle in the wedge between the engine's inner side and the cockpit, centre magazine and tank.
    const p1 = { x: s * 0.6, y: 0.75 };
    const p2 = { x: p1.x + u.x * -0.9, y: p1.y - u.y * 0.9 };
    const p3 = { x: s * 0.6, y: -0.3 };
    const c3 = { x: (p1.x + p2.x + p3.x) / 3, y: (p1.y + p2.y + p3.y) / 3 };
    const tri = [p1, p2, p3].map((p) => ({ x: round(p.x - c3.x), y: round(p.y - c3.y) }));
    add({ id: `mag-${side}`, kind: "storage", label: `Side magazine ${l}`, part: "bullet-magazine", bodies: [`mag-${side}`] }, bulletMag(`mag-${side}`, { kind: "polygon", vertices: polygonArea(tri) < 0 ? [...tri].reverse() : tri }, c3.x, c3.y));
    // The gun, outboard of the engine, upright; a triangular mount between its inner face and the engine's outer side.
    const outer = { x: corner.x - inward.x * engine.chamberWidth, y: corner.y - inward.y * engine.chamberWidth }; // the head's outer back corner
    const face = s * 1.3; // the gun's inner face
    const along = (face - outer.x) / u.x;
    const xPt = { x: face, y: outer.y + u.y * along };
    const yPt = { x: xPt.x + u.x * 0.3, y: xPt.y + u.y * 0.3 };
    const zPt = { x: face, y: xPt.y + 0.5 };
    const cm = { x: (xPt.x + yPt.x + zPt.x) / 3, y: (xPt.y + yPt.y + zPt.y) / 3 };
    const mt = [xPt, yPt, zPt].map((p) => ({ x: round(p.x - cm.x), y: round(p.y - cm.y) }));
    add({ id: `mount-${side}`, kind: "frame", label: `Mount ${l}`, part: "triangle", bodies: [`mount-${side}`] }, plate(`mount-${side}`, { kind: "polygon", vertices: polygonArea(mt) < 0 ? [...mt].reverse() : mt }, 0.5, cm.x, cm.y));
    const g = at(structuredClone(gunBody), `gun-${side}`, face + s * 0.15, xPt.y + 0.35);
    g.magazine = { ...g.magazine!, count: 0, shell: structuredClone(BULLET), railgun: { ...g.magazine!.railgun!, channel: `gun-${side}` } };
    add({ id: `gun-${side}`, kind: "weapon", label: `Gun ${l}`, part: "gun", bodies: [`gun-${side}`] }, g);
  }
  let bp: Blueprint = { format: 1, id: "preset-stegodon", name: "STEGODON", preset: true, rev: 1, ship: { bodies, joints: [], links: [] }, components, mix: { rules: structuredClone(thrustShip(scenario).mix.rules ?? []), rows: [] } };
  // The main engines' walls, chambers and nozzles.
  for (const id of ["eng-l", "eng-r"]) {
    bp = buildRocket(bp, id, engine);
    bp = setParam(bp, id, "rate", STEGODON_MAIN_FLOW);
  }
  // The tail: a small double engine across the boom's end, firing left (eng-tail-l) and right (eng-tail-r).
  const mh = src("main");
  const tailHeads: BodyInput[] = [];
  const tailJoints: JointInput[] = [];
  const wall = src("main-wall-a");
  for (const [id, x, angle] of [["tail-l", -0.09, -Math.PI / 2], ["tail-r", 0.09, Math.PI / 2]] as const) {
    const h = at(structuredClone(mh), id, x, -2.5, angle);
    h.shape = { kind: "box", width: 0.3, height: 0.18 };
    h.mass = 0.3;
    h.explosive = { ...h.explosive!, charge: round(0.3 * 0.008, 9) };
    h.injector = { ...h.injector!, channel: id };
    tailHeads.push(h);
    for (const [w, wx] of [["a", -0.1], ["b", 0.1]] as const) {
      const wb = at(structuredClone(wall), `${id}-w${w}`, 0, 0, angle);
      wb.mass = 0.1;
      wb.position = worldPoint(h, { x: wx, y: -0.3 });
      bp.ship.bodies.push(wb);
      tailJoints.push({ id: `${id}-w${w}`, a: id, b: wb.id, anchorA: { x: 0, y: 0 }, anchorB: { x: 0, y: 0 }, limits: { ...WELD_PRESETS[1].limits }, yield: WELD_PRESETS[1].yield });
    }
  }
  bp.ship.bodies.push(...tailHeads);
  bp.ship.joints.push(...tailJoints);
  bp.components.push({ id: "tail-l", kind: "engine", label: "Tail engine", part: "double-engine", bodies: ["tail-l", "tail-l-wa", "tail-l-wb", "tail-r", "tail-r-wa", "tail-r-wb"], heads: ["tail-l", "tail-r"] });
  bp = buildEngine(bp, component(bp, "tail-l"), { headWidth: 0.3, headHeight: 0.18, throat: 0.2, wall: 0.05, length: 0.4, flare: 5 });
  bp = setParam(bp, "tail-l", "rate", STEGODON_TAIL_FLOW);
  for (const c of bp.components) applyRules(bp, c.id);
  for (const c of bp.components) bp = reweld(bp, c.id);
  refeed(bp);
  reammo(bp);
  relink(bp);
  // Its wiring, as Chloe drew it: forward, both main engines; a turn alone, the tail; forward and a
  // turn, the main engine on the side away from the turn (it turns the ship that way) and the tail.
  const row = (channel: string, lines: MixerRow["lines"]): MixerRow => ({ channel, lines });
  bp.mix.rows = [
    row("eng-l", [{ control: "forward", weight: 1, ease: { control: "left", amount: 1 } }]),
    row("eng-r", [{ control: "forward", weight: 1, ease: { control: "right", amount: 1 } }]),
    row("tail-l", [{ control: "left", weight: 1 }]),
    row("tail-r", [{ control: "right", weight: 1 }]),
    row("gun-l", [{ control: "action-a", weight: 1 }]),
    row("gun-r", [{ control: "action-a", weight: 1 }]),
  ];
  return bp;
}

/** The Stegodon's main engines' flow and its tail's, each head, kg/s. */
const STEGODON_MAIN_FLOW = 3.4;
const STEGODON_TAIL_FLOW = 0.5;

// ---------- into the physics ----------

/**
 * The ship as the physics takes it: each polygon part's outline about its centroid (as the world
 * puts it) and its welds' anchors moved to match, so every weld starts where the designer put it.
 * (The world moves a polygon to its centroid but takes weld anchors as given: an outline drawn
 * about any other point, such as a form's bounding box or the Mastodon's cockpit, started with its
 * welds out of place, and the first step jolted the parts into line.)
 */
/**
 * The blueprint's ship as the physics takes it (centredShip), its welds stiff (DMG-009): the
 * designer's welds hold their parts true through an impact, so a hit reaches the damage rule as a
 * hit (the drop test, BPD-053). A weld touching an OG part keeps its game behaviour: THRUST OG lands
 * as it always has.
 */
export function physicsShip(bp: Blueprint): Ship {
  const og = new Set(bp.components.filter((c) => c.part?.endsWith("_og")).flatMap((c) => c.bodies));
  const out = centredShip(bp.ship);
  out.joints = out.joints.map((j) => (og.has(j.a) || og.has(j.b) ? j : { ...j, stiff: true }));
  return out;
}

export function centredShip(ship: Ship): Ship {
  const out = structuredClone(ship);
  const shift = new Map<string, Vec2>();
  for (const b of out.bodies) {
    if (b.shape.kind !== "polygon") continue;
    const { vertices, centroid } = normalizePolygon(b.shape.vertices);
    if (centroid.x === 0 && centroid.y === 0) continue;
    shift.set(b.id, centroid);
    b.shape = { kind: "polygon", vertices };
    const a = b.angle ?? 0;
    b.position = { x: b.position.x + centroid.x * Math.cos(a) - centroid.y * Math.sin(a), y: b.position.y + centroid.x * Math.sin(a) + centroid.y * Math.cos(a) };
  }
  if (!shift.size) return out;
  out.joints = out.joints.map((j) => {
    const sa = shift.get(j.a);
    const sb = shift.get(j.b);
    if (!sa && !sb) return j;
    const al = Math.hypot(j.anchorA.x, j.anchorA.y);
    return {
      ...j,
      // The weld's axis as its anchor gave it: the direction doesn't move with the frame.
      axis: j.axis ?? (al > 1e-9 ? { x: j.anchorA.x / al, y: j.anchorA.y / al } : { x: 1, y: 0 }),
      anchorA: sa ? { x: j.anchorA.x - sa.x, y: j.anchorA.y - sa.y } : j.anchorA,
      anchorB: sb ? { x: j.anchorB.x - sb.x, y: j.anchorB.y - sb.y } : j.anchorB,
    };
  });
  return out;
}

// ---------- the Phiomia (Chloe's sketch, 16 November 2026) ----------

/**
 * The Phiomia: the simplest ship, from Chloe's drawing, with the Mastodon's cockpit for scale. The
 * cockpit, a fuel tank on its top, and a spine up from the tank to a crossbar; at each end of the
 * crossbar a small rocket hangs, firing down past the cockpit's sides. The spine and crossbar are
 * only structure, so the engines are gentle. Forward fires both; a turn, the engine on its own
 * side; forward and a turn, that engine alone.
 */
export function phiomiaPreset(scenario: Parameters<typeof thrustShip>[0]): Blueprint {
  const t = thrustShip(scenario).ship;
  const src = (id: string): BodyInput => structuredClone(t.bodies.find((b) => b.id === id)!);
  const at = (b: BodyInput, id: string, x: number, y: number): BodyInput => ({ ...b, id, position: { x: round(x), y: round(y) }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 });
  const hull = src("hull");
  delete hull.tractor;
  const engine = phiomiaEngine();
  const bodies: BodyInput[] = [];
  const components: Component[] = [];
  const add = (c: Component, b: BodyInput) => {
    bodies.push(b);
    components.push(c);
  };
  const beam = (id: string, label: string, width: number, height: number, mass: number, x: number, y: number) => {
    const form: Form = { kind: "trapezoid", base: width, top: width, height, turn: 0 };
    add({ id, kind: "frame", label, part: "trapezoid", bodies: [id], form }, { id, shape: { kind: "polygon", vertices: formVertices(form) }, mass, position: { x: round(x), y: round(y) }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.3, material: { ...hull.material! } });
  };
  // The cockpit (the Mastodon's), its bottom at y = 0, its top 0.6 m across at y = 1.15.
  hull.shape = { kind: "polygon", vertices: [{ x: -0.6, y: -0.375 }, { x: 0.6, y: -0.375 }, { x: 0.6, y: 0.375 }, { x: 0.3, y: 0.775 }, { x: -0.3, y: 0.775 }, { x: -0.6, y: 0.375 }] };
  add({ id: "hull", kind: "cockpit", label: "Cockpit", part: "cockpit", bodies: ["hull"] }, at(hull, "hull", 0, 0.375));
  // The tank on the cockpit's top, as wide.
  add({ id: "tank", kind: "tank", label: "Tank", part: "tank", bodies: ["tank"] }, { ...at(src("tank-l"), "tank", 0, 1.5), shape: { kind: "box", width: 0.6, height: 0.7 } });
  // The spine, up to the crossbar; the crossbar between the engines' heads.
  beam("spine", "Spine", 0.15, 0.9, 0.5, 0, 2.3);
  beam("bar", "Crossbar", 1.7, 0.15, 0.9, 0, 2.825);
  // The engines: their heads level with the crossbar, at its ends.
  for (const [s, l] of [[-1, "L"], [1, "R"]] as const) {
    const id = `eng-${l.toLowerCase()}`;
    const head = at(src("main"), id, s * 1.1, 2.825);
    head.shape = { kind: "box", width: engine.chamberWidth, height: engine.headHeight };
    head.mass = 0.5;
    head.explosive = { ...head.explosive!, charge: round(0.5 * 0.008, 9) };
    head.injector = { ...head.injector!, channel: id };
    add({ id, kind: "engine", label: `Engine ${l}`, part: "main-thruster", bodies: [id], rocket: engine }, head);
  }
  let bp: Blueprint = { format: 1, id: "preset-phiomia", name: "PHIOMIA", preset: true, rev: 1, ship: { bodies, joints: [], links: [] }, components, mix: { rules: structuredClone(thrustShip(scenario).mix.rules ?? []), rows: [] } };
  for (const id of ["eng-l", "eng-r"]) {
    bp = buildRocket(bp, id, engine);
    bp = setParam(bp, id, "rate", PHIOMIA_FLOW);
  }
  for (const c of bp.components) applyRules(bp, c.id);
  for (const c of bp.components) bp = reweld(bp, c.id);
  refeed(bp);
  reammo(bp);
  relink(bp);
  // Chloe, 16 November 2026: a turn fires the engine on its own side. The cockpit hangs below the
  // engines, so Left swings the cockpit to the left (the engines' end to the right: clockwise).
  const row = (channel: string, lines: MixerRow["lines"]): MixerRow => ({ channel, lines });
  bp.mix.rows = [
    row("eng-l", [{ control: "forward", weight: 1, ease: { control: "right", amount: 1 } }, { control: "left", weight: 1 }]),
    row("eng-r", [{ control: "forward", weight: 1, ease: { control: "left", amount: 1 } }, { control: "right", weight: 1 }]),
  ];
  return bp;
}

/** The Phiomia's engines: 0.5 m chambers, a 0.25 m throat, nozzles flared to the chamber's inside. */
const phiomiaEngine = (): Rocket => ({ chamberWidth: 0.5, chamberLength: 0.35, headHeight: 0.15, throat: 0.25, nozzleLength: 0.5, flare: round(Math.atan((0.5 - 2 * 0.1 - 0.25) / 2 / 0.5) / DEG, 6), wall: 0.1, nozzleMass: 0.3 });
/** Each engine's flow at full, kg/s: gentle, for a ship held together by its beams. */
const PHIOMIA_FLOW = 0.3;

// ---------- the Loxodon (Chloe's sketch, 16 November 2026) ----------

/**
 * The Loxodon: a light transport and lander, from Chloe's drawing, with the Mastodon's cockpit for
 * scale. Each side of the cockpit: a fuel tank along its side (a trapezoid, its long side on the
 * cockpit), an engine outboard of it (a boxy chamber with a flared nozzle hanging below the ship,
 * its legs), and a fuel tank over both from the engine's top to the cockpit's sloping corner.
 * Forward fires both engines; a turn, the engine on the side away from it; forward and a turn,
 * that engine alone.
 */
export function loxodonPreset(scenario: Parameters<typeof thrustShip>[0]): Blueprint {
  const t = thrustShip(scenario).ship;
  const src = (id: string): BodyInput => structuredClone(t.bodies.find((b) => b.id === id)!);
  const at = (b: BodyInput, id: string, x: number, y: number): BodyInput => ({ ...b, id, position: { x: round(x), y: round(y) }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 });
  const hull = src("hull");
  delete hull.tractor;
  const engine = loxodonEngine();
  const bodies: BodyInput[] = [];
  const components: Component[] = [];
  const add = (c: Component, b: BodyInput) => {
    bodies.push(b);
    components.push(c);
  };
  // The cockpit (the Mastodon's), its bottom at y = 0: 1.2 m across, its corners sloping in from
  // y = 0.75 to its 0.6 m top at y = 1.15.
  hull.shape = { kind: "polygon", vertices: [{ x: -0.6, y: -0.375 }, { x: 0.6, y: -0.375 }, { x: 0.6, y: 0.375 }, { x: 0.3, y: 0.775 }, { x: -0.3, y: 0.775 }, { x: -0.6, y: 0.375 }] };
  add({ id: "hull", kind: "cockpit", label: "Cockpit", part: "cockpit", bodies: ["hull"] }, at(hull, "hull", 0, 0.375));
  const W = 0.275; // the side tanks' width, cockpit to engine
  const ex = 0.6 + W + engine.chamberWidth / 2; // the engines' centres
  for (const [s, l] of [[-1, "L"], [1, "R"]] as const) {
    const side = l.toLowerCase();
    // The side tank: a trapezoid, its 0.75 m base along the cockpit's side, its 0.5 m top along the engine's.
    const form: Form = { kind: "trapezoid", base: 0.75, top: 0.5, height: W, turn: s === -1 ? 90 : 270 };
    add({ id: `side-${side}`, kind: "tank", label: `Side tank ${l}`, part: "trapezoid-tank", bodies: [`side-${side}`], form }, { ...at(src("tank-l"), `side-${side}`, s * (0.6 + W / 2), 0.375), shape: { kind: "polygon", vertices: formVertices(form) } });
    // The engine, its head's top level with the side tank's top outer corner.
    const id = `eng-${side}`;
    const head = at(src("main"), id, s * ex, 0.625 - engine.headHeight / 2);
    head.shape = { kind: "box", width: engine.chamberWidth, height: engine.headHeight };
    head.mass = 0.6;
    head.explosive = { ...head.explosive!, charge: round(0.5 * 0.008, 9) };
    head.injector = { ...head.injector!, channel: id };
    add({ id, kind: "engine", label: `Engine ${l}`, part: "main-thruster", bodies: [id], rocket: engine }, head);
    // The top tank: over the engine and the side tank, up to the cockpit's sloping corner (three
    // quarters of the way up it), its roof straight from there to the engine's outer top corner.
    const outline = [
      { x: s * (ex + engine.chamberWidth / 2), y: 0.625 },
      { x: s * (0.6 + W), y: 0.625 },
      { x: s * 0.6, y: 0.75 },
      { x: s * 0.375, y: 1.05 },
    ];
    const { vertices, centroid } = normalizePolygon(outline.map((v) => ({ x: round(v.x), y: round(v.y) })));
    // It is a thin wedge, about 0.19 m deep at most: 0.1 m walls would fill it, so its walls are 0.05 m.
    add({ id: `top-${side}`, kind: "tank", label: `Top tank ${l}`, part: "tank", bodies: [`top-${side}`], wall: 0.05 }, { ...at(src("tank-l"), `top-${side}`, centroid.x, centroid.y), shape: { kind: "polygon", vertices: vertices.map((v) => ({ x: round(v.x), y: round(v.y) })) } });
  }
  let bp: Blueprint = { format: 1, id: "preset-loxodon", name: "LOXODON", preset: true, rev: 1, ship: { bodies, joints: [], links: [] }, components, mix: { rules: structuredClone(thrustShip(scenario).mix.rules ?? []), rows: [] } };
  for (const id of ["eng-l", "eng-r"]) {
    bp = buildRocket(bp, id, engine);
    bp = setParam(bp, id, "rate", LOXODON_FLOW);
  }
  for (const c of bp.components) applyRules(bp, c.id);
  for (const c of bp.components) bp = reweld(bp, c.id);
  refeed(bp);
  reammo(bp);
  relink(bp);
  // Gentle for landing: a turn alone runs the far engine at 40%; forward and a turn eases the near
  // engine to half, so the ship keeps lifting as it turns.
  const row = (channel: string, lines: MixerRow["lines"]): MixerRow => ({ channel, lines });
  bp.mix.rows = [
    row("eng-l", [{ control: "forward", weight: 1, ease: { control: "left", amount: LOXODON_EASE } }, { control: "right", weight: LOXODON_TURN }]),
    row("eng-r", [{ control: "forward", weight: 1, ease: { control: "right", amount: LOXODON_EASE } }, { control: "left", weight: LOXODON_TURN }]),
  ];
  return bp;
}

/** The Loxodon's engines: a 0.5 m square housing (head, chamber and throat), and a 0.45 m nozzle flared out to 0.54 m. */
const loxodonEngine = (): Rocket => ({ chamberWidth: 0.5, chamberLength: 0.3, headHeight: 0.1, throat: 0.25, nozzleLength: 0.45, flare: round(Math.atan((0.54 - 0.25) / 2 / 0.45) / DEG, 6), wall: 0.1, nozzleMass: 0.3 });
/** Each engine's flow at full, kg/s. */
const LOXODON_FLOW = 0.4;
/** A turn alone: the far engine's throttle. Forward and a turn: how far the near engine eases. */
const LOXODON_TURN = 0.4;
const LOXODON_EASE = 0.5;

/**
 * Parts with no preset to come from (a triangle), for the components list only: never opened.
 */
export function partsTemplate(): Blueprint {
  const form: Form = { kind: "triangle", base: 0.6, height: 0.6, apex: 0, turn: 0 };
  const tri: BodyInput = { id: "triangle", shape: { kind: "polygon", vertices: formVertices(form) }, mass: 0.8, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.3, material: { name: "hull", threshold: 150, toughness: 3000 } };
  return { format: 1, id: "parts", name: "PARTS", preset: true, rev: 1, ship: { bodies: [tri], joints: [], links: [] }, components: [{ id: "triangle", kind: "frame", label: "Triangle", part: "triangle", bodies: ["triangle"], form }], mix: { rules: [], rows: [] } };
}

/** How far a part must rise to stand clear of what it overlaps: up to the top of the highest. */
function overlapLift(bp: Blueprint, compId: string): number {
  const c = component(bp, compId);
  const mine = c.bodies.map((id) => worldVertices(body(bp, id)));
  const low = Math.min(...mine.flat().map((v) => v.y));
  let top = low;
  for (const o of bp.ship.bodies) {
    if (c.bodies.includes(o.id)) continue;
    const ov = worldVertices(o);
    if (mine.some((m) => overlaps(m, ov))) top = Math.max(top, ...ov.map((v) => v.y));
  }
  return round(top - low);
}

/**
 * Control links: every engine head, gun, shield and beam has one for its channel, so the wiring
 * reaches it (a part added from the list arrived without one, and never fired in Try it).
 */
export function relink(bp: Blueprint): void {
  const ids = new Set(bp.ship.bodies.map((b) => b.id));
  bp.ship.links = bp.ship.links.filter((l) => l.kind !== "control" || ids.has(l.to));
  for (const b of bp.ship.bodies) {
    for (const ch of [b.injector?.channel, b.magazine?.railgun?.channel, b.shield?.channel, b.tractor?.channel]) {
      if (!ch || bp.ship.links.some((l) => l.kind === "control" && l.to === b.id && l.channel === ch)) continue;
      bp.ship.links.push({ id: `ctl-${b.id}-${ch}`, kind: "control", channel: ch, to: b.id });
    }
  }
}

// ---------- containers: the design rules (docs/blueprint/design-rules-proposal.md §1–3) ----------

/** Which rule a part follows: the regular tanks and magazines (the OG ones keep their figures). */
export function containerKind(c: Component): ContainerKind | null {
  if (c.part === "tank" || c.part === "trapezoid-tank") return "tank";
  if (c.part === "magazine") return "magazine";
  if (c.part === "bullet-magazine") return "bullets";
  return null;
}

/** A part's wall thickness, m: a container's setting; 0.1 for everything else for now. */
export const wallOf = (c: Component): number => c.wall ?? WALL.default;

/** Sets a container's mass, what it holds (full), its material and its charge from its outline and walls. In place. */
export function applyContainer(bp: Blueprint, compId: string): void {
  const c = component(bp, compId);
  const kind = containerKind(c);
  if (!kind) return;
  const b = body(bp, c.bodies[0]);
  const s = containerSpec(kind, shapeVertices(b.shape), wallOf(c));
  b.mass = s.dryMass;
  b.material = { ...s.material };
  // Nothing it can hold, nothing to go off.
  const blast = b.explosive ?? c.blast;
  if (blast && s.charge > 0) {
    b.explosive = { ...blast, charge: s.charge };
    delete c.blast;
  } else if (blast) {
    c.blast = blast;
    delete b.explosive;
  }
  if (kind === "tank") {
    b.contents = (Object.entries(MIXTURE) as [string, number][]).map(([resource, f]) => {
      const kg = round(s.holds * f, 9);
      return { resource, mass: kg, capacity: kg };
    });
  } else if (b.ammo) b.ammo = { ...b.ammo, count: s.holds };
}

/** A container's settings and what follows from them, for the properties panel. */
function containerParams(bp: Blueprint, c: Component, kind: ContainerKind): Param[] {
  const b = body(bp, c.bodies[0]);
  const box = boundsOf(shapeVertices(b.shape));
  const t = wallOf(c);
  const s = containerSpec(kind, shapeVertices(b.shape), t);
  const k = t / WALL.default;
  const ro = (key: string, label: string, unit: string, value: number, decimals: number, note?: string): Param => ({ key, label, unit, value, min: 0, max: 1e6, step: 1, decimals, tab: "build", readonly: true, ...(note ? { note } : {}) });
  return [
    { key: "wall", label: "Wall thickness", unit: "m", value: t, min: WALL.min, max: maxWall(box.maxX - box.minX, box.maxY - box.minY), step: 0.01, decimals: 2, tab: "build", note: "Thicker: stronger welds and walls, heavier, holds less" },
    kind === "tank" ? ro("holds", "Propellant held", "kg", s.holds, 2, "H₂ and O₂, 1 : 8 by mass") : ro("holds", kind === "bullets" ? "Bullets held" : "Shells held", "", s.holds, 0, `${round(bodyMass((b.ammo?.shell ?? { mass: 0 }) as Parameters<typeof bodyMass>[0]) * s.holds, 2)} kg of shells, fed to the guns welded to it`),
    ro("dry", "Dry mass", "kg", s.dryMass, 2),
    ro("strength", "Strength", "×", k, 2, `Welds and armour against Thrust's (${s.material.threshold} J to dent, ${s.material.toughness} J more to destroy)`),
  ];
}

/** Within a container's size limits (or any size, for other parts). */
function fitsLimits(bp: Blueprint, c: Component): boolean {
  const kind = containerKind(c) ?? powerKind(c);
  if (!kind) return true;
  const box = boundsOf(shapeVertices(body(bp, c.bodies[0]).shape));
  const r = sizeLimits(kind);
  const ok = (d: number) => d >= r.min - 1e-9 && d <= r.max + 1e-9;
  return ok(box.maxX - box.minX) && ok(box.maxY - box.minY);
}

/** After a container's outline changes: back within its limits (or refused), its walls no thicker than it allows, and its rules applied. */
function afterReshape(before: Blueprint, after: Blueprint, compId: string): Blueprint {
  const c = component(after, compId);
  if (powerKind(c) || c.part === "gun") {
    if (!fitsLimits(after, c)) return before;
    applyRules(after, compId);
    return after;
  }
  if (!containerKind(c)) return after;
  if (!fitsLimits(after, c)) return before;
  const box = boundsOf(shapeVertices(body(after, c.bodies[0]).shape));
  const most = maxWall(box.maxX - box.minX, box.maxY - box.minY);
  if (wallOf(c) > most) setWall(after, compId, most);
  applyContainer(after, compId);
  return after;
}

/** A container's wall thickness, in place: its welds' strength goes with the thinner wall at each. */
function setWall(bp: Blueprint, compId: string, t: number): void {
  const c = component(bp, compId);
  const was = wallOf(c);
  c.wall = round(t, 6);
  const mine = new Set(c.bodies);
  for (const j of bp.ship.joints) {
    const aMine = mine.has(j.a);
    if (aMine === mine.has(j.b)) continue;
    const other = componentOfBody(bp, aMine ? j.b : j.a);
    const to = other ? wallOf(other) : WALL.default;
    const k = Math.min(c.wall, to) / Math.min(was, to);
    if (j.limits && k !== 1) j.limits = Object.fromEntries(Object.entries(j.limits).map(([key, v]) => [key, round((v as number) * k, 6)])) as typeof j.limits;
  }
}

// ---------- power: the design rules (§4) ----------

/** Which power rule a part follows: the regular battery and generator. */
export function powerKind(c: Component): PowerKind | null {
  return c.part === "battery" ? "battery" : c.part === "generator" ? "generator" : null;
}

const sizeLimits = (kind: ContainerKind | PowerKind) => (kind === "battery" || kind === "generator" ? POWER[kind] : CONTAINERS[kind]);

/**
 * Every rule a regular part follows, in place: a container's (§1–3); a battery's or generator's
 * figures from its area; and what the shield, railgun and beam draw (§4). OG parts are untouched.
 */
export function applyRules(bp: Blueprint, compId: string): void {
  const c = component(bp, compId);
  if (containerKind(c)) return applyContainer(bp, compId);
  const b = body(bp, c.bodies[0]);
  const pk = powerKind(c);
  if (pk) {
    const s = powerSpec(pk, Math.abs(polygonArea(shapeVertices(b.shape))));
    b.mass = s.mass;
    b.power = pk === "battery" ? { capacity: s.capacity! } : { output: s.output!, perKg: POWER.perKg };
    if (pk === "battery" && b.explosive) b.explosive = { ...b.explosive, charge: s.charge! };
    return;
  }
  for (const id of c.bodies) {
    const x = body(bp, id);
    if (c.part === "shield-emitter" && x.shield) x.shield = { ...x.shield, ...POWER.shield };
    if (c.part === "railgun" && x.magazine?.railgun) x.magazine = { ...x.magazine, railgun: { ...x.magazine.railgun, shot: POWER.railgunShot } };
    // The gun: its muzzle speed from its barrel's length, its muzzle at the barrel's end; no power.
    if (c.part === "gun" && x.magazine?.railgun && x.shape.kind === "box") {
      const { shot: _free, ...launch } = x.magazine.railgun;
      void _free;
      x.magazine = { ...x.magazine, at: { x: 0, y: round(x.shape.height / 2 + GUN.muzzle, 6) }, railgun: { ...launch, speed: gunSpeed(x.shape.height) } };
    }
    if (c.part === "cockpit" && x.tractor) x.tractor = { ...x.tractor, draw: POWER.beam, tetherDraw: POWER.tether };
  }
}

/** A ship's power as designed: batteries' kJ, generators' kW, and how long the batteries alone hold its shields up. */
export function powerStats(bp: Blueprint): { stored: number; output: number; shieldDraw: number; shieldSeconds: number } | null {
  const bodies = bp.ship.bodies;
  if (!bodies.some((b) => b.power)) return null;
  const stored = bodies.reduce((s, b) => s + (b.power?.capacity ?? 0), 0);
  const output = bodies.reduce((s, b) => s + (b.power?.output ?? 0), 0);
  const shieldDraw = bodies.reduce((s, b) => s + (b.shield?.draw ?? 0), 0);
  return { stored, output, shieldDraw, shieldSeconds: shieldDraw > output ? stored / (shieldDraw - output) : Infinity };
}

/** Shell feeds (WPN-015): every store of shells feeds every gun that fires shells like them. */
export function reammo(bp: Blueprint): void {
  const ids = new Set(bp.ship.bodies.map((b) => b.id));
  bp.ship.links = bp.ship.links.filter((l) => l.kind !== "ammo" || (ids.has(l.from) && ids.has(l.to)));
  for (const s of bp.ship.bodies) {
    if (!s.ammo) continue;
    const shell = JSON.stringify(s.ammo.shell);
    for (const g of bp.ship.bodies) {
      if (!g.magazine || JSON.stringify(g.magazine.shell) !== shell) continue;
      if (bp.ship.links.some((l) => l.kind === "ammo" && l.from === s.id && l.to === g.id)) continue;
      bp.ship.links.push({ id: `ammo-${s.id}-${g.id}`, kind: "ammo", from: s.id, to: g.id });
    }
  }
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

/**
 * An engine's units: each head (a body with an injector) and the nozzle walls welded to it. Most
 * engines have one; a double engine (the Mastodon's) has two back to back, firing opposite ways.
 */
export function engineUnits(bp: Blueprint, c: Component): { head: string; walls: string[] }[] {
  const heads = c.bodies.filter((id) => body(bp, id).injector);
  const rest = c.bodies.filter((id) => !heads.includes(id));
  // A rocket's walls (chamber, throat and nozzle) are all welded in a chain from its head.
  if (c.rocket) return [{ head: heads[0], walls: rest }];
  return heads.map((h) => ({
    head: h,
    walls: rest.filter((w) => bp.ship.joints.some((j) => (j.a === h && j.b === w) || (j.b === h && j.a === w))),
  }));
}

export interface EngineInfo {
  /** The component, and the head this push comes from. */
  id: string;
  head: string;
  walls: string[];
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
    .flatMap((c) =>
      engineUnits(bp, c).map((u) => {
        const h = body(bp, u.head);
        const inj = h.injector!;
        const d = rot(inj.direction ?? { x: 0, y: -1 }, h.angle ?? 0);
        return { id: c.id, head: u.head, walls: u.walls, channel: inj.channel, at: { ...h.position }, dir: { x: -d.x, y: -d.y }, thrust: (inj.rate ?? 0) * (u.walls.length >= 2 ? EXHAUST_SPEED : EXHAUST_SPEED_OPEN) };
      }),
    );
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
    throttles[e.channel] = t;
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

/**
 * A regular engine (design rules §5; docs/nozzle-design-thoughts.md §5, "the simplified engine"), in
 * its head's frame, exhaust along −y: the head (the injector plate, chamberWidth × headHeight); two
 * chamber walls `wall` thick and `chamberLength` long down its sides; two throat pieces closing the
 * chamber to a gap `throat` wide; and two nozzle walls from the throat, `nozzleLength` long, flared
 * out by `flare` degrees each side. Every piece is welded to the one before.
 */
export interface Rocket {
  chamberWidth: number;
  chamberLength: number;
  headHeight: number;
  throat: number;
  nozzleLength: number;
  flare: number;
  wall: number;
  /** Mass of each nozzle wall, kg; the chamber walls and throat pieces weigh 6.8 kg per m² (Thrust's walls'). */
  nozzleMass: number;
}

/**
 * The characteristic velocity of the game's exhaust, m/s: Thrust's engines give 206 m/s of thrust
 * per kg/s with a throat alone, c* × (1 + 1/γ) with γ 1.33 (docs/nozzle-design-thoughts.md §1).
 */
const C_STAR = 206 / (1 + 1 / 1.33);

/** A rocket's L*: its chamber's area over its throat's width, m (design rules §5). */
export const lstarOf = (r: Rocket): number => (r.chamberWidth * r.chamberLength) / r.throat;

/**
 * The most a regular rocket's chamber may run at, N/m (design rules §5; Chloe, 17 November 2026):
 * what its own walls hold, and what the weakest tank feeding it holds over the feed margin. `by`
 * names whichever sets it.
 */
export function pressureCeiling(bp: Blueprint, compId: string): { ceiling: number; by: string } | null {
  const c = component(bp, compId);
  if (!c.rocket) return null;
  const r = c.rocket;
  let best = { ceiling: holdPressure(r.wall, Math.max(r.chamberWidth, r.chamberLength)), by: "its own walls" };
  const heads = new Set(c.heads ?? [c.bodies[0]]);
  const feeding = new Set(bp.ship.links.filter((l) => l.kind === "feed" && heads.has(l.to)).map((l) => (l as { from: string }).from));
  for (const t of bp.components.filter((x) => x.kind === "tank" && x.bodies.some((id) => feeding.has(id)))) {
    const vs = shapeVertices(body(bp, t.bodies[0]).shape);
    const span = Math.max(...vs.map((a, i) => Math.hypot(vs[(i + 1) % vs.length].x - a.x, vs[(i + 1) % vs.length].y - a.y)));
    const p = holdPressure(wallOf(t), span) / PRESSURE.feedMargin;
    if (p < best.ceiling) best = { ceiling: p, by: t.label };
  }
  return best;
}

/** The most a regular rocket may burn, kg/s: its pressure ceiling through its throat. */
export function maxRate(bp: Blueprint, compId: string): number {
  const c = component(bp, compId);
  const p = pressureCeiling(bp, compId);
  return c.rocket && p ? (p.ceiling * c.rocket.throat) / C_STAR : Infinity;
}

/**
 * Every regular rocket's flow held to its ceiling (the designer stops you there): after an edit that
 * lowered one (thinner or longer tank walls, a narrower throat), its flow comes down to it. Returns
 * the blueprint, and the engines whose flow it cut.
 */
export function capRates(bp: Blueprint): { bp: Blueprint; cut: string[] } {
  const over = bp.components.filter((c) => c.rocket && (body(bp, c.bodies[0]).injector?.rate ?? 0) > maxRate(bp, c.id) * (1 + 1e-9));
  if (!over.length) return { bp, cut: [] };
  let out = bp;
  for (const c of over) out = setParam(out, c.id, "rate", Math.floor(maxRate(out, c.id) * 1000) / 1000);
  return { bp: out, cut: over.map((c) => c.label) };
}

/** A rocket's chamber length, and what its shape gives: chamber pressure and its ceiling, area ratio, L* and how completely it burns. */
function rocketParams(bp: Blueprint, c: Component, rate: number): Param[] {
  const r = c.rocket!;
  const exit = r.throat + 2 * r.nozzleLength * Math.tan(r.flare * DEG);
  const pressure = (rate * C_STAR) / r.throat;
  const cap = pressureCeiling(bp, c.id)!;
  const lstar = lstarOf(r);
  const ro = (key: string, label: string, unit: string, value: number, decimals: number, note: string): Param => ({ key, label, unit, value, min: 0, max: 1e9, step: 1, decimals, tab: "shape", readonly: true, note });
  return [
    { key: "chamberLength", label: "Chamber length", unit: "m", value: r.chamberLength, min: 0.05, max: 2, step: 0.05, decimals: 2, tab: "shape", note: "Room to burn: L* (below) is the chamber's area over the throat" },
    ro("pressure", "Chamber pressure", "N/m", pressure, 0, "Burn rate × c* ÷ throat: a narrower throat, a higher pressure"),
    ro("ceiling", "Pressure ceiling", "N/m", cap.ceiling, 0, `Set by ${cap.by}: thicker or shorter tank walls raise it. Now at ${Math.round((100 * pressure) / cap.ceiling)}%`),
    ro("areaRatio", "Area ratio", "×", exit / r.throat, 2, "Nozzle exit over throat: a wider nozzle gets more from each kg"),
    ro("lstar", "L*", "m", lstar, 2, `Chamber area ÷ throat width; below ${PRESSURE.lstar} m it doesn't all burn`),
    ro("efficiency", "Burns", "%", 100 * burnEfficiency(lstar), 0, "Of its propellant's energy, from L*: a longer chamber burns it all"),
  ];
}

/** A wall's mass per m² of it, kg (Thrust's nozzle walls: 0.75 kg for 1.1 × 0.1 m). */
const WALL_DENSITY = 0.75 / 0.11;

/**
 * Builds (or rebuilds) a regular engine's walls from its head and its shape, the head's back face
 * staying where it is. Its walls are new bodies, welded in a chain: head, chamber walls, throat
 * pieces, nozzle walls; and each throat piece and nozzle wall welded to the head as well, so the
 * head holds every piece. Their welds are Standard for their thickness.
 */
export function buildRocket(bp: Blueprint, compId: string, r: Rocket): Blueprint {
  const out = clone(bp);
  const c = component(out, compId);
  const h = body(out, c.bodies[0]);
  // The head: its back face (where it is welded to the ship) stays put.
  const was = h.shape.kind === "box" ? h.shape.height : r.headHeight;
  h.position = rounded(worldPoint(h, { x: 0, y: was / 2 - r.headHeight / 2 }));
  h.shape = { kind: "box", width: r.chamberWidth, height: r.headHeight };
  const old = new Set(c.bodies.slice(1));
  out.ship.bodies = out.ship.bodies.filter((b) => !old.has(b.id));
  out.ship.joints = out.ship.joints.filter((j) => !old.has(j.a) && !old.has(j.b));
  const t = r.wall;
  const top = -r.headHeight / 2;
  const chamberBottom = top - r.chamberLength;
  const throatBottom = chamberBottom - t;
  const dx = r.nozzleLength * Math.tan(r.flare * DEG);
  const piece = (id: string, centre: Vec2, shape: Shape, mass: number): BodyInput => ({ id, shape, mass: round(mass, 6), position: rounded(worldPoint(h, centre)), velocity: { x: 0, y: 0 }, angle: h.angle ?? 0, angularVelocity: 0, restitution: h.restitution ?? 0, friction: h.friction ?? 0.3, ...(h.material ? { material: { ...h.material } } : {}) });
  const made: BodyInput[] = [];
  const joints: JointInput[] = [];
  const limits = weldLimits(t);
  const join = (id: string, a: BodyInput, b: BodyInput, at: Vec2) => joints.push({ id, a: a.id, b: b.id, anchorA: rounded(localPoint(a, worldPoint(h, at))), anchorB: rounded(localPoint(b, worldPoint(h, at))), limits: { ...limits }, yield: WELD_PRESETS[1].yield } as JointInput);
  for (const [s, k] of [[-1, "a"], [1, "b"]] as const) {
    // Chamber wall: down the head's side, inside its width.
    const cw = piece(`${h.id}-cw-${k}`, { x: s * (r.chamberWidth / 2 - t / 2), y: top - r.chamberLength / 2 }, { kind: "box", width: t, height: r.chamberLength }, t * r.chamberLength * WALL_DENSITY);
    // Throat piece: across the chamber's end, from its wall in to the throat.
    const span = (r.chamberWidth - r.throat) / 2;
    const th = piece(`${h.id}-th-${k}`, { x: s * (r.throat / 2 + span / 2), y: chamberBottom - t / 2 }, { kind: "box", width: span, height: t }, span * t * WALL_DENSITY);
    // Nozzle wall: from the throat's edge, flared out.
    const tv = { x: (s * dx) / 2, y: -r.nozzleLength / 2 };
    const centre = { x: s * (r.throat / 2 + t / 2) + tv.x, y: throatBottom - r.nozzleLength / 2 };
    const verts = [
      { x: -tv.x - t / 2, y: -tv.y },
      { x: tv.x - t / 2, y: tv.y },
      { x: tv.x + t / 2, y: tv.y },
      { x: -tv.x + t / 2, y: -tv.y },
    ].map((v) => ({ x: round(v.x), y: round(v.y) }));
    const nz = piece(`${h.id}-nz-${k}`, centre, { kind: "polygon", vertices: polygonArea(verts) < 0 ? [...verts].reverse() : verts }, r.nozzleMass);
    made.push(cw, th, nz);
    join(`${h.id}-w-cw-${k}`, h, cw, { x: s * (r.chamberWidth / 2 - t / 2), y: top });
    join(`${h.id}-w-th-${k}`, cw, th, { x: s * (r.chamberWidth / 2 - t / 2), y: chamberBottom });
    join(`${h.id}-w-nz-${k}`, th, nz, { x: s * (r.throat / 2 + t / 2), y: throatBottom });
    // And each held by the head directly, at the same points: through a chain of light pieces the
    // welds could not hold their angles under the chamber's pressure, and the walls flapped (55° in
    // a 10 s flight; 0.18° like this, THRUST OG's 0.08°).
    join(`${h.id}-s-th-${k}`, h, th, { x: s * (r.chamberWidth / 2 - t / 2), y: chamberBottom });
    join(`${h.id}-s-nz-${k}`, h, nz, { x: s * (r.throat / 2 + t / 2), y: throatBottom });
  }
  out.ship.bodies.push(...made);
  out.ship.joints.push(...joints);
  c.bodies = [h.id, ...made.map((b) => b.id)];
  c.rocket = { ...r };
  // Its nozzle works (PRP-012): the exhaust leaves at the exit. Only these rockets declare one; the
  // OG engines and the double engine keep the throat's jet. A nozzle that narrows (a negative flare)
  // has its narrowest point at the exit, not the throat: 1D theory doesn't hold, so it keeps the throat's jet too.
  if (h.injector) {
    const inj = { ...h.injector };
    delete inj.nozzle;
    delete inj.efficiency;
    // A chamber short of the L* rule doesn't burn it all (design rules §5).
    const eff = burnEfficiency(lstarOf(r));
    if (eff < 1) inj.efficiency = round(eff, 6);
    h.injector = r.flare >= 0 ? { ...inj, nozzle: { length: r.nozzleLength, flare: r.flare, walls: [`${h.id}-nz-a`, `${h.id}-nz-b`] } } : inj;
  }
  // Its gas: the injector a little into the chamber, and the interior it may hold, chamber to nozzle exit.
  const inj = h.injector!;
  inj.outlet = { x: 0, y: round(top - Math.min(0.05, r.chamberLength / 2)) };
  inj.chamber = { width: r.chamberWidth, length: round(r.chamberLength + t + r.nozzleLength + 0.25) };
  inj.width = Math.min(inj.width ?? r.throat * 0.75, r.chamberWidth - 2 * t - 0.02);
  return out;
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
  if (c.rocket) {
    const r = c.rocket;
    return { headWidth: r.chamberWidth, headHeight: r.headHeight, throat: r.throat, wall: r.wall, length: r.nozzleLength, flare: r.flare };
  }
  // A double engine's two units are alike: the first stands for both.
  const u = engineUnits(bp, c)[0];
  const h = body(bp, u.head);
  if (h.shape.kind !== "box") throw new Error("An engine's head is a box");
  const walls = u.walls.map((id) => body(bp, id));
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
  let out = clone(bp);
  const units = engineUnits(bp, c);
  for (const u of units) out = buildUnit(out, u.head, u.walls, g, units.length > 1);
  if (units.length > 1) {
    // Back to back: the heads' welds to each other, along the face they share, as the touch rule puts them.
    const heads = new Set(units.map((u) => u.head));
    const was = out.ship.joints.find((j) => heads.has(j.a) && heads.has(j.b));
    out.ship.joints = out.ship.joints.filter((j) => !(heads.has(j.a) && heads.has(j.b)));
    const [p, q] = units.map((u) => body(out, u.head));
    let k = 0;
    for (const e of touching(p, q)) for (const pt of weldPoints(e)) out.ship.joints.push({ id: `${c.id}-core-${k++}`, a: p.id, b: q.id, anchorA: rounded(localPoint(p, pt)), anchorB: rounded(localPoint(q, pt)), limits: { ...(was?.limits ?? WELD_PRESETS[2].limits) }, yield: was?.yield ?? WELD_PRESETS[2].yield } as JointInput);
  }
  return out;
}

/** One head and its walls, built to a shape. Back to back with another, its back face stays where it is. */
function buildUnit(bp: Blueprint, headId: string, wallIds: string[], g: EngineGeom, backToBack: boolean): Blueprint {
  const out = clone(bp);
  const h = body(out, headId);
  if (backToBack && h.shape.kind === "box") h.position = rounded(worldPoint(h, { x: 0, y: h.shape.height / 2 - g.headHeight / 2 }));
  h.shape = { kind: "box", width: g.headWidth, height: g.headHeight };
  const inj = h.injector!;
  inj.outlet = { x: 0, y: -g.headHeight / 2 - 0.05 };
  inj.chamber = { width: g.headWidth, length: g.length + 0.25 };
  inj.width = Math.min(inj.width ?? g.throat * 0.75, g.throat - 0.02);
  const dx = g.length * Math.tan(g.flare * DEG);
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
  // Every part can be turned: by the handle on the blueprint, or here.
  const angle: Param = { key: "angle", label: "Angle", unit: "°", value: componentAngle(bp, compId), min: -180, max: 180, step: TURN_STEP, decimals: 0, tab: "shape", note: "Or drag the round handle above it (Shift: by 1°)" };
  return [...partParams(bp, compId), angle];
}

function partParams(bp: Blueprint, compId: string): Param[] {
  const c = component(bp, compId);
  const b = body(bp, c.bodies[0]);
  const ps: Param[] = [];
  const mass = (tab: Tab = "build"): Param => ({ key: "mass", label: "Mass", unit: "kg", value: c.bodies.reduce((s, id) => s + body(bp, id).mass, 0), min: 0.05, max: 500, step: 0.1, decimals: 2, tab });
  if (c.kind === "engine") {
    const g = engineGeom(bp, c);
    const units = engineUnits(bp, c);
    const inj = body(bp, units[0].head).injector!;
    const each = units.length > 1 ? " (each)" : "";
    ps.push(
      { key: "headWidth", label: "Chamber width", unit: "m", value: g.headWidth, min: 0.2, max: 4, step: 0.05, decimals: 2, tab: "shape" },
      { key: "headHeight", label: "Head depth", unit: "m", value: g.headHeight, min: 0.05, max: 1, step: 0.01, decimals: 2, tab: "shape" },
      { key: "throat", label: "Throat width", unit: "m", value: g.throat, min: 0.1, max: 4, step: 0.05, decimals: 2, tab: "shape" },
      { key: "wall", label: "Wall thickness", unit: "m", value: g.wall, min: 0.02, max: 0.5, step: 0.01, decimals: 2, tab: "shape" },
      { key: "length", label: "Nozzle wall length", unit: "m", value: g.length, min: 0.1, max: 4, step: 0.05, decimals: 2, tab: "shape" },
      { key: "flare", label: "Nozzle flare", unit: "°", value: g.flare, min: -10, max: 45, step: 0.5, decimals: 1, tab: "shape" },
      ...(c.rocket ? rocketParams(bp, c, inj.rate ?? 0) : []),
      { key: "rate", label: `Flow (burn rate)${each}`, unit: "kg/s", value: inj.rate ?? 0, min: 0.05, max: c.rocket ? Math.max(0.05, Math.floor(maxRate(bp, c.id) * 1000) / 1000) : 20, step: 0.05, decimals: 3, tab: "fuel", ...(c.rocket ? { note: "Up to its pressure ceiling (Shape)" } : {}) },
      { key: "economy", label: "Fuel efficiency", unit: "×", value: inj.economy ?? 1, min: 1, max: 200, step: 1, decimals: 0, tab: "fuel" },
      { key: "injWidth", label: "Injector width", unit: "m", value: inj.width ?? 0, min: 0.05, max: 4, step: 0.05, decimals: 2, tab: "fuel" },
      { key: "thrust", label: `Thrust (est.)${each}`, unit: "N", value: (inj.rate ?? 0) * exhaustSpeed(c), min: 0, max: 1e5, step: 1, decimals: 0, tab: "fuel", readonly: true, note: `flow × ${exhaustSpeed(c)} m/s; Measure gives the real figure` },
      { ...mass(), key: "headMass", label: `Head mass${each}`, value: body(bp, units[0].head).mass },
      { key: "wallMass", label: "Wall mass (each)", unit: "kg", value: units[0].walls.length ? body(bp, units[0].walls[0]).mass : 0, min: 0.01, max: 100, step: 0.05, decimals: 2, tab: "build" },
    );
    return ps;
  }
  const ck = containerKind(c);
  const pk = powerKind(c);
  const lim = ck ? CONTAINERS[ck] : pk ? POWER[pk] : { min: 0.05, max: 10 };
  if (b.shape.kind === "box") {
    ps.push(
      { key: "width", label: "Width", unit: "m", value: b.shape.width, min: lim.min, max: lim.max, step: 0.05, decimals: 2, tab: "shape" },
      { key: "height", label: "Height", unit: "m", value: b.shape.height, min: lim.min, max: lim.max, step: 0.05, decimals: 2, tab: "shape" },
    );
  } else if (c.form) {
    const f = c.form;
    ps.push({ key: "fBase", label: "Base", unit: "m", value: f.base, min: 0.1, max: 10, step: 0.05, decimals: 2, tab: "shape" });
    if (f.kind === "trapezoid") ps.push({ key: "fTop", label: "Top", unit: "m", value: f.top, min: 0.05, max: 10, step: 0.05, decimals: 2, tab: "shape" });
    ps.push({ key: "fHeight", label: "Height", unit: "m", value: f.height, min: 0.1, max: 10, step: 0.05, decimals: 2, tab: "shape" });
    if (f.kind === "triangle") ps.push({ key: "fApex", label: "Apex along", unit: "m", value: f.apex, min: -5, max: 5, step: 0.05, decimals: 2, tab: "shape", note: "From the middle of the base: ± half the base makes a right angle" });
    ps.push({ key: "fTurn", label: "Turn", unit: "°", value: f.turn, min: 0, max: 270, step: 90, decimals: 0, tab: "shape", note: "Which way the top points: 0 up, 90 left, 180 down, 270 right" });
  } else if (b.shape.kind === "polygon") {
    const box = boundsOf(b.shape.vertices);
    ps.push(
      { key: "pw", label: "Width", unit: "m", value: box.maxX - box.minX, min: 0.2, max: 10, step: 0.05, decimals: 2, tab: "shape", readonly: true, note: "Cockpit shape editing comes later" },
      { key: "ph", label: "Height", unit: "m", value: box.maxY - box.minY, min: 0.2, max: 10, step: 0.05, decimals: 2, tab: "shape", readonly: true },
    );
  }
  if (ck) ps.push(...containerParams(bp, c, ck));
  if (pk && b.power) {
    const ro = (key: string, label: string, unit: string, value: number, decimals: number, note: string): Param => ({ key, label, unit, value, min: 0, max: 1e9, step: 1, decimals, tab: "function", readonly: true, note });
    if (pk === "battery") ps.push(ro("capacity", "Stores", "kJ", b.power.capacity ?? 0, 0, `${POWER.battery.perArea} kJ per m²; full at the start. About ${round((b.power.capacity ?? 0) / POWER.shield.draw, 1)} s of shield alone`));
    else ps.push(ro("output", "Makes up to", "kW", b.power.output ?? 0, 0, `${POWER.generator.perArea} kW per m², burning ${round((b.power.output ?? 0) / POWER.perKg, 3)} kg/s of propellant at full; only while the batteries aren't full`));
  }
  for (const s of ck ? [] : (b.contents ?? [])) {
    ps.push({ key: `cap:${s.resource}`, label: `${s.resource === "h2" ? "H₂" : s.resource === "o2" ? "O₂" : s.resource} capacity`, unit: "kg", value: s.capacity, min: 0, max: 100, step: 0.05, decimals: 3, tab: "fuel" });
  }
  if (b.ammo && !ck) {
    const kg = bodyMass(b.ammo.shell as Parameters<typeof bodyMass>[0]);
    ps.push({ key: "ammo", label: "Shells stored", unit: "", value: b.ammo.count, min: 0, max: 1000, step: 1, decimals: 0, tab: "function", note: `${round(kg, 3)} kg each, fed to the guns welded to it` });
  }
  if (b.magazine) {
    ps.push({ key: "count", label: "Shells in the gun", unit: "", value: b.magazine.count, min: 0, max: 1000, step: 1, decimals: 0, tab: "function", ...(bp.ship.links.some((l) => l.kind === "ammo" && l.to === b.id) ? { note: "Magazines welded to it pass it more, one at a time" } : {}) });
    if (b.magazine.railgun && c.part === "gun") ps.push({ key: "speed", label: "Muzzle speed", unit: "m/s", value: b.magazine.railgun.speed, min: 1, max: 1000, step: 1, decimals: 0, tab: "function", readonly: true, note: `From the barrel's length (its height): ${GUN.speed} m/s at ${GUN.length} m, as its square root. Chemical: no power` });
    else if (b.magazine.railgun) ps.push({ key: "speed", label: "Muzzle speed", unit: "m/s", value: b.magazine.railgun.speed, min: 1, max: 1000, step: 1, decimals: 0, tab: "function" });
    ps.push({ key: "reload", label: "Reload", unit: "s", value: b.magazine.reload, min: 0.01, max: 10, step: 0.005, decimals: 3, tab: "function" });
  }
  if (b.tractor) {
    ps.push(
      { key: "range", label: "Beam range", unit: "m", value: b.tractor.range ?? 0, min: 1, max: 200, step: 1, decimals: 0, tab: "function" },
      { key: "force", label: "Beam force", unit: "N", value: b.tractor.force ?? 0, min: 0, max: 10000, step: 10, decimals: 0, tab: "function" },
    );
  }
  if (b.shield) ps.push({ key: "radius", label: "Shield radius", unit: "m", value: b.shield.radius, min: 0.5, max: 20, step: 0.05, decimals: 2, tab: "function" });
  if (!ck && !pk) ps.push(mass());
  else if (pk) ps.push({ ...mass(), readonly: true, note: "From its size (the design rules)" });
  return ps;
}

const clone = (bp: Blueprint): Blueprint => structuredClone(bp);

/** Changes one property. A change to a part's outline rewelds it to whatever it then touches. */
export function setParam(bp: Blueprint, compId: string, key: string, value: number): Blueprint {
  const c = component(bp, compId);
  // A regular rocket burns no more than its pressure ceiling lets it (design rules §5).
  if (key === "rate" && c.rocket) value = Math.min(value, maxRate(bp, compId));
  if (key === "angle") return rotateComponent(bp, compId, value);
  if (key === "wall" && containerKind(c)) {
    const out = clone(bp);
    const box = boundsOf(shapeVertices(body(out, c.bodies[0]).shape));
    setWall(out, compId, Math.max(WALL.min, Math.min(maxWall(box.maxX - box.minX, box.maxY - box.minY), value)));
    applyContainer(out, compId);
    return out;
  }
  if (c.kind === "engine" && c.rocket) {
    const map: Record<string, keyof Rocket> = { headWidth: "chamberWidth", headHeight: "headHeight", throat: "throat", wall: "wall", length: "nozzleLength", flare: "flare", chamberLength: "chamberLength" };
    if (map[key]) {
      const r = { ...c.rocket, [map[key]]: value };
      // The throat narrower than the chamber, inside its walls.
      r.throat = Math.min(r.throat, r.chamberWidth - 2 * r.wall);
      // Its chamber walls can hold other parts (the Stegodon's mounts): rebuilt, they weld again.
      return reweld(buildRocket(bp, compId, r), compId);
    }
  }
  if (c.kind === "engine") {
    if (["headWidth", "headHeight", "throat", "wall", "length", "flare"].includes(key)) {
      const g = { ...engineGeom(bp, c), [key]: value };
      g.throat = Math.min(g.throat, g.headWidth + 2);
      const out = buildEngine(bp, c, g);
      return key === "headWidth" || key === "headHeight" ? reweld(out, compId) : out;
    }
    const out = clone(bp);
    const units = engineUnits(bp, c);
    for (const u of units) setHead(out, body(out, u.head), key, value);
    if (key === "wallMass") for (const u of units) for (const id of u.walls) body(out, id).mass = value;
    return out;
  }
  return setOther(bp, c, key, value);
}

/** A trapezoid's or triangle's outline: the same stuff, so its mass and what it holds go with its area. */
function setForm(bp: Blueprint, compId: string, key: string, value: number): Blueprint {
  const f = { ...component(bp, compId).form! } as Form & { top?: number; apex?: number };
  if (key === "fBase") f.base = value;
  else if (key === "fTop") f.top = value;
  else if (key === "fHeight") f.height = value;
  else if (key === "fApex") f.apex = Math.max(-f.base / 2, Math.min(f.base / 2, value));
  else if (key === "fTurn") f.turn = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  const ruled = afterReshape(bp, withForm(bp, compId, f), compId);
  return ruled === bp ? bp : reweld(ruled, compId);
}

/** A part with a new outline; its mass and contents scaled by its area. */
function withForm(bp: Blueprint, compId: string, form: Form): Blueprint {
  const out = clone(bp);
  const c = component(out, compId);
  const f = { ...form };
  if (f.kind === "triangle") f.apex = Math.max(-f.base / 2, Math.min(f.base / 2, f.apex));
  const b = body(out, c.bodies[0]);
  const before = Math.abs(polygonArea(shapeVertices(b.shape)));
  b.shape = { kind: "polygon", vertices: formVertices(f) };
  const k = Math.abs(polygonArea(b.shape.vertices)) / (before || 1);
  b.mass = round(b.mass * k);
  for (const s of b.contents ?? []) {
    s.capacity = round(s.capacity * k, 9);
    s.mass = round(s.mass * k, 9);
  }
  c.form = f;
  return out;
}

/** An engine head's fuel and build properties. */
function setHead(out: Blueprint, h: BodyInput, key: string, value: number): void {
  {
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
    }
  }
}

function setOther(bp: Blueprint, c: Component, key: string, value: number): Blueprint {
  const compId = c.id;
  if (c.form && ["fBase", "fTop", "fHeight", "fApex", "fTurn"].includes(key)) return setForm(bp, compId, key, value);
  const out = clone(bp);
  const b = body(out, c.bodies[0]);
  if ((key === "width" || key === "height") && b.shape.kind === "box") {
    const old = b.shape.width * b.shape.height;
    b.shape = { ...b.shape, [key]: value };
    // The same stuff, bigger or smaller: mass and what it holds go with its area (a container: its rules).
    const k = (b.shape.width * b.shape.height) / old;
    b.mass = round(b.mass * k);
    for (const s of b.contents ?? []) {
      s.capacity = round(s.capacity * k, 9);
      s.mass = round(s.mass * k, 9);
    }
    const ruled = afterReshape(bp, out, compId);
    return ruled === bp ? bp : reweld(ruled, compId);
  }
  if (key.startsWith("cap:")) {
    const s = b.contents?.find((x) => x.resource === key.slice(4));
    if (s) {
      s.capacity = value;
      s.mass = value; // full at the start
    }
  } else if (key === "mass") b.mass = value;
  else if (key === "count" && b.magazine) b.magazine.count = Math.round(value);
  else if (key === "ammo" && b.ammo) b.ammo.count = Math.round(value);
  else if (key === "speed" && b.magazine?.railgun) b.magazine.railgun.speed = value;
  else if (key === "reload" && b.magazine) b.magazine.reload = value;
  else if (key === "range" && b.tractor) b.tractor.range = value;
  else if (key === "force" && b.tractor) b.tractor.force = value;
  else if (key === "radius" && b.shield) b.shield.radius = value;
  return out;
}

// ---------- welding ----------

/**
 * A weld's quality, on top of the thickness rule (design rules §1): its limits are
 * quality × k × the thinner wall it joins. These are the limits at 0.1 m walls (Thrust's).
 */
export const WELD_PRESETS: { name: string; quality: number; limits: JointInput["limits"] & object; yield: number }[] = [
  { name: "Light", quality: 0.5, limits: weldLimits(WALL.default, 0.5), yield: 0.3 },
  { name: "Standard", quality: 1, limits: weldLimits(WALL.default, 1), yield: 0.3 },
  { name: "Heavy", quality: 2, limits: weldLimits(WALL.default, 2), yield: 0.3 },
];

/** The weld presets for one weld: their limits for the walls it joins. */
export function weldPresetsFor(bp: Blueprint, weldId: string): typeof WELD_PRESETS {
  const w = welds(bp).find((x) => x.id === weldId);
  const t = w ? Math.min(wallOf(component(bp, w.a)), wallOf(component(bp, w.b))) : WALL.default;
  return WELD_PRESETS.map((p) => ({ ...p, limits: weldLimits(t, p.quality) }));
}

interface Edge {
  a: Vec2;
  b: Vec2;
  /** The way the side faces, out of its body (a unit vector). */
  out?: Vec2;
}

/** A body's straight sides, at any angle, in the ship's frame: each with the way it faces. */
function straightEdges(b: BodyInput): Edge[] {
  let vs = worldVertices(b);
  if (polygonArea(vs) < 0) vs = [...vs].reverse(); // anticlockwise, so each side's outside is on its right
  const out: Edge[] = [];
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const c = vs[(i + 1) % vs.length];
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    if (len < 1e-6) continue;
    // Snapped to the axis when it runs along one, so square sides stay exactly square.
    const n = { x: (c.y - a.y) / len, y: -(c.x - a.x) / len };
    const sq = (v: number) => (Math.abs(v) < 1e-9 ? 0 : Math.abs(Math.abs(v) - 1) < 1e-9 ? Math.sign(v) : v);
    out.push({ a, b: c, out: { x: sq(n.x), y: sq(n.y) } });
  }
  return out;
}

/** Two sides that face each other (so the parts would meet there, not overlap). */
const facing = (e: Edge, f: Edge) => !!e.out && !!f.out && e.out.x * f.out.x + e.out.y * f.out.y < -1 + 1e-6;

/** Along a side: how far each end of another side is from this one's start. */
const along = (e: Edge, p: Vec2) => {
  const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
  return ((p.x - e.a.x) * (e.b.x - e.a.x) + (p.y - e.a.y) * (e.b.y - e.a.y)) / len;
};
/** How far side f lies out from side e, along e's outward direction. */
const apart = (e: Edge, f: Edge) => (f.a.x - e.a.x) * e.out!.x + (f.a.y - e.a.y) * e.out!.y;
/** The length two facing sides share, as [from, to] along e (to < from if none). */
function shared(e: Edge, f: Edge): [number, number] {
  const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
  const fa = along(e, f.a);
  const fb = along(e, f.b);
  return [Math.max(0, Math.min(fa, fb)), Math.min(len, Math.max(fa, fb))];
}

const TOUCH = 1e-3;

/** Where two bodies touch side to side: the shared stretches, in the ship's frame. */
export function touching(p: BodyInput, q: BodyInput): Edge[] {
  const out: Edge[] = [];
  for (const e of straightEdges(p)) {
    for (const f of straightEdges(q)) {
      if (!facing(e, f) || Math.abs(apart(e, f)) > TOUCH) continue;
      const [lo, hi] = shared(e, f);
      if (hi - lo <= 0.02) continue;
      const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      const t = { x: (e.b.x - e.a.x) / len, y: (e.b.y - e.a.y) / len };
      out.push({ a: { x: e.a.x + t.x * lo, y: e.a.y + t.y * lo }, b: { x: e.a.x + t.x * hi, y: e.a.y + t.y * hi } });
    }
  }
  return out;
}

export function weldPoints(e: Edge): Vec2[] {
  const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
  if (len < 0.3 - 1e-6) return [{ x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }];
  const u = { x: (e.b.x - e.a.x) / len, y: (e.b.y - e.a.y) / len };
  return [
    { x: e.a.x + u.x * 0.1, y: e.a.y + u.y * 0.1 },
    { x: e.b.x - u.x * 0.1, y: e.b.y - u.y * 0.1 },
  ];
}

/** The bodies of a component that weld to others: an engine welds by its head only. */
/** What welds to the rest of the ship: an engine by its heads (its nozzle walls hang off them), anything else by every body. */
const weldingBodies = (c: Component) =>
  c.kind !== "engine"
    ? c.bodies
    : // A rocket welds by its head and its chamber's walls (an angled engine lies along the ship by its chamber); other engines by their heads.
      c.rocket
      ? c.bodies.filter((id) => id === c.bodies[0] || /-cw-[ab]$/.test(id))
      : (c.heads ?? c.bodies.slice(0, 1));

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
  for (const other of out.components) {
    if (other.id === compId) continue;
    // A new weld: Standard for the thinner of the two walls (design rules §1).
    const std = { limits: weldLimits(Math.min(wallOf(c), wallOf(other))), yield: WELD_PRESETS[1].yield };
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

// ---------- turning and resizing on the blueprint (§3.6) ----------

/** The step a part turns by, degrees, unless the player holds Shift. */
export const TURN_STEP = 15;

/** A part's angle, degrees (−180 to 180]: its main body's. */
export function componentAngle(bp: Blueprint, compId: string): number {
  const a = ((body(bp, component(bp, compId).bodies[0]).angle ?? 0) * 180) / Math.PI;
  const n = ((((a + 180) % 360) + 360) % 360) - 180;
  return round(n === -180 ? 180 : n, 6);
}

/**
 * Turns a part so its angle is `deg`, about its main body's centre (which stays put): its welds
 * break and re-form wherever its sides then meet others'.
 */
export function rotateComponent(bp: Blueprint, compId: string, deg: number): Blueprint {
  const out = clone(bp);
  const c = component(out, compId);
  const main = body(out, c.bodies[0]);
  const delta = ((deg - componentAngle(bp, compId)) * Math.PI) / 180;
  if (Math.abs(delta) < 1e-12) return out;
  const pivot = { ...main.position };
  const target = (deg * Math.PI) / 180;
  for (const id of c.bodies) {
    const b = body(out, id);
    const r = rot({ x: b.position.x - pivot.x, y: b.position.y - pivot.y }, delta);
    b.position = { x: round(pivot.x + r.x), y: round(pivot.y + r.y) };
    // Tidied, so whole degrees stay whole and quarter turns exact (sides square to the grid weld).
    b.angle = exactAngle(id === main.id ? target : (b.angle ?? 0) + delta);
  }
  return reweld(out, compId);
}

/** An angle tidied: a whole number of degrees to 1e-9, and a quarter turn exactly. */
function exactAngle(a: number): number {
  const deg = (a * 180) / Math.PI;
  const whole = Math.round(deg);
  const d = Math.abs(deg - whole) < 1e-7 ? whole : deg;
  const n = ((((d + 180) % 360) + 360) % 360) - 180;
  return n === 0 ? 0 : n === 90 ? Math.PI / 2 : n === -90 ? -Math.PI / 2 : n === -180 || n === 180 ? Math.PI : (n * Math.PI) / 180;
}

/** Whether a part can be resized by dragging: one body, a box or a trapezoid or triangle. */
export function resizable(bp: Blueprint, compId: string): boolean {
  const c = component(bp, compId);
  if (c.kind === "engine" || c.bodies.length !== 1) return false;
  return !!c.form || body(bp, c.bodies[0]).shape.kind === "box";
}

/** A part's size in its own frame (width along its x, height along its y), m. */
export function componentSize(bp: Blueprint, compId: string): { w: number; h: number } {
  const b = body(bp, component(bp, compId).bodies[0]);
  const box = boundsOf(shapeVertices(b.shape));
  return { w: round(box.maxX - box.minX), h: round(box.maxY - box.minY) };
}

/**
 * Resizes a part to w × h in its own frame, keeping `fixed` (a point in the ship's frame: the
 * corner or side opposite the one dragged) where it is; `side` is which way the dragged handle is
 * from it (−1, 0 or 1 along the part's x and y). What it holds and weighs goes with its area.
 */
export function resizeComponent(bp: Blueprint, compId: string, w: number, h: number, fixed: Vec2, side: { x: number; y: number }): Blueprint {
  const c = component(bp, compId);
  // A container stays within its size limits (§2, §3).
  const kind = containerKind(c);
  if (kind) {
    const r = CONTAINERS[kind];
    w = Math.max(r.min, Math.min(r.max, w));
    h = Math.max(r.min, Math.min(r.max, h));
  }
  const now = componentSize(bp, compId);
  let out: Blueprint;
  if (c.form) {
    const f = { ...c.form } as Form & { top?: number; apex?: number };
    // The form's own axes: base along x at turns 0 and 180, along y at 90 and 270.
    const sideways = f.turn === 90 || f.turn === 270;
    const kx = (sideways ? h / now.h : w / now.w) || 1;
    const ky = (sideways ? w / now.w : h / now.h) || 1;
    f.base = round(f.base * kx);
    if (f.kind === "trapezoid") f.top = round(f.top * kx);
    else f.apex = round(f.apex * kx);
    f.height = round(f.height * ky);
    out = afterReshape(bp, withForm(bp, compId, f), compId);
  } else {
    out = setOther(bp, c, "width", round(w));
    out = setOther(out, component(out, compId), "height", round(h));
  }
  if (out === bp) return bp;
  const b = body(out, c.bodies[0]);
  const a = b.angle ?? 0;
  const off = rot({ x: (side.x * w) / 2, y: (side.y * h) / 2 }, a);
  b.position = { x: round(fixed.x + off.x), y: round(fixed.y + off.y) };
  return reweld(out, compId);
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
    // Flush against a side: the smallest move that makes a side of ours meet a side of theirs,
    // at any angle; then, if another side of ours (facing another way) is near one of theirs, both.
    type Cand = { d: number; e: Edge; f: Edge };
    const cands: Cand[] = [];
    for (const m of mov)
      for (const e of straightEdges(m))
        for (const o of otherWeld)
          for (const f of straightEdges(o)) {
            if (!facing(e, f)) continue;
            const [lo, hi] = shared(e, f);
            if (hi - lo < 0.02) continue; // not alongside each other: they must share some length, not just a corner
            const d = apart(e, f);
            if (Math.abs(d) <= tol) cands.push({ d, e, f });
          }
    cands.sort((p, q) => Math.abs(p.d) - Math.abs(q.d));
    // The nearest snap that leaves it clear of every other part: a side it could meet may belong
    // to a part it can't sit beside (a rocket's chamber wall, under its head).
    const snapFor = (first: Cand | undefined): { cx: number; cy: number; guides: Edge[] } => {
      const g: Edge[] = [];
      if (!first) return { cx: 0, cy: 0, guides: g };
      const second = cands.find((c) => Math.abs(c.e.out!.x * first.e.out!.y - c.e.out!.y * first.e.out!.x) > 0.2);
      if (second) {
        // Both sides met: the move t with t·n1 = d1 and t·n2 = d2.
        const [n1, n2] = [first.e.out!, second.e.out!];
        const det = n1.x * n2.y - n1.y * n2.x;
        g.push(first.f, second.f);
        return { cx: (first.d * n2.y - second.d * n1.y) / det, cy: (n1.x * second.d - n2.x * first.d) / det, guides: g };
      }
      let x = first.e.out!.x * first.d;
      let y = first.e.out!.y * first.d;
      // Lined up along the side it meets: its end or middle with theirs, if near.
      const len = Math.hypot(first.e.b.x - first.e.a.x, first.e.b.y - first.e.a.y);
      const t = { x: (first.e.b.x - first.e.a.x) / len, y: (first.e.b.y - first.e.a.y) / len };
      const fa = along(first.e, first.f.a);
      const fb = along(first.e, first.f.b);
      const [f0, f1] = [Math.min(fa, fb), Math.max(fa, fb)];
      const options = [f0, f1 - len, (f0 + f1) / 2 - len / 2];
      const pick = options.filter((o) => Math.abs(o) <= tol).sort((p, q) => Math.abs(p) - Math.abs(q))[0];
      if (pick !== undefined) {
        x += t.x * pick;
        y += t.y * pick;
        g.push(first.f);
      }
      return { cx: x, cy: y, guides: g };
    };
    const clear = (cx2: number, cy2: number) => !moving.map((b) => shifted(b, dx + cx2, dy + cy2)).some((m) => otherAll.some((o) => overlaps(worldVertices(m), worldVertices(o))));
    const tried = cands.slice(0, 16);
    let chosen = snapFor(tried[0]);
    for (const c of tried) {
      const sn = snapFor(c);
      if (clear(sn.cx, sn.cy)) {
        chosen = sn;
        break;
      }
    }
    const first = tried[0];
    cx = chosen.cx;
    cy = chosen.cy;
    guides.push(...chosen.guides);
    snapped = !!first;
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
    // Each head its own channel: an engine's is its id; a double engine's second head's, that head's.
    if (b.injector) b.injector.channel = b.id;
    if (b.injector?.nozzle) b.injector.nozzle = { ...b.injector.nozzle, walls: b.injector.nozzle.walls.map(rename) };
    if (b.magazine?.railgun) b.magazine.railgun.channel = id;
    if (b.tractor) delete b.tractor; // a cockpit's beam belongs with the projector and winch it was built with
    if (b.shield) b.shield = { ...b.shield, channel: id, from: [], blocks: [] };
    return b;
  });
  const joints = tpl.ship.joints.filter((j) => c.bodies.includes(j.a) && c.bodies.includes(j.b)).map((j) => ({ ...structuredClone(j), id: `${id}-${j.id}`, a: rename(j.a), b: rename(j.b) }));
  return { comp: { id, kind: c.kind, label: uniqueLabel(bp, label ?? c.label.replace(/ (L|R|BL|BR|FL|FR)( OG)?$/, "$2")), bodies: bodies.map((b) => b.id), ...(c.part ? { part: c.part } : {}), ...(c.heads ? { heads: c.heads.map(rename) } : {}), ...(c.form ? { form: { ...c.form } } : {}) }, bodies, joints };
}

function uniqueLabel(bp: Blueprint, base: string): string {
  const used = new Set(bp.components.map((c) => c.label));
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Fuel lines: every engine draws from every tank, with room to spare over what it burns. */
function refeed(bp: Blueprint): void {
  const tanks = bp.components.filter((c) => c.kind === "tank").map((c) => body(bp, c.bodies[0]));
  const engs = bp.components.filter((c) => c.kind === "engine").flatMap((c) => (c.heads ?? [c.bodies[0]]).map((id) => body(bp, id)));
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
  reammo(out);
  relink(out);
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
  // "Thruster BL" ↔ "Thruster BR", and the same with an OG part's " OG" after it.
  const m = /^(.*?)(\s)(L|R|BL|BR|FL|FR)( OG)?$/.exec(label);
  if (!m) return `${label} (mirror)`;
  const swap: Record<string, string> = { L: "R", R: "L", BL: "BR", BR: "BL", FL: "FR", FR: "FL" };
  return `${m[1]}${m[2]}${swap[m[3]]}${m[4] ?? ""}`;
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
  // A trapezoid or triangle mirrored: turned the other way, its apex on the other side.
  if (made.comp.form) made.comp.form = { ...made.comp.form, turn: (360 - made.comp.form.turn) % 360, ...(made.comp.form.kind === "triangle" ? { apex: -made.comp.form.apex } : {}) } as Form;
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

// ---------- overlaps (§3.2: components never overlap) ----------

/** The components whose parts overlap this one's (more than touching). */
export function overlapsOf(bp: Blueprint, compId: string): string[] {
  const c = component(bp, compId);
  const mine = c.bodies.map((id) => worldVertices(body(bp, id)));
  return bp.components.filter((o) => o.id !== compId && o.bodies.some((id) => mine.some((m) => overlaps(m, worldVertices(body(bp, id)))))).map((o) => o.id);
}

/** Every overlapping pair, as [a, b] component ids (a before b in the list). */
export function allOverlaps(bp: Blueprint): [string, string][] {
  const out: [string, string][] = [];
  const cs = bp.components;
  const outlines = new Map(cs.map((c) => [c.id, c.bodies.map((id) => worldVertices(body(bp, id)))]));
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) if (outlines.get(cs[i].id)!.some((p) => outlines.get(cs[j].id)!.some((q) => overlaps(p, q)))) out.push([cs[i].id, cs[j].id]);
  return out;
}

/**
 * An edit to one component, refused if it would make that component overlap another it didn't
 * overlap before: the blueprint as it was, and the parts it would have run into.
 */
export function withoutNewOverlaps(before: Blueprint, after: Blueprint, compId: string): { bp: Blueprint; blocked: string[] } {
  if (!after.components.some((c) => c.id === compId)) return { bp: after, blocked: [] };
  const was = new Set(before.components.some((c) => c.id === compId) ? overlapsOf(before, compId) : []);
  const now = overlapsOf(after, compId).filter((id) => !was.has(id));
  return now.length ? { bp: before, blocked: now } : { bp: after, blocked: [] };
}

// ---------- action labels (§10) ----------

/** What a driven channel is, in a word for a button: FIRE for a gun, SHIELD, BEAM, else the part's name. */
function channelWord(bp: Blueprint, channel: string): string | null {
  const c = componentOfChannel(bp, channel);
  if (!c) return null;
  for (const id of c.bodies) {
    const b = body(bp, id);
    if (b.magazine?.railgun?.channel === channel) return "FIRE";
    if (b.shield?.channel === channel) return "SHIELD";
    if (b.tractor?.channel === channel) return "BEAM";
  }
  return c.label.toUpperCase();
}

/**
 * What a control is called on screen in this ship: the player's own name for it here, else the
 * largest thing it drives (an action wired 100% to the shield is SHIELD), else its own name.
 */
export function actionLabel(bp: Blueprint, control: string, fallback: string): string {
  const own = bp.labels?.[control]?.trim();
  if (own) return own;
  let best: { w: number; word: string } | null = null;
  for (const r of bp.mix.rows)
    for (const l of r.lines) {
      if (l.control !== control) continue;
      const word = channelWord(bp, r.channel);
      if (word && (!best || l.weight > best.w)) best = { w: l.weight, word };
    }
  return best?.word ?? fallback.toUpperCase();
}

/** Names a control on screen in this ship ("" goes back to the automatic name). */
export function setLabel(bp: Blueprint, control: string, label: string): Blueprint {
  const out = structuredClone(bp);
  const labels = { ...(out.labels ?? {}) };
  if (label.trim()) labels[control] = label.trim().toUpperCase().slice(0, 12);
  else delete labels[control];
  out.labels = labels;
  return out;
}
