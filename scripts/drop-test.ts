// The drop test for every preset (BPD-053): each ship let fall on Thrust's first level, as it falls
// in the game, and again 8 m/s harder. Prints a table: see src/app/blueprint/droptest.ts.
//   node scripts/drop-test.ts
import { readFileSync } from "node:fs";
import { dropTest } from "../src/app/blueprint/droptest.ts";
import { loxodonPreset, mastodonPreset, phiomiaPreset, stegodonPreset, thrustOgPreset, thrustPreset } from "../src/app/blueprint/model.ts";

const level = JSON.parse(readFileSync(new URL("../scenarios/thrust-1.json", import.meta.url), "utf8"));
const presets = [thrustOgPreset, thrustPreset, mastodonPreset, stegodonPreset, phiomiaPreset, loxodonPreset];
console.log("| Ship | Landing | Energy lost (J) | Through contacts | Biggest hit (J) | Integrity lost | Welds broken | Most flex before a break |");
console.log("|---|---|---|---|---|---|---|---|");
for (const make of presets) {
  const bp = make(level);
  for (const extra of [0, 8]) {
    const r = dropTest(bp, level, extra);
    const share = r.energyLost > 0 ? ` (${Math.round((100 * r.contactEnergy) / r.energyLost)}%)` : "";
    console.log(
      `| ${bp.name} | ${r.impactSpeed.toFixed(1)} m/s | ${r.energyLost.toFixed(0)} | ${r.contactEnergy.toFixed(0)}${share} | ${r.biggestHit.toFixed(0)} | ${r.integrityLost.toFixed(2)} | ${r.welds.length}${r.welds.length ? `: ${r.welds.join(", ")}` : ""} | ${r.flex.toFixed(1)}° (${r.flexPart}) |`,
    );
  }
}
