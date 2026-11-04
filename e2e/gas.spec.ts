// M3: gas in the sandbox — rendering, the Gas tool and the starter scenarios.
import { expect, test } from "@playwright/test";
import { dragWorld, openStarter, shot, waitForTick, world } from "./helpers.ts";

type GasWorld = Awaited<ReturnType<typeof world>> & { gas: { parcels: { thermal: number }[]; removed: { count: number } } };
const gasWorld = (page: Parameters<typeof world>[0]) => world(page) as Promise<GasWorld>;

test("SBX-035 parcels are coloured by temperature with a scale shown; the switch shows composition (SC-02)", async ({ page }, info) => {
  await openStarter(page, "sc02-gas-in-a-box");
  await expect(page.getByTestId("gas-scale")).toContainText("kelvin, log scale");
  await expect(page.getByTestId("inspector")).toContainText("GAS");
  await expect(page.getByTestId("inspector")).toContainText("484");
  await page.keyboard.press("Space");
  await waitForTick(page, 20);
  await page.keyboard.press("Space");
  await shot(page, info, "sc02-gas-in-a-box");
  // Drawn as a glowing plume by default; the switch beside it gives dots.
  await expect(page.getByTestId("gas-style")).toHaveText("Plume");
  await expect(page.getByTestId("gas-scale")).toContainText("grey smoke below");
  await page.getByTestId("gas-style").click();
  await expect(page.getByTestId("gas-style")).toHaveText("Dots");
  await expect(page.getByTestId("gas-scale")).toContainText("darker is colder");
  await page.getByTestId("gas-colour").click();
  await expect(page.getByTestId("gas-scale")).toContainText("helium");
  await expect(page.getByTestId("gas-colour")).toHaveText("Composition");
  const w = await gasWorld(page);
  expect(w.ledger.violations).toBe(0);
});

test("GAS-001 the Gas tool fills a dragged rectangle and clears it again", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("pick-empty").click();
  await page.keyboard.press("g");
  await expect(page.getByTestId("gas-palette")).toBeVisible();
  await page.getByTestId("field-gas-temperature").fill("600");
  await page.getByTestId("field-gas-temperature").press("Enter");
  await dragWorld(page, [-1, -1], [1, 1]);
  await expect(page.getByTestId("toast")).toContainText("Added 400 parcels");
  let w = await gasWorld(page);
  expect(w.gas.parcels).toHaveLength(400);
  await page.getByTestId("gas-mode-clear").click();
  await dragWorld(page, [2, -2], [0, 2]); // the right half (the panel covers the left of the view)
  w = await gasWorld(page);
  expect(w.gas.parcels).toHaveLength(200);
  // Undo brings the cleared half back.
  await page.keyboard.press("Control+z");
  w = await gasWorld(page);
  expect(w.gas.parcels).toHaveLength(400);
});

test("RS-07b the simplest rocket accelerates right as its gas jets out of the hole (SC-03)", async ({ page }, info) => {
  await openStarter(page, "sc03-simplest-rocket");
  await page.getByTestId("hide-look-for").click();
  await page.keyboard.press("Space");
  await waitForTick(page, 12, 60_000);
  await page.keyboard.press("Space");
  await shot(page, info, "sc03-simplest-rocket");
  const w = await gasWorld(page);
  const top = w.bodies.find((b) => b.id === "top")!;
  expect(top.velocity.x).toBeGreaterThan(20);
  expect(w.ledger.violations).toBe(0);
  // The scenario selects the box and the camera follows it.
  await expect(page.getByTestId("inspector-title")).toHaveText("top");
});
