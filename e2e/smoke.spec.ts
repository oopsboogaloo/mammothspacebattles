import { expect, test } from "@playwright/test";

test("ARC-006 the page runs the headless core through fixed steps", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Mammoth Space Battles" })).toBeVisible();
  const tick = page.getByTestId("tick");
  await expect.poll(async () => Number(await tick.textContent()), { timeout: 5000 }).toBeGreaterThan(60);
  // Time is always tick × 1/240 s.
  const [t, time] = await Promise.all([tick.textContent(), page.getByTestId("time").textContent()]);
  expect(Math.abs(Number(time) - Number(t) / 240)).toBeLessThan(0.05);
  expect(errors).toEqual([]);
});
