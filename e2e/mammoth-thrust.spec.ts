import { expect, test, type Page } from "@playwright/test";
import { shot } from "./helpers.ts";

interface Body {
  id: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  integrity: number;
  tractor?: { mode: string };
}
interface Hook {
  sandbox: () => { world: { time: number; controls: Record<string, number>; bodies: Body[]; thrust: { spec: { start: { x: number; y: number }; top: number } } } };
  thrust: () => { phase: string; lives: number; n: number; score: number; pod: string; stats: { back: number } } | null;
  level: () => number | null;
  camera: () => { x: number; y: number; zoom: number };
  edit: (commands: unknown[]) => boolean;
  shown: () => number;
}
const hook = <T,>(page: Page, f: (m: Hook) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__msb)`) as Promise<T>;
const start = async (page: Page) => {
  await page.goto("./thrust.html");
  await page.getByTestId("mth-start").click();
  await expect(page.getByTestId("mth-hud")).toBeVisible();
};
/** Puts the ship flying 9 m over the pod, at rest: flying there by hand is the game, not the test. */
const overPod = (page: Page) =>
  hook(page, (m) => {
    const w = m.sandbox().world;
    const n = m.thrust()!.n;
    const hull = w.bodies.find((b) => b.id === `p${n}-hull`)!;
    const pod = w.bodies.find((b) => b.id === "pod")!;
    const d = { x: pod.position.x - hull.position.x, y: pod.position.y + 9 - hull.position.y };
    return m.edit(w.bodies.filter((b) => b.id.startsWith(`p${n}-`)).map((b) => ({ type: "body.set", id: b.id, patch: { position: { x: b.position.x + d.x, y: b.position.y + d.y }, velocity: { x: 0, y: 0 } } })));
  });

test("MTH-001 MTH-002 Mammoth Thrust on its own page: the title over a still map, then play with only the level, the HUD and the buttons", async ({ page }) => {
  await page.goto("./thrust.html");
  await expect(page).toHaveTitle("Mammoth Thrust");
  await expect(page.getByRole("heading", { name: "MAMMOTH THRUST" })).toBeVisible();
  const play = page.getByTestId("mth-start");
  await expect(play).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(play).toHaveCSS("border-top-color", "rgb(255, 255, 255)");
  // Nothing leads to the sandbox.
  await expect(page.getByText("sandbox", { exact: false })).toHaveCount(0);
  // The map behind the title is still: nothing happens on it.
  await expect.poll(() => hook(page, (m) => m.thrust()?.phase)).toBe("flying");
  const t0 = await hook(page, (m) => m.sandbox().world.time);
  await page.waitForTimeout(500);
  expect(await hook(page, (m) => m.sandbox().world.time)).toBe(t0);
  await play.click();
  await expect(page.getByTestId("mth-score")).toHaveText("SCORE 0");
  await expect(page.getByTestId("mth-level")).toHaveText("LEVEL 1");
  await expect(page.getByTestId("mth-lives")).toHaveText("▲▲▲");
  await expect(page.getByTestId("mth-pod")).toHaveText("POD ON ITS STAND");
  await expect(page.getByTestId("mth-slugs")).toHaveText("SHELLS 120");
  await expect(page.getByTestId("mth-damage")).toHaveText("DAMAGE 0%");
  for (const b of ["thrust-left", "thrust-right", "thrust-reverse", "thrust-fire", "thrust-tractor", "mth-pause"]) await expect(page.getByTestId(b)).toBeVisible();
  await expect(page.getByTestId("sandbox")).toHaveCount(0);
  // The game is running, and the ship is falling under gravity.
  await expect.poll(() => hook(page, (m) => m.sandbox().world.bodies.find((b) => b.id === "p1-hull")!.velocity.y), { timeout: 15_000 }).toBeLessThan(-1);
});

test("MTH-052 the view follows the ship, 90 m of the level from top to bottom", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await start(page);
  await expect.poll(() => hook(page, (m) => m.camera().zoom)).toBe(8);
  await page.keyboard.down("ArrowUp");
  await expect
    .poll(async () => {
      const [c, y, v] = await hook(page, (m) => {
        const h = m.sandbox().world.bodies.find((b) => b.id === "p1-hull")!;
        return [m.camera(), h.position.y, h.velocity.y] as const;
      });
      // Within what the ship moves between the world's last step and the frame drawn.
      return Math.abs(c.y - y) < 2 + Math.abs(v) * 0.2;
    })
    .toBe(true);
  await page.keyboard.up("ArrowUp");
});

test("MTH-021 the keys: ↑ is forward, Space fires slugs, and Z or / works the tractor beam; letting go stops them", async ({ page }) => {
  await start(page);
  await page.keyboard.down("ArrowUp");
  const engines = () => hook(page, (m) => ["main", "bl", "br", "fl", "fr"].map((c) => m.sandbox().world.controls[c] ?? 0).join(""));
  await expect.poll(engines).toBe("11100");
  await page.keyboard.up("ArrowUp");
  await expect.poll(engines).toBe("00000");
  await page.keyboard.down("Space");
  await expect(page.getByTestId("mth-slugs")).not.toHaveText("SHELLS 120", { timeout: 30_000 });
  await page.keyboard.up("Space");
  for (const key of ["z", "/"]) {
    await page.keyboard.down(key);
    await expect.poll(() => hook(page, (m) => m.sandbox().world.bodies.find((b) => b.id === "p1-tractor")?.tractor?.mode)).toBe("beam");
    await page.keyboard.up(key);
    await expect.poll(() => hook(page, (m) => m.sandbox().world.bodies.find((b) => b.id === "p1-tractor")?.tractor?.mode)).toBe("off");
  }
});

test("MTH-021 touch: the beam button works the tractor while held, with a thrust button held at the same time", async ({ page }) => {
  await start(page);
  const beam = page.getByTestId("thrust-tractor");
  await expect(beam).toHaveAccessibleName("Tractor");
  await page.getByTestId("thrust-left").dispatchEvent("pointerdown", { pointerId: 1 });
  await beam.dispatchEvent("pointerdown", { pointerId: 2 });
  await expect.poll(() => hook(page, (m) => [m.sandbox().world.controls.tractor ?? 0, m.sandbox().world.controls.left ?? 0].join())).toBe("1,1");
  await beam.dispatchEvent("pointerup", { pointerId: 2 });
  await page.getByTestId("thrust-left").dispatchEvent("pointerup", { pointerId: 1 });
  await expect.poll(() => hook(page, (m) => [m.sandbox().world.controls.tractor ?? 0, m.sandbox().world.controls.left ?? 0].join())).toBe("0,0");
});

test("MTH-021 MTH-024 the tractor takes the pod on the tether; carried past the top, the level is complete, and level 2 opens with the score and ships carried over", async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  expect(await overPod(page)).toBe(true);
  await page.keyboard.down("z");
  await expect(page.getByTestId("mth-pod")).toHaveText("POD ON THE TETHER", { timeout: 15_000 });
  await page.keyboard.up("z");
  await page.keyboard.down("ArrowUp");
  await expect(page.getByTestId("mth-won")).toBeVisible({ timeout: 60_000 });
  await page.keyboard.up("ArrowUp");
  await expect(page.getByTestId("mth-won")).toContainText("Level 1 complete");
  await expect(page.getByTestId("mth-won")).toContainText("+2000");
  const score = await hook(page, (m) => m.thrust()!.score);
  expect(score).toBeGreaterThan(3000);
  // The world rests while the level's result is up.
  const t0 = await hook(page, (m) => m.sandbox().world.time);
  await page.waitForTimeout(400);
  expect(await hook(page, (m) => m.sandbox().world.time)).toBe(t0);
  await page.getByTestId("mth-next").click();
  await expect(page.getByTestId("mth-level")).toHaveText("LEVEL 2");
  await expect(page.getByTestId("mth-score")).toHaveText(`SCORE ${score}`);
  await expect(page.getByTestId("mth-lives")).toHaveText("▲▲▲");
  await expect(page.getByTestId("mth-pod")).toHaveText("POD ON ITS STAND");
  await expect.poll(() => hook(page, (m) => m.thrust()?.phase)).toBe("flying");
  expect(await hook(page, (m) => m.level())).toBe(2);
});

test("MTH-026 a ship that reaches the top without the pod is put back at the start, and told so; no life is lost", async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  await page.keyboard.down("ArrowUp");
  await expect(page.getByTestId("mth-back")).toBeVisible({ timeout: 60_000 });
  await page.keyboard.up("ArrowUp");
  await expect(page.getByTestId("mth-back")).toContainText("Finish the mission");
  expect(await hook(page, (m) => m.thrust()!.stats.back)).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("mth-lives")).toHaveText("▲▲▲");
  await expect(page.getByTestId("mth-back")).toBeHidden({ timeout: 20_000 });
});

test("MTH-050 self-destruct costs a ship, and three ships lost is game over, with Play again", async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  for (let k = 3; k >= 1; k--) {
    await expect(page.getByTestId("mth-lives")).toHaveText("▲".repeat(k));
    // The next ship beams in 2.5 s after a loss by the game's clock, which a slow machine runs behind.
    await expect.poll(() => hook(page, (m) => m.thrust()?.phase), { timeout: 30_000 }).toBe("flying");
    await page.getByTestId("mth-destruct").click();
    await expect(page.getByTestId("mth-destruct")).toHaveText("Confirm self-destruct");
    await page.getByTestId("mth-destruct").click();
    if (k > 1) await expect(page.getByTestId("mth-lost")).toBeVisible({ timeout: 20_000 });
  }
  await expect(page.getByTestId("mth-over")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mth-over")).toContainText("No ships left");
  await expect(page.getByTestId("thrust-fire")).toHaveCount(0);
  await page.getByTestId("mth-again").click();
  await expect(page.getByTestId("mth-lives")).toHaveText("▲▲▲");
  await expect(page.getByTestId("mth-score")).toHaveText("SCORE 0");
});

test("MTH-002 P and Esc pause; the menu resumes, or quits to the title", async ({ page }) => {
  await start(page);
  await page.keyboard.press("p");
  await expect(page.getByTestId("mth-paused")).toBeVisible();
  const t0 = await hook(page, (m) => m.sandbox().world.time);
  await page.waitForTimeout(300);
  expect(await hook(page, (m) => m.sandbox().world.time)).toBe(t0);
  await page.getByTestId("mth-resume").click();
  await expect(page.getByTestId("mth-paused")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mth-paused")).toBeVisible();
  await page.getByTestId("mth-quit").click();
  await expect(page.getByTestId("mth-title")).toBeVisible();
  await expect(page.getByRole("heading", { name: "MAMMOTH THRUST" })).toBeVisible();
});

test("MTH-001 the sandbox's start screen has a button that opens the game's own page", async ({ page }) => {
  await page.goto("./");
  await page.getByTestId("open-thrust").click();
  await expect(page).toHaveTitle("Mammoth Thrust");
});

test("TST-010 screenshots of Mammoth Thrust: the title, play over the surface, the pod on the tether, and the chamber", async ({ page }, info) => {
  test.setTimeout(120_000);
  for (const [name, size] of [["laptop", { width: 1440, height: 900 }], ["ipad", { width: 1180, height: 820 }]] as const) {
    await page.setViewportSize(size);
    await page.goto("./thrust.html");
    await expect(page.getByRole("heading", { name: "MAMMOTH THRUST" })).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, info, `thrust-title-${name}`);
    await page.getByTestId("mth-start").click();
    await expect(page.getByTestId("mth-hud")).toBeVisible();
    await page.waitForTimeout(600);
    await shot(page, info, `thrust-play-${name}`);
    expect(await overPod(page)).toBe(true);
    await page.keyboard.down("z");
    await expect(page.getByTestId("mth-pod")).toHaveText("POD ON THE TETHER", { timeout: 15_000 });
    await page.keyboard.up("z");
    await shot(page, info, `thrust-tether-${name}`);
  }
});
