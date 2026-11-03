// M4: build a ship from parts and fly it (W3), and read an injector's status (INS-006).
import { expect, test, type Page } from "@playwright/test";
import { Budget, openStarter, shot, toPage, waitForTick, world } from "./helpers.ts";

async function moveWorld(page: Page, x: number, y: number) {
  const p = await toPage(page, x, y);
  await page.mouse.move(p.x, p.y);
}

const hullOf = async (page: Page) => {
  const w = await world(page);
  return w.bodies.find((b) => b.id.startsWith("hull"))!;
};

test("UXV-001 W3 SBX-020 build a ship (hull, tank, engine), link feed and control, bind a key and fly it in ≤ 20 actions", async ({ page }, info) => {
  await page.goto("./");
  const b = new Budget(page, 20);
  await b.click(page.getByTestId("pick-empty"));
  // Hull.
  await b.press("s");
  await b.click(page.getByTestId("spawn-hull"));
  await b.clickWorld(0, 2);
  // Tank under the hull, engine under the tank (Attach welds each to the port it points at).
  await b.press("a");
  await b.click(page.getByTestId("spawn-tank"));
  // Point just below the hull's bottom face (a click on the hull itself would drag the hull).
  await moveWorld(page, 0, 1.45);
  await expect(page.getByTestId("attach-readout")).toContainText("Valid: hull-1");
  await b.clickWorld(0, 1.45);
  await b.click(page.getByTestId("spawn-engine"));
  await moveWorld(page, 0, 0.95);
  await expect(page.getByTestId("attach-readout")).toContainText("Valid: tank-");
  await b.clickWorld(0, 0.95);
  // Feed links: one drag links both propellants.
  await b.press("l");
  await b.dragWorld([0, 1.25], [0, 0.9]);
  // Control link and key on the engine.
  await b.press("Escape");
  await b.clickWorld(0, 0.9);
  await expect(page.getByTestId("injector-status")).toContainText('No control link for channel "main"');
  await b.click(page.getByTestId("add-control"));
  await expect(page.getByTestId("injector-status")).toContainText("Idle: main = 0");
  await b.click(page.getByTestId("bind-main"));
  await b.press("w");
  // Fly: follow the ship, play, hold W.
  await b.press("f");
  await b.press("Space");
  b.count++;
  await page.keyboard.down("w");
  await expect(page.getByTestId("injector-status")).toContainText("Firing at 100%");
  await waitForTick(page, 240, 60_000);
  await page.keyboard.up("w");
  b.done();
  await page.keyboard.press("Space");
  await shot(page, info, "w3-ship");
  const w = await world(page);
  const hull = await hullOf(page);
  expect(hull.velocity.y).toBeGreaterThan(1); // it climbed
  expect((w as unknown as { gas: { parcels: unknown[] } }).gas.parcels.length).toBeGreaterThan(0);
  expect(w.ledger.violations).toBe(0);
  expect(w.events.some((e) => e.type === "ignition")).toBe(true);
});

test("INS-006 PRP-009 the injector's status gives the reason it is not firing", async ({ page }) => {
  await openStarter(page, "rs08-chemical-rocket");
  await page.getByTestId("hide-look-for").click();
  // The scenario follows the hull; select the engine instead.
  const w = await world(page);
  const eng = w.bodies.find((x) => x.id === "engine")!;
  await page.keyboard.press("f"); // stop following
  const p = await toPage(page, eng.position.x, eng.position.y);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId("inspector-title")).toHaveText("engine");
  await expect(page.getByTestId("injector-status")).toContainText("Idle: main = 0");
  await page.getByTestId("step10").click(); // the timeline commands full thrust at step 0
  await expect(page.getByTestId("injector-status")).toContainText("Firing at 100%");
  // Break the O₂ feed: once the engine's own store is used up, it says why it stopped.
  await page.locator(".joint", { hasText: "o2: tank → engine" }).getByRole("button", { name: "Remove" }).click();
  for (let i = 0; i < 12; i++) await page.getByTestId("step10").click();
  await expect(page.getByTestId("injector-status")).toContainText("No feed: nothing links o2 to it");
});
