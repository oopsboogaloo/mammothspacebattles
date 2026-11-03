// Core workflows from spec §8.3, each within its action budget (UXV-001).
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { Budget, body, hash, openStarter, shot, waitForTick, world } from "./helpers.ts";

test("UXV-001 W1 open the sandbox and run a reference scenario in ≤ 3 actions", async ({ page }, info) => {
  await page.goto("./");
  const b = new Budget(page, 3);
  await b.click(page.getByTestId("pick-sc01-elastic-collision"));
  await b.press("Space");
  await waitForTick(page, 500);
  await expect(page.getByTestId("graph-value-vax")).toContainText("-2.5000");
  await expect(page.getByTestId("graph-value-vbx")).toContainText("0.50000");
  b.done();
  await shot(page, info, "w1-sc01-running");
});

test("UXV-001 W2 spawn two bodies, set a velocity, collide them and read the impulse in ≤ 8 actions", async ({ page }) => {
  await page.goto("./");
  const b = new Budget(page, 8);
  await b.click(page.getByTestId("pick-empty"));
  await b.press("s");
  await b.clickWorld(2, 0); // a disc at rest
  await b.dragWorld([-2, 0], [-1, 0]); // a disc moving right at 2 m/s
  await b.press("Space");
  await expect(page.getByTestId("event").first()).toContainText("Collision", { timeout: 10_000 });
  await expect(page.getByTestId("event").first()).toContainText("N·s");
  b.done();
  const w = await world(page);
  expect(w.bodies).toHaveLength(2);
  expect(w.ledger.violations).toBe(0);
});

test("UXV-001 W5 add a probe, graph it, and measure with the ruler in ≤ 5 actions", async ({ page }) => {
  await openStarter(page, "rs02-off-centre-impact");
  const b = new Budget(page, 5);
  await b.press("p");
  await b.clickWorld(0.3, 0);
  await b.click(page.getByTestId("probe-spin"));
  await expect(page.getByTestId("graph-rod.spin")).toBeVisible();
  await b.press("r");
  await b.dragWorld([-0.9, 0], [0.9, 0]);
  await expect(page.getByTestId("ruler-readout")).toContainText("1.80 m");
  b.done();
});

test("UXV-001 W6 SCN-005 SCN-006 save the experiment, reload it, and get the same result in ≤ 4 actions", async ({ page }) => {
  await openStarter(page, "sc01-elastic-collision");
  // Make an edit while running so the file has a recorded command.
  await page.getByTestId("step10").click();
  await page.keyboard.press("i");
  const { dragWorld } = await import("./helpers.ts");
  await dragWorld(page, [-2.9, 0.2], [-2.9, 0.8]);
  await page.getByTestId("step10").click();
  const before = await hash(page);
  const tick = (await world(page)).tick;

  const b = new Budget(page, 4);
  const download = page.waitForEvent("download");
  await b.press("Control+s");
  const file = await (await download).path();
  const saved = JSON.parse(readFileSync(file!, "utf8"));
  expect(saved.timeline.some((e: { commands: { type: string }[] }) => e.commands.some((c) => c.type === "body.impulse"))).toBe(true);

  await page.goto("./");
  const chooser = page.waitForEvent("filechooser");
  await b.click(page.getByTestId("open-file"));
  await (await chooser).setFiles(file!);
  await expect(page.getByTestId("sandbox")).toBeVisible();
  for (let i = 0; i < tick / 10; i++) await page.getByTestId("step10").click();
  expect(await hash(page)).toBe(before);
  b.done();
});

test("UXV-001 W7 SBX-034 find the step and entity behind a conservation violation in ≤ 3 actions", async ({ page }) => {
  await page.goto("./");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("open-file").click();
  await (await chooser).setFiles("e2e/fixtures/violation.json");
  // Reading the file is asynchronous: wait for the sandbox before pressing play.
  await expect(page.getByTestId("sandbox")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("violations")).toContainText(/[1-9]\d* violation/, { timeout: 10_000 });
  await page.keyboard.press("Space");

  const b = new Budget(page, 3);
  await b.click(page.getByTestId("violations"));
  await b.click(page.getByTestId("violation-entry").first());
  b.done();
  expect((await world(page)).tick).toBe(31);
  await expect(page.getByTestId("inspector-title")).toHaveText("b");
});

test("SBX-012 dragging a body while running pulls it with a spring and records the drag", async ({ page }) => {
  await openStarter(page, "sc01-elastic-collision");
  await page.getByTestId("hide-look-for").click();
  await page.keyboard.press("m");
  await page.keyboard.press("Space");
  const { dragWorld } = await import("./helpers.ts");
  await dragWorld(page, [3, 0], [3, 3], 20);
  await page.keyboard.press("Space");
  const b = await body(page, "b");
  expect(b!.velocity.y).toBeGreaterThan(0);
  expect((await world(page)).ledger.violations).toBe(0);
  await expect(page.getByTestId("undo")).toHaveAttribute("title", /Undo Drag b/);
});
