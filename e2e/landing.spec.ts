// FLT-009: the landing challenge on screen: readout while flying, verdict with its reason, try again.
import { expect, test, type Page } from "@playwright/test";
import { shot, waitForTick } from "./helpers.ts";

// A free fall to the ground is about 950 steps; WebKit and Firefox on CI run slowly.
test.describe.configure({ timeout: 120_000 });

const phase = (page: Page) =>
  page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { challenge?: { status: { phase: string } } } } } }).__msb.sandbox().world.challenge?.status.phase);

async function openLand(page: Page) {
  await page.goto("./");
  await page.getByTestId("pick-land-twin-engine").click();
  await expect(page.getByTestId("challenge-hud")).toBeVisible();
}

test("FLT-009 LAND shows height, speeds, tilt and fuel; a crash says why and pauses; Try again restarts", async ({ page }, info) => {
  await openLand(page);
  const hud = page.getByTestId("challenge-hud");
  for (const label of ["Above pad", "Down", "Side", "Tilt", "Fuel"]) await expect(hud).toContainText(label);
  await expect(hud).toContainText("Fuel 100%");
  // Fire both engines briefly: propellant goes down.
  await page.keyboard.down("q");
  await page.keyboard.down("e");
  await page.getByTestId("play").click();
  await waitForTick(page, 120, 60_000);
  await page.keyboard.up("q");
  await page.keyboard.up("e");
  await expect(hud).not.toContainText("Fuel 100%");
  // Then fall: the ship drifts onto the slope short of the pad.
  await page.getByTestId("scale-16").click();
  const verdict = page.getByTestId("challenge-verdict");
  await expect(verdict).toBeVisible({ timeout: 100_000 });
  await expect(verdict).toContainText("Crashed");
  await expect(verdict).toContainText(/Touched the ground off the pad|Hit the pad at/);
  await expect(page.getByTestId("play")).toHaveAttribute("aria-label", "Play"); // the verdict paused the run
  expect(await phase(page)).toBe("crashed");
  await shot(page, info, "land-crashed");
  await page.getByTestId("challenge-retry").click();
  await expect(verdict).toHaveCount(0);
  await expect(hud).toContainText("Fuel 100%");
  expect(await phase(page)).toBe("flying");
  await expect(page.getByTestId("play")).toHaveAttribute("aria-label", "Pause"); // and runs again
});

test.describe("on a phone (390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("FLT-009 SBX-047 the readout, the note and the flight buttons don't overlap, and Try again works by tap", async ({ page }, info) => {
    await openLand(page);
    const hud = (await page.getByTestId("challenge-hud").boundingBox())!;
    const note = (await page.getByTestId("look-for").boundingBox())!;
    const pad = (await page.locator(".flightpad").boundingBox())!;
    expect(hud.y + hud.height).toBeLessThanOrEqual(note.y + 1);
    expect(hud.y + hud.height).toBeLessThanOrEqual(pad.y + 1);
    await page.getByTestId("scale-16").tap();
    await page.getByTestId("play").tap();
    const verdict = page.getByTestId("challenge-verdict");
    await expect(verdict).toBeVisible({ timeout: 100_000 });
    await expect(verdict).toContainText("Crashed");
    await shot(page, info, "land-crashed-phone");
    await page.getByTestId("challenge-retry").tap();
    await expect(verdict).toHaveCount(0);
    expect(await phase(page)).toBe("flying");
  });
});
