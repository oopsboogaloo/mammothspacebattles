import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, scenarioFiles } from "./helpers.ts";

describe("benchmark command", () => {
  it("NFR-001 LED-004 reports steps per second and per-subsystem time for every scenario", () => {
    const out = join(mkdtempSync(join(tmpdir(), "msb-bench-")), "bench.json");
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/bench.ts"), "--steps", "20", "--json", out], { encoding: "utf8", cwd: ROOT });
    expect(r.status, r.stderr).toBe(0);
    const { rows } = JSON.parse(readFileSync(out, "utf8"));
    expect(rows).toHaveLength(scenarioFiles().length);
    for (const row of rows) {
      expect(row.stepsPerSecond).toBeGreaterThan(0);
      // The six subsystems, plus the gas step's own phases (gas.*) where there is gas.
      const keys = Object.keys(row.subsystemsMs);
      expect(keys.filter((k) => !k.startsWith("gas."))).toEqual(["commands", "forces", "contacts", "integrate", "gas", "ledger"]);
      // With free flight on (sandbox), also the mask and the free gas's own time (gas.mask, gas.free).
      if (row.parcels > 0) {
        const phases = keys.filter((k) => k.startsWith("gas.") && k !== "gas.mask" && k !== "gas.free").sort();
        expect(phases).toEqual(["gas.clusters", "gas.contacts", "gas.density", "gas.finish", "gas.impulses", "gas.move", "gas.neighbours", "gas.setup"]);
      }
      expect(row.parcels).toBeGreaterThanOrEqual(0);
    }
    expect(r.stdout).toMatch(/rs00-workload/);
  });
});
