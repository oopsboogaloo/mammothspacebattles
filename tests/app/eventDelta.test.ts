import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getProfile, initialWorld, parseScenario, stepInPlace } from "../../src/core/index.ts";
import { applyEventDelta, eventDelta } from "../../src/app/eventDelta.ts";

describe("worker results send only the change to the event log", () => {
  it("PRF the page rebuilds the worker's log exactly, also once the log is full and trimmed", () => {
    const s = parseScenario(JSON.parse(readFileSync(new URL("../../scenarios/lander-emergency.json", import.meta.url), "utf8")));
    const prof = getProfile(s.profile);
    const worker = initialWorld(s);
    // A log nearly full already, so the run trims it.
    for (let k = 0; k < 9_950; k++) worker.events.push({ tick: 0, type: "filler", data: { k } });
    let page = structuredClone(worker.events);
    let trimmed = false;
    // Runs of 30 steps, as the worker sends them, until the 10,000-event log has been trimmed.
    for (let run = 0; run < 100 && !trimmed; run++) {
      const before = worker.events.slice();
      for (let k = 0; k < 30; k++) stepInPlace(worker, [], prof);
      const d = eventDelta(before, worker.events);
      trimmed ||= d.drop > 0;
      page = applyEventDelta(page, structuredClone(d));
      expect(page.length).toBe(worker.events.length);
    }
    expect(trimmed).toBe(true);
    expect(page).toEqual(worker.events);
  });

  it("PRF an emptied or untouched log comes through", () => {
    const a = { tick: 1, type: "x", data: {} };
    const b = { tick: 2, type: "y", data: {} };
    expect(applyEventDelta([a], eventDelta([a], []))).toEqual([]);
    expect(applyEventDelta([a, b], eventDelta([a, b], [a, b]))).toEqual([a, b]);
    expect(applyEventDelta([], eventDelta([], [a]))).toEqual([a]);
  });
});
