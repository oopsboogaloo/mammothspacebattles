// M7 first look on screen: generated rubble asteroids, shot at and colliding.
import { expect, test } from "@playwright/test";
import { openStarter, shot, waitForTick, world } from "./helpers.ts";

test.describe.configure({ timeout: 120_000 });

test("AST-001 AST-002 the rubble scenario builds its asteroids from pieces, and the gunship can shoot at them", async ({ page }, info) => {
  await openStarter(page, "gunship-rubble");
  const w = await world(page);
  for (const id of ["ra", "rb", "rc", "rd"]) expect(w.bodies.filter((b) => b.id.startsWith(`${id}-`)).length).toBe(12);
  await page.getByTestId("play").click();
  await waitForTick(page, 30, 60_000);
  await page.keyboard.down("f");
  await waitForTick(page, 60, 60_000);
  await page.keyboard.up("f");
  await waitForTick(page, 240, 90_000);
  await page.getByTestId("play").click();
  expect((await world(page)).bodies.some((b) => b.id === "breech-shell-1")).toBe(true);
  await shot(page, info, "gunship-rubble");
});

test("AST-003 two asteroids close on each other; each is 20 welded pieces", async ({ page }, info) => {
  await openStarter(page, "asteroid-collision");
  const w = await world(page);
  expect(w.bodies.filter((b) => b.id.startsWith("big-")).length).toBe(20);
  expect(w.bodies.filter((b) => b.id.startsWith("small-")).length).toBe(20);
  await shot(page, info, "asteroid-collision");
});
