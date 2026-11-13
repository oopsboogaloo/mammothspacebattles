// A game controller in the three games (src/app/gamepad.ts), with a pad the test holds.
import { expect, test, type Page } from "@playwright/test";

interface World {
  controls: Record<string, number>;
  bodies: { id: string; tractor?: { mode: string } }[];
}
const world = <T,>(page: Page, f: (w: World) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__msb.sandbox().world)`) as Promise<T>;

/** Gives the page one controller, with nothing held. */
const plugIn = (page: Page) =>
  page.addInitScript(() => {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    navigator.getGamepads = () => [pad as unknown as Gamepad];
  });
const A = 0, B = 1, X = 2, Y = 3, LB = 4, RT = 7, START = 9, DOWN = 13;
const button = (page: Page, i: number, on: boolean) =>
  page.evaluate(([k, v]) => {
    const b = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad.buttons[k as number];
    b.pressed = v as boolean;
    b.value = v ? 1 : 0;
  }, [i, on] as const);
const stick = (page: Page, x: number) => page.evaluate((v) => void ((window as unknown as { __pad: { axes: number[] } }).__pad.axes[0] = v), x);
/** Waits until the page has drawn two more frames: the pad has been read at least once since. */
const frames = (page: Page) => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
/** A press and release, each seen by at least one frame however slow the browser is. */
const tap = async (page: Page, i: number) => {
  await button(page, i, true);
  await frames(page);
  await button(page, i, false);
  await frames(page);
};
const engines = (page: Page) => world(page, (w) => ["main", "bl", "br", "fl", "fr"].map((c) => w.controls[c] ?? 0).join(""));

test("PAD-002 Mammoth Thrust with a controller: A starts, then flies; the stick turns; B reverses; X fires; Y is the beam; Start pauses and resumes", async ({ page }) => {
  await plugIn(page);
  await page.goto("./thrust.html");
  await expect(page.getByTestId("mth-start")).toBeVisible();
  // A on the title is Play. Still held as the game starts, it does nothing until let go.
  await button(page, A, true);
  await expect(page.getByTestId("mth-hud")).toBeVisible();
  await frames(page);
  await frames(page);
  expect(await engines(page)).toBe("00000");
  await button(page, A, false);
  await frames(page);
  await button(page, A, true);
  await expect.poll(() => engines(page)).toBe("11100");
  await button(page, A, false);
  await expect.poll(() => engines(page)).toBe("00000");
  await button(page, RT, true);
  await expect.poll(() => engines(page)).toBe("11100");
  await button(page, RT, false);
  await stick(page, -1);
  await expect.poll(() => engines(page)).not.toBe("00000");
  const left = await engines(page);
  await stick(page, 1);
  await expect.poll(() => engines(page)).not.toBe(left);
  await stick(page, 0);
  await expect.poll(() => engines(page)).toBe("00000");
  await button(page, B, true);
  await expect.poll(() => engines(page)).toBe("00011");
  await button(page, B, false);
  await button(page, X, true);
  await expect.poll(() => world(page, (w) => w.controls.fire ?? 0)).toBe(1);
  await button(page, X, false);
  await expect.poll(() => world(page, (w) => w.controls.fire ?? 0)).toBe(0);
  for (const k of [Y, LB]) {
    await button(page, k, true);
    await expect.poll(() => world(page, (w) => w.bodies.find((b) => b.id === "p1-hull")?.tractor?.mode)).toBe("beam");
    await button(page, k, false);
    await expect.poll(() => world(page, (w) => w.bodies.find((b) => b.id === "p1-hull")?.tractor?.mode)).toBe("off");
  }
  // Start pauses, with whatever was held let go; in the menu the D-pad chooses and Start resumes.
  await button(page, RT, true);
  await expect.poll(() => engines(page)).toBe("11100");
  await tap(page, START);
  await expect(page.getByTestId("mth-paused")).toBeVisible();
  await tap(page, DOWN);
  await expect(page.getByTestId("mth-resume")).toBeFocused();
  await tap(page, DOWN);
  await expect(page.getByTestId("swap-sides")).toBeFocused();
  await tap(page, START);
  await expect(page.getByTestId("mth-paused")).toHaveCount(0);
  // Still held from before the pause, the trigger does nothing until it is let go and pulled again.
  await expect.poll(() => engines(page)).toBe("00000");
  await button(page, RT, false);
  await frames(page);
  await button(page, RT, true);
  await expect.poll(() => engines(page)).toBe("11100");
  await button(page, RT, false);
});

test("PAD-002 Mammoth Asteroids with a controller: A starts and flies, X fires, and the menu's Quit is chosen with the D-pad and A", async ({ page }) => {
  await plugIn(page);
  await page.goto("./asteroids.html?seed=1");
  await expect(page.getByTestId("mas-start")).toBeVisible();
  await tap(page, A);
  await expect(page.getByTestId("mas-hud")).toBeVisible();
  await button(page, A, true);
  await expect.poll(() => engines(page)).toBe("11100");
  await button(page, A, false);
  await expect.poll(() => engines(page)).toBe("00000");
  await button(page, X, true);
  await expect.poll(() => world(page, (w) => w.controls.fire ?? 0)).toBe(1);
  await button(page, X, false);
  await tap(page, START);
  await expect(page.getByTestId("mas-paused")).toBeVisible();
  for (let i = 0; i < 3; i++) await tap(page, DOWN);
  await expect(page.getByTestId("mas-quit")).toBeFocused();
  await tap(page, A);
  await expect(page.getByTestId("mas-title")).toBeVisible();
});

test("PAD-002 Lander with a controller: A opens the missions; a trigger or bumper is one engine and A both; Start pauses", async ({ page }) => {
  await plugIn(page);
  await page.goto("./?game=lander");
  await expect(page.getByTestId("lander-title")).toBeVisible();
  await tap(page, A);
  await expect(page.getByTestId("lander-select")).toBeVisible();
  await page.getByTestId("lander-pick-lander-easy").click();
  await expect(page.getByTestId("lander-hud")).toBeVisible();
  const controls = () => world(page, (w) => `${w.controls.left ?? 0},${w.controls.right ?? 0}`);
  // A left control is the right engine (LND-035).
  await button(page, LB, true);
  await expect.poll(controls).toBe("0,1");
  await button(page, LB, false);
  await button(page, RT, true);
  await expect.poll(controls).toBe("1,0");
  await button(page, RT, false);
  await stick(page, -1);
  await expect.poll(controls).toBe("0,1");
  await stick(page, 0);
  await button(page, A, true);
  await expect.poll(controls).toBe("1,1");
  await button(page, A, false);
  await expect.poll(controls).toBe("0,0");
  await tap(page, START);
  await expect(page.getByText("Paused")).toBeVisible();
  await tap(page, START);
  await expect(page.getByText("Paused")).toHaveCount(0);
});

test("PAD-003 Mammoth Thrust with a controller: the right trigger half pulled is half thrust, and the stick a little to the side while going forward turns gently", async ({ page }) => {
  await plugIn(page);
  await page.goto("./thrust.html");
  await page.getByTestId("mth-start").click();
  await expect(page.getByTestId("mth-hud")).toBeVisible();
  const engines = () => world(page, (w) => ["main", "bl", "br", "fl", "fr"].map((c) => +(w.controls[c] ?? 0).toFixed(2)).join(" "));
  await page.evaluate(() => {
    const b = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad.buttons[7];
    b.value = 0.5;
  });
  await expect.poll(engines).toBe("0.5 0.5 0.5 0 0");
  await page.evaluate(() => {
    const p = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[]; axes: number[] } }).__pad;
    p.buttons[7].value = 1;
    p.buttons[7].pressed = true;
    p.axes[0] = 0.15 + 0.85 * 0.4; // 40% of the way past the dead zone, to the right
  });
  await expect.poll(engines).toBe("1 1 0.6 0 0.2");
  await page.evaluate(() => {
    const p = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[]; axes: number[] } }).__pad;
    p.buttons[7].value = 0;
    p.buttons[7].pressed = false;
    p.axes[0] = 0;
  });
  await expect.poll(engines).toBe("0 0 0 0 0");
});
