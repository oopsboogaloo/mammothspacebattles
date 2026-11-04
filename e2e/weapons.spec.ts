// M6 first look on screen: the cannon test fires a shell at the breakable ship.
import { expect, test } from "@playwright/test";
import { body, openStarter, shot, waitForTick } from "./helpers.ts";

test.describe.configure({ timeout: 120_000 });

test("WPN-001 the cannon test fires on its own at 0.5 s, and the shell flies at the ship", async ({ page }, info) => {
  await openStarter(page, "cannon-test");
  await expect(page.getByTestId("look-for")).toContainText("cannon fires");
  await page.getByTestId("play").click();
  await waitForTick(page, 150, 90_000);
  await page.getByTestId("play").click();
  const s = (await body(page, "shell"))!;
  expect(s.velocity.x).toBeGreaterThan(20);
  await shot(page, info, "cannon-fired");
});
