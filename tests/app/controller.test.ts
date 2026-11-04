import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyScenario, runSteps, Sandbox } from "../../src/app/controller.ts";
import { hashValue, parseScenario, runScenario, ScenarioError } from "../../src/core/index.ts";
import { disc, readJson, ROOT } from "../helpers.ts";

const sc01 = () => readJson(join(ROOT, "scenarios/sc01-elastic-collision.json"));

describe("sandbox controller", () => {
  it("SBX-013 SCN-006 every edit is a recorded command: the exported scenario replays to the same world", () => {
    const s = new Sandbox(sc01());
    s.step(30);
    s.edit([{ type: "body.add", body: disc("c", { position: { x: 0, y: 3 }, velocity: { x: 0, y: -1 } }) }], "Spawn disc");
    s.step(100);
    s.edit([{ type: "body.impulse", id: "a", impulse: { x: 0, y: 0.5 }, point: { x: -1, y: 0 } }], "Impulse");
    s.step(200);
    const exported = s.exportScenario();
    const replay = runScenario(parseScenario(exported), { steps: s.tick });
    expect(replay.finalHash).toBe(hashValue(s.world));
    expect((exported.timeline as unknown[]).length).toBe(2);
  });

  it("SBX-019 undo and redo work for at least 200 edits", () => {
    const s = new Sandbox(emptyScenario());
    const hashes = [hashValue(s.world)];
    for (let i = 0; i < 210; i++) {
      s.edit([{ type: "body.add", body: disc(`d${String(i).padStart(3, "0")}`, { position: { x: i * 2, y: 0 } }) }], "Spawn");
      if (i % 3 === 0) s.step(2);
      hashes.push(hashValue(s.world));
    }
    const tick = s.tick;
    for (let i = 0; i < 200; i++) s.undo();
    expect(s.world.bodies).toHaveLength(10);
    expect(s.tick).toBe(tick);
    for (let i = 0; i < 200; i++) s.redo();
    expect(hashValue(s.world)).toBe(hashes.at(-1));
    expect(s.canRedo).toBe(false);
  }, 30_000);

  it("SBX-004 editing after jumping back discards the recorded future; one undo restores it", () => {
    const s = new Sandbox(emptyScenario());
    s.edit([{ type: "body.add", body: disc("a", { velocity: { x: 1, y: 0 } }) }], "Spawn a");
    s.step(100);
    s.edit([{ type: "body.add", body: disc("b", { position: { x: 0, y: 5 } }) }], "Spawn b");
    s.step(100);
    const future = hashValue(s.world);
    s.goTo(50);
    expect(s.world.bodies.map((b) => b.id)).toEqual(["a"]);
    s.edit([{ type: "body.set", id: "a", patch: { mass: 5 } }], "Set mass");
    s.step(150);
    expect(s.world.bodies.map((b) => b.id)).toEqual(["a"]); // b's spawn was discarded
    s.goTo(50);
    s.undo();
    s.goTo(200);
    expect(hashValue(s.world)).toBe(future);
  });

  it("SBX-034 jumping to a step replays deterministically from snapshots", () => {
    const s = new Sandbox(sc01());
    s.step(400);
    const at400 = hashValue(s.world);
    s.goTo(123);
    const fresh = runScenario(parseScenario(sc01()), { steps: 123 });
    expect(hashValue(s.world)).toBe(fresh.finalHash);
    s.goTo(400);
    expect(hashValue(s.world)).toBe(at400);
    expect(s.history["ledger.ke"]).toHaveLength(401);
  });

  it("SBX-012 dragging while running pulls with a bounded spring the ledger attributes to the user", () => {
    const s = new Sandbox(emptyScenario());
    s.edit([{ type: "body.add", body: disc("a") }], "Spawn");
    s.edit([{ type: "drag.set", id: "a", anchor: { x: 0, y: 0 }, target: { x: 100, y: 0 } }], "Drag", 7);
    s.step(10);
    const last = s.world.ledger.last!;
    expect(last.sources.user.momentumX).toBeGreaterThan(0);
    // Bounded: at most maxAcceleration × mass × dt of impulse per step.
    expect(last.sources.user.momentumX).toBeLessThanOrEqual(200 * 1 * s.profile.timestep + 1e-12);
    expect(s.world.ledger.violations).toBe(0);
    expect(s.world.bodies[0].position.x).toBeLessThan(1); // not teleported to the target
  });

  it("edits in the same group merge into one undo step", () => {
    const s = new Sandbox(emptyScenario());
    s.edit([{ type: "body.add", body: disc("a") }], "Spawn");
    s.edit([{ type: "drag.set", id: "a", anchor: { x: 0, y: 0 }, target: { x: 1, y: 0 } }], "Drag", 9);
    s.step(5);
    s.edit([{ type: "drag.set", id: "a", anchor: { x: 0, y: 0 }, target: { x: 2, y: 0 } }], "Drag", 9);
    s.edit([{ type: "drag.clear", id: "a" }], "Drag", 9);
    expect(s.undoLabel).toBe("Drag");
    s.undo();
    expect(s.undoLabel).toBe("Spawn");
    expect(s.world.drags).toEqual([]);
  });

  it("UX-006 an invalid scenario throws ScenarioError; an invalid edit changes nothing", () => {
    expect(() => new Sandbox({ schema: 1 })).toThrow(ScenarioError);
    const s = new Sandbox(emptyScenario());
    s.edit([{ type: "body.add", body: disc("a") }], "Spawn");
    const before = hashValue(s.world);
    expect(() => s.edit([{ type: "body.add", body: disc("a") }], "Spawn again")).toThrow(/Duplicate/);
    expect(hashValue(s.world)).toBe(before);
    expect(s.undoLabel).toBe("Spawn");
  });

  it("SCN-008 a parameter value builds the world and is saved as the new default on export", () => {
    const s = new Sandbox(sc01(), { mA: 4 });
    expect(s.world.bodies[0].mass).toBe(4);
    const out = s.exportScenario() as { parameters: { id: string; default: number }[] };
    expect(out.parameters.find((p) => p.id === "mA")!.default).toBe(4);
    expect(new Sandbox(out).world.bodies[0].mass).toBe(4);
  });
});

describe("stepping elsewhere (the simulation worker)", () => {
  const scenario = () => readJson(join(ROOT, "scenarios", "cannon-test.json"));

  it("ARC-006 DET-001 a run made on a copy of the world, taken in, equals stepping in place: world, graphs and snapshots", () => {
    const here = new Sandbox(scenario());
    const there = new Sandbox(scenario());
    here.step(130);
    // As the worker does: a copy of the world and the plan, stepped, then handed back.
    const copy = structuredClone(there.world);
    const run = runSteps(copy, structuredClone({ ...there.plan, profile: there.profile }), 130);
    expect(there.acceptRun(run, there.version)).toBe(true);
    expect(hashValue(there.world)).toBe(hashValue(here.world));
    expect(there.history).toEqual(here.history);
    there.goTo(65); // from the snapshot at 60 the run delivered
    here.goTo(65);
    expect(hashValue(there.world)).toBe(hashValue(here.world));
  });

  it("ARC-006 a run is dropped if the sandbox changed while it was out: an edit, a step or a jump", () => {
    const sb = new Sandbox(scenario());
    for (const change of [() => sb.edit([{ type: "body.add", body: disc("x", { position: { x: 50, y: 50 } }) }], "Spawn"), () => sb.step(1), () => sb.goTo(0)]) {
      const v = sb.version;
      const run = runSteps(structuredClone(sb.world), sb.plan, 10);
      change();
      const before = hashValue(sb.world);
      expect(sb.acceptRun(run, v)).toBe(false);
      expect(hashValue(sb.world)).toBe(before);
    }
  });
});
