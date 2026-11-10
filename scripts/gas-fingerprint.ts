// Gas fingerprint: what the gas does in the scenes that depend on it, and how long it takes, so a
// change to the gas solver (per-parcel substeps, §10.1) can be checked against it.
//   node scripts/gas-fingerprint.ts [--out file.json] [--compare baseline.json] [--tol 0.05]
// Each case runs a scenario, optionally with commands, and records named measurements. --compare
// prints each measurement against the baseline and fails (exit 1) if one differs by more than the
// tolerance (relative, or absolute below 1e-9 for residuals). Times are reported, not compared.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assemblyTotals, getProfile, initialWorld, parseScenario, stepInPlace, timelineByStep, type Command, type World, parcelsOf } from "../src/core/index.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = new URL("..", import.meta.url).pathname;

interface Case {
  name: string;
  scenario: string;
  steps: number;
  /** Commands by step, on top of the scenario's own timeline. */
  commands?: Record<number, Command[]>;
  measure: (w: World) => Record<string, number>;
}
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });
const asm = (w: World, id: string) => assemblyTotals(w, id)!;
const body = (w: World, id: string) => w.bodies.find((b) => b.id === id);

const CASES: Case[] = [
  { name: "SC-02 gas in a box", scenario: "sc02-gas-in-a-box", steps: 480, measure: (w) => ({ parcels: w.gas.count, thermal: parcelsOf(w.gas).reduce((s, p) => s + p.thermal, 0) }) },
  { name: "RS-07 gas burst", scenario: "rs07-gas-burst", steps: 480, measure: (w) => ({ parcels: w.gas.count, kinetic: parcelsOf(w.gas).reduce((s, p) => s + 0.5 * p.mass * (p.velocity.x ** 2 + p.velocity.y ** 2), 0) }) },
  { name: "RS-08 chemical rocket, 2 s", scenario: "rs08-chemical-rocket", steps: 480, measure: (w) => ({ vy: asm(w, "hull").velocity.y }) },
  { name: "RS-16 twin engine", scenario: "rs16-twin-engine", steps: 600, measure: (w) => ({ vy: asm(w, "hull").velocity.y, spin: asm(w, "hull").angularVelocity }) },
  { name: "LAND both engines 1 s", scenario: "land-twin-engine", steps: 240, commands: { 0: [set("left", 1), set("right", 1)] }, measure: (w) => ({ vy: asm(w, "hull").velocity.y }) },
  { name: "GS2 both engines 3 s", scenario: "gunship-2", steps: 720, commands: { 0: [set("left", 1), set("right", 1)] }, measure: (w) => ({ vy: asm(w, "hull").velocity.y, parcels: w.gas.count }) },
  { name: "GS2 left engine 0.5 s", scenario: "gunship-2", steps: 120, commands: { 0: [set("left", 1)] }, measure: (w) => ({ spin: asm(w, "hull").angularVelocity }) },
  { name: "GUN muzzle speed", scenario: "cannon-test", steps: 180, measure: (w) => ({ shell: body(w, "shell")!.velocity.x, recoil: asm(w, "breech").velocity.x }) },
];

interface Result {
  case: string;
  values: Record<string, number>;
  residual: { momentum: number; angularMomentum: number; energy: number };
  violations: number;
  msPerStep: number;
  gasMsPerStep: Record<string, number>;
}

function run(c: Case): Result {
  const scn = parseScenario(JSON.parse(readFileSync(join(root, "scenarios", `${c.scenario}.json`), "utf8")));
  const profile = getProfile(scn.profile);
  const byStep = timelineByStep(scn);
  const w = initialWorld(scn);
  const out: Record<string, number> = {};
  const gas: Record<string, number> = {};
  const t0 = performance.now();
  for (let s = 0; s < c.steps; s++) {
    stepInPlace(w, [...(byStep.get(s) ?? []), ...(c.commands?.[s] ?? [])], profile, { clock: () => performance.now(), out });
    for (const [k, v] of Object.entries(out)) if (k.startsWith("gas")) gas[k] = (gas[k] ?? 0) + v;
  }
  const ms = performance.now() - t0;
  const m = w.ledger.maxResidual;
  return {
    case: c.name,
    values: c.measure(w),
    residual: { momentum: Math.hypot(m.momentumX, m.momentumY), angularMomentum: m.angularMomentum, energy: m.energy },
    violations: w.ledger.violations,
    msPerStep: Math.round((ms / c.steps) * 100) / 100,
    gasMsPerStep: Object.fromEntries(Object.entries(gas).map(([k, v]) => [k, Math.round((v / c.steps) * 100) / 100])),
  };
}

const results = CASES.map(run);
for (const r of results) {
  console.log(`${r.case.padEnd(28)} ${r.msPerStep.toFixed(2).padStart(7)} ms/step  ${Object.entries(r.values).map(([k, v]) => `${k}=${v.toPrecision(6)}`).join("  ")}  viol=${r.violations}`);
}
const outFile = opt("--out");
if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n");

const base = opt("--compare");
if (base) {
  const tol = Number(opt("--tol") ?? 0.05);
  const before = JSON.parse(readFileSync(base, "utf8")) as Result[];
  let bad = 0;
  console.log(`\nAgainst ${base} (tolerance ${(tol * 100).toFixed(1)}%):`);
  for (const r of results) {
    const b = before.find((x) => x.case === r.case);
    if (!b) continue;
    for (const [k, v] of Object.entries(r.values)) {
      const old = b.values[k];
      const rel = Math.abs(v - old) / Math.max(Math.abs(old), 1e-9);
      const ok = rel <= tol;
      if (!ok) bad++;
      console.log(`  ${ok ? "ok " : "BAD"} ${r.case}: ${k} ${old.toPrecision(6)} → ${v.toPrecision(6)} (${(rel * 100).toFixed(2)}%)`);
    }
    if (r.violations > b.violations) {
      bad++;
      console.log(`  BAD ${r.case}: violations ${b.violations} → ${r.violations}`);
    }
    console.log(`      ${r.case}: ${b.msPerStep} → ${r.msPerStep} ms/step (${(b.msPerStep / r.msPerStep).toFixed(2)}× faster)`);
  }
  if (bad) process.exitCode = 1;
}
