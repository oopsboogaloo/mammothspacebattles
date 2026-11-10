// The gas split into clusters that can't meet within a step, each stepped on its own (§10.1).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeTotals, createWorld, getProfile, gasClusters, hashValue, initialWorld, normalizeBody, parseScenario, stepGas, stepInPlace, wallBodies, type Command, type World, parcelsOf, setParcels, gasOf } from "../../src/core/index.ts";
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
    const cs = gasClusters(w.gas, wallBodies(w.bodies), w.joints, sandbox.timestep);
    expect(cs.length).toBeGreaterThanOrEqual(3);
    expect(cs.reduce((n, c) => n + c.parcels.length, 0)).toBe(w.gas.count);
    for (const c of cs) expect(c.bodies.length).toBeLessThan(w.bodies.length);
    // By now the ships have crashed into each other, which leaves small energy residuals logged in
    // §9.9 (they predate clusters); mass and momentum stay exact.
    expect(w.ledger.maxResidual.mass).toBeLessThan(1e-9);
    expect(Math.hypot(w.ledger.maxResidual.momentumX, w.ledger.maxResidual.momentumY)).toBeLessThan(1e-9);
  }, 300_000);
});

describe("gas clusters, review findings", () => {
  const test = getProfile("test");
  const parcel = (id: number, x: number, y: number, thermal: number, mass = 0.01, radius = 0.1) => ({ id, mass, composition: { o2: 1 }, position: { x, y }, velocity: { x: 0, y: 0 }, thermal, radius });
  const fresh = (parcels: ReturnType<typeof parcel>[], bodies: object[] = []) => {
    const w = createWorld(1, bodies as never, { x: 0, y: 0 }, {}, test);
    setParcels(w.gas, structuredClone(parcels));
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
    expect(gasClusters(gasOf(ps), [], [], test.timestep)).toHaveLength(1);
    const a = fresh(ps);
    const b = fresh(ps);
    stepInPlace(a, [], test);
    stepGas(b.gas, [], [], test.timestep, b.bounds);
    expect(hashValue(parcelsOf(a.gas))).toBe(hashValue(parcelsOf(b.gas)));
  });

  it("NFR-004 pooled small clusters list a fixed body they share once, so its walls push once", () => {
    const ground = { ...box("ground", 10, 1, { position: { x: 0, y: -0.5 } }), fixed: true };
    const ps = [parcel(1, -4, 0.1, 1), parcel(2, 4, 0.1, 1)];
    const cs = gasClusters(gasOf(ps), wallBodies([normalizeBody(ground as never)]), [], test.timestep);
    expect(cs).toHaveLength(1);
    expect(cs[0].bodies).toEqual([0]);
    const a = fresh(ps, [ground]);
    const b = fresh(ps, [ground]);
    stepInPlace(a, [], test);
    stepGas(b.gas, wallBodies(b.bodies), [], test.timestep, b.bounds);
    expect(hashValue(parcelsOf(a.gas))).toBe(hashValue(parcelsOf(b.gas)));
  });
});
