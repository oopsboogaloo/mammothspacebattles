// The stress test: the Mammoth for you to fly, two rubble asteroids, and an "Add a gunship" button.
// Each press adds an AI gunship (Gunship 2 from the duel, AI-3) that hunts whatever it sees, you or
// another gunship (each is its own side), so the scene fills with ships flying round and shooting.
// The inspector's Performance section shows what each step costs as they pile up.
//   node scripts/stress-test.ts            writes scenarios/stress-test.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario, scenarioToJson } from "../src/core/index.ts";

const root = new URL("..", import.meta.url).pathname;
type Json = Record<string, unknown>;
type Vec = { x: number; y: number };
const resolved = (file: string) => scenarioToJson(parseScenario(JSON.parse(readFileSync(join(root, "scenarios", `${file}.json`), "utf8"))));

// The welded assembly round `rootId`: its bodies, the welds between them, and the links within it.
function assembly(w: { bodies: Json[]; joints?: Json[]; links?: Json[] }, rootId: string) {
  const js = w.joints ?? [];
  const ship = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const j of js)
      if (ship.has(String(j.a)) !== ship.has(String(j.b))) {
        ship.add(String(j.a));
        ship.add(String(j.b));
        grew = true;
      }
  }
  return {
    bodies: w.bodies.filter((b) => ship.has(String(b.id))),
    joints: js.filter((j) => ship.has(String(j.a))),
    links: (w.links ?? []).filter((l) => ship.has(String(l.to)) && (l.from === undefined || ship.has(String(l.from)))),
  };
}

// You: the Mammoth, as its own scenario has it.
const mam = resolved("mammoth") as Json & { world: { bodies: Json[]; joints: Json[]; links: Json[] }; ui: Json };
const you = assembly(mam.world, "cockpit");

// The template: the duel's AI gunship, laid out round its hull, with "{n}" for the copy's number in
// every id ("e1-…" → "s{n}-…") and channel ("e1.…" → "s{n}.…"), and its own side.
const duel = resolved("ai-duel") as Json & { world: { bodies: Json[]; joints: Json[]; links: Json[] } };
const enemy = assembly(duel.world, "e1-hull");
const hull = enemy.bodies.find((b) => b.id === "e1-hull") as Json & { position: Vec };
const centred = enemy.bodies.map((b) => {
  const p = (b as { position: Vec }).position;
  const c = structuredClone(b) as Json & { pilot?: Json };
  c.position = { x: p.x - hull.position.x, y: p.y - hull.position.y };
  c.velocity = { x: 0, y: 0 };
  c.angularVelocity = 0;
  if (c.pilot) c.pilot = { ...c.pilot, mode: "hunting", side: "s{n}" };
  return c;
});
const named = (x: unknown) => JSON.parse(JSON.stringify(x).replace(/"e1-/g, '"s{n}-').replace(/"e1\./g, '"s{n}.'));
const template = { label: "Add a gunship", bodies: named(centred), joints: named(enemy.joints), links: named(enemy.links), radius: 70 };

const rock = (id: string, seed: number, radius: number, at: Vec) => ({
  id,
  seed,
  pieces: 12,
  radius,
  density: 100,
  material: { name: "rock", threshold: 10, toughness: 200 },
  bond: 100000,
  position: at,
  velocity: { x: 0, y: 0 },
  angle: 0.3 * seed,
  angularVelocity: 0.02,
  gold: 1,
  compounds: 1,
});

const scenario = {
  schema: 1,
  name: "stress-test",
  title: "Stress test",
  description:
    "How many ships before it slows? Fly the Mammoth (Q and E, F fires, T beams) among two asteroids, and press 'Add a gunship' (top bar) to add AI gunships that hunt whatever they see — you or each other. The Performance section shows what each step costs. Built by scripts/stress-test.ts.",
  profile: "sandbox",
  seed: 7,
  world: {
    bodies: you.bodies,
    joints: you.joints,
    links: you.links,
    gravity: { x: 0, y: 0 },
    bounds: { min: { x: -500, y: -500 }, max: { x: 500, y: 500 }, farField: 10, depth: 2 },
    asteroids: [rock("rock-a", 3, 4, { x: -30, y: 40 }), rock("rock-b", 8, 3.5, { x: 35, y: -25 })],
  },
  timeline: [],
  end: { steps: 240 },
  probes: [],
  assertions: [{ kind: "event", type: "violation", occurred: false }],
  ui: {
    lookFor: "Press 'Add a gunship' (top bar) again and again and watch the step time beside it: once a step takes longer than its budget, the game falls behind real time. More in the inspector's Performance section.",
    overlays: [],
    graphs: [],
    camera: { x: 0, y: 0, zoom: 6 },
    follow: "cockpit",
    keys: mam.ui.keys,
    labels: false,
    spawn: template,
  },
};
parseScenario(scenario);
writeFileSync(join(root, "scenarios", "stress-test.json"), JSON.stringify(scenario, null, 2) + "\n");
console.log(`stress-test.json: you ${you.bodies.length} bodies; template ${template.bodies.length} bodies, ${template.joints.length} joints, ${template.links.length} links`);
