import { expect, test } from "@playwright/test";

test("ARC-006 SBX-041 the page loads and runs the headless core through fixed steps", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Choose a starting scenario" })).toBeVisible();
  await page.getByTestId("pick-sc01-elastic-collision").click();
  await page.keyboard.press("Space");
  const tick = page.getByTestId("tick");
  await expect.poll(async () => Number(await tick.textContent()), { timeout: 5000 }).toBeGreaterThan(60);
  await page.keyboard.press("Space");
  // Time is always tick × 1/240 s, whatever the frame rate.
  const [t, time] = await Promise.all([tick.textContent(), page.getByTestId("sim-time").textContent()]);
  expect(Math.abs(parseFloat(time!) - Number(t) / 240)).toBeLessThanOrEqual(0.0005 + 1e-12); // shown to 3 decimals
  expect(errors).toEqual([]);
});
