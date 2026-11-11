import { expect, test, type Page } from "@playwright/test";

interface Hook {
  sandbox: () => { world: { controls: Record<string, number>; bounds: { min: { x: number; y: number }; max: { x: number; y: number } }; bodies: { id: string; integrity: number }[]; arcade: { state: { lives: number; score: number } } } };
  arcade: () => { phase: string; level: number; lives: number; score: number; stats: { shots: number }; gold: { total: number } } | null;
  toPage: (x: number, y: number) => { x: number; y: number };
}
const hook = <T,>(page: Page, f: (m: Hook) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__msb)`) as Promise<T>;
const start = async (page: Page, query = "?seed=1") => {
  await page.goto(`./asteroids.html${query}`);
  await page.getByTestId("mas-start").click();
  await expect(page.getByTestId("mas-hud")).toBeVisible();
};

test("MAS-001 MAS-002 MAS-008 Mammoth Asteroids on its own page: the title, then play with only the arena, the HUD and the buttons", async ({ page }) => {
  await page.goto("./asteroids.html?seed=1");
  await expect(page).toHaveTitle("Mammoth Asteroids");
  await expect(page.getByRole("heading", { name: "MAMMOTH ASTEROIDS" })).toBeVisible();
  // Black buttons with a white border and white text, square corners (MAS-006).
  const play = page.getByTestId("mas-start");
  await expect(play).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(play).toHaveCSS("border-top-color", "rgb(255, 255, 255)");
  await expect(play).toHaveCSS("border-top-width", "2px");
  await expect(play).toHaveCSS("border-radius", "0px");
  await expect(play).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.getByRole("button", { name: "High scores" })).toBeVisible();
  // Nothing leads to the sandbox.
  await expect(page.getByText("sandbox", { exact: false })).toHaveCount(0);
  await play.click();
  await expect(page.getByTestId("mas-score")).toHaveText("SCORE 0");
  await expect(page.getByTestId("mas-level")).toHaveText("LEVEL 1");
  await expect(page.getByTestId("mas-lives")).toHaveText("▲▲▲");
  await expect(page.getByTestId("mas-gold")).toHaveText(/GOLD [23] \/ [23]/);
  await expect(page.getByTestId("mas-slugs")).toHaveText("SHELLS 120");
  await expect(page.getByTestId("mas-damage")).toHaveText("DAMAGE 0%");
  for (const b of ["thrust-left", "thrust-right", "thrust-fire", "mas-pause"]) await expect(page.getByTestId(b)).toBeVisible();
  // No sandbox panels or tools, and none of the view's own overlays.
  await expect(page.getByTestId("sandbox")).toHaveCount(0);
  await expect(page.getByText("Keys", { exact: true })).toBeHidden();
  // The game is running.
  await expect.poll(() => hook(page, (m) => m.arcade()?.phase)).toBe("playing");
});

test("MAS-010 the arena is the whole view: the screen's shape, 160 m high, its corners at the view's corners", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await start(page);
  const b = await hook(page, (m) => m.sandbox().world.bounds);
  expect(b.max.y - b.min.y).toBe(160);
  expect(b.max.x - b.min.x).toBeCloseTo(160 * (1280 / 720), 6);
  await expect
    .poll(async () => {
      const c = await hook(page, (m) => {
        const w = m.sandbox().world.bounds;
        return [m.toPage(w.min.x, w.max.y), m.toPage(w.max.x, w.min.y)];
      });
      return Math.max(Math.abs(c[0].x), Math.abs(c[0].y), Math.abs(c[1].x - 1280), Math.abs(c[1].y - 720));
    })
    .toBeLessThan(1.5);
});

test("MAS-052 the keys: Space fires shells, ↑ is forward (the main thruster), S is reverse (the front thrusters), and letting go stops them", async ({ page }) => {
  await start(page);
  await page.keyboard.down("Space");
  await expect.poll(() => hook(page, (m) => m.arcade()!.stats.shots), { timeout: 10_000 }).toBeGreaterThan(1);
  await page.keyboard.up("Space");
  await expect(page.getByTestId("mas-slugs")).not.toHaveText("SHELLS 120");
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.fire ?? 0)).toBe(0);
  await page.keyboard.down("ArrowUp");
  await expect.poll(() => hook(page, (m) => [m.sandbox().world.controls.left ?? 0, m.sandbox().world.controls.right ?? 0].join())).toBe("1,1");
  // Forward is the main thruster and both back ones, and no front one (MAS-035).
  const engines = () => hook(page, (m) => ["main", "bl", "br", "fl", "fr"].map((c) => m.sandbox().world.controls[c] ?? 0).join(""));
  await expect.poll(engines).toBe("11100");
  // Q with ↑ still down, then Q up: left stays on for ↑.
  await page.keyboard.down("q");
  await page.keyboard.up("q");
  await page.waitForTimeout(300);
  expect(await hook(page, (m) => m.sandbox().world.controls.left)).toBe(1);
  await page.keyboard.up("ArrowUp");
  await expect.poll(() => hook(page, (m) => [m.sandbox().world.controls.left ?? 0, m.sandbox().world.controls.right ?? 0].join())).toBe("0,0");
  await expect.poll(engines).toBe("00000");
  // E turns right: the back left thruster and the front right one.
  await page.keyboard.down("e");
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.right ?? 0)).toBe(1);
  await expect.poll(engines).toBe("01001");
  await page.keyboard.up("e");
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.right ?? 0)).toBe(0);
  // S and ↓ are reverse: both front thrusters.
  for (const key of ["s", "ArrowDown"]) {
    await page.keyboard.down(key);
    await expect.poll(engines).toBe("00011");
    await page.keyboard.up(key);
    await expect.poll(engines).toBe("00000");
  }
});

test("MAS-052 touch: the fire button fires while held, with a thrust button held at the same time", async ({ page }) => {
  await start(page);
  const fire = page.getByTestId("thrust-fire");
  const left = page.getByTestId("thrust-left");
  await left.dispatchEvent("pointerdown", { pointerId: 1 });
  await fire.dispatchEvent("pointerdown", { pointerId: 2 });
  await expect.poll(() => hook(page, (m) => m.arcade()!.stats.shots), { timeout: 10_000 }).toBeGreaterThan(1);
  expect(await hook(page, (m) => m.sandbox().world.controls.left)).toBe(1);
  await fire.dispatchEvent("pointerup", { pointerId: 2 });
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.fire ?? 0)).toBe(0);
  expect(await hook(page, (m) => m.sandbox().world.controls.left)).toBe(1); // still held
  await left.dispatchEvent("pointerup", { pointerId: 1 });
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.left ?? 0)).toBe(0);
  // The reverse button.
  const reverse = page.getByTestId("thrust-reverse");
  await expect(reverse).toHaveText("REV");
  await reverse.dispatchEvent("pointerdown", { pointerId: 3 });
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.reverse ?? 0)).toBe(1);
  await reverse.dispatchEvent("pointerup", { pointerId: 3 });
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.reverse ?? 0)).toBe(0);
});

test("MAS-004 P and Esc pause; the menu resumes, or quits to the title", async ({ page }) => {
  await start(page);
  await page.keyboard.press("p");
  await expect(page.getByTestId("mas-paused")).toBeVisible();
  await page.getByTestId("mas-resume").click();
  await expect(page.getByTestId("mas-paused")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mas-paused")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("mas-paused")).toHaveCount(0);
  await page.getByTestId("mas-pause").click();
  await page.getByTestId("mas-quit").click();
  await expect(page.getByTestId("mas-title")).toBeVisible();
  // And a new game starts from the title.
  await page.getByTestId("mas-start").click();
  await expect(page.getByTestId("mas-score")).toHaveText("SCORE 0");
});

test("MAS-005 game over, initials for a high score, and the table kept through a reload", async ({ page }) => {
  // Stepping on the page (?worker=0), so the test can end the game: one ship left, its hull destroyed.
  await start(page, "?seed=1&worker=0");
  await hook(page, (m) => {
    const w = m.sandbox().world;
    w.arcade.state.lives = 1;
    w.arcade.state.score = 1230;
    w.bodies.find((b) => b.id === "p1-hull")!.integrity = 0;
  });
  await expect(page.getByTestId("mas-over")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("mas-over")).toContainText("Score 1230 · level 1");
  // Initials: B, A, C.
  const next = page.getByRole("button", { name: "Next letter" });
  await next.nth(0).click();
  await next.nth(2).click();
  await next.nth(2).click();
  await page.getByTestId("mas-save").click();
  const mine = page.getByTestId("mas-score-mine");
  await expect(mine).toContainText("BAC");
  await expect(mine).toContainText("1230");
  await expect(mine).toContainText("level 1");
  await page.reload();
  await page.getByTestId("mas-open-scores").click();
  await expect(page.getByTestId("mas-scores")).toContainText("BAC");
  await expect(page.getByTestId("mas-scores")).toContainText("1230");
  await page.getByTestId("mas-scores-back").click();
  await expect(page.getByTestId("mas-title")).toBeVisible();
});

test("MAS-052 the game cancels the browser's pinch zoom", async ({ page }) => {
  await page.goto("./asteroids.html");
  const viewport = () => page.evaluate(() => document.querySelector('meta[name="viewport"]')!.getAttribute("content"));
  await expect.poll(viewport).toContain("maximum-scale=1.0");
  const cancelled = await page.evaluate(() => {
    const e = new Event("gesturestart", { cancelable: true });
    document.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(cancelled).toBe(true);
});

test("MAS-008 the sandbox's start screen has a button that opens the game's own page", async ({ page }) => {
  await page.goto("./");
  const open = page.getByTestId("open-asteroids");
  await expect(open).toHaveText("Play Mammoth Asteroids");
  // It sits with Lander's button and looks like it.
  const lander = page.getByTestId("open-lander");
  for (const prop of ["background-color", "color", "height", "font-size"]) await expect(open).toHaveCSS(prop, await lander.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop));
  await open.click();
  await expect(page).toHaveTitle("Mammoth Asteroids");
  await expect(page.getByTestId("mas-start")).toBeVisible();
});

test("MAS-001 MAS-060 behind the title an AI pilot plays the game for real; Play starts the player's own game", async ({ page }) => {
  await page.goto("./asteroids.html?seed=4");
  await expect(page.getByRole("heading", { name: "MAMMOTH ASTEROIDS" })).toBeVisible();
  for (const b of ["mas-start", "mas-open-howto", "mas-open-physics", "mas-open-scores"]) await expect(page.getByTestId(b)).toBeVisible();
  // The demo: the game running, its ship flown by a Clearing pilot, with no HUD or buttons of the game's.
  const demo = () =>
    page.evaluate(() => {
      const m = (window as unknown as { __msb: { sandbox: () => { world: { time: number; arcade: { spec: { demo?: boolean } }; bodies: { id: string; pilot?: { mode: string } }[] } } | null } }).__msb;
      const w = m.sandbox()?.world;
      return w ? { demo: !!w.arcade.spec.demo, time: w.time, pilot: w.bodies.find((b) => b.pilot)?.pilot?.mode ?? null } : null;
    });
  // CI's WebKit ran this demo at about 16 steps a second (237 steps in 15 s), so the check is that
  // it is running, not how far it has got.
  await expect.poll(async () => (await demo())?.time ?? 0, { timeout: 30_000 }).toBeGreaterThan(0.25);
  expect(await demo()).toMatchObject({ demo: true, pilot: "clearing" });
  await expect(page.getByTestId("mas-hud")).toHaveCount(0);
  await expect(page.getByTestId("thrust-fire")).toHaveCount(0);
  // The keys do nothing to it.
  await page.keyboard.down("Space");
  await page.waitForTimeout(300);
  await page.keyboard.up("Space");
  expect((await demo())!.demo).toBe(true);
  // Play: a new game with no pilot.
  await page.getByTestId("mas-start").click();
  await expect(page.getByTestId("mas-score")).toHaveText("SCORE 0");
  expect(await demo()).toMatchObject({ demo: false, pilot: null });
});

test("MAS-007 How to play and The physics open from the title, each with Back, and the demo carries on after", async ({ page }) => {
  await page.goto("./asteroids.html?seed=4");
  await page.getByTestId("mas-open-howto").click();
  const howto = page.getByTestId("mas-howto");
  await expect(howto.getByRole("heading", { name: "HOW TO PLAY" })).toBeVisible();
  for (const text of ["Collect all the gold", "Space or W", "three ships", "three at the most", "1,000 × N"]) await expect(howto).toContainText(text);
  await page.getByTestId("mas-back").click();
  await expect(page.getByTestId("mas-start")).toBeVisible();
  await page.getByTestId("mas-open-physics").click();
  const physics = page.getByTestId("mas-physics");
  await expect(physics.getByRole("heading", { name: "THE PHYSICS" })).toBeVisible();
  for (const text of ["There is no thrust force", "railgun", "Where the game cheats", "Gold can't be damaged", "sixty-six times", "5.5 kg"]) await expect(physics).toContainText(text);
  // White on black, as the rest of the game.
  await expect(physics).toHaveCSS("color", "rgb(255, 255, 255)");
  await page.getByTestId("mas-back").click();
  const time = () => page.evaluate(() => (window as unknown as { __msb: { sandbox: () => { world: { time: number } } } }).__msb.sandbox().world.time);
  const t0 = await time();
  await expect.poll(time, { timeout: 30_000 }).toBeGreaterThan(t0 + 0.1);
});
