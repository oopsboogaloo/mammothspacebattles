import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Body } from "../src/core/index.ts";

export const ROOT = new URL("..", import.meta.url).pathname;

export function scenarioFiles(): string[] {
  const dir = join(ROOT, "scenarios");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function disc(id: string, over: Partial<Body> = {}): Body {
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
