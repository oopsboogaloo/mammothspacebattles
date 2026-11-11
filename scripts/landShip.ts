// The LAND twin-engine lander made breakable, for the games that fly it (Mammoth Lander, Mammoth
// Asteroids): its parts have materials, its welds have limits and bend, and its tank carries a
// charge that goes off when the tank is destroyed (LND-021). One copy, so the games' ships stay the same.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario, scenarioToJson } from "../src/core/index.ts";

const root = new URL("..", import.meta.url).pathname;
type Json = Record<string, unknown>;
type Vec = { x: number; y: number };

const land = scenarioToJson(parseScenario(JSON.parse(readFileSync(join(root, "scenarios", "land-twin-engine.json"), "utf8")))) as Json & {
  world: { bodies: Json[]; joints: Json[]; links: Json[] };
};
const shipIds = new Set<string>();
for (const j of land.world.joints) [j.a, j.b].forEach((id) => shipIds.add(String(id)));
const hull = land.world.bodies.find((b) => b.id === "hull")!;
const origin = hull.position as Vec;

/** Each part's material: thin metal, so a crash bends and breaks it (energies in J). */
export const material = (bid: string) => (bid === "tank" ? { name: "tank", threshold: 60, toughness: 500 } : { name: "hull", threshold: 150, toughness: 3000 });
/**
 * Weld limits, and where the welds start to bend (DMG-008): a share of the limits, beyond which a
 * load costs the weld integrity. Tuned by dropping the ship upright onto a pad: about 2 m/s does no
 * harm, 3 m/s bends the leg welds a little, 4 m/s badly, and about 4.5 m/s breaks a leg off.
 */
export const WELD = { tension: 7650, compression: 15300, shear: 5350, torque: 1840 };
export const YIELD = 0.3;

/** A leak in the tank (Emergency, LND-040): how damaged it is (1 whole), and where the hole faces in its frame. */
export interface Leak {
  integrity: number;
  normal: Vec;
  /** How fast the gas jets out, m/s: the push, for the same loss of fuel. */
  speed?: number;
}

/**
 * The ship as a template: its parts round the hull's centre, pointing up, their ids `prefix` + the
 * LAND ship's (with `{n}` for the ship's number), its control channels left and right.
 */
export function landShip(prefix: string, economy: number, leak?: Leak) {
  const id = (x: unknown) => `${prefix}${String(x)}`;
  const bodies = land.world.bodies
    .filter((b) => shipIds.has(String(b.id)))
    .map((b) => {
      const out: Json = { ...b, id: id(b.id), position: { x: (b.position as Vec).x - origin.x, y: (b.position as Vec).y - origin.y }, material: material(String(b.id)) };
      if (out.injector) out.injector = { ...(out.injector as Json), economy };
      // The tank's charge: the propellant's stored energy. It goes off when the tank is damaged until
      // it bursts; before that, a damaged tank leaks (DMG-004).
      if (b.id === "tank") out.explosive = { charge: 0.05, arm: 1e6, fragments: 6, radius: 0.5, whenDestroyed: true };
      // A leaking tank: damaged from the start, its hole on the side the leak faces (DMG-004).
      if (b.id === "tank" && leak) {
        const box = b.shape as { width: number; height: number };
        out.integrity = leak.integrity;
        out.breach = { point: { x: (leak.normal.x * box.width) / 2, y: (leak.normal.y * box.height) / 2 }, normal: leak.normal, credit: 0, count: 0, speed: leak.speed };
      }
      return out;
    });
  const joints = land.world.joints.map((j) => ({ ...j, id: id(j.id), a: id(j.a), b: id(j.b), limits: WELD, yield: YIELD }));
  const links = land.world.links.map((l) => ({ ...l, id: id(l.id), ...(l.from !== undefined ? { from: id(l.from) } : {}), to: id(l.to) }));
  return { bodies, joints, links };
}
