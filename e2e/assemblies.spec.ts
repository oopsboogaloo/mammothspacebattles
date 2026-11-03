// M2: assemblies, joints, links and branching, through the UI.
import { expect, test, type Page } from "@playwright/test";
import { Budget, body, dragWorld, hash, openStarter, toPage, waitForTick, world } from "./helpers.ts";

async function clickWorld(page: Page, x: number, y: number, opts: { button?: "left" | "right" } = {}) {
  const p = await toPage(page, x, y);
  await page.mouse.click(p.x, p.y, opts);
}

/** Sets a range input's value the way a drag would (Playwright can't fill sliders). */
async function setSlider(page: Page, testid: string, value: number) {
  await page.getByTestId(testid).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("UXV-001 W4 SBX-015 SBX-016 detach a part mid-flight and see the assembly's mass update in ≤ 3 actions", async ({ page }) => {
  await openStarter(page, "rs05b-spinning-assembly");
  await page.getByTestId("hide-look-for").click();
  await page.keyboard.press("Space");
  await waitForTick(page, 60);
  await page.keyboard.press("Space");
  const pod = (await body(page, "pod-right"))!;
  const b = new Budget(page, 3);
  await b.clickWorld(pod.position.x, pod.position.y);
  await b.click(page.getByTestId("detach"));
  const hull = (await body(page, "hull"))!;
  await b.clickWorld(hull.position.x, hull.position.y);
  b.done();
  await expect(page.locator(".section", { hasText: "ASSEMBLY" })).toContainText("5.00 kg");
  const after = (await body(page, "pod-right"))!;
  expect(after.velocity).toEqual(pod.velocity); // keeps its momentum
  expect((await world(page)).ledger.violations).toBe(0);
});

test("UXV-001 W8 SBX-004 pause, scrub back 5 s, change a value and resume, branching the run, in ≤ 5 actions", async ({ page }) => {
  await openStarter(page, "sc01-elastic-collision");
  await page.getByTestId("scale-4").click();
  await page.keyboard.press("Space");
  await waitForTick(page, 240 * 7);
  const b = new Budget(page, 5);
  await b.press("Space");
  const end = (await world(page)).tick;
  // Scrub back to t = 2 s (at least 5 s back), where both discs are still on screen.
  const back = 480;
  expect(end - back).toBeGreaterThanOrEqual(240 * 5);
  b.count++;
  await setSlider(page, "scrub", back);
  expect((await world(page)).tick).toBe(back);
  const original = await hash(page);
  const a = (await body(page, "a"))!;
  await b.clickWorld(a.position.x, a.position.y);
  await page.getByTestId("field-vx").fill("-1");
  await b.press("Enter");
  await b.press("Space");
  b.done();
  await waitForTick(page, back + 60);
  await page.keyboard.press("Space");
  const sb = await page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { maxTick: number } } }).__msb.sandbox().maxTick);
  expect(sb).toBeLessThan(end); // the old future was discarded
  // One undo brings the discarded future back.
  await page.keyboard.press("Control+z");
  await setSlider(page, "scrub", back);
  expect(await hash(page)).toBe(original);
});

test("SBX-003 the scrub bar reaches back at least 10 s", async ({ page }) => {
  await openStarter(page, "rs05b-spinning-assembly");
  await page.getByTestId("scale-8").click();
  await page.keyboard.press("Space");
  await waitForTick(page, 240 * 12);
  await page.keyboard.press("Space");
  const end = (await world(page)).tick;
  await setSlider(page, "scrub", end - 240 * 10);
  expect((await world(page)).tick).toBe(end - 240 * 10);
  await setSlider(page, "scrub", end);
  expect((await world(page)).tick).toBe(end);
});

test("SBX-014 SBX-016 attaching shows a live valid/blocked preview, then welds the part and updates the assembly", async ({ page }) => {
  await openStarter(page, "rs05b-spinning-assembly");
  await page.getByTestId("hide-look-for").click();
  await page.keyboard.press("a");
  await page.getByTestId("spawn-box").click();
  const top = await toPage(page, 0, 0.55);
  await page.mouse.move(top.x, top.y);
  await expect(page.getByTestId("attach-readout")).toContainText("Valid: hull");
  const right = await toPage(page, 1.05, 0);
  await page.mouse.move(right.x, right.y);
  await expect(page.getByTestId("attach-readout")).toContainText("Blocked");
  await page.mouse.move(top.x, top.y);
  await page.mouse.click(top.x, top.y);
  const w = (await world(page)) as Awaited<ReturnType<typeof world>> & { joints: unknown[] };
  expect(w.joints).toHaveLength(3);
  const box = w.bodies.find((b) => b.id.startsWith("box-"))!;
  expect(box.position.y).toBeCloseTo(1, 6);
  await page.keyboard.press("Escape");
  await clickWorld(page, 0, 0);
  await expect(page.locator(".section", { hasText: "ASSEMBLY" })).toContainText("7.00 kg");
});

test("SBX-017 the link tool makes a feed link between stores and lights up only compatible bodies", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("pick-empty").click();
  await page.keyboard.press("s");
  await page.getByTestId("spawn-box").click();
  for (const x of [-2, 2, 0]) await clickWorld(page, x, x === 0 ? 3 : 0);
  await page.keyboard.press("Escape");
  for (const [x, amount] of [[-2, "5"], [2, ""]] as const) {
    await clickWorld(page, x, 0);
    await page.getByTestId("add-store").click();
    if (amount) {
      await page.getByTestId("field-store-fuel-mass").fill(amount);
      await page.getByTestId("field-store-fuel-mass").press("Enter");
    }
  }
  await page.keyboard.press("l");
  await dragWorld(page, [-2, 0], [0, 3]); // box without a store: refused
  await expect(page.getByTestId("toast")).toContainText("matching store");
  await dragWorld(page, [-2, 0], [2, 0]);
  const w = await world(page);
  expect((w as unknown as { links: { kind: string; from: string; to: string }[] }).links).toEqual([expect.objectContaining({ kind: "feed", from: "box-1", to: "box-2" })]);
  await page.keyboard.press("Space");
  await waitForTick(page, 240);
  await page.keyboard.press("Space");
  const right = (await body(page, "box-2")) as unknown as { contents: { mass: number }[] };
  expect(right.contents[0].mass).toBeGreaterThan(0.9);
});

test("SBX-020 keys can be bound to control channels; the legend shows them while flying", async ({ page }) => {
  await openStarter(page, "rs05b-spinning-assembly");
  await page.getByTestId("hide-look-for").click();
  await clickWorld(page, 0, 0);
  await page.getByTestId("new-channel").fill("main");
  await page.getByTestId("add-control").click();
  await page.getByTestId("bind-main").click();
  await page.keyboard.press("w");
  await expect(page.getByTestId("key-legend")).toContainText("W → main 0.00");
  await page.keyboard.down("w");
  await expect(page.getByTestId("key-legend")).toContainText("main 1.00");
  await expect(page.locator(".section", { hasText: "LINKS" })).toContainText("main = 1.00");
  await page.keyboard.up("w");
  await expect(page.getByTestId("key-legend")).toContainText("main 0.00");
});

test("SBX-021 an assembly can be saved as a prefab and spawned as a copy", async ({ page }) => {
  await openStarter(page, "rs05b-spinning-assembly");
  await page.getByTestId("hide-look-for").click();
  await clickWorld(page, 0, 0, { button: "right" });
  await page.getByTestId("ctx-prefab").click();
  await page.keyboard.press("s");
  await page.getByTestId("prefab-0").click();
  await clickWorld(page, 3, 2.5);
  const w = await world(page);
  expect(w.bodies).toHaveLength(6);
  expect((w as unknown as { joints: unknown[] }).joints).toHaveLength(4);
});

test("SBX-032 joint load shows as a fraction of the limit in the inspector and as an overlay", async ({ page }) => {
  await openStarter(page, "rs05b-spinning-assembly");
  await page.getByTestId("hide-look-for").click();
  await expect(page.getByTestId("overlay-joints")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Overlay legend")).toContainText("line thickens with load");
  await page.getByTestId("step10").click();
  await clickWorld(page, 0, 0);
  // Centripetal tension on each pod: m·ω²·r = 1 × 0.64 × 1.3 ≈ 0.83 N of a 5,000 N limit.
  await expect(page.getByTestId("joint-load-jR")).toContainText("0% tension");
  await page.getByTestId("field-jR-tension").fill("0.5");
  await page.getByTestId("field-jR-tension").press("Enter");
  await page.getByTestId("step").click();
  const w = await world(page);
  expect(w.events.some((e) => e.type === "joint.break")).toBe(true);
});
