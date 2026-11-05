// The tractor beam and tether on screen (TRC).
import { expect, test } from "@playwright/test";
import { openStarter, shot, waitForTick } from "./helpers.ts";

test.describe.configure({ timeout: 120_000 });

type Hook = { __msb: { sandbox: () => { world: { tick: number; bodies: { id: string; tractor?: { mode: string; cargo?: string } }[]; ledger: { violations: number } } } } };
const tractor = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const w = (window as unknown as Hook).__msb.sandbox().world;
    const t = w.bodies.find((b) => b.id === "hull")!.tractor!;
    return { mode: t.mode, cargo: t.cargo ?? null, violations: w.ledger.violations };
  });

test("TRC-001 TRC-003 holding T beams the ball in, and the tether takes it", async ({ page }, info) => {
  await openStarter(page, "tractor");
  await expect(page.getByTestId("look-for")).toContainText("Hold T to beam");
  await page.keyboard.down("t");
  for (let i = 0; i < 20; i++) await page.getByTestId("step10").click();
  await waitForTick(page, 200);
  expect((await tractor(page)).mode).toBe("beam");
  await shot(page, info, "tractor-beam");
  // The ball comes within 20 m at about step 530.
  for (let i = 0; i < 40; i++) await page.getByTestId("step10").click();
  await waitForTick(page, 600);
  await page.keyboard.up("t");
  const t = await tractor(page);
  expect(t.mode).toBe("tether");
  expect(t.cargo).toBe("ball");
  expect(t.violations).toBe(0);
  await shot(page, info, "tractor-tether");
});
