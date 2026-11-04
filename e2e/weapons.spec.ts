// M6 first look on screen: the cannon test fires a shell at the breakable ship.
import { expect, test } from "@playwright/test";
import { body, openStarter, shot, waitForTick } from "./helpers.ts";

test.describe.configure({ timeout: 120_000 });

test("WPN-001 the cannon test fires on its own at 0.5 s, and the shell flies at the ship", async ({ page }, info) => {
  await openStarter(page, "cannon-test");
  await expect(page.getByTestId("look-for")).toContainText("cannon fires");
  await page.getByTestId("play").click();
  await waitForTick(page, 150, 90_000);
  await page.getByTestId("play").click();
  // The run may get well past step 150 before the pause lands (Firefox did), and by about step 290
  // the shell has hit the ship and slowed. So: it left the barrel, and it was fast, either still in
  // flight or when it struck.
  const s = (await body(page, "shell"))!;
  expect(s.position.x).toBeGreaterThan(-16.5);
  const hit = await page.evaluate(() =>
    (window as unknown as { __msb: { sandbox: () => { world: { events: { type: string; data: Record<string, unknown> }[] } } } }).__msb
      .sandbox()
      .world.events.filter((e) => e.type === "collision" && (e.data.a === "shell" || e.data.b === "shell"))
      .map((e) => Number(e.data.speed)),
  );
  expect(Math.max(s.velocity.x, ...hit)).toBeGreaterThan(20);
  await shot(page, info, "cannon-fired");
});

test("WPN-001 the gunship fires on F, recoils, and its magazine loads the next shell", async ({ page }, info) => {
  await openStarter(page, "gunship");
  await page.getByTestId("play").click();
  await waitForTick(page, 30, 60_000);
  await page.keyboard.down("f");
  await waitForTick(page, 60, 60_000);
  await page.keyboard.up("f");
  // The first shell was loaded at the start; after the shot and the 1 s reload, the second is in.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { bodies: { id: string }[] } } } }).__msb.sandbox().world.bodies.filter((b) => b.id.startsWith("breech-shell")).length), { timeout: 90_000 })
    .toBe(2);
  await page.getByTestId("play").click();
  expect((await body(page, "hull"))!.velocity.y).toBeLessThan(-0.5);
  await shot(page, info, "gunship");
});
