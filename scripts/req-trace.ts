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
for (const m of spec.matchAll(/^- \*\*([A-Z]+-\d+)\*\* `\[([MSC]) · M(\d)\+? · ([A-Z])\]`/gm)) {
  reqs.push({ id: m[1], priority: m[2], milestone: Number(m[3]), verification: m[4] });
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
const gate = arg >= 0 ? Number(process.argv[arg + 1]?.replace(/^M/, "")) : undefined;

const missing: string[] = [];
const rows: string[] = [];
for (const r of reqs) {
  const covered = r.verification === "R" ? mentions(reviewText, r.id) : mentions(testText, r.id);
  const where = r.verification === "R" ? "review" : "test";
  rows.push(`${covered ? "✓" : "·"} ${r.id.padEnd(8)} ${r.priority} M${r.milestone} ${r.verification}  ${covered ? where : "—"}`);
  if (gate !== undefined && r.milestone <= gate && r.priority === "M" && !covered) missing.push(`${r.id} (M${r.milestone}, needs a ${where})`);
}

const done = rows.filter((r) => r.startsWith("✓")).length;
if (gate === undefined) console.log(rows.join("\n"));
console.log(`${done}/${reqs.length} requirements traced.`);
if (gate !== undefined) {
  if (missing.length) {
    console.error(`Milestone gate M${gate} failed. Untraced must-have requirements:\n  ${missing.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`Milestone gate M${gate}: every must-have requirement is traced.`);
}
