import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BodyInput } from "../src/core/index.ts";
import { toCoreUnits } from "../src/core/migrateUnits.ts";

export const ROOT = new URL("..", import.meta.url).pathname;

export function scenarioFiles(): string[] {
  const dir = join(ROOT, "scenarios");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * A JSON file. A scenario file (schema 2, the game's units) comes back in the core's units, marked as
 * such, so the tests of the core's behaviour check the same figures as before the units changed
 * (docs/units-rescale-plan.md: UNITS-001 proves the two run the same). `readFile` reads it as it is.
 */
export function readJson(file: string): unknown {
  const raw = readFile(file);
  if (!raw || typeof raw !== "object" || (raw as { schema?: unknown }).schema !== 2) return raw;
  return inCoreUnits(raw as Record<string, unknown>);
}

/** A scenario in the game's units (schema 2) as the same in the core's: schema 2, units 1 and 1. */
export function inCoreUnits(raw: Record<string, unknown>): Record<string, unknown> {
  const core = toCoreUnits(raw) as { world: Record<string, unknown> };
  return { ...core, schema: 2, world: { ...core.world, units: { length: 1, mass: 1 } } };
}

/** A JSON file as it is. */
export function readFile(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function disc(id: string, over: Partial<BodyInput> = {}): BodyInput {
  return {
    id,
    shape: { kind: "disc", radius: 0.5 },
    mass: 1,
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    angle: 0,
    angularVelocity: 0,
    ...over,
  };
}

/** A minimal valid scenario object to mutate in tests. */
export function baseScenario(): Record<string, unknown> {
  return {
    schema: 1,
    name: "t",
    profile: "test",
    seed: 1,
    world: { bodies: [] },
    timeline: [],
    end: { steps: 10 },
    probes: [{ id: "tick", path: "tick" }],
    assertions: [],
  };
}

export function box(id: string, width: number, height: number, over: Partial<BodyInput> = {}): BodyInput {
  return { ...disc(id), shape: { kind: "box", width, height }, ...over };
}
