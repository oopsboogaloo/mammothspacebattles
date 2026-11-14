// The worker sends rock it has already sent as stubs; the page puts its own copies back (simWorker.ts, simClient.ts).
import { describe, expect, it } from "vitest";
import { unpackBodies } from "../../src/app/simClient.ts";
import type { Body } from "../../src/core/index.ts";

const rock = (id: string) => ({ id, fixed: true, position: { x: 1, y: 2 } }) as unknown as Body;

describe("simClient", () => {
  it("PRF the page puts its own rock in place of the worker's stubs, in the same order; a missing one fails the run", () => {
    const mine = [rock("rock-a"), rock("rock-b")];
    const ship = { id: "p1-hull" } as unknown as Body;
    const world = { bodies: [{ id: "rock-b", kept: true as const }, ship, { id: "rock-a", kept: true as const }] };
    expect(unpackBodies(world, mine)).toBe(true);
    expect(world.bodies).toEqual([mine[1], ship, mine[0]]);
    expect(world.bodies[0]).toBe(mine[1]);
    const missing = { bodies: [{ id: "rock-c", kept: true as const }] };
    expect(unpackBodies(missing, mine)).toBe(false);
  });
});
