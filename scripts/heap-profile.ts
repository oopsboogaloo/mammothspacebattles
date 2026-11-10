// Which functions allocate, by V8's sampling heap profiler (counting what is collected too).
//   node scripts/heap-profile.ts scenario.json [steps]
import { Session } from "node:inspector/promises";
import { readFileSync } from "node:fs";
import { getProfile, initialWorld, parseScenario, stepInPlace, timelineByStep } from "../src/core/index.ts";

const [file, stepsArg] = process.argv.slice(2);
const scn = parseScenario(JSON.parse(readFileSync(file, "utf8")));
const profile = getProfile(scn.profile);
const byStep = timelineByStep(scn);
const world = initialWorld(scn);
for (let s = 0; s < 240; s++) stepInPlace(world, byStep.get(s) ?? [], profile);
const session = new Session();
session.connect();
await session.post("HeapProfiler.startSampling", { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const steps = Number(stepsArg ?? 1200);
for (let s = 240; s < 240 + steps; s++) stepInPlace(world, byStep.get(s) ?? [], profile);
const { profile: p } = (await session.post("HeapProfiler.stopSampling")) as { profile: { head: Node } };
interface Node { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] }
const by = new Map<string, number>();
let total = 0;
const walk = (n: Node) => {
  const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/.*\/src\//, "")}:${n.callFrame.lineNumber + 1}`;
  by.set(k, (by.get(k) ?? 0) + n.selfSize);
  total += n.selfSize;
  n.children.forEach(walk);
};
walk(p.head);
console.log(`total sampled ${(total / 1e6).toFixed(0)} MB over ${steps} steps`);
for (const [k, v] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`);
