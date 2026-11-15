// Engine validation (docs/perf/engine-validation.md): does the chamber model (PRP-011,
// src/core/vessel.ts) give the thrust the gas simulation would, for engines of other sizes and shapes?
//
// Each engine is a head with an injector, a chamber, a throat and a nozzle, welded to a heavy base,
// alone in empty space with no gravity, in the sandbox profile (the game's). It is run:
// - **model:** the injector declares its interior, so the chamber is held as one volume and lets its
//   gas out through the throat as a jet at c*·(1 + 1/γ);
// - **gas:** the same engine with no interior declared, so the chamber, throat and nozzle are all
//   parcels (SPH), at several parcel rates (parcels a second), to see whether it converges;
// and compared with one-dimensional ideal nozzle flow from the chamber's own state (planar: areas
// are widths), with and without the loss to a diverging jet (sin α ÷ α).
//
//   node scripts/engine-validation.ts                 writes scenarios/eng-validation.json (the sandbox's ENG-V)
//   node scripts/engine-validation.ts --sweep         runs the sweep; prints the tables, writes docs/perf/engine-validation.json
//   node scripts/engine-validation.ts --sweep --quick fewer engines and parcel rates
//   node scripts/engine-validation.ts --report        the tables again, from docs/perf/engine-validation.json
//   node scripts/engine-validation.ts --engine K      engine K alone (0–9), its row as JSON on stdout; in parallel:
//     seq 0 9 | xargs -P 4 -I{} sh -c 'node scripts/engine-validation.ts --engine {} > /tmp/eng-{}.json'
//   node scripts/engine-validation.ts --merge FILES   those rows, in order, into docs/perf/engine-validation.json, and the tables
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assemblyTotals, getProfile, initialWorld, parseScenario, stepInPlace, vesselPressure, vesselShape, type World } from "../src/core/index.ts";
import { mixture } from "../src/core/gas.ts";

type Vec = { x: number; y: number };
type Json = Record<string, unknown>;
const root = new URL("..", import.meta.url).pathname;
const HZ = 240;
const profile = getProfile("sandbox");
const r6 = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const rv = (v: Vec): Vec => ({ x: r6(v.x), y: r6(v.y) });

/**
 * An engine, in metres at size 1, scaled by `size`: RS-08's (scenarios/rs08-chemical-rocket.json)
 * chamber 0.8 m wide and 0.6 m long, throat 0.3 m, 0.5 kg/s; a nozzle `nozzle` m long opening to
 * `exit` m (0 long: none). The flow scales with the throat, so the chamber pressure is the same at
 * every size.
 */
export interface Engine {
  name: string;
  size: number;
  chamberWidth: number;
  chamberLength: number;
  throat: number;
  exit: number;
  nozzle: number;
  rate: number;
}
const BASE = { chamberWidth: 0.8, chamberLength: 0.6, throat: 0.3, rate: 0.5 };
const engineOf = (name: string, exit: number, nozzle: number, size = 1): Engine => ({ name, size, ...BASE, exit, nozzle });
/** The engine's dimensions at its size. */
const dims = (e: Engine) => {
  const s = e.size;
  return { Wc: e.chamberWidth * s, Lc: e.chamberLength * s, Wt: e.throat * s, We: e.exit * s, Ln: e.nozzle * s, rate: e.rate * s, t: Math.max(0.05, 0.1 * s), h: 0.2 * s };
};
/** Area ratio and the nozzle's half-angle, rad (0 with no nozzle). */
const geometry = (e: Engine) => ({ ratio: e.exit / e.throat, half: e.nozzle > 0 ? Math.atan2((e.exit - e.throat) / 2, e.nozzle) : 0 });

const STRONG = { tension: 1e9, compression: 1e9, shear: 1e9, torque: 1e9 };
const MIX = { h2: 1 / 9, o2: 8 / 9 };

/**
 * The engine's bodies, welds and control link, ids prefixed `p`, its head's top at `at`, firing
 * down (−y). `chamber`: declare the interior (the chamber model) or not (all parcels).
 */
function build(e: Engine, p: string, at: Vec, chamber: boolean, parcelMass: number, seconds: number) {
  const { Wc, Lc, Wt, We, Ln, rate, t, h } = dims(e);
  const bodies: Json[] = [];
  const joints: Json[] = [];
  const pos = new Map<string, { c: Vec }>();
  const add = (id: string, shape: Json, mass: number, c: Vec, extra: Json = {}) => {
    pos.set(id, { c });
    bodies.push({ id: `${p}${id}`, shape, mass, position: rv({ x: at.x + c.x, y: at.y + c.y }), velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.3, ...extra });
  };
  const box = (id: string, x0: number, x1: number, y0: number, y1: number, mass: number, extra: Json = {}) => add(id, { kind: "box", width: r6(x1 - x0), height: r6(y1 - y0) }, mass, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, extra);
  const poly = (id: string, corners: Vec[], mass: number) => {
    let a = 0;
    let c = { x: 0, y: 0 };
    corners.forEach((q, i) => {
      const r = corners[(i + 1) % corners.length];
      const w = q.x * r.y - r.x * q.y;
      a += w;
      c = { x: c.x + (q.x + r.x) * w, y: c.y + (q.y + r.y) * w };
    });
    c = { x: c.x / (3 * a), y: c.y / (3 * a) };
    add(id, { kind: "polygon", vertices: corners.map((q) => rv({ x: q.x - c.x, y: q.y - c.y })) }, mass, c);
  };
  const weld = (a: string, b: string, w: Vec) => {
    const A = pos.get(a)!.c;
    const B = pos.get(b)!.c;
    joints.push({ id: `${p}w-${a}-${b}-${joints.length}`, a: `${p}${a}`, b: `${p}${b}`, anchorA: rv({ x: w.x - A.x, y: w.y - A.y }), anchorB: rv({ x: w.x - B.x, y: w.y - B.y }), limits: STRONG });
  };

  const half = Wc / 2 + t;
  const outlet = { x: 0, y: -h / 2 - 0.05 * e.size }; // head-local
  const yThroat = -h - Lc - t; // bottom of the throat
  const toThroat = -yThroat + outlet.y; // from the outlet to the throat's bottom, m
  // Enough propellant for the run; the head carries it.
  const load = rate * seconds * 1.2;
  box("head", -half, half, -h, 0, 1, {
    contents: [
      { resource: "h2", mass: r6(load * MIX.h2), capacity: r6(load * MIX.h2) },
      { resource: "o2", mass: r6(load * MIX.o2), capacity: r6(load * MIX.o2) },
    ],
    injector: {
      channel: "main",
      rate: r6(rate),
      mixture: MIX,
      outlet: rv(outlet),
      direction: { x: 0, y: -1 },
      width: r6(Wc * 0.75),
      speed: 10,
      parcelMass: r6(parcelMass),
      radius: 0.035,
      igniter: true,
      // The interior reaches past the throat (to the nozzle's exit and a little beyond), so the
      // throat is found inside it whatever the nozzle (src/core/vessel.ts, computeShape).
      ...(chamber ? { chamber: { width: r6(2 * half), length: r6(toThroat + Ln + 0.2 * e.size) } } : {}),
    },
  });
  box("base", -half, half, 0, 0.5 * e.size, 100);
  box("wall-l", -half, -Wc / 2, -h - Lc, -h, 0.3);
  box("wall-r", Wc / 2, half, -h - Lc, -h, 0.3);
  box("throat-l", -half, -Wt / 2, yThroat, -h - Lc, 0.3);
  box("throat-r", Wt / 2, half, yThroat, -h - Lc, 0.3);
  weld("base", "head", { x: -half / 2, y: 0 });
  weld("base", "head", { x: half / 2, y: 0 });
  for (const [k, s] of [[-1, "l"], [1, "r"]] as const) {
    weld("head", `wall-${s}`, { x: k * (Wc / 2 + t / 2), y: -h });
    weld(`wall-${s}`, `throat-${s}`, { x: k * (Wc / 2 + t / 2), y: -h - Lc });
    if (Ln > 0) {
      // Inner edge from the throat's lip to the exit; the wall `t` thick outside it.
      const c = [
        { x: (k * Wt) / 2, y: yThroat },
        { x: k * (Wt / 2 + t), y: yThroat },
        { x: k * (We / 2 + t), y: yThroat - Ln },
        { x: (k * We) / 2, y: yThroat - Ln },
      ];
      poly(`nozzle-${s}`, k < 0 ? c : c.slice().reverse(), 0.3);
      weld(`throat-${s}`, `nozzle-${s}`, { x: k * (Wt / 2 + t / 2), y: yThroat });
    }
  }
  return { bodies, joints, links: [{ id: `${p}ctl`, kind: "control", channel: "main", to: `${p}head` }] };
}

/** A world of the given engines (each with its own channel), no gravity, exhaust removed 20 m from everything. */
function worldOf(parts: ReturnType<typeof build>[]): Json {
  return { gravity: { x: 0, y: 0 }, bounds: { min: { x: -1000, y: -1000 }, max: { x: 1000, y: 1000 }, farField: 20 }, bodies: parts.flatMap((x) => x.bodies), joints: parts.flatMap((x) => x.joints), links: parts.flatMap((x) => x.links) };
}

// ---- Ideal nozzle flow (planar) ----

/** Supersonic exit Mach number for area ratio `ratio` (1: sonic). */
function exitMach(ratio: number, g: number): number {
  if (ratio <= 1) return 1;
  const f = (M: number) => (1 / M) * Math.pow((2 / (g + 1)) * (1 + ((g - 1) / 2) * M * M), (g + 1) / (2 * (g - 1))) - ratio;
  let lo = 1;
  let hi = 50;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
/**
 * Ideal thrust per kg/s, m/s, from the chamber's specific internal energy `u0` (J/kg, the gas's
 * units) and γ: at the throat (sonic: c*·(1 + 1/γ)), and through a nozzle of area ratio `ratio` and
 * half-angle `half` into vacuum, v_e + p_e·A_e/ṁ, with the jet's momentum times sin α ÷ α.
 */
function ideal(u0: number, g: number, ratio: number, half: number) {
  const uStar = (u0 * 2) / (g + 1);
  const cStar = Math.sqrt(g * (g - 1) * uStar);
  const M = exitMach(ratio, g);
  const ue = u0 / (1 + ((g - 1) / 2) * M * M);
  const ve = M * Math.sqrt(g * (g - 1) * ue);
  const press = ((g - 1) * ue) / ve; // p_e·A_e ÷ ṁ
  const loss = half > 1e-9 ? Math.sin(half) / half : 1;
  return { throat: cStar * (1 + 1 / g), nozzle: ve + press, nozzleLoss: loss * ve + press, exitMach: M };
}

// ---- Measurement ----

interface Run {
  thrust: number; // N, 0.75–1.5 s
  early: number; // N, 0.5–1.0 s
  late: number; // N, 1.0–1.5 s
  pressure: number; // N/m, the chamber's mean, 0.75–1.5 s
  parcels: number; // mean in the world, 0.75–1.5 s
  msPerStep: number;
  released?: { speed: number; gamma: number }; // model: the jet's speed relative to the engine, and γ
  violations: number;
  enclosed?: boolean;
}

function run(e: Engine, chamber: boolean, parcelsPerSecond: number): Run {
  const seconds = 1.5;
  const { rate, Wc, Lc, h } = dims(e);
  const parts = build(e, "e-", { x: 0, y: 0 }, chamber, rate / parcelsPerSecond, seconds);
  const scn = { schema: 1, name: "engine-validation", profile: "sandbox", seed: 1, world: worldOf([parts]), timeline: [], end: { steps: 1 }, probes: [], assertions: [] };
  const w0: World = initialWorld(parseScenario(scn));
  // Catch the parcels the engine lets out as they are added (before the gas step moves them).
  let catching = false;
  let vHead = 0;
  let mOut = 0;
  let pOut = 0;
  let gamma = NaN;
  const gas = new Proxy(w0.gas, {
    set(g, k, value) {
      if (k === "count" && catching && value === g.count + 1) {
        mOut += g.mass[g.count];
        pOut -= g.mass[g.count] * (g.vy[g.count] - vHead);
        if (Number.isNaN(gamma)) gamma = mixture(g.composition[g.count]).gamma;
      }
      return Reflect.set(g, k, value);
    },
  });
  const w: World = Object.assign(w0, { gas });
  const head = () => w.bodies.find((b) => b.id === "e-head")!;
  const at: { m: number; vy: number }[] = [];
  const pressure: number[] = [];
  const parcels: number[] = [];
  let enclosed = false;
  const steps = Math.round(seconds * HZ);
  const from = Math.round(0.75 * HZ);
  let ms = 0;
  for (let i = 0; i <= steps; i++) {
    const a = assemblyTotals(w, "e-head")!;
    at.push({ m: a.mass, vy: a.velocity.y });
    const b = head();
    vHead = b.velocity.y;
    catching = chamber && i >= from && i < steps;
    if (i >= from) {
      parcels.push(w.gas.count);
      if (chamber) {
        const shape = vesselShape(w, b);
        enclosed = !!shape;
        if (shape && b.injector!.vessel) pressure.push(vesselPressure(b.injector!.vessel, shape.area));
      } else {
        // The parcels in the chamber (the head's frame; the engine doesn't turn): P = (γ − 1)·U ÷ A.
        let U = 0;
        let g = 1.33;
        for (let k = 0; k < w.gas.count; k++) {
          const x = w.gas.x[k] - b.position.x;
          const y = w.gas.y[k] - (b.position.y - h / 2);
          if (Math.abs(x) < Wc / 2 && y < 0 && y > -Lc) {
            U += w.gas.thermal[k];
            g = mixture(w.gas.composition[k]).gamma;
          }
        }
        pressure.push(((g - 1) * U) / (Wc * Lc));
      }
    }
    if (i < steps) {
      const t0 = performance.now();
      stepInPlace(w, i === 0 ? [{ type: "control.set", channel: "main", value: 1 }] : [], profile);
      if (i >= from) ms += performance.now() - t0;
    }
  }
  const force = (t0: number, t1: number) => {
    const a = at[Math.round(t0 * HZ)];
    const b = at[Math.round(t1 * HZ)];
    return (((a.m + b.m) / 2) * (b.vy - a.vy)) / (t1 - t0);
  };
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  return {
    thrust: force(0.75, 1.5),
    early: force(0.5, 1.0),
    late: force(1.0, 1.5),
    pressure: mean(pressure),
    parcels: mean(parcels),
    msPerStep: ms / (steps - from),
    ...(chamber ? { released: { speed: pOut / mOut, gamma }, enclosed } : {}),
    violations: w.ledger.violations,
  };
}

// ---- The engines ----

const SHAPES: Engine[] = [
  engineOf("Throat only", 0.3, 0),
  engineOf("Straight, 0.6 m", 0.3, 0.6),
  engineOf("Ratio 2, 0.6 m", 0.6, 0.6),
  engineOf("Ratio 2.8, 0.6 m (RS-08)", 0.84, 0.6),
  engineOf("Ratio 2.8, 0.15 m (wide)", 0.84, 0.15),
  engineOf("Ratio 2.8, 1.5 m (long)", 0.84, 1.5),
  engineOf("Ratio 5, 1.2 m", 1.5, 1.2),
];
const SIZES: Engine[] = [0.5, 2, 4].map((s) => engineOf(`Ratio 2.8, 0.6 m (RS-08) × ${s}`, 0.84, 0.6, s));
/** Parcel rates for the gas runs, a second (the sandbox lets a chamber engine release 1,000). */
const RATES = [500, 1000, 2000, 4000, 8000];

const ALL = [...SHAPES, ...SIZES];

function sweep(quick: boolean, only?: number) {
  const engines = only !== undefined ? [ALL[only]] : quick ? [SHAPES[0], SHAPES[3], SHAPES[6]] : ALL;
  const rates = quick ? [500, 1000] : RATES;
  const out = [];
  for (const e of engines) {
    const t = Date.now();
    const model = run(e, true, 1000);
    const gas = rates.map((n) => ({ rate: n, ...run(e, false, n) }));
    const { ratio, half } = geometry(e);
    const { rate } = dims(e);
    const g = model.released!.gamma;
    // The chamber's state, from the jet's speed the model gave: c*·(1 + 1/γ) = speed.
    const cStar = model.released!.speed / (1 + 1 / g);
    const u0 = ((cStar * cStar) / (g * (g - 1))) * ((g + 1) / 2);
    const th = ideal(u0, g, ratio, half);
    const row = { engine: e, ratio, halfAngle: (half * 180) / Math.PI, flow: rate, model, gas, ideal: { throat: th.throat * rate, nozzle: th.nozzle * rate, nozzleLoss: th.nozzleLoss * rate, exitMach: th.exitMach } };
    out.push(row);
    console.error(`${e.name}: ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }
  return out;
}

/**
 * Where the gas's thrust is heading as parcels get finer: from the three finest rates (each double
 * the last), F∞ = F₃ + (F₃ − F₂) ÷ (2^p − 1) with p = log₂((F₂ − F₁) ÷ (F₃ − F₂)) (Richardson). Only
 * when the steps shrink (p > 0): otherwise null.
 */
function extrapolate(gas: { rate: number; thrust: number }[]): { limit: number; order: number } | null {
  if (gas.length < 3) return null;
  const [a, b, c] = gas.slice(-3);
  if (b.rate !== 2 * a.rate || c.rate !== 2 * b.rate) return null;
  const d1 = b.thrust - a.thrust;
  const d2 = c.thrust - b.thrust;
  if (!(d1 * d2 > 0) || Math.abs(d2) >= Math.abs(d1)) return null;
  const order = Math.log2(d1 / d2);
  return { limit: c.thrust + d2 / (2 ** order - 1), order };
}

type Row = ReturnType<typeof sweep>[number];

function report(rows: Row[]) {
  const n = (x: number, d = 0) => x.toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const rates = rows[0].gas.map((g) => g.rate);
  console.log("Thrust, N (and ÷ the model's). Gas: chamber, throat and nozzle all parcels, at so many parcels a second.\n");
  console.log(`| Engine | Area ratio | Half-angle | Ideal, throat | Ideal, nozzle (with divergence loss) | Model | ${rates.map((r) => `Gas, ${n(r)}/s`).join(" | ")} |`);
  console.log(`|---|---|---|---|---|---|${rates.map(() => "---").join("|")}|`);
  for (const r of rows) {
    const m = r.model.thrust;
    console.log(`| ${r.engine.name} | ${n(r.ratio, 1)} | ${n(r.halfAngle)}° | ${n(r.ideal.throat)} | ${n(r.ideal.nozzle)} (${n(r.ideal.nozzleLoss)}) | ${n(m)}${r.model.enclosed ? "" : " (not held)"} | ${r.gas.map((g) => `${n(g.thrust)} (${n(g.thrust / m, 2)})`).join(" | ")} |`);
  }
  console.log("\nWhere the gas is heading (Richardson, from the three finest rates), against the model and the ideal nozzle.\n");
  console.log("| Engine | Gas, finest | Gas, extrapolated (order) | Model | Model ÷ gas, extrapolated | Ideal, nozzle with loss | Gas extrapolated ÷ ideal |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const x = extrapolate(r.gas);
    const f = r.gas[r.gas.length - 1].thrust;
    console.log(`| ${r.engine.name} | ${n(f)} | ${x ? `${n(x.limit)} (${n(x.order, 1)})` : "–"} | ${n(r.model.thrust)} | ${x ? n(r.model.thrust / x.limit, 2) : "–"} | ${n(r.ideal.nozzleLoss)} | ${x ? n(x.limit / r.ideal.nozzleLoss, 2) : "–"} |`);
  }
  console.log("\nChamber pressure, N/m (the model's volume; the gas's parcels in the chamber), and steadiness: thrust 1.0–1.5 s ÷ 0.5–1.0 s.\n");
  console.log(`| Engine | Model | ${rates.map((r) => `Gas, ${n(r)}/s`).join(" | ")} | Steadiness, model | ${rates.map((r) => `Steadiness, ${n(r)}/s`).join(" | ")} |`);
  console.log(`|---|---|${rates.map(() => "---").join("|")}|---|${rates.map(() => "---").join("|")}|`);
  for (const r of rows) console.log(`| ${r.engine.name} | ${n(r.model.pressure)} | ${r.gas.map((g) => n(g.pressure)).join(" | ")} | ${n(r.model.late / r.model.early, 3)} | ${r.gas.map((g) => n(g.late / g.early, 3)).join(" | ")} |`);
  console.log("\nCost: parcels in the world and ms a step (this machine).\n");
  console.log(`| Engine | Model | ${rates.map((r) => `Gas, ${n(r)}/s`).join(" | ")} |`);
  console.log(`|---|---|${rates.map(() => "---").join("|")}|`);
  for (const r of rows) console.log(`| ${r.engine.name} | ${n(r.model.parcels)}, ${n(r.model.msPerStep, 1)} ms | ${r.gas.map((g) => `${n(g.parcels)}, ${n(g.msPerStep, 1)} ms`).join(" | ")} |`);
  const v = rows.reduce((k, r) => k + r.model.violations + r.gas.reduce((j, g) => j + g.violations, 0), 0);
  console.log(`\nJet speed the model gave: ${n(rows[0].model.released!.speed)} m/s (γ ${n(rows[0].model.released!.gamma, 3)}). Ledger violations: ${v}.`);
}

// ---- The sandbox's scenario: three engines, each as the model and as gas, side by side ----

function scenario(): Json {
  const seconds = 2;
  const pairs: [Engine, string][] = [
    [SHAPES[0], "throat"],
    [SHAPES[3], "rs08"],
    [SHAPES[6], "r5"],
  ];
  const parts: ReturnType<typeof build>[] = [];
  const probes: Json[] = [];
  pairs.forEach(([e, key], i) => {
    for (const [j, chamber] of [[0, true], [1, false]] as const) {
      const p = `${key}-${chamber ? "model" : "gas"}-`;
      const part = build(e, p, { x: (i * 2 + j) * 6 - 15, y: 0 }, chamber, dims(e).rate / 1000, seconds);
      parts.push(part);
      probes.push({ id: `${key}_${chamber ? "model" : "gas"}`, path: `assembly[id=${p}head].velocity.y` });
    }
  });
  probes.push({ id: "parcels", path: "gas.count" });
  return {
    schema: 1,
    name: "eng-validation",
    title: "Engine validation: the chamber model against the gas",
    description:
      "ENG-V. Three engines, each twice: as the chamber model (left of each pair) and with every bit of gas simulated (right). Left to right: throat only, RS-08's nozzle (area ratio 2.8) and a long nozzle (ratio 5). Each is welded to a 100 kg base in empty space and fires for 2 s; the faster one makes more thrust. The numbers are in docs/perf/engine-validation.md (node scripts/engine-validation.ts --sweep).",
    profile: "sandbox",
    seed: 1,
    world: worldOf(parts),
    timeline: [{ step: 0, commands: [{ type: "control.set", channel: "main", value: 1 }] }],
    end: { steps: seconds * HZ },
    probes,
    assertions: [
      ...pairs.flatMap(([, key]) => [
        // At 2 s (2026-11-15): the model about 2.0 m/s, the gas about 1.35 m/s.
        { kind: "rangeOver", probe: `${key}_model`, from: "end", to: "end", min: 1.8 },
        { kind: "rangeOver", probe: `${key}_gas`, from: "end", to: "end", min: 1 },
      ]),
      { kind: "event", type: "ignition", occurred: true },
      { kind: "event", type: "joint.break", occurred: false },
      { kind: "event", type: "violation", occurred: false },
    ],
    ui: {
      lookFor: "Each pair is one engine: the chamber model on the left, all gas on the right. The higher one makes more thrust; the gap is what the model gets wrong.",
      overlays: ["velocity"],
      graphs: pairs.flatMap(([, key]) => [`${key}_model`, `${key}_gas`]),
      camera: { x: 0, y: 0, zoom: 25 },
    },
  };
}

const args = process.argv.slice(2);
const results = join(root, "docs", "perf", "engine-validation.json");
if (args.includes("--report")) report(JSON.parse(readFileSync(results, "utf8")) as Row[]);
else if (args.includes("--engine")) console.log(JSON.stringify(sweep(false, Number(args[args.indexOf("--engine") + 1]))[0]));
else if (args.includes("--merge")) {
  const rows = args.slice(args.indexOf("--merge") + 1).map((f) => JSON.parse(readFileSync(f, "utf8")) as Row);
  rows.sort((a, b) => ALL.findIndex((e) => e.name === a.engine.name) - ALL.findIndex((e) => e.name === b.engine.name));
  writeFileSync(results, JSON.stringify(rows, null, 1) + "\n");
  report(rows);
}
else if (args.includes("--sweep")) {
  const rows = sweep(args.includes("--quick"));
  report(rows);
  if (!args.includes("--quick")) writeFileSync(results, JSON.stringify(rows, null, 1) + "\n");
} else {
  const file = join(root, "scenarios", "eng-validation.json");
  const scn = scenario();
  parseScenario(scn);
  writeFileSync(file, JSON.stringify(scn, null, 2) + "\n");
  console.log(`wrote ${file}`);
}
