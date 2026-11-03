// World state and the step function (ARC-002). M0 has no physics yet: a step
// applies commands and advances the clock. Bodies are stored sorted by id so
// iteration order never depends on insertion or hash order (DET-004).

import { createRng, nextFloat, type RngState } from "./prng.ts";
import type { Profile } from "./profile.ts";

export const WORLD_SCHEMA = 1;

export interface Vec2 {
  x: number; // m
  y: number; // m
}

export interface Body {
  id: string;
  shape: { kind: "disc"; radius: number }; // m
  mass: number; // kg
  position: Vec2; // m
  velocity: Vec2; // m/s
  angle: number; // rad
  angularVelocity: number; // rad/s
}

export interface WorldEvent {
  tick: number;
  type: string;
  data: Record<string, number | string | boolean>;
}

export interface World {
  schema: number;
  tick: number;
  time: number; // s
  rng: RngState;
  bodies: Body[];
  events: WorldEvent[];
}

/** Commands are the only way to change a world other than stepping it. */
export type Command =
  | { type: "body.add"; body: Body }
  | { type: "body.remove"; id: string }
  | { type: "body.set"; id: string; patch: Partial<Omit<Body, "id">> }
  | { type: "rng.sample"; label: string };

export function createWorld(seed: number, bodies: Body[] = []): World {
  const world: World = { schema: WORLD_SCHEMA, tick: 0, time: 0, rng: createRng(seed), bodies: [], events: [] };
  for (const body of bodies) addBody(world, body);
  return world;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addBody(world: World, body: Body): void {
  if (world.bodies.some((b) => b.id === body.id)) throw new Error(`Duplicate body id "${body.id}"`);
  world.bodies.push(structuredClone(body));
  world.bodies.sort((a, b) => compareIds(a.id, b.id));
}

function findBody(world: World, id: string): Body {
  const body = world.bodies.find((b) => b.id === id);
  if (!body) throw new Error(`No body with id "${id}"`);
  return body;
}

export function applyCommand(world: World, cmd: Command): void {
  switch (cmd.type) {
    case "body.add":
      addBody(world, cmd.body);
      break;
    case "body.remove":
      findBody(world, cmd.id);
      world.bodies = world.bodies.filter((b) => b.id !== cmd.id);
      break;
    case "body.set":
      Object.assign(findBody(world, cmd.id), structuredClone(cmd.patch));
      break;
    case "rng.sample":
      world.events.push({ tick: world.tick, type: "rng.sample", data: { label: cmd.label, value: nextFloat(world.rng) } });
      break;
  }
}

/** Advances the world by one fixed step, mutating it. Commands apply at the start of the step. */
export function stepInPlace(world: World, commands: readonly Command[], profile: Profile): void {
  for (const cmd of commands) applyCommand(world, cmd);
  world.tick += 1;
  // Derive time from the tick count so it never accumulates rounding error.
  world.time = world.tick * profile.timestep;
}

/** Pure form of stepInPlace: returns a new world and leaves the input untouched. */
export function step(world: World, commands: readonly Command[], profile: Profile): World {
  const next = structuredClone(world);
  stepInPlace(next, commands, profile);
  return next;
}
