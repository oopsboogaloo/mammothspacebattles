// The reference battle (docs/gpu-gas-plan.md, Phase 0): the benchmark scene the gas budget is set
// against. Four ships firing every engine (the Mammoth, Gunship 3, Gunship 2 and the FLY lander),
// two explosive shells bursting on rubble asteroids within the same second, and the plumes washing
// over asteroids behind the ships.
//   node scripts/reference-battle.ts            writes scenarios/reference-battle.json
// Each ship is copied from its own scenario at default parameters: the welded assembly round its
// root body, with the links between its parts. Ids get a prefix; every ship's engines answer the
// shared `left` and `right` channels, so Q and E fly the whole fleet.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario, scenarioToJson } from "../src/core/index.ts";

const root = new URL("..", import.meta.url).pathname;
type Json = Record<string, unknown>;
type Vec = { x: number; y: number };

interface ShipSpec {
  file: string;
  root: string;
  prefix: string;
  at: Vec;
}
// Side by side, all heading +y, 25–30 m apart so the ships don't collide, close enough that the
// far field (10 m from every body) keeps the neighbours' exhaust alive where plumes overlap rocks.
const SHIPS: ShipSpec[] = [
  { file: "mammoth", root: "cockpit", prefix: "mam", at: { x: -45, y: 0 } },
  { file: "gunship-3", root: "hull", prefix: "gs3", at: { x: -15, y: 0 } },
  { file: "gunship-2", root: "hull", prefix: "gs2", at: { x: 15, y: 0 } },
  { file: "fly-twin-engine", root: "hull", prefix: "fly", at: { x: 40, y: 0 } },
];

function resolved(file: string): Json {
  const raw = JSON.parse(readFileSync(join(root, "scenarios", `${file}.json`), "utf8"));
  return scenarioToJson(parseScenario(raw));
}

const bodies: Json[] = [];
const joints: Json[] = [];
const links: Json[] = [];
for (const s of SHIPS) {
  const w = resolved(s.file).world as { bodies: Json[]; joints?: Json[]; links?: Json[] };
  const js = w.joints ?? [];
  // The welded assembly round the root.
  const ship = new Set([s.root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const j of js) {
      const a = String(j.a);
      const b = String(j.b);
      if (ship.has(a) !== ship.has(b)) {
        ship.add(a);
        ship.add(b);
        grew = true;
      }
    }
  }
  const id = (x: string) => `${s.prefix}-${x}`;
  for (const b of w.bodies) {
    if (!ship.has(String(b.id))) continue;
    const c = structuredClone(b) as Json & { position: Vec; tractor?: Json };
    c.id = id(String(b.id));
    c.position = { x: c.position.x + s.at.x, y: c.position.y + s.at.y };
    if (c.tractor?.tetherFrom) c.tractor.tetherFrom = id(String(c.tractor.tetherFrom));
    bodies.push(c);
  }
  for (const j of js) if (ship.has(String(j.a))) joints.push({ ...j, id: id(String(j.id)), a: id(String(j.a)), b: id(String(j.b)) });
  for (const l of w.links ?? []) {
    if (!ship.has(String(l.to)) || (l.from !== undefined && !ship.has(String(l.from)))) continue;
    const c: Json = { ...l, id: id(String(l.id)), to: id(String(l.to)) };
    if (l.from !== undefined) c.from = id(String(l.from));
    links.push(c);
  }
}

// Rubble asteroids, as in GS-X: two in the shells' paths, two in the plumes behind the ships.
const rock = (id: string, seed: number, radius: number, at: Vec, v: Vec = { x: 0, y: 0 }) => ({
  id,
  seed,
  pieces: 12,
  radius,
  density: 100,
  material: { name: "rock", threshold: 10, toughness: 200 },
  bond: 100000,
  position: at,
  velocity: v,
  angle: 0.3 * seed,
  angularVelocity: 0.02,
  gold: 1,
  compounds: 1,
});
const asteroids = [
  rock("rock-a", 3, 4, { x: -30, y: 30 }),
  rock("rock-b", 8, 3.5, { x: 28, y: 32 }),
  rock("rock-c", 5, 3, { x: -45, y: -14 }),
  rock("rock-d", 11, 3, { x: 15, y: -13 }),
];

// Two armed 0.5 kg shells with the Mammoth's 0.3 kg charge, flying at the first two rocks so both
// burst within the same second (about 0.5 s and 0.8 s in).
const shell = (id: string, at: Vec, v: Vec): Json => ({
  id,
  shape: { kind: "box", width: 0.36, height: 0.3 },
  mass: 0.5,
  position: at,
  velocity: v,
  angle: 0,
  angularVelocity: 0,
  restitution: 0,
  friction: 0.05,
  explosive: { charge: 0.3, fragments: 6, radius: 2 },
});
bodies.push(shell("shell-a", { x: -30, y: 3 }, { x: 0, y: 50 }));
bodies.push(shell("shell-b", { x: 28, y: -8 }, { x: 0, y: 46 }));

const scenario = {
  schema: 1,
  name: "reference-battle",
  title: "Reference battle",
  description:
    "The gas benchmark (docs/gpu-gas-plan.md): four ships firing every engine — the Mammoth, Gunship 3, Gunship 2 and the FLY lander — two explosive shells bursting on rubble asteroids within the same second, and the plumes washing over asteroids behind the ships. Q and E fly the whole fleet. Built by scripts/reference-battle.ts; the gas cost here is the baseline the GPU gas is budgeted against.",
  profile: "sandbox",
  seed: 48,
  world: {
    bodies,
    joints,
    links,
    gravity: { x: 0, y: 0 },
    bounds: { min: { x: -500, y: -500 }, max: { x: 500, y: 500 }, farField: 10, depth: 2 },
    asteroids,
  },
  timeline: [
    {
      step: 0,
      commands: [
        { type: "control.set", channel: "left", value: 1 },
        { type: "control.set", channel: "right", value: 1 },
      ],
    },
  ],
  end: { steps: 240 },
  probes: [
    { id: "parcels", path: "gas.parcels.length" },
    { id: "substeps", path: "gas.substeps" },
  ],
  // Both shells burst within the same second; the ledger stays clean.
  assertions: [
    { kind: "event", type: "detonation", occurred: true, from: 0, to: 240 },
    { kind: "event", type: "violation", occurred: false },
  ],
  ui: {
    lookFor:
      "The gas benchmark: every engine on four ships fires from the start, and two shells burst on the rocks ahead within the first second. Watch the parcel count and the step time.",
    overlays: [],
    graphs: [],
    camera: { x: 0, y: 5, zoom: 6 },
    follow: "mam-cockpit",
    keys: { q: "left", e: "right" },
    labels: false,
  },
};
// Check it parses before writing.
parseScenario(scenario);
writeFileSync(join(root, "scenarios", "reference-battle.json"), JSON.stringify(scenario, null, 2) + "\n");
console.log(`reference-battle.json: ${bodies.length} bodies, ${joints.length} joints, ${links.length} links, ${asteroids.length} asteroids`);
