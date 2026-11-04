// M5 on screen: RS-11's damage, the damage overlay, and a part's material and integrity in the inspector.
import { expect, test } from "@playwright/test";
import { body, openStarter, shot, toPage, waitForTick } from "./helpers.ts";

test("DMG-003 DMG-004 DMG-005 RS-11 runs on screen: the bare tank is wrecked, the armoured one isn't, and the inspector shows why", async ({ page }, info) => {
  await openStarter(page, "rs11-armour-ram");
  await expect(page.getByTestId("overlay-damage")).toHaveAttribute("aria-pressed", "true"); // the scenario turns it on
  await page.getByTestId("play").click();
  await waitForTick(page, 72, 60_000);
  await page.getByTestId("play").click();
  expect((await body(page, "tank-a"))!.integrity).toBe(0);
  expect((await body(page, "tank-b"))!.integrity).toBe(1);
  expect((await body(page, "armour"))!.integrity).toBeLessThan(1);
  await shot(page, info, "rs11-after-ram");
  // Select the wrecked tank: its material and integrity are in the inspector.
  const a = (await body(page, "tank-a"))!.position;
  const p = await toPage(page, a.x, a.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("field-damage-material")).toHaveValue("tank");
  await expect(page.getByTestId("field-integrity")).toHaveValue("0");
  // DMG-004: it leaks through the dent, and the inspector says how fast.
  await expect(page.getByTestId("inspector")).toContainText("Leaking");
  expect((await page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { gas: { parcels: unknown[] } } } } }).__msb.sandbox().world.gas.parcels.length))).toBeGreaterThan(0);
});
