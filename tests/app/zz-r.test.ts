import { appendFileSync, readFileSync } from "node:fs";
import { it } from "vitest";
import { thrustOgPreset, thrustPreset, stats, allOverlaps, pieces, welds, engines } from "../../src/app/blueprint/model.ts";
import { measureNow } from "../../src/app/blueprint/measure.ts";
it("r", () => {
  const scn = JSON.parse(readFileSync("scenarios/thrust-1.json", "utf8"));
  for (const bp of [thrustOgPreset(scn), thrustPreset(scn)]) {
    const s = stats(bp);
    const r = measureNow(bp, [{ forward: 1 }, { reverse: 1 }, { left: 1 }, { right: 1 }]);
    appendFileSync("/tmp/claude-0/r.out", JSON.stringify({ n: bp.name, mass: +s.mass.toFixed(2), prop: +s.propellant.toFixed(2), w: s.width, h: +s.height.toFixed(2), I: +s.inertia.toFixed(1), overlaps: allOverlaps(bp), pieces: pieces(bp).length, welds: welds(bp).length, est: engines(bp).map((e) => Math.round(e.thrust)), r: r.map((x) => [x.ahead.toFixed(2), x.turn.toFixed(2), x.broke]) }) + "\n");
  }
}, 900000);
