// Small helpers about bodies that several modules need.

/** A store's resource on a body. Its mass counts toward the body's mass (ASM-002). */
export interface Store {
  resource: string;
  mass: number; // kg
  capacity: number; // kg
}

/** Total mass: the body's own (dry) mass plus everything in its stores, kg. */
export function bodyMass(b: { mass: number; contents?: Store[]; magazine?: { count: number; shell: { mass: number; contents?: Store[] } }; injector?: { vessel?: { mass: number } } }): number {
  let m = b.mass;
  if (b.contents) for (const s of b.contents) m += s.mass;
  // Gas held in an engine's chamber moves with it (§10.1).
  if (b.injector?.vessel) m += b.injector.vessel.mass;
  // Shells still in a magazine are part of the body that carries them, with anything they carry.
  if (b.magazine) m += b.magazine.count * bodyMass(b.magazine.shell);
  return m;
}

/**
 * The world's bodies by id (the last of an id, as `new Map(bodies.map(...))` gives), kept while the
 * list holds the same body objects in the same order. Several steps' worth of code each built this
 * for every body, every step, a large share of what a step allocated. Shared: callers only read it.
 */
const byIdCache = new WeakMap<object, { list: object[]; map: Map<string, never> }>();
export function bodiesById<B extends { id: string }>(world: { bodies: B[] }): ReadonlyMap<string, B> {
  const bodies = world.bodies;
  const kept = byIdCache.get(bodies);
  if (kept && kept.list.length === bodies.length) {
    let same = true;
    for (let i = 0; i < bodies.length && same; i++) same = kept.list[i] === bodies[i];
    if (same) return kept.map as unknown as Map<string, B>;
  }
  const map = new Map(bodies.map((b) => [b.id, b]));
  byIdCache.set(bodies, { list: [...bodies], map: map as unknown as Map<string, never> });
  return map;
}
