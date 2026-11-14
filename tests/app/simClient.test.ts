// The worker sends rock it has already sent as stubs; the page puts its own copies back (rockStubs.ts, simClient.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { unpackBodies } from "../../src/app/simClient.ts";
import { RockStubs, runChangesBodies } from "../../src/app/rockStubs.ts";
import { applyCommands, getProfile, initialWorld, parseScenario, stepInPlace, type Body, type Command, type World } from "../../src/core/index.ts";

const level = () => initialWorld(parseScenario(JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8"))));
const P = getProfile("sandbox");
/** What the page holds after taking a run: the worker's world, as sent (structuredClone stands in for postMessage), with the stubs filled. */
function take(sent: World, page: World): World | null {
  const got = structuredClone(sent) as World;
  return unpackBodies(got as never, page.bodies) ? got : null;
}

describe("simClient", () => {
  it("PRF the page puts its own rock in place of the worker's stubs, in the same order; a missing one fails the run", () => {
    const rock = (id: string) => ({ id, fixed: true, position: { x: 1, y: 2 } }) as unknown as Body;
    const mine = [rock("rock-a"), rock("rock-b")];
    const ship = { id: "p1-hull" } as unknown as Body;
    const world = { bodies: [{ id: "rock-b", kept: true as const }, ship, { id: "rock-a", kept: true as const }] };
    expect(unpackBodies(world, mine)).toBe(true);
    expect(world.bodies).toEqual([mine[1], ship, mine[0]]);
    expect(world.bodies[0]).toBe(mine[1]);
    expect(unpackBodies({ bodies: [{ id: "rock-c", kept: true as const }] }, mine)).toBe(false);
  });

  it("PRF on a Thrust level the second run sends the rock as stubs, and the page's world matches the worker's exactly", () => {
    const worker = level();
    let page = structuredClone(worker);
    const stubs = new RockStubs();
    for (let run = 0; run < 3; run++) {
      for (let i = 0; i < 24; i++) stepInPlace(worker, [], P);
      const packed = stubs.pack(worker);
      if (run > 0) expect(packed.filter((b) => "kept" in b).length).toBeGreaterThan(50);
      page = take({ ...worker, bodies: packed as Body[] }, page)!;
      expect(page).not.toBeNull();
      expect(JSON.stringify(page.bodies)).toBe(JSON.stringify(worker.bodies));
    }
  });

  it("PRF a run that changes a body in place (body.set on a rock piece) sends every body whole, so the page gets the change", () => {
    const worker = level();
    let page = structuredClone(worker);
    const stubs = new RockStubs();
    page = take({ ...worker, bodies: stubs.pack(worker) as Body[] }, page)!;
    const piece = worker.bodies.find((b) => b.fixed && b.id.startsWith("rock-"))!;
    const set: Command = { type: "body.set", id: piece.id, patch: { friction: 0.1 } };
    applyCommands(worker, [set], P);
    expect(runChangesBodies({ timeline: [[worker.tick, [set]]], edits: [] }, worker.tick, 1)).toBe(true);
    expect(runChangesBodies({ timeline: [[worker.tick, [{ type: "control.set", channel: "main", value: 1 } as Command]]], edits: [] }, worker.tick, 1)).toBe(false);
    stubs.forget();
    page = take({ ...worker, bodies: stubs.pack(worker) as Body[] }, page)!;
    expect(page.bodies.find((b) => b.id === piece.id)!.friction).toBe(0.1);
  });
});
