// A ship's damage rules outside the games (docs/blueprint/spec.md §9: the designer's Try it), the
// same as Mammoth Asteroids' and Thrust's (MAS-037, MAS-038, MTH-062; arcade.ts): what is no longer
// welded to the cockpit no longer answers the controls. An engine knocked off has its fuel line cut
// and burns off what its own small store holds, held on, then is dead; one still joined to a tank
// that came off with it (a wing lost whole) burns on from that tank until it is empty; the tank
// leaks where the line left it. Anything else controlled (a gun, a shield) knocked off loses its
// control links. With the cockpit gone, nothing answers.
import { cutControl, cutShipLines } from "./arcade.ts";
import type { BodyInput, LinkInput, World } from "./world.ts";

export interface ShipRules {
  /** The cockpit's body: what stays welded to it is the ship. */
  hull: string;
  /** The ship as designed: its bodies (for where each part was) and its fuel lines. */
  ship: { bodies: BodyInput[]; links?: LinkInput[] };
  /** Fuel lines cut and lines burning on, as "tank>engine" (kept by the rules). */
  cut?: string[];
  burning?: string[];
}

/** Applies the rules after a step's physics; returns whether anything changed. */
export function runShipRules(world: World): boolean {
  const r = world.shipRules;
  if (!r) return false;
  let changed = cutShipLines(world, { ship: r.ship, hull: r.hull }, 1, r, r.hull, "ship.line");
  // Everything else controlled: off the ship, its control links go. (Engines are left to the fuel
  // lines' rule above, which holds a lost engine on until it has burned what it holds.)
  const controlled = new Set(world.links.filter((l) => l.kind === "control").map((l) => l.to));
  for (const id of controlled) {
    const b = world.bodies.find((x) => x.id === id);
    if (b?.injector) continue;
    changed = cutControl(world, r.hull, id) || changed;
  }
  return changed;
}
