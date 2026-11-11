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

test("LND-060 the game's own page: the same game, with no way back to the sandbox", async ({ page }) => {
  await page.goto("./lander.html");
  await expect(page).toHaveTitle("Mammoth Lander");
  await expect(page.getByTestId("lander-credit")).toHaveText("by Chloe Bolland © 2026");
  await page.getByTestId("lander-title").click();
  await expect(page.getByTestId("lander-select")).toBeVisible();
  for (const k of ["easy", "medium", "hard", "cave", "cave-2", "emergency", "orbital", "binary", "heavy-orbital"]) await expect(page.getByTestId(`lander-pick-lander-${k}`)).toBeEnabled();
  await expect(page.getByText("Back to the sandbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "High scores" })).toBeVisible();
  // It flies, from the keyboard too: holding E fires the right engine and burns fuel.
  await page.getByTestId("lander-pick-lander-easy").click();
  const hud = page.getByTestId("lander-hud");
  await expect(hud).toContainText("FUEL 8.10 kg");
  await page.keyboard.down("e");
  await expect(hud).not.toContainText("FUEL 8.10 kg", { timeout: 10_000 });
  await page.keyboard.up("e");
  await expect(page.getByTestId("sandbox")).toHaveCount(0);
  // P pauses.
  await page.keyboard.press("p");
  await expect(page.getByText("Paused")).toBeVisible();
});

test("LND-060 the game's own page never shows the diagnostics log, even with ?diag=1", async ({ page }) => {
  // The sandbox's game shows it with ?diag=1 ...
  await page.goto("./?game=lander&diag=1");
  await page.getByTestId("lander-title").click();
  await page.getByTestId("lander-pick-lander-easy").click();
  await expect(page.getByTestId("lander-diag")).toBeVisible();
  // ... the game's own page never does.
  await page.goto("./lander.html?diag=1");
  await page.getByTestId("lander-title").click();
  await page.getByTestId("lander-pick-lander-easy").click();
  await expect(page.getByTestId("lander-hud")).toBeVisible();
  await expect(page.getByTestId("lander-diag")).toHaveCount(0);
  await expect(page.getByText("Copy log")).toHaveCount(0);
});

test("LND-061 How to play and The physics open from mission select and come back", async ({ page }) => {
  await page.goto("./lander.html");
  await page.getByTestId("lander-title").click();
  await page.getByTestId("lander-howto").click();
  const how = page.getByTestId("lander-howto-screen");
  await expect(how).toContainText("Controls");
  await expect(how).toContainText("Q, Left Shift or ←");
  await page.getByTestId("lander-info-back").click();
  await page.getByTestId("lander-physics").click();
  await expect(page.getByTestId("lander-physics-screen")).toContainText("Thrust is gas");
  await page.getByTestId("lander-info-back").click();
  await expect(page.getByTestId("lander-select")).toBeVisible();
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
  // The L button is the right engine (LND-035): it must not be left on.
  const held = await page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { controls: Record<string, number> } } } }).__msb.sandbox().world.controls);
  expect(held.right ?? 0).toBe(0);
  expect(held.left ?? 0).toBe(0);
});

test("LND-035 a left control turns the ship left, which is the right engine; the pause menu's option swaps them, and is kept", async ({ page }) => {
  await page.goto("./?game=lander");
  await page.getByTestId("lander-title").click();
  await page.getByTestId("lander-pick-lander-easy").click();
  await expect(page.getByTestId("lander-hud")).toContainText("FUEL");
  const controls = () => page.evaluate(() => { const c = (window as unknown as { __msb: { sandbox: () => { world: { controls: Record<string, number> } } } }).__msb.sandbox().world.controls; return `${c.left ?? 0},${c.right ?? 0}`; });
  const left = page.getByTestId("thrust-left");
  // The L button, and the Q key: the right engine.
  await left.dispatchEvent("pointerdown", { pointerId: 1 });
  await expect.poll(controls).toBe("0,1");
  await left.dispatchEvent("pointerup", { pointerId: 1 });
  await expect.poll(controls).toBe("0,0");
  await page.keyboard.down("q");
  await expect.poll(controls).toBe("0,1");
  await page.keyboard.up("q");
  await expect.poll(controls).toBe("0,0");
  // Swapped in the pause menu: the L button and Q are the left engine.
  await page.getByTestId("lander-pause").click();
  const swap = page.getByTestId("swap-sides");
  await expect(swap).toHaveText("Swap left and right: off");
  await swap.click();
  await expect(swap).toHaveText("Swap left and right: on");
  await page.getByRole("button", { name: "Resume" }).last().click();
  await left.dispatchEvent("pointerdown", { pointerId: 1 });
  await expect.poll(controls).toBe("1,0");
  await left.dispatchEvent("pointerup", { pointerId: 1 });
  await page.keyboard.down("e");
  await expect.poll(controls).toBe("0,1");
  await page.keyboard.up("e");
  // Kept through a reload.
  await page.reload();
  await page.getByTestId("lander-title").click();
  await page.getByTestId("lander-pick-lander-easy").click();
  await page.getByTestId("lander-pause").click();
  await expect(page.getByTestId("swap-sides")).toHaveText("Swap left and right: on");
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
