// Headless CLI (ARC-007).
//   node src/cli/sim.ts run <scenario.json> [--out result.json] [--hashes] [--quiet]
//   node src/cli/sim.ts validate <scenario.json>
// Exit codes: 0 pass, 1 assertion failed, 2 invalid input.

import { readFileSync, writeFileSync } from "node:fs";
import { parseScenario, runScenario, ScenarioError } from "../core/index.ts";

function usage(): never {
  console.error("Usage:\n  sim run <scenario.json> [--out result.json] [--hashes] [--quiet]\n  sim validate <scenario.json>");
  process.exit(2);
}

function load(file: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`Cannot read ${file}: ${(e as Error).message}`);
    process.exit(2);
  }
  try {
    return parseScenario(raw);
  } catch (e) {
    console.error(e instanceof ScenarioError ? e.message : String(e));
    process.exit(2);
  }
}

const [cmd, file, ...rest] = process.argv.slice(2);
if (!cmd || !file) usage();
const flag = (name: string) => rest.includes(name);
const option = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};

if (cmd === "validate") {
  const scn = load(file);
  console.log(`OK: ${scn.name} (${scn.end.steps} steps, ${scn.assertions.length} assertions)`);
  process.exit(0);
}
if (cmd !== "run") usage();

const scn = load(file);
const result = runScenario(scn, { recordHashes: flag("--hashes") });
const out = option("--out");
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
if (!flag("--quiet")) {
  console.log(`${result.scenario}: ${result.steps} steps, final hash ${result.finalHash}`);
  for (const a of result.assertions) console.log(`  ${a.pass ? "PASS" : "FAIL"} #${a.index} ${a.kind}: ${a.message}`);
  console.log(result.passed ? "PASSED" : "FAILED");
}
process.exit(result.passed ? 0 : 1);
