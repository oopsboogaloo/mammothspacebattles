// SBX-047: phones and tablets can build and fly by touch, with no keyboard.
import { expect, test, type Page } from "@playwright/test";
import { dragWorld, shot, toPage, waitForTick, world } from "./helpers.ts";

// These fly gas engines in the browser; WebKit on CI runs them at about 7 steps a second at tablet
// size, so 200 steps can take longer than the default 30 s. The checks are unchanged.
test.describe.configure({ timeout: 90_000 });

async function tapWorld(page: Page, x: number, y: number) {
  const p = await toPage(page, x, y);
  await page.mouse.click(p.x, p.y);
}

const tickNow = async (page: Page) => (await world(page)).tick;

/**
 * Runs the simulation for at least `ticks` steps from now, then pauses. Buttons are pressed and
 * released while paused, so each phase lasts its full length however fast the machine is.
 */
async function runFor(page: Page, ticks: number) {
  const from = await tickNow(page);
  await page.getByTestId("play").click();
  await waitForTick(page, from + ticks, 60_000);
  await page.getByTestId("play").click();
}

/**
 * Holds an on-screen button with a touch-type pointer, as a thumb would; returns a release function.
 * Use pointer ids from 11 up: 1 is the mouse, and a mouse click releases a hold with the same id.
 */
async function hold(page: Page, testid: string, pointerId: number): Promise<() => Promise<void>> {
  const el = page.getByTestId(testid);
  const box = (await el.boundingBox())!;
  const opts = { pointerId, pointerType: "touch", isPrimary: pointerId === 11, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true };
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
      const release = await hold(page, "fly-main", 11);
      await expect(page.getByTestId("fly-main")).toHaveAttribute("aria-pressed", "true");
      await runFor(page, 200);
      await release();
      await expect(page.getByTestId("fly-main")).toHaveAttribute("aria-pressed", "false");
      await shot(page, info, `w3-${name}`);
      const w = await world(page);
      const hull = w.bodies.find((b) => b.id === "hull-1")!;
      expect(hull.velocity.y).toBeGreaterThan(0.5);
      expect(w.ledger.violations).toBe(0);
    });
  });
}

for (const [name, viewport] of [
  ["phone", { width: 390, height: 844 }],
  ["tablet", { width: 820, height: 1180 }],
] as const)
  test.describe(`${name} (${viewport.width} px), two thumbs`, () => {
    test.use({ viewport });

    test(`SBX-047 UXV-001 W9 on a ${name}: a twin-engine ship flown with two on-screen buttons held at once`, async ({ page }) => {
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
      // Both thumbs down: climb. Then lift the right one: the left engine alone turns the nose right.
      const left = await hold(page, "fly-main", 11);
      const right = await hold(page, "fly-main-2", 12);
      await expect(page.getByTestId("fly-main")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("fly-main-2")).toHaveAttribute("aria-pressed", "true");
      await runFor(page, 120);
      await right();
      await runFor(page, 120);
      await left();
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
    const left = await hold(page, "fly-left", 11);
    await runFor(page, 120);
    await left();
    const w = await world(page);
    const hull = w.bodies.find((b) => b.id === "hull")! as (typeof w.bodies)[number] & { angularVelocity: number };
    expect(hull.angularVelocity).toBeLessThan(-0.2); // left engine alone: nose turns right
    expect(w.ledger.violations).toBe(0);
  });
});

test.describe("flight buttons (phone, 390 px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("SBX-047 a hold ends when the finger lifts anywhere, and when its control link is removed", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("pick-fly-twin-engine").click();
    const btn = page.getByTestId("fly-left");
    const box = (await btn.boundingBox())!;
    // Press on the button, lift off it (over the world): the engine must stop.
    await btn.dispatchEvent("pointerdown", { pointerId: 7, pointerType: "touch", clientX: box.x + 10, clientY: box.y + 10, bubbles: true });
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() =>
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, pointerType: "touch", clientX: 50, clientY: 300, bubbles: true })),
    );
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    // Hold again, then remove its control link: the channel is let go, not left on.
    await btn.dispatchEvent("pointerdown", { pointerId: 8, pointerType: "touch", clientX: box.x + 10, clientY: box.y + 10, bubbles: true });
    await page.evaluate(() => {
      const hook = (window as unknown as { __msb: { sandbox: () => { edit: (c: unknown[], l: string) => void } } }).__msb;
      hook.sandbox().edit([{ type: "link.remove", id: "ctl-left" }], "Remove");
    });
    await page.getByTestId("step").click();
    await expect(page.getByTestId("fly-left")).toHaveCount(0);
    const controls = await page.evaluate(
      () => (window as unknown as { __msb: { sandbox: () => { world: { controls: Record<string, number> } } } }).__msb.sandbox().world.controls,
    );
    expect(controls.left ?? 0).toBe(0);
  });

  test("SBX-030 SBX-047 the camera keeps following the ship after a tap on empty space, a wobbly tap, or a tap on another part", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("pick-fly-twin-engine").click();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const view = (await page.getByTestId("view").boundingBox())!;
    const hullOnScreen = async () => {
      const h = (await world(page)).bodies.find((b) => b.id === "hull")!;
      return toPage(page, h.position.x, h.position.y);
    };
    const centre = async () => {
      const v = (await page.getByTestId("view").boundingBox())!;
      return { x: v.x + v.width / 2, y: v.y + v.height / 2 };
    };
    // Tap empty space (clears the selection), then a tap that wobbles 5 px, then a tap on the left engine.
    await page.mouse.click(view.x + 30, view.y + 40);
    await page.mouse.move(view.x + 30, view.y + 60);
    await page.mouse.down();
    await page.mouse.move(view.x + 33, view.y + 64, { steps: 3 });
    await page.mouse.up();
    const engine = (await world(page)).bodies.find((b) => b.id === "chamber-left-l")!;
    const e = await toPage(page, engine.position.x, engine.position.y);
    await page.mouse.click(e.x, e.y);
    await expect(page.getByTestId("mobile-follow")).toHaveAttribute("aria-pressed", "true");
    const left = await hold(page, "fly-left", 11);
    const right = await hold(page, "fly-right", 12);
    await runFor(page, 150);
    await left();
    await right();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const hull = (await world(page)).bodies.find((b) => b.id === "hull")!;
    expect(hull.position.y).toBeGreaterThan(2.5); // it climbed
    const [end, c] = [await hullOnScreen(), await centre()];
    expect(Math.hypot(end.x - c.x, end.y - c.y)).toBeLessThan(10); // and the camera stayed on it
  });

  test("SBX-047 with many channels every button stays on screen", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("pick-fly-twin-engine").click();
    await page.evaluate(() => {
      const hook = (window as unknown as { __msb: { sandbox: () => { edit: (c: unknown[], l: string) => void } } }).__msb;
      hook.sandbox().edit(
        Array.from({ length: 10 }, (_, i) => ({ type: "link.add", link: { id: `extra-${i}`, kind: "control", channel: `aux-${i}`, to: "hull" } })),
        "Add channels",
      );
    });
    await page.getByTestId("step").click();
    const view = (await page.getByTestId("view").boundingBox())!;
    const buttons = page.locator(".padbtn");
    await expect(buttons).toHaveCount(12);
    for (const b of await buttons.all()) {
      const r = (await b.boundingBox())!;
      expect(r.y).toBeGreaterThanOrEqual(view.y - 1);
      expect(r.y + r.height).toBeLessThanOrEqual(view.y + view.height + 1);
      expect(r.x).toBeGreaterThanOrEqual(view.x - 1);
    }
  });
});
