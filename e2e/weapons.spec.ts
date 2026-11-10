// M6 first look on screen: the cannon test fires a shell at the breakable ship.
import { expect, test } from "@playwright/test";
import { body, openStarter, shot, waitForTick } from "./helpers.ts";

test.describe.configure({ timeout: 120_000 });

test("WPN-001 the cannon test fires on its own at 0.5 s, and the shell flies at the ship", async ({ page }, info) => {
  await openStarter(page, "cannon-test");
  await expect(page.getByTestId("look-for")).toContainText("cannon fires");
  await page.getByTestId("play").click();
  // It fires at step 120 and is clear of the barrel by step 180, so wait past that: the pause can
  // land at once (results arrive from the simulation worker in runs).
  await waitForTick(page, 200, 90_000);
  await page.getByTestId("play").click();
  // The run may get well past step 200 before the pause lands (Firefox did), and by about step 290
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
  type W = { tick: number; bodies: { id: string; mass: number; velocity: { x: number; y: number }; contents?: { mass: number }[]; magazine?: { count: number; shell: { mass: number } } }[]; events: { tick: number; type: string; data: Record<string, unknown> }[] };
  const sim = () => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: unknown } } }).__msb.sandbox().world) as Promise<W>;
  await openStarter(page, "gunship");
  await page.getByTestId("play").click();
  await waitForTick(page, 30, 60_000);
  await page.keyboard.down("f");
  // Let go once the shell has left: holding on burns a jet through the empty barrel (slow engines held it for seconds).
  await expect.poll(async () => (await sim()).bodies.find((b) => b.id === "breech-shell-1")?.velocity.y ?? 0, { timeout: 60_000 }).toBeGreaterThan(30);
  await page.keyboard.up("f");
  // The first shell was loaded at the start; after the shot and the 1 s reload, the second is in.
  await expect.poll(async () => (await sim()).bodies.filter((b) => b.id.startsWith("breech-shell")).length, { timeout: 90_000 }).toBe(2);
  await page.getByTestId("play").click();
  // Recoil: the ship as a whole (every part but the shells and other ships) moves back, down its axis.
  const w = await sim();
  const own = w.bodies.filter((b) => !/^(t[123]-|rock-|breech-shell)/.test(b.id));
  const mass = (b: W["bodies"][number]) => b.mass + (b.contents ?? []).reduce((s, c) => s + c.mass, 0) + (b.magazine ? b.magazine.count * b.magazine.shell.mass : 0);
  const vy = own.reduce((s, b) => s + mass(b) * b.velocity.y, 0) / own.reduce((s, b) => s + mass(b), 0);
  const hits = w.events.filter((e) => e.type === "collision" && own.some((b) => b.id === e.data.a || b.id === e.data.b)).map((e) => `${e.tick}:${e.data.a}/${e.data.b}`);
  expect(vy, `tick ${w.tick}; ship collisions: ${hits.join(" ") || "none"}`).toBeLessThan(-0.5);
  await shot(page, info, "gunship");
});

test("FLT-002 Gunship 2 opens with its engines either side of the hull and the cannon on the wing", async ({ page }, info) => {
  await openStarter(page, "gunship-2");
  const hull = (await body(page, "hull"))!;
  const left = (await body(page, "engine-l"))!;
  const right = (await body(page, "engine-r"))!;
  const breech = (await body(page, "breech"))!;
  expect(left.position.x).toBeLessThan(hull.position.x - 1);
  expect(right.position.x).toBeGreaterThan(hull.position.x + 1);
  expect(breech.position.y).toBeLessThan(1.5);
  await shot(page, info, "gunship-2");
});

test("WPN-005 WPN-006 the explosive cannon test: the shell bursts on the ship into fragments and a flash of gas, and wrecks parts", async ({ page }, info) => {
  await openStarter(page, "cannon-explosive");
  // Step to past the strike (fired at step 120, it strikes at about 288, the gas comes out a step later).
  for (let i = 0; i < 31; i++) await page.getByTestId("step10").click();
  await waitForTick(page, 310);
  const w = await page.evaluate(() => {
    const s = (window as unknown as { __msb: { sandbox: () => { world: { events: { type: string; data: Record<string, unknown> }[]; bodies: { id: string }[]; gas: { count: number; composition: Record<string, number>[] }; ledger: { violations: number } } } } }).__msb.sandbox().world;
    return { det: s.events.filter((e) => e.type === "detonation").length, destroyed: s.events.filter((e) => e.type === "destroyed").length, fragments: s.bodies.filter((b) => /^shell-f\d+$/.test(b.id)).length, blast: s.gas.composition.slice(0, s.gas.count).filter((c) => c.co2).length, violations: s.ledger.violations };
  });
  expect(w.det).toBe(1);
  expect(w.fragments).toBe(6);
  expect(w.blast).toBeGreaterThan(0);
  expect(w.destroyed).toBeGreaterThan(2);
  expect(w.violations).toBe(0);
  await shot(page, info, "cannon-explosive-burst");
});
