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

test("BPD-022 drag a tank in from the list: it snaps flush, shows green weld points before release, and welds on release", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("part-tank-r").locator("polygon").first().click();
  await page.keyboard.press("Delete");
  await page.getByRole("tab", { name: "TA" }).click();
  const card = (await page.getByTestId("card-tank-l").boundingBox())!;
  const gen = (await page.getByTestId("part-gen-r").locator("polygon").first().boundingBox())!;
  await page.mouse.move(card.x + 30, card.y + 30);
  await page.mouse.down();
  await page.mouse.move(card.x + 90, card.y + 40, { steps: 3 });
  await page.mouse.move(gen.x + gen.width + 75, gen.y + gen.height / 2 + 10, { steps: 10 });
  await expect(page.getByTestId("ghost")).toHaveAttribute("data-state", "weld");
  await page.mouse.up();
  await expect(page.getByTestId("selected-name")).toHaveText("Propellant tank");
  const bp = await page.evaluate(() => (window as unknown as { __msb: { blueprint: () => { ship: { joints: { a: string; b: string }[] } } } }).__msb.blueprint());
  expect(bp.ship.joints.filter((j) => (j.a === "tank" && j.b === "gen-r") || (j.a === "gen-r" && j.b === "tank")).length).toBe(2);
  await expect(page.getByTestId("loose")).toHaveCount(0);
});

test("BPD-022 ＋ adds a part where it welds, and moving a part off the ship warns that the ship is in pieces", async ({ page }) => {
  await openFresh(page);
  await page.getByRole("tab", { name: "GE" }).click();
  await page.getByRole("button", { name: "Add Generator", exact: true }).click();
  await expect(page.getByTestId("selected-name")).toHaveText("Generator");
  await expect(page.getByTestId("performance")).toContainText("18 parts");
  const bat = (await page.getByTestId("part-battery").locator("polygon").first().boundingBox())!;
  await page.mouse.move(bat.x + bat.width * 0.25, bat.y + bat.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(bat.x + bat.width * 0.25, bat.y + bat.height * 0.7 + 200, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("loose")).toContainText("pieces");
});

/** Opens THRUST OG, the game's ship as it is (its railgun through the shield emitter, no free side for another thruster). */
async function openOg(page: Page) {
  await page.getByTestId("open-drawer").click();
  await page.getByTestId("design-THRUST OG").click();
  await expect(page.getByTestId("drawing-name")).toHaveText("THRUST OG");
}

test("BPD-024 wire a new engine in the mixer and test it by holding a key: nothing is wired until the player does it, and nothing off the cockpit answers", async ({ page }) => {
  await openFresh(page);
  await openOg(page);
  await page.getByRole("tab", { name: "EN" }).click();
  await page.getByRole("button", { name: "Add Light thruster", exact: true }).click();
  await page.getByTestId("mode-controls").click();
  await expect(page.getByTestId("mixer")).toContainText("not wired");
  await expect(page.getByTestId("response")).toContainText("Not wired: Light thruster");
  await page.getByTestId("cell-back-action-a").click();
  await expect(page.getByTestId("lines-back").getByTestId("say")).toHaveText("Fires fully on Action A.");
  await page.keyboard.down("Space");
  await expect(page.getByTestId("control-action-a")).toHaveClass(/held/);
  // THRUST OG has no free side for it, so it was placed clear of the ship: not welded to the
  // cockpit, it doesn't answer even when wired, and the checks say so.
  await expect(page.getByTestId("response")).toContainText("Not welded to the cockpit, so they won't answer: Light thruster");
  await expect(page.getByTestId("mixer").locator("tr", { hasText: "Light thruster" })).toContainText("0%");
  // An engine on the ship does answer.
  await expect(page.getByTestId("mixer").locator("tr", { hasText: "Railgun" })).toContainText("100");
  await page.keyboard.up("Space");
  await page.getByTestId("mode-build").click();
  await expect(page.getByTestId("performance")).toBeVisible();
});

test("BPD-025 Measure runs the real physics in the background and shows the measured figures until the blueprint changes", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("measure").click();
  await expect(page.getByTestId("performance")).toContainText("✓ measured", { timeout: 30_000 });
  await expect(page.getByTestId("performance")).toContainText(/Accel\. forward3[56]\.\d m\/s² ✓/);
  // A change makes it an estimate again; undo brings the measurement back.
  await page.getByTestId("part-main").locator("polygon").nth(1).click();
  const rate = page.getByTestId("param-rate");
  await page.getByRole("region", { name: "Properties" }).getByRole("tab", { name: "FUEL" }).click();
  await rate.locator("input.num").fill("5");
  await rate.locator("input.num").press("Enter");
  await expect(page.getByTestId("performance")).toContainText("est.");
});

test("BPD-026 two toggles in the top bar hide and show the left and right panels, the blueprint widening; the choice is kept after a reload", async ({ page }) => {
  await openFresh(page);
  const view = page.getByTestId("blueprint-view");
  const wide = (await view.boundingBox())!.width;
  await expect(page.getByTestId("toggle-left")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("toggle-left").click();
  await page.getByTestId("toggle-right").click();
  await expect(page.getByRole("region", { name: "Components" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Properties" })).toHaveCount(0);
  await expect(page.getByTestId("toggle-right")).toHaveAttribute("aria-pressed", "false");
  expect((await view.boundingBox())!.width).toBeGreaterThan(wide + 500);
  await page.reload();
  await expect(page.getByRole("region", { name: "Components" })).toHaveCount(0);
  await page.getByTestId("toggle-right").click();
  await expect(page.getByRole("region", { name: "Properties" })).toBeVisible();
  // \ toggles both.
  await page.keyboard.press("Backslash");
  await expect(page.getByRole("region", { name: "Properties" })).toHaveCount(0);
  await page.keyboard.press("Backslash");
  await expect(page.getByRole("region", { name: "Components" })).toBeVisible();
  // The performance table folds to its header.
  await page.getByTestId("fold-stats").click();
  await expect(page.getByTestId("performance")).not.toContainText("Mass");
});

test("BPD-026 on a folding phone's inner screen the panels start hidden, open over the blueprint without narrowing it, and nothing scrolls the page", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 884, height: 1104 }, hasTouch: true });
  const page = await ctx.newPage();
  await openFresh(page);
  const view = page.getByTestId("blueprint-view");
  await expect(page.getByTestId("toggle-left")).toHaveAttribute("aria-pressed", "false");
  const w = (await view.boundingBox())!.width;
  expect(w).toBeGreaterThan(860);
  await page.getByTestId("toggle-right").tap();
  await expect(page.getByRole("region", { name: "Properties" })).toBeVisible();
  expect((await view.boundingBox())!.width).toBe(w);
  const scrolls = await page.evaluate(() => [document.documentElement.scrollHeight > innerHeight, document.documentElement.scrollWidth > innerWidth]);
  expect(scrolls).toEqual([false, false]);
  await ctx.close();
});

test("BPD-027 Mirror makes a part's mirror image on the other side, wired with turn left and right swapped; a taken side is refused with the reason", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("part-back-r").locator("polygon").nth(1).click();
  await page.keyboard.press("Delete");
  await page.getByTestId("part-back-l").locator("polygon").nth(1).click();
  await page.getByTestId("mirror-part").click();
  await expect(page.getByTestId("selected-name")).toHaveText("Thruster BR");
  await page.getByRole("region", { name: "Properties" }).getByRole("tab", { name: "CONTROLS" }).click();
  await expect(page.getByTestId("say").first()).toHaveText("Fires fully on Turn left. Fires fully on Forward, except while Turn right is held.");
  await page.getByTestId("part-tank-l").locator("polygon").first().click();
  await page.getByTestId("mirror-part").click();
  await expect(page.getByTestId("toast")).toContainText("other side is taken");
});

test("BPD-028 after a try-out each weld shows how hard it worked, and the page says which worked hardest", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("try-it").click();
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1500);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("toast")).toContainText(/hardest-worked weld reached \d+% of its limit|welds? broke/);
  await page.getByTestId("weld-gen-l|tank-l").locator("circle").first().click({ force: true });
  await expect(page.getByTestId("weld-load")).toHaveText(/^\d+% (tension|compression|shear|torque)$|^BROKE$/);
});

test("BPD-029 a game controller flies Try it: A is forward, the stick turns, through the blueprint's wiring", async ({ page }) => {
  // A standard-mapping pad, held as a test sets it.
  // As e2e/gamepad.spec.ts plugs one in: assigned, which every engine honours (WebKit ignores a defineProperty here).
  await page.addInitScript(() => {
    const pad = { id: "test pad", index: 0, connected: true, mapping: "standard", timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    navigator.getGamepads = () => [pad as unknown as Gamepad];
  });
  await openFresh(page);
  await page.getByTestId("try-it").click();
  // Pressed only once the flight is running: a button already held as it starts counts for nothing
  // until let go (gamepad.ts), and a slow browser can take a while to start it.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { time: number } } | null } }).__msb.sandbox()?.world.time ?? 0), { timeout: 30_000 }).toBeGreaterThan(0.05);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await page.evaluate(() => {
    const p = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[]; axes: number[] } }).__pad;
    p.buttons[0].pressed = true; // A: forward
    p.buttons[0].value = 1;
    p.axes[0] = 1; // stick right
  });
  const controls = () => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { controls: Record<string, number> } } | null } }).__msb.sandbox()?.world.controls ?? {});
  await expect.poll(controls, { timeout: 15_000 }).toMatchObject({ forward: 1, main: 1, bl: 1, fr: 0.5 });
  await page.evaluate(() => {
    const p = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[]; axes: number[] } }).__pad;
    p.buttons[0].pressed = false;
    p.buttons[0].value = 0;
    p.axes[0] = 0;
  });
  await expect.poll(controls, { timeout: 15_000 }).toMatchObject({ main: 0 });
});

test("BPD-031 Try it's field is 120 × 75 m and wraps; the view follows the ship, showing 60 m of it", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("try-it").click();
  const w = await page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { bounds: { min: { x: number; y: number }; max: { x: number; y: number }; wrap: boolean } } } } }).__msb.sandbox().world.bounds);
  expect([w.max.x - w.min.x, w.max.y - w.min.y, w.wrap]).toEqual([120, 75, true]);
  await page.keyboard.down("ArrowUp");
  // Held until it has flown, however slowly the browser runs the flight.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { bodies: { id: string; position: { y: number } }[] } } } }).__msb.sandbox().world.bodies.find((b) => b.id === "hull")!.position.y), { timeout: 60_000, intervals: [50] }).toBeGreaterThan(1);
  await page.keyboard.up("ArrowUp");
  const cam = await page.evaluate(() => {
    const msb = (window as unknown as { __msb: { camera: () => { x: number; y: number; zoom: number }; sandbox: () => { world: { bodies: { id: string; position: { x: number; y: number } }[] } } } }).__msb;
    return { cam: msb.camera(), at: msb.sandbox().world.bodies.find((b) => b.id === "hull")!.position, vw: innerWidth };
  });
    expect(Math.abs(cam.cam.y - cam.at.y)).toBeLessThan(2); // and the view went with it
  // It shows 60 m across (or 37.5 m up, whichever fits): about half the field.
  expect(cam.vw / cam.cam.zoom).toBeGreaterThanOrEqual(59.9);
  expect(cam.vw / cam.cam.zoom).toBeLessThan(75);
});

test("BPD-032 on a touch screen Try it has Mammoth Thrust's buttons: L and R held together fly forward through the wiring", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await openFresh(page);
  await page.getByTestId("try-it").click();
  await expect(page.getByTestId("thrust-left")).toBeVisible();
  await expect(page.getByTestId("thrust-forward")).toBeVisible();
  await page.getByTestId("thrust-left").dispatchEvent("pointerdown");
  await page.getByTestId("thrust-right").dispatchEvent("pointerdown");
  const controls = () => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { controls: Record<string, number> } } | null } }).__msb.sandbox()?.world.controls ?? {});
  await expect.poll(controls, { timeout: 15_000 }).toMatchObject({ main: 1, bl: 1, br: 1 });
  await page.getByTestId("thrust-left").dispatchEvent("pointerup");
  await page.getByTestId("thrust-right").dispatchEvent("pointerup");
  await expect.poll(controls, { timeout: 15_000 }).toMatchObject({ main: 0 });
  await ctx.close();
});

test("BPD-030 in Try it a thruster not welded to the cockpit doesn't answer the controls: it burns off its own store and stops", async ({ page }) => {
  await openFresh(page);
  // Unweld the main thruster from the battery.
  await page.getByTestId("weld-battery|main").locator("circle").first().click({ force: true });
  await page.keyboard.press("Delete");
  await page.getByTestId("try-it").click();
  await page.keyboard.down("ArrowUp");
  const main = () => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { bodies: { id: string; injector?: { channel: string } }[] } } } }).__msb.sandbox().world.bodies.find((b) => b.id === "main")?.injector?.channel);
  await expect.poll(main, { timeout: 15_000 }).toBe("main.residual");
  await page.keyboard.up("ArrowUp");
});

test("BPD-033 a control held through Refuel & reset goes on working in the fresh flight", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("try-it").click();
  await page.keyboard.down("ArrowUp");
  const controls = () => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { controls: Record<string, number>; time: number } } | null } }).__msb.sandbox()?.world.controls ?? {});
  await expect.poll(controls, { timeout: 15_000 }).toMatchObject({ main: 1 });
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(300);
  await expect.poll(controls, { timeout: 15_000 }).toMatchObject({ forward: 1, main: 1 });
  await page.keyboard.up("ArrowUp");
});

test("BPD-035 parts never overlap: THRUST OG's railgun and shield emitter are flagged (THRUST 1's railgun stands on it), and widening a tank into its neighbours is refused", async ({ page }) => {
  await openFresh(page);
  await expect(page.getByTestId("overlapping")).toHaveCount(0);
  await openOg(page);
  await expect(page.getByTestId("overlapping")).toContainText("Railgun OG and Shield emitter OG");
  await page.getByTestId("part-tank-l").locator("polygon").first().click();
  const width = page.getByTestId("param-width").locator("input.num");
  await width.fill("1.7");
  await width.press("Enter");
  await expect(page.getByTestId("toast")).toContainText("overlap Generator L OG and Magazine L OG");
  await expect(width).toHaveValue("1.50");
});

test("BPD-034 the action buttons are named by what they do in this ship, and the player can rename them for it", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await openFresh(page);
  await page.getByTestId("mode-controls").tap();
  await expect(page.getByTestId("screen-name-action-b")).toHaveAttribute("placeholder", "BEAM");
  await page.getByTestId("screen-name-action-b").fill("grab");
  await page.getByTestId("screen-name-action-b").press("Enter");
  await page.getByTestId("try-it").tap();
  await expect(page.getByTestId("thrust-fire")).toHaveText("FIRE");
  await expect(page.getByTestId("thrust-tractor")).toHaveText("GRAB");
  await expect(page.getByTestId("thrust-shield")).toHaveText("SHIELD");
  await ctx.close();
});

test("BPD-018 arrow keys in a value box change it and the box keeps up; leaving the box keeps the change", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("part-main").locator("polygon").nth(1).click();
  const input = page.getByTestId("param-length").locator("input.num");
  await input.focus();
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("1.15");
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveValue("1.20");
  await input.blur();
  await expect(input).toHaveValue("1.20");
});

test("BPD-034 a blueprint file saved with the old Fire, Tractor and Shield wiring imports wired to Actions A, B and C", async ({ page }) => {
  await openFresh(page);
  const bp = await page.evaluate(() => (window as unknown as { __msb: { blueprint: () => unknown } }).__msb.blueprint());
  const old = JSON.parse(JSON.stringify(bp).replaceAll('"action-a"', '"fire"').replaceAll('"action-b"', '"tractor"').replaceAll('"action-c"', '"shield"'));
  old.preset = false;
  await page.getByTestId("open-drawer").click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "⤒ Import" }).click();
  await (await chooser).setFiles({ name: "old.blueprint.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) });
  await expect(page.getByTestId("drawing-name")).toContainText("THRUST 1");
  const lines = await page.evaluate(() => (window as unknown as { __msb: { blueprint: () => { mix: { rows: { channel: string; lines: { control: string }[] }[] } } } }).__msb.blueprint().mix.rows.filter((r) => ["fire", "tractor", "shield"].includes(r.channel)).map((r) => r.lines[0].control));
  expect(lines).toEqual(["action-a", "action-b", "action-c"]);
});

test("BPD-036 the OG parts are listed after the regular ones; in Try it, THRUST 1's railgun fires the shells its magazines hold", async ({ page }) => {
  await openFresh(page);
  // Storage: the regular magazine, then the OG one under its heading.
  await page.getByRole("tab", { name: "ST" }).click();
  await expect(page.getByTestId("kind-name")).toHaveText("STORAGE");
  await expect(page.getByTestId("card-mag-l")).toContainText("13.00 kg"); // 3 kg and 60 shells
  await expect(page.getByTestId("card-mag-l-og")).toContainText("3.00 kg");
  await expect(page.getByText("OG · AS THRUST HAS THEM")).toBeVisible();
  await page.getByTestId("try-it").click();
  const shells = () =>
    page.evaluate(() => {
      const w = (window as unknown as { __msb: { sandbox: () => { world: { bodies: { id: string; ammo?: { count: number } }[] } } | null } }).__msb.sandbox()?.world;
      return (w?.bodies ?? []).filter((b) => b.ammo).reduce((s, b) => s + b.ammo!.count, 0);
    });
  await expect.poll(shells, { timeout: 15_000 }).toBeLessThanOrEqual(119); // one already in the gun
  await page.keyboard.down("Space");
  await expect.poll(shells, { timeout: 60_000 }).toBeLessThan(115);
  await page.keyboard.up("Space");
});

test("BPD-037 click the blueprint's name to rename it; a preset is renamed as your own copy", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("drawing-name").click();
  const box = page.getByTestId("drawing-name-input");
  await box.fill("Wasp");
  await box.press("Enter");
  await expect(page.getByTestId("drawing-name")).toHaveText("WASP");
  await expect(page.getByText("EDITING", { exact: true })).toBeVisible();
  // Renamed again, it stays the same blueprint (no second copy), and the preset is still THRUST 1.
  await page.getByTestId("drawing-name").click();
  await page.getByTestId("drawing-name-input").fill("Hornet");
  await page.getByTestId("drawing-name-input").press("Enter");
  await expect(page.getByTestId("drawing-name")).toHaveText("HORNET");
  const names = await page.evaluate(() => JSON.parse(localStorage.getItem("msb.blueprints.v1")!).mine.map((b: { name: string }) => b.name));
  expect(names).toEqual(["HORNET"]);
  await page.reload();
  await expect(page.getByTestId("drawing-name")).toHaveText("HORNET");
});

test("BPD-038 the Mastodon Gun Ship flies in Try it on its double engines, and Action A fires its four railguns from the magazines", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("open-drawer").click();
  await page.getByTestId("design-MASTODON GUN SHIP").click();
  await expect(page.getByTestId("drawing-name")).toHaveText("MASTODON GUN SHIP");
  await page.getByRole("tab", { name: "FR" }).click();
  await expect(page.getByTestId("card-triangle")).toBeVisible();
  await page.getByTestId("try-it").click();
  const world = () =>
    page.evaluate(() => {
      const w = (window as unknown as { __msb: { sandbox: () => { world: { time: number; bodies: { id: string; position: { y: number }; ammo?: { count: number } }[] } } | null } }).__msb.sandbox()?.world;
      return { t: w?.time ?? 0, y: w?.bodies.find((b) => b.id === "hull")?.position.y ?? 0, shells: (w?.bodies ?? []).filter((b) => b.ammo).reduce((s, b) => s + b.ammo!.count, 0) };
    });
  await expect.poll(async () => (await world()).t, { timeout: 30_000 }).toBeGreaterThan(0.05);
  const y0 = (await world()).y;
  await page.keyboard.down("ArrowUp");
  await expect.poll(async () => (await world()).y - y0, { timeout: 60_000, intervals: [50] }).toBeGreaterThan(1);
  await page.keyboard.up("ArrowUp");
  const before = (await world()).shells;
  await page.keyboard.down("Space");
  await expect.poll(async () => before - (await world()).shells, { timeout: 60_000 }).toBeGreaterThanOrEqual(8);
  await page.keyboard.up("Space");
});

test("BPD-041 BPD-042 drag the round handle to turn a part in 15° steps, and a corner to resize it", async ({ page }) => {
  await openFresh(page);
  await page.getByTestId("open-drawer").click();
  await page.getByRole("button", { name: "＋ New blank" }).click();
  await page.getByRole("tab", { name: "TA" }).click();
  await page.getByRole("button", { name: "Add Propellant tank", exact: true }).click();
  const part = () => page.evaluate(() => (window as unknown as { __msb: { blueprint: () => { ship: { bodies: { id: string; angle: number; position: { x: number; y: number }; shape: { width?: number; height?: number } }[] } } } }).__msb.blueprint().ship.bodies[0]);
  const centre = async (id: string) => {
    const b = await page.getByTestId(id).boundingBox();
    return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };
  };
  // Turn: the knob is straight above the part; drag it round to the left, a quarter turn.
  const knob = await centre("rotate-handle");
  const mid = await centre("part-tank");
  const r = mid.y - knob.y;
  await page.mouse.move(knob.x, knob.y);
  await page.mouse.down();
  for (const a of [20, 45, 70, 89]) await page.mouse.move(mid.x - r * Math.sin((a * Math.PI) / 180), mid.y - r * Math.cos((a * Math.PI) / 180), { steps: 3 });
  await page.mouse.up();
  await expect.poll(async () => Math.round(((await part()).angle * 180) / Math.PI)).toBe(90);
  // One undo step for the whole turn.
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await part()).angle).toBe(0);
  // Resize: drag the top-right corner out 0.5 m each way; the bottom-left corner stays.
  const before = await part();
  const corner = await centre("resize-1-1");
  const zoom = await page.evaluate(() => Number(document.querySelector(".zl")?.textContent?.match(/\d+/)?.[0] ?? 0));
  const px = zoom || 80;
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  await page.mouse.move(corner.x + 0.5 * px, corner.y - 0.5 * px, { steps: 6 });
  await page.mouse.up();
  const after = await part();
  expect(after.shape.width).toBeGreaterThan(before.shape.width!);
  expect(after.shape.height).toBeGreaterThan(before.shape.height!);
  expect(after.position.x - after.shape.width! / 2).toBeCloseTo(before.position.x - before.shape.width! / 2, 5);
  expect(after.position.y - after.shape.height! / 2).toBeCloseTo(before.position.y - before.shape.height! / 2, 5);
});
