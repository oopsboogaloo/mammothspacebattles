// The first AI pilot on screen (AIP, M8 phase 1).
import { expect, test } from "@playwright/test";
import { openStarter, shot, waitForTick } from "./helpers.ts";

test.describe.configure({ timeout: 120_000 });

type Hook = { __msb: { sandbox: () => { world: { bodies: { id: string; position: { x: number; y: number }; pilot?: { intent: string } }[]; ledger: { violations: number } } } } };

test("AIP-001 AIP-008 the AI ship hovers over the base, then flies off right on its own, saying what it is doing", async ({ page }, info) => {
  await openStarter(page, "ai-flight");
  const read = () =>
    page.evaluate(() => {
      const w = (window as unknown as Hook).__msb.sandbox().world;
      const h = w.bodies.find((b) => b.id === "e1-hull")!;
      return { x: h.position.x, y: h.position.y, intent: h.pilot!.intent, violations: w.ledger.violations };
    });
  const start = await read();
  for (let i = 0; i < 168; i++) await page.getByTestId("step10").click(); // to 7 s: hover, then the 6 m/s leg
  await waitForTick(page, 1680);
  const later = await read();
  expect(later.intent).toContain("hold velocity 6.0");
  expect(later.x).toBeGreaterThan(start.x + 5);
  expect(later.y).toBeGreaterThan(start.y - 3); // it didn't fall
  expect(later.violations).toBe(0);
  await shot(page, info, "ai-flight");
});

test("AIP-015 AIP-017 the patrolling AI ship flies its route through the rocks, with its plan drawn", async ({ page }, info) => {
  await openStarter(page, "ai-patrol");
  for (let i = 0; i < 144; i++) await page.getByTestId("step10").click(); // 6 s
  await waitForTick(page, 1440);
  const s = await page.evaluate(() => {
    const w = (window as unknown as Hook).__msb.sandbox().world;
    const h = w.bodies.find((b) => b.id === "e1-hull")! as unknown as { pilot: { intent: string; plan?: { route?: unknown[] } } };
    return { intent: h.pilot.intent, route: h.pilot.plan?.route?.length ?? 0, violations: w.ledger.violations };
  });
  expect(s.intent).toContain("route: waypoint");
  expect(s.route).toBe(5);
  expect(s.violations).toBe(0);
  await shot(page, info, "ai-patrol");
});
