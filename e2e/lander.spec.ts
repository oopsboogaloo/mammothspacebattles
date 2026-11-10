import { expect, test } from "@playwright/test";

test("LND-001 LND-002 LND-030 Mammoth Lander: title, mission select, and a flight with the HUD and thrust", async ({ page }) => {
  await page.goto("./?game=lander");
  await expect(page.getByTestId("lander-credit")).toHaveText("by Chloe Bolland © 2026");
  await page.getByTestId("lander-title").click();
  await expect(page.getByTestId("lander-select")).toBeVisible();
  // Each mission card shows a picture of its level, drawn from the level itself.
  await expect(page.getByTestId("lander-preview-lander-orbital")).toBeVisible({ timeout: 10_000 });
  // All nine missions are ready.
  for (const k of ["easy", "medium", "hard", "cave", "cave-2", "emergency", "orbital", "binary", "heavy-orbital"]) await expect(page.getByTestId(`lander-pick-lander-${k}`)).toBeEnabled();
  await page.getByTestId("lander-pick-lander-easy").click();
  const hud = page.getByTestId("lander-hud");
  await expect(hud).toContainText("FUEL 8.10 kg");
  await expect(page.getByTestId("lander-lives")).toContainText("3");
  // Holding a thrust button burns fuel.
  const left = page.getByTestId("thrust-left");
  await left.dispatchEvent("pointerdown", { pointerId: 1 });
  await expect(hud).not.toContainText("FUEL 8.10 kg", { timeout: 10_000 });
  await left.dispatchEvent("pointerup", { pointerId: 1 });
  // No sandbox panels in the game.
  await expect(page.getByTestId("sandbox")).toHaveCount(0);
  // Pause and resume.
  await page.getByTestId("lander-pause").click();
  await expect(page.getByText("Paused")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).last().click();
  await expect(page.getByText("Paused")).toHaveCount(0);
});

test("LND-001 the sandbox picker opens the game", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("open-lander").click();
  await expect(page.getByTestId("lander-title")).toBeVisible();
});

test("LND-050 Emergency flashes its banner", async ({ page }) => {
  await page.goto("./?game=lander");
  await page.getByTestId("lander-title").click();
  await page.getByTestId("lander-pick-lander-emergency").click();
  await expect(page.getByTestId("lander-emergency")).toBeVisible();
  await expect(page.getByTestId("lander-emergency")).toHaveText("EMERGENCY");
});

test("LND-030 a thrust released while paused stays released on resume", async ({ page }) => {
  await page.goto("./?game=lander");
  await page.getByTestId("lander-title").click();
  await page.getByTestId("lander-pick-lander-easy").click();
  await expect(page.getByTestId("lander-hud")).toContainText("FUEL");
  const left = page.getByTestId("thrust-left");
  // Press, pause at once (the press may still be queued for the worker), release while paused, resume.
  await left.dispatchEvent("pointerdown", { pointerId: 1 });
  await page.getByTestId("lander-pause").click();
  await left.dispatchEvent("pointerup", { pointerId: 1 });
  await page.getByRole("button", { name: "Resume" }).last().click();
  await page.waitForTimeout(500);
  const left1 = await page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { controls: Record<string, number> } } } }).__msb.sandbox().world.controls.left ?? 0);
  expect(left1).toBe(0);
});

test("LND-030 the game cancels the browser's pinch zoom, and gives it back to the sandbox", async ({ page }) => {
  await page.goto("./?game=lander");
  const viewport = () => page.evaluate(() => document.querySelector('meta[name="viewport"]')!.getAttribute("content"));
  const pinchCancelled = () =>
    page.evaluate(() => {
      const e = new Event("gesturestart", { cancelable: true });
      document.dispatchEvent(e);
      return e.defaultPrevented;
    });
  await expect.poll(viewport).toContain("maximum-scale=1.0");
  expect(await pinchCancelled()).toBe(true);
  await page.goto("./");
  expect(await viewport()).toBe("width=device-width, initial-scale=1.0");
  expect(await pinchCancelled()).toBe(false);
});
