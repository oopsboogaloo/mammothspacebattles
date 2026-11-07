// Simulation profiles (PRF-001, PRF-002, PRF-004). All values are SI (ARC-005).

export interface Profile {
  name: string;
  /** Fixed step, seconds. */
  timestep: number;
  solverIterations: number;
  /** Gas dynamic scale (DEC-13): 1 is real gas; N makes sound and exhaust √N times slower. Default 1. */
  gasScale?: number;
  /**
   * Free flight (docs/perf/gpu-gas-phase0.md §11, §13): gas that can't come within this many
   * smoothing lengths of any body in the step flies on its own, without pressure, instead of being
   * stepped as gas. Off (undefined) unless a profile sets it: on (2) in sandbox, off in test, whose
   * gas stays the full model as the reference.
   */
  gasFreeFlight?: number;
  /**
   * Most parcels a second one engine's chamber releases at full command (docs/perf/gpu-gas-phase0.md
   * §15). A chamber that would release more uses heavier parcels (rate ÷ this) instead: the same mass,
   * momentum and energy in fewer parcels. Its thrust is the jet's recoil whatever the parcel size, so it
   * changes little. Injectors without a chamber keep their own parcels. Off (undefined) unless a profile sets it: 1,000 in sandbox, off in test.
   */
  gasParcelRate?: number;
  tol: {
    mass: number; // kg
    momentum: number; // kg·m/s
    angularMomentum: number; // kg·m²/s
    energy: number; // J
    velocity: number; // fraction of the reference speed
    pressure: number; // fraction of the predicted pressure
    penetration: number; // m
    rocket: number; // fraction of the predicted Δv
  };
  limit: {
    bodies: number;
    gasParcels: number;
    contacts: number;
    maxSpeed: number; // m/s
    minThickness: number; // m
    minFragment: number; // m
  };
}

const TOL_KEYS = ["mass", "momentum", "angularMomentum", "energy", "velocity", "pressure", "penetration", "rocket"] as const;
const LIMIT_KEYS = ["bodies", "gasParcels", "contacts", "maxSpeed", "minThickness", "minFragment"] as const;

export class ProfileError extends Error {
  readonly missing: string[];
  readonly invalid: string[];
  constructor(name: string, missing: string[], invalid: string[]) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing ${missing.join(", ")}`);
    if (invalid.length) parts.push(`invalid ${invalid.join(", ")}`);
    super(`Profile "${name}" rejected: ${parts.join("; ")}`);
    this.missing = missing;
    this.invalid = invalid;
  }
}

/** Validates an untrusted profile object and returns it typed, or throws ProfileError naming every bad key. */
export function parseProfile(raw: unknown): Profile {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name : "(unnamed)";
  const missing: string[] = [];
  const invalid: string[] = [];
  const checkPositive = (key: string, v: unknown) => {
    if (v === undefined) missing.push(key);
    else if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) invalid.push(key);
  };
  if (typeof obj.name !== "string") missing.push("name");
  checkPositive("timestep", obj.timestep);
  checkPositive("solverIterations", obj.solverIterations);
  if (obj.gasScale !== undefined) checkPositive("gasScale", obj.gasScale);
  if (obj.gasParcelRate !== undefined) checkPositive("gasParcelRate", obj.gasParcelRate);
  const tol = (obj.tol ?? {}) as Record<string, unknown>;
  const limit = (obj.limit ?? {}) as Record<string, unknown>;
  for (const k of TOL_KEYS) checkPositive(`tol.${k}`, tol[k]);
  for (const k of LIMIT_KEYS) checkPositive(`limit.${k}`, limit[k]);
  if (missing.length || invalid.length) throw new ProfileError(name, missing, invalid);
  return obj as unknown as Profile;
}

const TEST: Profile = {
  name: "test",
  timestep: 1 / 240,
  solverIterations: 20,
  tol: { mass: 1e-9, momentum: 1e-9, angularMomentum: 1e-9, energy: 1e-6, velocity: 1e-6, pressure: 0.05, penetration: 0.005, rocket: 0.05 },
  limit: { bodies: 1_000, gasParcels: 5_000, contacts: 10_000, maxSpeed: 2_000, minThickness: 0.05, minFragment: 0.05 },
};

const SANDBOX: Profile = {
  name: "sandbox",
  timestep: 1 / 240,
  solverIterations: 10,
  // Heavy gas: sound and exhaust 10× slower, so engines run in real time in the browser (DEC-13).
  gasScale: 100,
  // Far gas flies free: about half the step in the reference battle, ships within 1% (gpu-gas-phase0.md §13).
  gasFreeFlight: 2,
  // At most 1,000 parcels a second per engine (the gunships' made 1,500 each): about a quarter off the
  // reference battle's step for 3% of the gunships' speed. 500 saves no more and its lumpier thrust
  // spoils the autopilot's hover (gpu-gas-phase0.md §15).
  gasParcelRate: 1000,
  tol: { mass: 1e-6, momentum: 1e-6, angularMomentum: 1e-6, energy: 1e-3, velocity: 1e-4, pressure: 0.1, penetration: 0.005, rocket: 0.1 },
  limit: { bodies: 5_000, gasParcels: 20_000, contacts: 50_000, maxSpeed: 2_000, minThickness: 0.05, minFragment: 0.05 },
};

export const PROFILES: Readonly<Record<string, Profile>> = { test: parseProfile(TEST), sandbox: parseProfile(SANDBOX) };

export function getProfile(name: string): Profile {
  const p = PROFILES[name];
  if (!p) throw new Error(`Unknown profile "${name}". Known: ${Object.keys(PROFILES).join(", ")}`);
  return p;
}
