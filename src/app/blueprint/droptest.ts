// The drop test (BPD-053; the damage research of 17 November 2026): a blueprint's ship let fall on
// Thrust's first level with no input, as Chloe tested THRUST OG by hand. What it measures is what
// makes a ship's damage feel right or wrong:
// - where the landing's energy goes: through its contacts with the ground (which is what the damage
//   rule, DMG-002, sees) or into its welds as they flex (which it doesn't);
// - the biggest single hit on one part in one step, against the parts' damage threshold (150 J for
//   hull and engine parts);
// - what it loses: integrity, parts destroyed, welds broken;
// - how far its parts bend against the cockpit before anything breaks.
// THRUST OG is the benchmark: it loses its main engine's right nozzle wall and its battery's welds.
import { getProfile, initialWorld, massProps, parseScenario, stepInPlace, type World } from "../../core/index.ts";
import { withBlueprint } from "../playtest.ts";
import type { Blueprint } from "./model.ts";

export interface DropResult {
  /** The hull's speed just before it lands, m/s. */
  impactSpeed: number;
  /** Mechanical energy (kinetic and gravitational) the ship loses over the landing, J. */
  energyLost: number;
  /** Of it, what its contacts with anything not its own took, J: what the damage rule sees. */
  contactEnergy: number;
  /** The biggest share of one contact's energy one of its parts took in one step, J. */
  biggestHit: number;
  /** Integrity lost, summed over its parts; parts destroyed; welds broken (ids, without the game's prefix). */
  integrityLost: number;
  destroyed: number;
  welds: string[];
  /** The most any part turned against the cockpit before the first weld broke, degrees, and which. */
  flex: number;
  flexPart: string;
}

const STEP = 1 / 240;

/**
 * Drops `bp` on Thrust's first level (`level` is its scenario) and measures the landing. `extra`
 * adds that much downward speed at the start (m/s), for a harder landing. Runs `seconds` (5 by default).
 */
export function dropTest(bp: Blueprint, level: Record<string, unknown>, extra = 0, seconds = 5): DropResult {
  const sc = parseScenario(withBlueprint(level, bp));
  const w = initialWorld(sc) as World;
  const profile = getProfile((sc as unknown as { profile?: string }).profile ?? "sandbox");
  const mine = (id: string) => id.startsWith("p1-");
  const ship = () => w.bodies.filter((b) => mine(b.id));
  for (const b of ship()) b.velocity = { x: b.velocity.x, y: b.velocity.y - extra };
  const hull = () => w.bodies.find((b) => b.id === "p1-hull");
  const turn = (b: { angle: number }) => b.angle - (hull()?.angle ?? 0);
  const start = new Map(ship().map((b) => [b.id, turn(b)]));
  const mechanical = () =>
    ship().reduce((s, b) => s + 0.5 * b.mass * (b.velocity.x ** 2 + b.velocity.y ** 2) + 0.5 * massProps(b.shape, b.mass).inertia * b.angularVelocity ** 2 - b.mass * w.gravity.y * b.position.y, 0);
  const out: DropResult = { impactSpeed: 0, energyLost: 0, contactEnergy: 0, biggestHit: 0, integrityLost: 0, destroyed: 0, welds: [], flex: 0, flexPart: "" };
  let landed = -1;
  let before = 0;
  let seen = 0;
  for (let i = 0; i < seconds / STEP; i++) {
    const h = hull();
    const v = h ? Math.hypot(h.velocity.x, h.velocity.y) : 0;
    const m = mechanical();
    stepInPlace(w, [], profile);
    const hits = w.contacts.filter((c) => mine(c.a) !== mine(c.b) && c.energyLost > 0);
    if (landed < 0 && hits.length) {
      landed = i;
      out.impactSpeed = v;
      before = m;
    }
    for (const c of hits) {
      out.contactEnergy += c.energyLost;
      out.biggestHit = Math.max(out.biggestHit, c.energyLost / 2);
    }
    if (w.events.length < seen) seen = 0;
    for (const e of w.events.slice(seen)) {
      const d = e.data as { id?: string; a?: string; b?: string; loss?: number };
      if (e.type === "damage" && d.id && mine(d.id)) out.integrityLost += d.loss ?? 0;
      if (e.type === "destroyed" && d.id && mine(d.id)) out.destroyed++;
      if (e.type === "joint.break" && d.a && d.b && mine(d.a) && mine(d.b)) out.welds.push((d.id ?? "").replace(/^p1-/, ""));
    }
    seen = w.events.length;
    if (!out.welds.length)
      for (const b of ship()) {
        const a0 = start.get(b.id);
        if (a0 === undefined) continue;
        const d = (Math.abs(Math.atan2(Math.sin(turn(b) - a0), Math.cos(turn(b) - a0))) * 180) / Math.PI;
        if (d > out.flex) {
          out.flex = d;
          out.flexPart = b.id.replace(/^p1-/, "");
        }
      }
    // A second after landing: the landing's energy is settled (later, a ship whose engine fired takes off again).
    if (landed >= 0 && i === landed + 240) out.energyLost = before - mechanical();
  }
  return out;
}
