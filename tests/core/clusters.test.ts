// The gas split into clusters that can't meet within a step, each stepped on its own (§10.1).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeTotals, createWorld, getProfile, gasClusters, hashValue, initialWorld, normalizeBody, parseScenario, runClusterJob, runGasJob, stepGas, stepInPlace, stepInPlaceAsync, wallBodies, type Command, type World } from "../../src/core/index.ts";
import { box, readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });

/** Gunship 2 with the target ships' engines wired to the same controls: four ships firing. */
function fleet(): World {
  const raw = readJson(join(ROOT, "scenarios", "gunship-2.json")) as { world: { links: { kind: string; id: string; from?: string; to?: string }[] } };
  const feeds = raw.world.links.filter((l) => l.kind === "feed" && l.from === "tank" && String(l.to).startsWith("engine"));
  for (const t of ["t1", "t2", "t3"]) {
    for (const s of ["l", "r"]) raw.world.links.push({ id: `ctl-${t}-${s}`, kind: "control", channel: s === "l" ? "left" : "right", to: `${t}-engine-${s}` } as never);
    for (const f of feeds) raw.world.links.push({ ...f, id: `${t}-${f.id}`, from: `${t}-tank`, to: `${t}-${f.to}` });
  }
  return initialWorld(parseScenario(raw));
}

describe("gas clusters", () => {
  it("NFR-004 four ships firing, once their plumes have drawn apart, make separate clusters, each with only the bodies it can reach", () => {
    const w = fleet();
    // Early on the ships' plumes are close enough to meet within a step, so they are one cluster.
    for (let i = 0; i < 400; i++) stepInPlace(w, i === 0 ? [set("left", 1), set("right", 1)] : [], sandbox);
    const cs = gasClusters(w.gas.parcels, wallBodies(w.bodies), w.joints, sandbox.timestep);
    expect(cs.length).toBeGreaterThanOrEqual(3);
    expect(cs.reduce((n, c) => n + c.parcels.length, 0)).toBe(w.gas.parcels.length);
    for (const c of cs) expect(c.bodies.length).toBeLessThan(w.bodies.length);
    // By now the ships have crashed into each other, which leaves small energy residuals logged in
    // §9.9 (they predate clusters); mass and momentum stay exact.
    expect(w.ledger.maxResidual.mass).toBeLessThan(1e-9);
    expect(Math.hypot(w.ledger.maxResidual.momentumX, w.ledger.maxResidual.momentumY)).toBeLessThan(1e-9);
  }, 300_000);

  it("NFR-004 DET-001 cluster jobs run on copies (as in helper threads), in any order, give the same world as stepping in place", async () => {
    const here = fleet();
    const there = fleet();
    // Copies as a thread would get them, run in reverse order, answered in job order.
    const elsewhere = async (jobs: Parameters<typeof runClusterJob>[0][]) => {
      const copies = jobs.map((j) => structuredClone(j));
      const results = copies.map(() => null as ReturnType<typeof runClusterJob> | null);
      for (let k = copies.length - 1; k >= 0; k--) results[k] = structuredClone(runClusterJob(copies[k]));
      return results as ReturnType<typeof runClusterJob>[];
    };
    for (let i = 0; i < 150; i++) {
      const cmds = i === 0 ? [set("left", 1), set("right", 1)] : [];
      stepInPlace(here, cmds, sandbox);
      await stepInPlaceAsync(there, cmds, sandbox, (job) => runGasJob(job, elsewhere));
    }
    expect(hashValue(there)).toBe(hashValue(here));
    expect(there.ledger.violations).toBe(0);
  }, 300_000);
});

describe("gas clusters, review findings", () => {
  const test = getProfile("test");
  const parcel = (id: number, x: number, y: number, thermal: number, mass = 0.01, radius = 0.1) => ({ id, mass, composition: { o2: 1 }, position: { x, y }, velocity: { x: 0, y: 0 }, thermal, radius });
  const fresh = (parcels: ReturnType<typeof parcel>[], bodies: object[] = []) => {
    const w = createWorld(1, bodies as never, { x: 0, y: 0 }, {}, test);
    w.gas.parcels = structuredClone(parcels);
    w.gas.nextId = parcels.length + 1;
    w.ledger.totals = computeTotals(w);
    return w;
  };

  it("NFR-004 two clouds at rest close enough for their pressure to meet within the step are one cluster, and step as one", () => {
    // Two 32-parcel clouds, hot and still, 0.8 m apart at their nearest.
    const ps: ReturnType<typeof parcel>[] = [];
    for (let k = 0; k < 64; k++) {
      const side = k < 32 ? -1 : 1;
      const j = k % 32;
      ps.push(parcel(k + 1, side * (0.4 + 0.1 * (j % 8)), 0.1 * Math.floor(j / 8), 1000));
    }
    expect(gasClusters(ps as never, [], [], test.timestep)).toHaveLength(1);
    const a = fresh(ps);
    const b = fresh(ps);
    stepInPlace(a, [], test);
    stepGas(b.gas, [], [], test.timestep, b.bounds);
    expect(hashValue(a.gas.parcels)).toBe(hashValue(b.gas.parcels));
  });

  it("NFR-004 pooled small clusters list a fixed body they share once, so its walls push once", () => {
    const ground = { ...box("ground", 10, 1, { position: { x: 0, y: -0.5 } }), fixed: true };
    const ps = [parcel(1, -4, 0.1, 1), parcel(2, 4, 0.1, 1)];
    const cs = gasClusters(ps as never, wallBodies([normalizeBody(ground as never)]), [], test.timestep);
    expect(cs).toHaveLength(1);
    expect(cs[0].bodies).toEqual([0]);
    const a = fresh(ps, [ground]);
    const b = fresh(ps, [ground]);
    stepInPlace(a, [], test);
    stepGas(b.gas, wallBodies(b.bodies), [], test.timestep, b.bounds);
    expect(hashValue(a.gas.parcels)).toBe(hashValue(b.gas.parcels));
  });
});
