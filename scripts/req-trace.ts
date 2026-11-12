// Requirement traceability (TST-005, TST-006).
//   node scripts/req-trace.ts                  report every requirement and where it is verified
//   node scripts/req-trace.ts --milestone M0   also fail if a must-have requirement up to M0
//                                              has no test (or, for review-only ones, no review record)
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface Req {
  id: string;
  priority: string;
  milestone: number;
  verification: string;
}

const root = new URL("..", import.meta.url).pathname;
const spec = readFileSync(join(root, "docs/spec.md"), "utf8");
const reqs: Req[] = [];
// Milestones are M0…M10; a letter suffix is an intermediate milestone (M4b sits between M4 and M5).
const milestoneNumber = (s: string) => {
  const m = /^M?(\d+)([a-z])?$/.exec(s);
  return m ? Number(m[1]) + (m[2] ? 0.5 : 0) : NaN;
};
for (const m of spec.matchAll(/^- \*\*([A-Z]+-\d+)\*\* `\[([MSC]) · (M\d+[a-z]?)\+? · ([A-Z])\]`/gm)) {
  reqs.push({ id: m[1], priority: m[2], milestone: milestoneNumber(m[3]), verification: m[4] });
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const testText = [...files(join(root, "tests")), ...files(join(root, "e2e"))]
  .filter((f) => /\.(test|spec)\.ts$/.test(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const reviewText = files(join(root, "docs/reviews"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const mentions = (text: string, id: string) => new RegExp(`\\b${id}\\b`).test(text);

const arg = process.argv.indexOf("--milestone");
const gateArg = arg >= 0 ? (process.argv[arg + 1] ?? "") : "";
const gate = arg >= 0 ? milestoneNumber(gateArg) : undefined;

const missing: string[] = [];
const rows: string[] = [];
for (const r of reqs) {
  const covered = r.verification === "R" ? mentions(reviewText, r.id) : mentions(testText, r.id);
  const where = r.verification === "R" ? "review" : "test";
  const label = Number.isInteger(r.milestone) ? `M${r.milestone}` : `M${Math.floor(r.milestone)}b`;
  rows.push(`${covered ? "✓" : "·"} ${r.id.padEnd(8)} ${r.priority} ${label.padEnd(3)} ${r.verification}  ${covered ? where : "—"}`);
  if (gate !== undefined && r.milestone <= gate && r.priority === "M" && !covered) missing.push(`${r.id} (${label}, needs a ${where})`);
}

const done = rows.filter((r) => r.startsWith("✓")).length;
if (gate === undefined) console.log(rows.join("\n"));
console.log(`${done}/${reqs.length} requirements traced.`);
if (gate !== undefined) {
  if (missing.length) {
    console.error(`Milestone gate ${gateArg} failed. Untraced must-have requirements:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`Milestone gate ${gateArg}: every must-have requirement is traced.`);
}
