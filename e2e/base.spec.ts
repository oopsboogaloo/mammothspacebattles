// The home base on screen (BAS).
import { expect, test } from "@playwright/test";
import { openStarter, shot, waitForTick } from "./helpers.ts";

test.describe.configure({ timeout: 120_000 });

type Hook = { __msb: { sandbox: () => { world: { bodies: { id: string; position: { x: number; y: number }; collector?: unknown }[]; ledger: { violations: number } } } } };

test("BAS-001 the base: Gunship 2 on the pad of a big asteroid, beside the egg cup, tower and dome, lifts off against its gravity", async ({ page }, info) => {
  await openStarter(page, "base");
  await expect(page.getByTestId("look-for")).toContainText("egg cup");
  const read = () =>
    page.evaluate(() => {
      const w = (window as unknown as Hook).__msb.sandbox().world;
      const ids = new Set(w.bodies.map((b) => b.id));
      return { hullY: w.bodies.find((b) => b.id === "hull")!.position.y, parts: ["base-rock", "pad", "cup-floor", "tower", "dome"].every((i) => ids.has(i)), collector: !!w.bodies.find((b) => b.id === "cup-floor")!.collector, violations: w.ledger.violations };
    });
  const start = await read();
  expect(start.parts).toBe(true);
  expect(start.collector).toBe(true);
  await shot(page, info, "base");
  // Both engines: it climbs off the pad against about 2 m/s² of gravity.
  await page.keyboard.down("q");
  await page.keyboard.down("e");
  for (let i = 0; i < 48; i++) await page.getByTestId("step10").click();
  await waitForTick(page, 480);
  await page.keyboard.up("q");
  await page.keyboard.up("e");
  const up = await read();
  expect(up.hullY).toBeGreaterThan(start.hullY + 1);
  expect(up.violations).toBe(0);
  await shot(page, info, "base-liftoff");
});
