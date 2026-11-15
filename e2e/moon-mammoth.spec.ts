// Moon Mammoth's page (docs/games/moon-mammoth.md): the title, play with the keys, the touch buttons
// and a controller, the turning view, pause, a send-back, and the finish. On the small test moon
// (moon.html?level=test: 40 m in radius, flags at 0, 60 and 120 m round), but for the first.
import { expect, test, type Page } from "@playwright/test";
import { shot } from "./helpers.ts";

interface State {
  phase: string;
  flag: number;
  left: number;
  elapsed: number;
  tries: number;
  facing: number;
  action: string;
  ducked: boolean;
  back?: { why: string };
}
interface Hook {
  sandbox: () => { world: { time: number; controls: Record<string, number> } };
  moon: () => State | null;
  mammoth: () => { position: { x: number; y: number }; velocity: { x: number; y: number }; shape: { radius: number } };
  camera: () => { x: number; y: number; zoom: number };
  turn: () => number;
  edit: (commands: unknown[]) => boolean;
}
const hook = <T,>(page: Page, f: (m: Hook) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__msb)`) as Promise<T>;
const R = 40;
const start = async (page: Page, level = "?level=test") => {
  await page.goto(`./moon.html${level}`);
  await page.getByTestId("mmn-start").click();
  await expect(page.getByTestId("mmn-hud")).toBeVisible();
};
/** How far round the moon the mammoth is, m clockwise from the top, and how high over the smooth surface. */
const along = (page: Page) => hook(page, (m) => 40 * Math.atan2(m.mammoth().position.x, m.mammoth().position.y));
const alt = (page: Page) => hook(page, (m) => Math.hypot(m.mammoth().position.x, m.mammoth().position.y) - 40);
/** Puts the mammoth standing at s m round, at rest: running there is the game, not the test. */
const place = (page: Page, s: number) =>
  page.evaluate(([s, r]) => (window as unknown as { __msb: Hook }).__msb.edit([{ type: "body.set", id: "mammoth", patch: { position: { x: r * Math.sin(s / 40), y: r * Math.cos(s / 40) }, velocity: { x: 0, y: 0 } } }]), [s, R + 1.02] as const);
const hold = (page: Page, id: string, on: boolean) => page.getByTestId(id).dispatchEvent(on ? "pointerdown" : "pointerup", { pointerId: 1, bubbles: true });

test("MMN-001 Moon Mammoth: the title, Play, and the mammoth on the moon with nothing that leads to the sandbox", async ({ page }, info) => {
  await page.goto("./moon.html");
  await expect(page.getByTestId("mmn-title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "MOON MAMMOTH" })).toBeVisible();
  await shot(page, info, "mmn-title");
  await page.getByTestId("mmn-start").click();
  await expect(page.getByTestId("mmn-hud")).toBeVisible();
  await expect(page.getByTestId("mmn-flag")).toHaveText("FLAG 0/6");
  await expect(page.getByTestId("mmn-ready")).toBeVisible();
  await expect(page.locator("a")).toHaveCount(0);
  expect(await hook(page, (m) => m.moon()!.phase)).toBe("waiting");
  await shot(page, info, "mmn-play");
});

test("MMN-070 MMN-056 MMN-060 the keys run, jump, duck and roll; the clock starts at the first move; the view turns with the mammoth", async ({ page }) => {
  await start(page);
  await place(page, -60);
  expect(await hook(page, (m) => m.moon()!.elapsed)).toBe(0);
  await page.keyboard.down("ArrowLeft");
  await expect.poll(() => along(page)).toBeLessThan(-66);
  expect(await hook(page, (m) => m.moon()!.phase)).toBe("running");
  expect(await hook(page, (m) => m.moon()!.facing)).toBe(-1);
  await expect(page.getByTestId("mmn-ready")).toHaveCount(0);
  // The drawing is turned by the mammoth's place round the moon, and the view looks along that line.
  const view = await hook(page, (m) => ({ turn: m.turn(), at: Math.atan2(m.mammoth().position.x, m.mammoth().position.y), cam: Math.atan2(m.camera().x, m.camera().y) }));
  expect(view.turn).toBeCloseTo(view.at, 6);
  expect(Math.abs(view.cam - view.at)).toBeLessThan(0.05);
  await page.keyboard.up("ArrowLeft");
  await page.keyboard.down("Space");
  await expect.poll(() => alt(page)).toBeGreaterThan(2.5);
  await page.keyboard.up("Space");
  await expect.poll(() => alt(page)).toBeLessThan(1.1);
  await page.keyboard.down("ArrowDown");
  await expect.poll(() => hook(page, (m) => m.mammoth().shape.radius)).toBe(0.6);
  await expect.poll(() => hook(page, (m) => m.moon()!.action)).toBe("sit");
  await page.keyboard.up("ArrowDown");
  await expect.poll(() => hook(page, (m) => m.mammoth().shape.radius)).toBe(1);
  await page.keyboard.down("ShiftLeft");
  await expect.poll(() => hook(page, (m) => m.moon()!.action)).toBe("roll");
  await page.keyboard.up("ShiftLeft");
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.roll)).toBe(0);
});

test("MMN-070 the touch buttons run, jump, duck and roll", async ({ page }) => {
  await start(page);
  await place(page, -60);
  await hold(page, "mmn-right", true);
  await expect.poll(() => along(page)).toBeGreaterThan(-56);
  await hold(page, "mmn-right", false);
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.right)).toBe(0);
  await hold(page, "mmn-jump", true);
  await expect.poll(() => alt(page)).toBeGreaterThan(2.5);
  await hold(page, "mmn-jump", false);
  await expect.poll(() => alt(page)).toBeLessThan(1.1);
  await hold(page, "mmn-duck", true);
  await expect.poll(() => hook(page, (m) => m.moon()!.ducked)).toBe(true);
  await hold(page, "mmn-duck", false);
  await expect.poll(() => hook(page, (m) => m.moon()!.ducked)).toBe(false);
  await hold(page, "mmn-roll", true);
  await expect.poll(() => hook(page, (m) => m.moon()!.action)).toBe("roll");
  await hold(page, "mmn-roll", false);
});

test("MMN-070 a controller: the stick runs, A jumps, B ducks, X rolls, Start pauses", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    navigator.getGamepads = () => [pad as unknown as Gamepad];
  });
  const button = (i: number, on: boolean) =>
    page.evaluate(([k, v]) => {
      const b = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad.buttons[k as number];
      b.pressed = v as boolean;
      b.value = v ? 1 : 0;
    }, [i, on] as const);
  const stick = (x: number) => page.evaluate((v) => void ((window as unknown as { __pad: { axes: number[] } }).__pad.axes[0] = v), x);
  const control = (name: string) => hook(page, (m) => m.sandbox().world.controls) .then((c) => c[name] ?? 0);
  await start(page);
  await place(page, -60);
  await stick(1);
  await expect.poll(() => control("right")).toBe(1);
  await stick(0);
  await expect.poll(() => control("right")).toBe(0);
  for (const [i, name] of [[0, "jump"], [1, "duck"], [2, "roll"]] as const) {
    await button(i, true);
    await expect.poll(() => control(name)).toBe(1);
    await button(i, false);
    await expect.poll(() => control(name)).toBe(0);
  }
  await button(9, true);
  await expect(page.getByTestId("mmn-paused")).toBeVisible();
  await button(9, false);
});

test("MMN-071 pause stops the world and the clocks; resume carries on", async ({ page }) => {
  await start(page);
  await place(page, -60);
  await page.keyboard.down("ArrowLeft");
  await expect.poll(() => hook(page, (m) => m.moon()!.elapsed)).toBeGreaterThan(0.2);
  await page.keyboard.up("ArrowLeft");
  await page.getByTestId("mmn-pause").click();
  await expect(page.getByTestId("mmn-paused")).toBeVisible();
  const at = await hook(page, (m) => ({ t: m.sandbox().world.time, e: m.moon()!.elapsed }));
  await page.waitForTimeout(300);
  expect(await hook(page, (m) => ({ t: m.sandbox().world.time, e: m.moon()!.elapsed }))).toEqual(at);
  await page.getByTestId("mmn-resume").click();
  await expect.poll(() => hook(page, (m) => m.sandbox().world.time)).toBeGreaterThan(at.t);
});

test("MMN-052 MMN-051 on the spikes the mammoth is back at the last flag, with a note; out of time the same", async ({ page }, info) => {
  await start(page);
  await place(page, 58);
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => hook(page, (m) => m.moon()!.flag)).toBe(1);
  // On along the ground into the crater's spikes (78 to 82 m).
  await expect.poll(() => hook(page, (m) => m.moon()!.tries)).toBe(1);
  await page.keyboard.up("ArrowRight");
  // Back at the flag at 60 m: on the near side of the crater (its rim is at 73 m), however far it
  // had run on from the flag before the key came up.
  const at = await along(page);
  expect(at).toBeGreaterThan(59);
  expect(at).toBeLessThan(73);
  await expect(page.getByTestId("mmn-back")).toContainText("OUCH");
  await shot(page, info, "mmn-back");
  expect(await hook(page, (m) => m.moon()!.back!.why)).toBe("spikes");
  await expect(page.getByTestId("mmn-tries")).toHaveText("TRIES 1");
  // Standing still, the leg's 16 s (as the player sees them) run out.
  await expect.poll(() => hook(page, (m) => m.moon()!.tries), { timeout: 30_000 }).toBe(2);
  expect(await hook(page, (m) => m.moon()!.back!.why)).toBe("time");
});

test("MMN-050 MMN-055 flags in order to the finish: the lap's time, kept as the best on the device, and Play again", async ({ page }, info) => {
  await start(page);
  await place(page, 58);
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => hook(page, (m) => m.moon()!.flag)).toBe(1);
  await expect(page.getByTestId("mmn-flag")).toHaveText("FLAG 1/2");
  await page.keyboard.up("ArrowRight");
  await place(page, 117);
  await page.keyboard.down("ArrowRight");
  await expect(page.getByTestId("mmn-won")).toBeVisible();
  await page.keyboard.up("ArrowRight");
  await shot(page, info, "mmn-won");
  expect(await hook(page, (m) => m.moon()!.phase)).toBe("won");
  const time = await page.getByTestId("mmn-won-time").textContent();
  expect(Number(time)).toBeGreaterThan(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("moon-mammoth-best")!)["moon-test"])).toBeGreaterThan(0);
  await page.getByTestId("mmn-again").click();
  await expect(page.getByTestId("mmn-ready")).toBeVisible();
  expect(await hook(page, (m) => m.moon()!.flag)).toBe(0);
  // The title shows the best.
  await page.getByTestId("mmn-pause").click();
  await page.getByTestId("mmn-quit").click();
  await expect(page.getByTestId("mmn-best")).toContainText(time!);
});
