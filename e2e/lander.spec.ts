import { expect, test } from "@playwright/test";

test("LND-001 LND-002 LND-030 Mammoth Lander: title, mission select, and a flight with the HUD and thrust", async ({ page }) => {
  await page.goto("./?game=lander");
  await page.getByTestId("lander-title").click();
  await expect(page.getByTestId("lander-select")).toBeVisible();
  // Easy, Medium, Hard and Emergency are ready; Cave and Orbital are coming.
  for (const k of ["easy", "medium", "hard", "emergency"]) await expect(page.getByTestId(`lander-pick-lander-${k}`)).toBeEnabled();
  await expect(page.getByTestId("lander-pick-lander-cave")).toBeDisabled();
  await expect(page.getByTestId("lander-pick-lander-orbital")).toBeDisabled();
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
