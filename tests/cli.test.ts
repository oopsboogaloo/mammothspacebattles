import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseScenario, ROOT } from "./helpers.ts";

function sim(...args: string[]) {
  return spawnSync(process.execPath, [join(ROOT, "src/cli/sim.ts"), ...args], { encoding: "utf8", cwd: ROOT });
}

describe("headless CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "msb-cli-"));

  it("ARC-007 runs a scenario headless and writes probes, final world and hashes to JSON", () => {
    const out = join(dir, "empty.json");
    const r = sim("run", "scenarios/empty.json", "--out", out, "--hashes");
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/empty: 240 steps, final hash [0-9a-f]{16}/);
    expect(r.stdout).toMatch(/PASSED/);
    const result = JSON.parse(readFileSync(out, "utf8"));
    expect(result.world.tick).toBe(240);
    expect(result.probes.tick).toHaveLength(241);
    expect(result.hashes).toHaveLength(241);
    expect(result.finalHash).toBe(result.hashes[240]);
  });

  it("ARC-007 exits 1 when an assertion fails", () => {
    const file = join(dir, "failing.json");
    writeFileSync(file, JSON.stringify({ ...baseScenario(), assertions: [{ kind: "valueAt", probe: "tick", step: "end", equals: 99, tol: 0 }] }));
    const r = sim("run", file);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/FAIL #0 valueAt/);
  });

  it("ARC-007 exits 2 with path-annotated errors for an invalid scenario", () => {
    const file = join(dir, "invalid.json");
    writeFileSync(file, JSON.stringify({ ...baseScenario(), seed: "x" }));
    const r = sim("validate", file);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/\$\.seed: must be a finite number/);
  });

  it("ARC-007 validate accepts a good file and usage errors exit 2", () => {
    expect(sim("validate", "scenarios/empty.json").status).toBe(0);
    expect(sim("explode").status).toBe(2);
    expect(sim("run", join(dir, "missing.json")).status).toBe(2);
  });

  it("DET-001 the CLI gives the same final hash as running twice in-process", () => {
    const a = sim("run", "scenarios/m0-commands.json").stdout.match(/final hash ([0-9a-f]{16})/)?.[1];
    const b = sim("run", "scenarios/m0-commands.json").stdout.match(/final hash ([0-9a-f]{16})/)?.[1];
    expect(a).toBeDefined();
    expect(a).toBe(b);
  });
});
