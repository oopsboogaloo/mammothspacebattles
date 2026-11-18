// The units proof for every scenario, as a report (docs/units-rescale-plan.md): node scripts/units-report.ts
// (UNITS_ONLY=name,… to pick scenarios; UNITS_STEPS=n, default 1200: 5 s, with scripted input).
import { basename } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { proof } from "../tests/unitsProof.ts";
const only = process.env.UNITS_ONLY?.split(",");
const steps = Number(process.env.UNITS_STEPS ?? 1200);
for (const f of readdirSync("scenarios")
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const name = basename(f, ".json");
  if (only && !only.includes(name)) continue;
  try {
    const t = Date.now();
    const r = proof(JSON.parse(readFileSync(`scenarios/${f}`, "utf8")), steps);
    console.log(
      `${r.diff ? "FAIL" : "ok  "} ${name} (${r.steps} steps, ${Date.now() - t} ms) ${r.diff}${r.untagged.length ? " | untagged: " + r.untagged.join(" ") : ""}`,
    );
  } catch (e) {
    console.log(`ERR  ${name}: ${(e as Error).message.split("\n")[0]}`);
  }
}
