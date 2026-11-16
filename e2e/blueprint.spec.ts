// The blueprint designer's page (docs/blueprint/spec.md): select, change, undo, welds, and Try it.
import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ timeout: 60_000 });

async function openFresh(page: Page) {
  await page.goto("blueprint.html");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("drawing-name")).toHaveText("THRUST 1");
}

const blueprint = (page: Page) => page.evaluate(() => (window as unknown as { __msb: { blueprint: () => { name: string; preset?: boolean; ship: { bodies: { id: string; shape: unknown }[] } } } }).__msb.blueprint());

test("BPD-017 the sandbox's start screen links to the designer, which opens on Thrust 1 and fits one screen", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("open-blueprint")).toHaveAttribute("href", "blueprint.html");
  await openFresh(page);
  const scrolls = await page.evaluate(() => [document.documentElement.scrollHeight > innerHeight, document.documentElement.scrollWidth > innerWidth]);
  expect(scrolls).toEqual([false, false]);
  await expect(page.getByTestId("performance")).toContainText("61.2 kg");
});

test("BPD-018 select an engine and type a new nozzle length: a preset is copied, the walls change, and undo puts them back", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("part-main").locator("polygon").nth(1).click();
  await expect(page.getByTestId("selected-name")).toHaveText("Main thruster");
  const input = page.getByTestId("param-length").locator("input.num");
  await input.fill("1.6");
  await input.press("Enter");
  await expect(page.getByTestId("drawing-name")).toHaveText("THRUST 1 COPY");
  await expect(page.getByTestId("toast")).toContainText("preset");
  await expect(input).toHaveValue("1.60");
  const after = await blueprint(page);
  expect(after.preset).toBeFalsy();
  // A held stepper is one undo step.
  const flare = page.getByTestId("param-flare").locator("input.num");
  const before = await flare.inputValue();
  await page.getByTestId("param-flare").getByRole("button", { name: /^More/ }).hover();
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect(flare).not.toHaveValue(before);
  await page.keyboard.press("Control+z");
  await expect(flare).toHaveValue(before);
  await page.keyboard.press("Control+z");
  await expect(input).toHaveValue("1.10");
});

test("BPD-019 click a weld point to see its two parts and its strength", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("weld-gen-l|tank-l").locator("circle").first().click({ force: true });
  await expect(page.getByTestId("selected-name")).toHaveText("Weld · Generator L ↔ Tank L");
  await expect(page.getByText("2 weld points")).toBeVisible();
});

test("BPD-020 Try it flies the blueprint at once, its controls wired, and Esc comes back to the blueprint unchanged", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("try-it").click();
  await expect(page.getByTestId("try-view")).toBeVisible();
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("KeyE");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { controls: Record<string, number> } } | null } }).__msb.sandbox()?.world.controls ?? {}))
    .toMatchObject({ main: 1, bl: 1, fr: 0.5 });
  await page.waitForTimeout(500);
  const hull = await page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { gravity: { x: number; y: number }; bodies: { id: string; velocity: { x: number; y: number } }[] } } } }).__msb.sandbox().world);
  expect(hull.gravity).toEqual({ x: 0, y: 0 });
  expect(Math.hypot(hull.bodies.find((b) => b.id === "hull")!.velocity.x, hull.bodies.find((b) => b.id === "hull")!.velocity.y)).toBeGreaterThan(1);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("KeyE");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("drawing-name")).toHaveText("THRUST 1");
  expect((await blueprint(page)).preset).toBe(true);
});
