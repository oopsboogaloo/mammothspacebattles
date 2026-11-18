// The units proof's comparison (docs/units-rescale-plan.md, stage 1): a scenario run in the core's
// units and converted (lengths ×4, masses ×1024), side by side, compared after every step.
import { parseScenario, scenarioProfile, initialWorld, timelineByStep, scenarioSteps, stepInPlace, type World } from "../src/core/index.ts";
import { scaleScenario } from "../src/core/scaleScenario.ts";
import { D, factor, type Dim, type Units } from "../src/core/units.ts";

export const U: Units = { length: 4, mass: 1024 };

/** The first difference between `a` (core units) and `b` (in U), or "" if none. */
export function difference(a: World, b: World): string {
  const f = (d: Dim) => factor(U, d);
  const same = (x: number, y: number, d: Dim) => Object.is(x, y / f(d));
  if (a.bodies.length !== b.bodies.length) return `bodies: ${a.bodies.length} vs ${b.bodies.length}`;
  for (let i = 0; i < a.bodies.length; i++) {
    const p = a.bodies[i];
    const q = b.bodies[i];
    if (p.id !== q.id) return `body ${i}: ${p.id} vs ${q.id}`;
    const checks: [string, number, number, Dim][] = [
      ["position.x", p.position.x, q.position.x, D.length],
      ["position.y", p.position.y, q.position.y, D.length],
      ["velocity.x", p.velocity.x, q.velocity.x, D.speed],
      ["velocity.y", p.velocity.y, q.velocity.y, D.speed],
      ["angle", p.angle, q.angle, D.none],
      ["angularVelocity", p.angularVelocity, q.angularVelocity, D.none],
      ["mass", p.mass, q.mass, D.mass],
      ["integrity", p.integrity, q.integrity, D.none],
    ];
    for (const [k, x, y, d] of checks) if (!same(x, y, d)) return `${p.id}.${k}: ${x} vs ${y / f(d)} (×${f(d)})`;
  }
  if (a.joints.length !== b.joints.length) return `joints: ${a.joints.length} vs ${b.joints.length}`;
  for (let i = 0; i < a.joints.length; i++) {
    if (a.joints[i].id !== b.joints[i].id) return `joint ${i}: ${a.joints[i].id} vs ${b.joints[i].id}`;
    if (!same(a.joints[i].integrity, b.joints[i].integrity, D.none)) return `${a.joints[i].id}.integrity: ${a.joints[i].integrity} vs ${b.joints[i].integrity}`;
  }
  const g = a.gas;
  const h = b.gas;
  if (g.count !== h.count) return `gas parcels: ${g.count} vs ${h.count}`;
  const gas: [keyof typeof g & ("x" | "y" | "vx" | "vy" | "mass" | "thermal" | "radius"), Dim][] = [
    ["x", D.length],
    ["y", D.length],
    ["vx", D.speed],
    ["vy", D.speed],
    ["mass", D.mass],
    ["thermal", D.energy],
    ["radius", D.length],
  ];
  for (let i = 0; i < g.count; i++)
    for (const [k, d] of gas) if (!same(g[k][i], h[k][i], d)) return `gas[${i}].${k}: ${g[k][i]} vs ${h[k][i] / f(d)}`;
  if (a.events.length !== b.events.length) return `events: ${a.events.map((e) => e.type).join(",")} vs ${b.events.map((e) => e.type).join(",")}`;
  for (let i = 0; i < a.events.length; i++) if (a.events[i].type !== b.events[i].type || a.events[i].tick !== b.events[i].tick) return `event ${i}: ${a.events[i].type}@${a.events[i].tick} vs ${b.events[i].type}@${b.events[i].tick}`;
  return "";
}

/**
 * Every control a player or the scenario could set: the games' steering mixes' controls, a
 * blueprint mixer's, and every channel a link or a device answers (engines, guns, tractors,
 * shields). Never the self-destruct.
 */
export function controlChannels(w: World): string[] {
  const out = new Set<string>();
  const mixes = [w.thrust?.spec.mix, w.arcade?.spec.mix];
  for (const m of mixes) {
    if (!m) continue;
    if (Array.isArray(m)) for (const row of m) for (const a of row.any) for (const c of [...a.on, ...(a.off ?? [])]) out.add(c);
    else for (const c of [m.forward, m.left, m.right, m.reverse]) out.add(c);
  }
  for (const row of w.mix?.rows ?? []) for (const line of row.lines) out.add(line.control);
  for (const l of w.links) if (l.kind === "control") out.add(l.channel);
  for (const b of w.bodies) for (const c of [b.injector?.channel, b.tractor?.channel, b.shield?.channel, b.magazine?.railgun?.channel]) if (c) out.add(c);
  out.delete("destruct");
  return [...out].sort();
}

/** The scripted input at step k: channel i is held on and off in turns of 37 + 23·i steps, so they overlap in every combination. */
export function scripted(channels: string[], k: number): { type: "control.set"; channel: string; value: number }[] {
  const out: { type: "control.set"; channel: string; value: number }[] = [];
  channels.forEach((channel, i) => {
    const period = 37 + 23 * i;
    const on = Math.floor(k / period) % 2;
    if (k === 0 || k % period === 0) out.push({ type: "control.set", channel, value: on });
  });
  return out;
}

/**
 * Runs `scn` both ways for `steps` simulation steps (its own length if not given; past its end it
 * goes on), with its timeline and, if `input`, the scripted input on every control; the first
 * difference, or "".
 */
export function proof(raw: unknown, steps?: number, input = true): { diff: string; untagged: string[]; steps: number } {
  const scn = parseScenario(raw);
  const { scenario: big, untagged } = scaleScenario(scn, U);
  const a = initialWorld(scn);
  const b = initialWorld(big);
  const pa = scenarioProfile(scn);
  const pb = scenarioProfile(big);
  const ta = timelineByStep(scn);
  const tb = timelineByStep(big);
  const n = steps ?? scenarioSteps(scn);
  const channels = input ? controlChannels(a) : [];
  let diff = difference(a, b);
  if (diff) return { diff: `at start: ${diff}`, untagged, steps: 0 };
  for (let s = 0; s < n; s++) {
    const keys = scripted(channels, s);
    stepInPlace(a, [...(ta.get(s) ?? []), ...keys], pa);
    stepInPlace(b, [...(tb.get(s) ?? []), ...keys], pb);
    diff = difference(a, b);
    if (diff) return { diff: `step ${s + 1}: ${diff}`, untagged, steps: s + 1 };
  }
  return { diff: "", untagged, steps: n };
}

