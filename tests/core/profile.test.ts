import { describe, expect, it } from "vitest";
import { PROFILES, ProfileError, getProfile, parseProfile } from "../../src/core/index.ts";

const REQUIRED_TOL = ["mass", "momentum", "angularMomentum", "energy", "velocity", "pressure", "penetration", "rocket"];
const REQUIRED_LIMIT = ["bodies", "gasParcels", "contacts", "maxSpeed", "minThickness", "minFragment"];

describe("simulation profiles", () => {
  it("PRF-001 every profile declares timestep, solver iterations and every tol.* and limit.* the spec uses", () => {
    for (const p of Object.values(PROFILES)) {
      expect(p.timestep).toBeGreaterThan(0);
      expect(p.solverIterations).toBeGreaterThan(0);
      for (const k of REQUIRED_TOL) expect(p.tol[k as keyof typeof p.tol], `${p.name} tol.${k}`).toBeGreaterThan(0);
      for (const k of REQUIRED_LIMIT) expect(p.limit[k as keyof typeof p.limit], `${p.name} limit.${k}`).toBeGreaterThan(0);
    }
  });

  it("PRF-001 every tol.* and limit.* named in the spec is a profile key", async () => {
    const { readFileSync } = await import("node:fs");
    const spec = readFileSync(new URL("../../docs/spec.md", import.meta.url), "utf8");
    const named = new Set([...spec.matchAll(/`(tol|limit)\.([A-Za-z]+)`/g)].map((m) => `${m[1]}.${m[2]}`));
    const p = getProfile("test");
    for (const key of named) {
      const [group, name] = key.split(".") as ["tol" | "limit", string];
      expect(p[group], key).toHaveProperty(name);
    }
  });

  it("PRF-002 ships a strict test profile and a larger real-time sandbox profile", () => {
    const test = getProfile("test");
    const sandbox = getProfile("sandbox");
    expect(test.tol.momentum).toBeLessThan(sandbox.tol.momentum);
    expect(test.tol.energy).toBeLessThan(sandbox.tol.energy);
    expect(sandbox.limit.gasParcels).toBeGreaterThan(test.limit.gasParcels);
    expect(sandbox.limit.bodies).toBeGreaterThan(test.limit.bodies);
  });

  it("PRF-004 a profile missing values is rejected and names every missing key", () => {
    const raw = structuredClone(getProfile("test")) as unknown as Record<string, Record<string, unknown>>;
    delete raw.tol.rocket;
    delete raw.limit.minFragment;
    let error: ProfileError | undefined;
    try {
      parseProfile(raw);
    } catch (e) {
      error = e as ProfileError;
    }
    expect(error).toBeInstanceOf(ProfileError);
    expect(error!.missing).toEqual(["tol.rocket", "limit.minFragment"]);
    expect(error!.message).toMatch(/tol\.rocket, limit\.minFragment/);
  });

  it("PRF-004 non-positive or non-numeric values are rejected as invalid", () => {
    const raw = structuredClone(getProfile("test")) as unknown as Record<string, unknown>;
    raw.timestep = 0;
    (raw.tol as Record<string, unknown>).mass = "small";
    expect(() => parseProfile(raw)).toThrow(/invalid timestep, tol\.mass/);
  });

  it("unknown profile names are reported with the known list", () => {
    expect(() => getProfile("fast")).toThrow(/Known: test, sandbox/);
  });
});
