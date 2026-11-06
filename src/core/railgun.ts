// Railgun (WPN-008): a magazine that launches its shells electrically, with no propellant gas.
//
// A stand-in for the gas cannon, which is kept for later: firing a gas cannon from a ship that is
// manoeuvring hard crushed its propellant behind the shell and could take seconds a step. A
// railgun fires the moment its channel is on and it has reloaded: the next shell appears at the
// muzzle, moving with that point of the gun, and the gun pushes it out along the bore at `speed`,
// taking the equal and opposite push itself. Momentum and angular momentum are exact (the shell's
// mass leaves the gun as a magazine's does). The energy comes from the ship's power, recorded in
// the ledger under `power`.

import { add, cross, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { bodyMass } from "./bodies.ts";
import { massProps } from "./shapes.ts";
import type { Body, World } from "./world.ts";

export interface Railgun {
  /** Control channel that fires it, through a control link (on above 0). */
  channel: string;
  /** Launch speed relative to the muzzle, m/s. */
  speed: number;
}

/** A railgun's channel is on, through a working control link. */
function triggered(world: World, b: Body, channel: string): boolean {
  const linked = world.links.some((l) => l.kind === "control" && l.to === b.id && l.channel === channel && l.integrity > 0);
  return linked && (world.controls[channel] ?? 0) > 0;
}

/** Whether a railgun is ready: shells left, reloaded, working. */
export function railgunReady(b: Body): boolean {
  const m = b.magazine;
  return !!m?.railgun && b.integrity > 0 && m.count >= 1 && m.timer >= m.reload - 1e-9;
}

/**
 * Runs every railgun for one step: counts up its reload, and fires when its channel is on and it
 * is ready. Returns how many fired. Event `railgun.fired`.
 */
export function fireRailguns(world: World, dt: number, addBody: (w: World, b: Body) => void, normalize: (input: never) => Body): number {
  let fired = 0;
  for (const b of [...world.bodies]) {
    const mag = b.magazine;
    if (!mag?.railgun || b.fixed) continue;
    mag.timer += dt;
    if (!railgunReady(b) || !triggered(world, b, mag.railgun.channel)) continue;
    const q = sinCos(b.angle);
    const r = rotate(q, mag.at);
    const at: Vec2 = add(b.position, r);
    const spin = { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x };
    const angle = b.angle + mag.angle;
    const id = `${b.id}-shell-${mag.loaded + 1}`;
    const shell = normalize({ ...structuredClone(mag.shell), id, position: at, velocity: add(b.velocity, spin), angle, angularVelocity: b.angularVelocity } as never);
    if (shell.explosive) shell.explosive = { ...shell.explosive, from: b.id, armed: false };
    // The shell's mass leaves the gun, with the momentum it carries.
    const m0 = bodyMass(b);
    const ms = bodyMass(shell);
    mag.count -= 1;
    mag.loaded += 1;
    mag.timer = 0;
    const m1 = bodyMass(b);
    b.velocity = { x: (m0 * b.velocity.x - ms * shell.velocity.x) / m1, y: (m0 * b.velocity.y - ms * shell.velocity.y) / m1 };
    // The launch: equal and opposite pushes at the muzzle, along the bore.
    const bore = rotate(sinCos(angle), { x: 0, y: 1 });
    const J = scale(bore, ms * mag.railgun.speed);
    shell.velocity = add(shell.velocity, scale(J, 1 / ms));
    b.velocity = sub(b.velocity, scale(J, 1 / m1));
    const I1 = massProps(b.shape, m1).inertia;
    if (I1 > 0) b.angularVelocity -= cross(r, J) / I1;
    addBody(world, shell);
    world.events.push({ tick: world.tick, type: "railgun.fired", data: { id: b.id, shell: id, left: mag.count } });
    fired += 1;
  }
  return fired;
}
