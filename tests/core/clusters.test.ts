// The gas split into clusters that can't meet within a step, each stepped on its own (§10.1).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getProfile, gasClusters, hashValue, initialWorld, parseScenario, runClusterJob, runGasJob, stepInPlace, stepInPlaceAsync, wallBodies, type Command, type World } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

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
  it("NFR-004 four ships firing make separate clusters, one per plume, each with only the bodies it can reach", () => {
    const w = fleet();
    for (let i = 0; i < 120; i++) stepInPlace(w, i === 0 ? [set("left", 1), set("right", 1)] : [], sandbox);
    const cs = gasClusters(w.gas.parcels, wallBodies(w.bodies), w.joints, sandbox.timestep);
    expect(cs.length).toBeGreaterThanOrEqual(4);
    expect(cs.reduce((n, c) => n + c.parcels.length, 0)).toBe(w.gas.parcels.length);
    for (const c of cs) expect(c.bodies.length).toBeLessThan(w.bodies.length);
    expect(w.ledger.violations).toBe(0);
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
