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
