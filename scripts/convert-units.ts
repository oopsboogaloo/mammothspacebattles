// Converts the scenario files from schema 1 (the core's units) to schema 2 (the game's: lengths ×4,
// masses ×1024; docs/units-rescale-plan.md), in place. Files already at schema 2 are left alone.
// The conversion is exact (migrateUnits.ts); UNITS-003 checks each against the original.
//   node scripts/convert-units.ts [file.json …]   (default: every file in scenarios/)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrateUnits } from "../src/core/migrateUnits.ts";

const root = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const files = args.length ? args : readdirSync(join(root, "scenarios")).filter((f) => f.endsWith(".json")).map((f) => join(root, "scenarios", f));
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (raw.schema !== 1) continue;
  // Kept as it was written: indented, or on one line (the generated Moon levels).
  const indented = /^\{\s*\n/.test(text);
  writeFileSync(file, (indented ? JSON.stringify(migrateUnits(raw), null, 2) : JSON.stringify(migrateUnits(raw))) + "\n");
  console.log(`converted ${file}`);
}
