// M5 on screen: RS-11's damage, the damage overlay, and a part's material and integrity in the inspector.
import { expect, test } from "@playwright/test";
import { body, openStarter, shot, toPage, waitForTick } from "./helpers.ts";

test("DMG-003 DMG-005 DMG-007 RS-11 runs on screen: the bare tank bursts into dust, the armoured one is untouched, and the inspector shows why", async ({ page }, info) => {
  await openStarter(page, "rs11-armour-ram");
  await expect(page.getByTestId("overlay-damage")).toHaveAttribute("aria-pressed", "true"); // the scenario turns it on
  // Step to an exact tick rather than play and pause: a pause lands later on a slow machine.
  for (let i = 0; i < 8; i++) await page.getByTestId("step10").click();
  await waitForTick(page, 80);
  expect(await body(page, "tank-a")).toBeUndefined(); // destroyed: gone, in a puff of dust
  expect(await page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { dust?: unknown[] } } } }).__msb.sandbox().world.dust?.length ?? 0)).toBeGreaterThan(10);
  expect((await body(page, "tank-b"))!.integrity).toBe(1);
  expect((await body(page, "armour"))!.integrity).toBeLessThan(1);
  await shot(page, info, "rs11-after-ram");
  // Select the armour: its material and integrity are in the inspector.
  const a = (await body(page, "armour"))!.position;
  const p = await toPage(page, a.x, a.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("field-integrity")).not.toHaveValue("1");
});
