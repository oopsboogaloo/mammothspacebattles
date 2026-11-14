// Rock the simulation worker has already sent (simWorker.ts) goes back to the page as a stub, and the
// page puts its own copy back in its place (simClient.ts unpackBodies). Mammoth Thrust's levels are
// hundreds of fixed rock pieces, most of the world the worker would otherwise clone for every run.
import type { Body, Command, World } from "../core/index.ts";

/** A body the page already holds as it is. */
export interface KeptBody {
  id: string;
  kept: true;
}

const isRock = (w: World, b: Body): boolean => !!w.terrain && b.fixed === true && !b.material && b.id.startsWith(w.terrain.prefix);

/**
 * Rock is fixed and has no material, so the step itself changes nothing of it in place: a crater
 * takes pieces out and adds new ones, which go whole. Each piece is checked against what was sent all
 * the same (its shape, where it is and how it lies), and everything is forgotten whenever the page
 * sends a world or a run applies a command that can change a body (runChangesBodies).
 */
export class RockStubs {
  private sent = new WeakMap<Body, { shape: Body["shape"]; x: number; y: number; angle: number }>();

  forget(): void {
    this.sent = new WeakMap();
  }

  /** The world's bodies to send: rock already sent as it is, as stubs. */
  pack(w: World): (Body | KeptBody)[] {
    return w.bodies.map((b) => {
      if (!isRock(w, b)) return b;
      const was = this.sent.get(b);
      if (was && was.shape === b.shape && was.x === b.position.x && was.y === b.position.y && was.angle === b.angle) return { id: b.id, kept: true };
      this.sent.set(b, { shape: b.shape, x: b.position.x, y: b.position.y, angle: b.angle });
      return b;
    });
  }
}

/**
 * Whether a run applied a command that can change a body in place: anything but the controls
 * (body.set, an impulse, a drag, world.set, ...). The games send only control.set.
 */
export function runChangesBodies(req: { inputs?: Command[]; timeline: [number, Command[]][]; edits: { tick: number; commands: Command[] }[] }, from: number, steps: number): boolean {
  const changes = (cs: readonly Command[]) => cs.some((c) => c.type !== "control.set");
  const ran = (tick: number) => tick >= from && tick <= from + steps;
  return (!!req.inputs && changes(req.inputs)) || req.timeline.some(([t, cs]) => ran(t) && changes(cs)) || req.edits.some((e) => ran(e.tick) && changes(e.commands));
}
