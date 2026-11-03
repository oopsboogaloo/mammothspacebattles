import { describe, expect, it } from "vitest";
import { attachCommands, makePrefab, nearestPort, place, ports, prefabCommands, usedPorts } from "../../src/app/ports.ts";
import { applyCommands, createWorld, getProfile, stepInPlace } from "../../src/core/index.ts";
import { box, disc } from "../helpers.ts";

const slop = getProfile("test").tol.penetration / 2;

describe("ports and attaching", () => {
  it("SBX-014 boxes have a port on each face, discs four on the rim", () => {
    expect(ports({ kind: "box", width: 2, height: 1 }).map((p) => p.local)).toEqual([{ x: 0, y: -0.5 }, { x: 1, y: 0 }, { x: 0, y: 0.5 }, { x: -1, y: 0 }]);
    expect(ports({ kind: "disc", radius: 1 })).toHaveLength(4);
  });

  it("SBX-014 a part attaches flush to the face it is offered to, unrotated, and the result is valid", () => {
    const w = createWorld(1, [box("hull", 2, 1)]);
    const near = nearestPort(w, { x: 1.1, y: 0 }, 0.6)!;
    expect(near.port.index).toBe(1);
    const pl = place(w, { id: "new", shape: { kind: "box", width: 1, height: 1 } }, near.body, near.port, slop);
    expect(pl.valid).toBe(true);
    expect(pl.position.x).toBeCloseTo(1.5, 12);
    expect(pl.position.y).toBeCloseTo(0, 12);
    expect(pl.angle).toBeCloseTo(0, 12);
  });

  it("SBX-014 the preview explains why a placement is blocked: overlap or a port already in use", () => {
    const w = createWorld(1, [box("hull", 2, 1), disc("rock", { position: { x: 1.6, y: 0 }, shape: { kind: "disc", radius: 0.3 } })]);
    const pl = place(w, { id: "new", shape: { kind: "box", width: 1, height: 1 } }, w.bodies[0], ports(w.bodies[0].shape)[1], slop);
    expect(pl.valid).toBe(false);
    expect(pl.reason).toMatch(/overlap rock/);
    const w2 = createWorld(1, [box("hull", 2, 1)]);
    const p2 = place(w2, { id: "a", shape: { kind: "box", width: 1, height: 1 } }, w2.bodies[0], ports(w2.bodies[0].shape)[1], slop);
    applyCommands(w2, attachCommands(w2, box("a", 1, 1), p2, "j1", true));
    expect(usedPorts(w2, "hull")).toEqual(new Set([1]));
    expect(place(w2, { id: "b", shape: { kind: "disc", radius: 0.2 } }, w2.bodies[1], ports(w2.bodies[1].shape)[1], slop).reason).toMatch(/already holds a joint/);
  });

  it("SBX-014 a part attached to a moving, spinning body starts with that body's motion at its position", () => {
    const w = createWorld(1, [box("hull", 2, 1, { velocity: { x: 1, y: 0 }, angularVelocity: 2 })]);
    const pl = place(w, { id: "a", shape: { kind: "box", width: 1, height: 1 } }, w.bodies[0], ports(w.bodies[0].shape)[1], slop);
    const cmds = attachCommands(w, box("a", 1, 1), pl, "j", true);
    applyCommands(w, cmds);
    const a = w.bodies.find((b) => b.id === "a")!;
    expect(a.velocity.x).toBeCloseTo(1, 12);
    expect(a.velocity.y).toBeCloseTo(2 * 1.5, 12);
    expect(a.angularVelocity).toBe(2);
    stepInPlace(w, [], getProfile("test"));
    expect(w.ledger.violations).toBe(0);
  });

  it("SBX-021 an assembly saved as a prefab spawns as a copy with fresh ids and the same joints", () => {
    const w = createWorld(1, [box("hull", 2, 1, { position: { x: 5, y: 5 } }), box("pod", 1, 1, { position: { x: 6.5, y: 5 } })], { x: 0, y: 0 }, {
      joints: [{ id: "j", a: "hull", b: "pod", anchorA: { x: 1, y: 0 }, anchorB: { x: -0.5, y: 0 } }],
    });
    const pf = makePrefab(w, "pod", "Ship");
    expect(pf.bodies.map((b) => b.position)).toEqual([{ x: 0, y: 0 }, { x: 1.5, y: 0 }]);
    let n = 0;
    const cmds = prefabCommands(pf, { x: -3, y: 0 }, (base) => `${base}-${++n}`);
    applyCommands(w, cmds);
    expect(w.bodies).toHaveLength(4);
    expect(w.joints).toHaveLength(2);
    const copy = w.bodies.find((b) => b.id === "pod-2")!;
    expect(copy.position).toEqual({ x: -1.5, y: 0 });
  });
});
