// SBX-047: phones and tablets can build and fly by touch, with no keyboard.
import { expect, test, type Page } from "@playwright/test";
import { dragWorld, shot, toPage, waitForTick, world } from "./helpers.ts";

async function tapWorld(page: Page, x: number, y: number) {
  const p = await toPage(page, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Holds an on-screen button with a touch-type pointer, as a thumb would; returns a release function. */
async function hold(page: Page, testid: string, pointerId: number): Promise<() => Promise<void>> {
  const el = page.getByTestId(testid);
  const box = (await el.boundingBox())!;
  const opts = { pointerId, pointerType: "touch", isPrimary: pointerId === 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true };
  await el.dispatchEvent("pointerdown", opts);
  return async () => {
    await el.dispatchEvent("pointerup", opts);
  };
}

async function buildSingle(page: Page) {
  await page.goto("./");
  await page.getByTestId("pick-empty").click();
  await page.getByTestId("tool-spawn").click();
  await page.getByTestId("spawn-hull").click();
  await tapWorld(page, 0, 2);
  await page.getByTestId("tool-attach").click();
  await page.getByTestId("spawn-tank").click();
  await tapWorld(page, 0, 1.45);
  await page.getByTestId("spawn-engine").click();
  await tapWorld(page, 0, 0.95);
  await page.getByTestId("tool-link").click();
  await dragWorld(page, [0, 1.25], [0, 0.9]);
  await page.getByTestId("tool-select").click();
  await tapWorld(page, 0, 0.9);
}

for (const [name, viewport] of [
  ["phone", { width: 390, height: 844 }],
  ["tablet", { width: 820, height: 1180 }],
] as const) {
  test.describe(`${name} (${viewport.width} px)`, () => {
    test.use({ viewport });

    test(`SBX-047 UXV-001 W3 on a ${name}: build a ship by tapping, then fly it with the on-screen button`, async ({ page }, info) => {
      await buildSingle(page);
      // The inspector is a sheet on narrow screens.
      await page.getByRole("button", { name: "Inspector", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Inspector" });
      await expect(sheet.getByTestId("injector-status")).toContainText('No control link for channel "main"');
      await sheet.getByTestId("add-control").click();
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.getByTestId("fly-main")).toBeVisible();
      await page.getByTestId("mobile-follow").click();
      await page.getByTestId("play").click();
      const release = await hold(page, "fly-main", 1);
      await expect(page.getByTestId("fly-main")).toHaveAttribute("aria-pressed", "true");
      await waitForTick(page, 200, 60_000);
      await release();
      await expect(page.getByTestId("fly-main")).toHaveAttribute("aria-pressed", "false");
      await page.getByTestId("play").click();
      await shot(page, info, `w3-${name}`);
      const w = await world(page);
      const hull = w.bodies.find((b) => b.id === "hull-1")!;
      expect(hull.velocity.y).toBeGreaterThan(0.5);
      expect(w.ledger.violations).toBe(0);
    });
  });
}

test.describe("tablet (820 px), two thumbs", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("SBX-047 UXV-001 W9 on a tablet: a twin-engine ship flown with two on-screen buttons held at once", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("pick-empty").click();
    await page.getByTestId("tool-spawn").click();
    await page.getByTestId("spawn-hull").click();
    await tapWorld(page, 0, 2);
    await page.getByTestId("tool-attach").click();
    await page.getByTestId("spawn-tank").click();
    await tapWorld(page, 0, 1.45);
    await page.getByTestId("spawn-plank").click();
    await tapWorld(page, 0, 0.95);
    await page.getByTestId("spawn-engine").click();
    await tapWorld(page, -1, 0.75);
    await tapWorld(page, 1, 0.75);
    await page.getByTestId("tool-link").click();
    await dragWorld(page, [0, 1.25], [-1, 0.7]);
    await dragWorld(page, [0, 1.25], [1, 0.7]);
    await page.getByTestId("tool-select").click();
    for (const x of [-1, 1]) {
      await tapWorld(page, x, 0.7);
      await page.getByRole("button", { name: "Inspector", exact: true }).click();
      await page.getByRole("dialog", { name: "Inspector" }).getByTestId("add-control").click();
      await page.getByRole("button", { name: "Close", exact: true }).click();
    }
    await expect(page.getByTestId("fly-main")).toBeVisible();
    await expect(page.getByTestId("fly-main-2")).toBeVisible();
    await page.getByTestId("play").click();
    // Both thumbs down: climb. Then lift the right one: the left engine alone turns the nose right.
    const left = await hold(page, "fly-main", 1);
    const right = await hold(page, "fly-main-2", 2);
    await waitForTick(page, 120, 60_000);
    await expect(page.getByTestId("fly-main")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("fly-main-2")).toHaveAttribute("aria-pressed", "true");
    await right();
    await waitForTick(page, 240, 60_000);
    await left();
    await page.getByTestId("play").click();
    const w = await world(page);
    const hull = w.bodies.find((b) => b.id === "hull-1")! as (typeof w.bodies)[number] & { angularVelocity: number };
    expect(hull.velocity.y).toBeGreaterThan(0.5);
    expect(hull.angularVelocity).toBeLessThan(-0.2);
    expect(w.ledger.violations).toBe(0);
  });
});

test.describe("tablet (820 px), ready-made ship", () => {
  test.use({ viewport: { width: 820, height: 1180 } });

  test("SBX-047 SBX-020 the FLY scenario opens ready to fly: left/right buttons, Q/E bound, camera following", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("pick-fly-twin-engine").click();
    await expect(page.getByTestId("fly-left")).toBeVisible();
    await expect(page.getByTestId("fly-right")).toBeVisible();
    await expect(page.getByTestId("fly-left")).toContainText("Q");
    await expect(page.getByTestId("fly-right")).toContainText("E");
    await page.getByTestId("play").click();
    const left = await hold(page, "fly-left", 1);
    await waitForTick(page, 120, 60_000);
    await left();
    await page.getByTestId("play").click();
    const w = await world(page);
    const hull = w.bodies.find((b) => b.id === "hull")! as (typeof w.bodies)[number] & { angularVelocity: number };
    expect(hull.angularVelocity).toBeLessThan(-0.2); // left engine alone: nose turns right
    expect(w.ledger.violations).toBe(0);
  });
});
