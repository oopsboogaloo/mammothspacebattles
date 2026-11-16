// The ship's power on the game's HUD (Chloe, 16 November 2026; design rules §4): its batteries'
// charge and how hard its generators are working. Shown only for a ship with a power system:
// the games' own ships, which have none, show nothing.
import { powerOf, type World } from "../core/index.ts";

/** The ship being flown in a game, or the one a page names: its hull's id. */
export function flownHull(world: World): string | null {
  const g = world.thrust ?? world.arcade ?? world.lander;
  if (!g) return null;
  return g.spec.hull.replaceAll("{n}", String(g.state.n));
}

export function PowerGauge({ world, ship }: { world: World; ship: string | null }) {
  const p = ship && world.bodies.some((b) => b.id === ship) ? powerOf(world, ship) : null;
  if (!p) return null;
  const charge = p.capacity > 0 ? p.stored / p.capacity : 0;
  const load = p.output > 0 ? p.making / p.output : 0;
  return (
    <>
      <span class="mas-fuel mas-power" data-testid="hud-battery" title={`Battery: ${Math.round(p.stored)} of ${Math.round(p.capacity)} kJ`}>
        <i class={charge < 0.2 ? "low" : ""} style={{ width: `${(100 * charge).toFixed(1)}%` }} />
        <em>BATTERY</em>
      </span>
      <span class="mas-fuel mas-power gen" data-testid="hud-generators" title={`Generators: ${Math.round(p.making)} of ${Math.round(p.output)} kW`}>
        <i class={load > 0.95 ? "low" : ""} style={{ width: `${(100 * load).toFixed(1)}%` }} />
        <em>GEN LOAD</em>
      </span>
    </>
  );
}
