import { expect, test, type Page } from "@playwright/test";
import { shot } from "./helpers.ts";

interface Body {
  id: string;
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  integrity: number;
  tractor?: { mode: string; siphoning?: string };
  contents?: { mass: number }[];
  turret?: { shots: number; sees: boolean; target?: string };
}
interface Hook {
  sandbox: () => { world: { time: number; controls: Record<string, number>; bodies: Body[]; links: { id: string; off?: string }[]; terrain: { holes: { x: number; y: number; r: number }[] }; thrust: { spec: { start: { x: number; y: number }; top: number } } } };
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

/**
 * Switches every turret off. A turret fires at random bearings, so whether a bolt knocks a ship the
 * test is flying depends on how the browser's timing falls: tests that are about something else
 * fly with the turrets quiet.
 */
const quiet = (page: Page) =>
  hook(page, (m) => m.edit(m.sandbox().world.bodies.filter((b) => b.turret).map((b) => ({ type: "body.set", id: b.id, patch: { turret: { ...b.turret, enabled: false } } }))));

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
  for (const b of ["thrust-left", "thrust-right", "thrust-reverse", "thrust-fire", "thrust-tractor", "thrust-shield", "mth-pause"]) await expect(page.getByTestId(b)).toBeVisible();
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
    await expect.poll(() => hook(page, (m) => m.sandbox().world.bodies.find((b) => b.id === "p1-hull")?.tractor?.mode)).toBe("beam");
    await page.keyboard.up(key);
    await expect.poll(() => hook(page, (m) => m.sandbox().world.bodies.find((b) => b.id === "p1-hull")?.tractor?.mode)).toBe("off");
  }
});

test("SHD-001 SHD-005 the keys: X or . holds the shield up, and the engines don't work while it is", async ({ page }) => {
  await start(page);
  const field = () => hook(page, (m) => m.sandbox().world.bodies.some((b) => b.id === "p1-shield-field"));
  for (const key of ["x", "."]) {
    await page.keyboard.down(key);
    await expect.poll(field).toBe(true);
    await page.keyboard.up(key);
    await expect.poll(field).toBe(false);
  }
  await page.keyboard.down("x");
  await expect.poll(field).toBe(true);
  await page.keyboard.down("ArrowUp");
  await expect.poll(() => hook(page, (m) => m.sandbox().world.links.filter((l) => l.off === "shield").length)).toBe(6);
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("x");
  await expect.poll(() => hook(page, (m) => m.sandbox().world.links.filter((l) => l.off).length)).toBe(0);
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
  test.setTimeout(300_000);
  await start(page);
  expect(await quiet(page)).toBe(true);
  expect(await overPod(page)).toBe(true);
  await page.keyboard.down("z");
  await expect(page.getByTestId("mth-pod")).toHaveText("POD ON THE TETHER", { timeout: 15_000 });
  await page.keyboard.up("z");
  await page.keyboard.down("ArrowUp");
  // The climb is about 5 game seconds: 10 s on screen, and several times that on a slow machine. If
  // it never ends, say where the ship and the pod had got to.
  const where = () =>
    hook(page, (m) => {
      const w = m.sandbox().world;
      const at = (id: string) => w.bodies.find((b) => b.id === id)?.position;
      const s = m.thrust()!;
      return JSON.stringify({ phase: s.phase, pod: s.pod, lives: s.lives, n: s.n, back: s.stats.back, time: w.time, top: w.thrust.spec.top, hull: at(`p${s.n}-hull`), podAt: at("pod") });
    });
  try {
    await expect(page.getByTestId("mth-won")).toBeVisible({ timeout: 200_000 });
  } catch {
    throw new Error(`The level was not won in 200 s: ${await where()}`);
  }
  await page.keyboard.up("ArrowUp");
  await expect(page.getByTestId("mth-won")).toContainText("Level 1 complete");
  await expect(page.getByTestId("mth-won")).toContainText("+2000");
  const score = await hook(page, (m) => m.thrust()!.score);
  expect(score).toBeGreaterThan(2500); // 2000 for the pod, and most of the 8.1 kg of fuel the ship carries (MTH-094)
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

test("MTH-042 holding the beam over a fuel tank draws its fuel into the ship, and says so", async ({ page }) => {
  await start(page);
  expect(await quiet(page)).toBe(true);
  const held = () => hook(page, (m) => (m.sandbox().world.bodies.find((b) => b.id === "fuel-1")?.contents ?? []).reduce((k, c) => k + c.mass, 0));
  const full = await held();
  expect(full).toBeGreaterThan(8);
  await expect(page.getByTestId("mth-refuel")).toHaveCount(0);
  // The ship 30 m over the tank, at rest: it falls slowly enough to draw for a while.
  expect(
    await hook(page, (m) => {
      const w = m.sandbox().world;
      const hull = w.bodies.find((b) => b.id === "p1-hull")!;
      const tank = w.bodies.find((b) => b.id === "fuel-1")!;
      const d = { x: tank.position.x - hull.position.x, y: tank.position.y + 30 - hull.position.y };
      return m.edit(w.bodies.filter((b) => b.id.startsWith("p1-")).map((b) => ({ type: "body.set", id: b.id, patch: { position: { x: b.position.x + d.x, y: b.position.y + d.y }, velocity: { x: 0, y: 0 } } })));
    }),
  ).toBe(true);
  await page.keyboard.down("z");
  await expect(page.getByTestId("mth-refuel")).toHaveText("REFUELLING", { timeout: 15_000 });
  await expect.poll(held, { timeout: 30_000 }).toBeLessThan(full);
  await page.keyboard.up("z");
  await expect(page.getByTestId("mth-refuel")).toHaveCount(0, { timeout: 15_000 });
});

test("MTH-052 the view doesn't jump when the tether takes the pod: it eases toward it", async ({ page }) => {
  await start(page);
  expect(await quiet(page)).toBe(true);
  expect(await overPod(page)).toBe(true);
  // Each frame: how far the view's centre is from the ship.
  await page.evaluate(() => {
    const m = (window as unknown as { __msb: { sandbox: () => { world: { bodies: { id: string; position: { x: number; y: number } }[] } }; camera: () => { x: number; y: number } } }).__msb;
    const out: number[] = [];
    (window as unknown as { __lean: number[] }).__lean = out;
    const tick = () => {
      const hull = m.sandbox().world.bodies.find((b) => b.id === "p1-hull");
      if (hull) out.push(Math.hypot(m.camera().x - hull.position.x, m.camera().y - hull.position.y));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.keyboard.down("z");
  await expect(page.getByTestId("mth-pod")).toHaveText("POD ON THE TETHER", { timeout: 15_000 });
  await page.keyboard.up("z");
  // It ends up leaning toward the pod...
  await expect.poll(() => page.evaluate(() => (window as unknown as { __lean: number[] }).__lean.at(-1)!), { timeout: 15_000 }).toBeGreaterThan(2);
  // ...and got there with no frame moving it far (a jump was about 3 m at once).
  const steps = await page.evaluate(() => {
    const v = (window as unknown as { __lean: number[] }).__lean;
    return Math.max(...v.slice(1).map((x, i) => Math.abs(x - v[i])));
  });
  expect(steps).toBeLessThan(1.5);
});

test("MTH-030 MTH-036 a turret that sees the ship waits, turns its gun and fires bolts; they show in flight", async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  const turret = () => hook(page, (m) => m.sandbox().world.bodies.find((b) => b.id === "t1-breech")?.turret);
  expect((await turret())?.shots).toBe(0);
  // Over the valley, in plain sight of the turret on its shoulder, held there against gravity by the test.
  const hold = () =>
    hook(page, (m) => {
      const w = m.sandbox().world;
      const hull = w.bodies.find((b) => b.id === "p1-hull")!;
      const d = { x: -10 - hull.position.x, y: 40 - hull.position.y };
      return m.edit(w.bodies.filter((b) => b.id.startsWith("p1-") && !b.id.includes("-shell-")).map((b) => ({ type: "body.set", id: b.id, patch: { position: { x: b.position.x + d.x, y: b.position.y + d.y }, velocity: { x: 0, y: 0 } } })));
    });
  await expect
    .poll(
      async () => {
        await hold();
        return (await turret())?.shots ?? 0;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBeGreaterThan(0);
  expect((await turret())?.target).toBe("p1-hull");
  expect(await hook(page, (m) => m.sandbox().world.bodies.some((b) => b.id.startsWith("t1-breech-shell-")))).toBe(true);
});

test("MTH-060 a ship destroyed on the ground leaves a crater there, and the view stays on it", async ({ page }) => {
  test.setTimeout(90_000);
  await start(page);
  expect(await quiet(page)).toBe(true);
  expect(await hook(page, (m) => m.sandbox().world.terrain.holes.length)).toBe(0);
  // The ship set down on the flat ground under the start (the ground there is at y = 10).
  await hook(page, (m) => {
    const w = m.sandbox().world;
    const hull = w.bodies.find((b) => b.id === "p1-hull")!;
    const d = 12.6 - hull.position.y;
    return m.edit(w.bodies.filter((b) => b.id.startsWith("p1-")).map((b) => ({ type: "body.set", id: b.id, patch: { position: { x: b.position.x, y: b.position.y + d }, velocity: { x: 0, y: 0 } } })));
  });
  // The view has followed the ship down before it is destroyed (it stays where it last saw a ship).
  await expect.poll(() => hook(page, (m) => Math.abs(m.camera().y - 12.6))).toBeLessThan(3);
  await page.getByTestId("mth-destruct").click();
  await page.getByTestId("mth-destruct").click();
  await expect.poll(() => hook(page, (m) => m.sandbox().world.terrain.holes.length), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const holes = await hook(page, (m) => m.sandbox().world.terrain.holes);
  for (const h of holes) expect(h.r).toBeCloseTo(3.6, 6);
  // The cockpit is gone, and the view is still where it was: on the crater, not back at the start 60 m up.
  await expect.poll(() => hook(page, (m) => m.thrust()?.phase)).toBe("between");
  expect(await hook(page, (m) => m.sandbox().world.bodies.some((b) => b.id === "p1-hull"))).toBe(false);
  expect(Math.abs((await hook(page, (m) => m.camera().y)) - 12)).toBeLessThan(6);
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
    // The ship goes up at once; the page leaves 3 s to watch it before it says so.
    await expect.poll(() => hook(page, (m) => m.thrust()?.phase)).toBe("between");
    if (k === 3) await expect(page.getByTestId("mth-lost")).toBeHidden();
    if (k > 1) await expect(page.getByTestId("mth-lost")).toBeVisible({ timeout: 30_000 });
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

test("MTH-021 a Shift let go while the other is still down doesn't stick, though Windows sends no release for it", async ({ page }) => {
  await start(page);
  const engines = () => hook(page, (m) => ["main", "bl", "br", "fl", "fr"].map((c) => m.sandbox().world.controls[c] ?? 0).join(""));
  const key = (type: string, code: string, shiftKey: boolean) => page.evaluate(([t, c, s]) => void window.dispatchEvent(new KeyboardEvent(t as string, { code: c as string, key: "Shift", shiftKey: s as boolean, bubbles: true })), [type, code, shiftKey] as const);
  await key("keydown", "ShiftLeft", true);
  await expect.poll(engines).not.toBe("00000");
  await key("keydown", "ShiftRight", true);
  // The left one is let go first: nothing arrives. Then the right one: no Shift is held now.
  await key("keyup", "ShiftRight", false);
  await expect.poll(engines).toBe("00000");
  // One Shift let go with the other truly held still turns.
  await key("keydown", "ShiftLeft", true);
  await key("keydown", "ShiftRight", true);
  await key("keyup", "ShiftRight", true);
  await expect.poll(engines).not.toBe("00000");
  await key("keyup", "ShiftLeft", false);
  await expect.poll(engines).toBe("00000");
});

test("MTH-021 the Ctrl keys turn as the Shift keys do, the other keys still work while one is held, and a Ctrl let go unseen doesn't stick", async ({ page }) => {
  await start(page);
  const engines = () => hook(page, (m) => ["main", "bl", "br", "fl", "fr"].map((c) => m.sandbox().world.controls[c] ?? 0).join(""));
  await page.keyboard.down("ShiftLeft");
  await expect.poll(engines).not.toBe("00000");
  const left = await engines();
  await page.keyboard.up("ShiftLeft");
  await expect.poll(engines).toBe("00000");
  await page.keyboard.down("ControlLeft");
  await expect.poll(engines).toBe(left);
  // Space fires with Ctrl held.
  await page.keyboard.down("Space");
  await expect.poll(() => hook(page, (m) => m.sandbox().world.controls.fire ?? 0)).toBe(1);
  await page.keyboard.up("Space");
  await page.keyboard.up("ControlLeft");
  await expect.poll(engines).toBe("00000");
  await page.keyboard.down("ControlRight");
  await expect.poll(engines).not.toBe("00000");
  expect(await engines()).not.toBe(left);
  await page.keyboard.up("ControlRight");
  await expect.poll(engines).toBe("00000");
  // Both down, the left one let go with no release sent, then the right one: neither is held.
  const key = (type: string, code: string, ctrlKey: boolean) => page.evaluate(([t, c, s]) => void window.dispatchEvent(new KeyboardEvent(t as string, { code: c as string, key: "Control", ctrlKey: s as boolean, bubbles: true })), [type, code, ctrlKey] as const);
  await key("keydown", "ControlLeft", true);
  await key("keydown", "ControlRight", true);
  await key("keyup", "ControlRight", false);
  await expect.poll(engines).toBe("00000");
});

test("MTH-014 thrust.html?level=4 plays from level 4, the winding cave, with its six electric turrets", async ({ page }) => {
  await page.goto("./thrust.html?level=4");
  await page.getByTestId("mth-start").click();
  await expect(page.getByTestId("mth-level")).toHaveText("LEVEL 4");
  expect(await hook(page, (m) => m.level())).toBe(4);
  expect(await hook(page, (m) => m.sandbox().world.bodies.filter((b) => b.turret).length)).toBe(6);
  // Without the address, Play starts at level 1.
  await page.goto("./thrust.html");
  await page.getByTestId("mth-start").click();
  await expect(page.getByTestId("mth-level")).toHaveText("LEVEL 1");
  await expect(page.getByTestId("mth-coolant")).toHaveCount(0);
});

test("MTH-082 level 4's power plant: with its coolant gone it goes critical, the page counts down, and when it blows with the pod still down the game is over", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./thrust.html?level=4");
  await page.getByTestId("mth-start").click();
  await expect(page.getByTestId("mth-level")).toHaveText("LEVEL 4");
  expect(await hook(page, (m) => (m.thrust() as unknown as { plant: { up: { tx: boolean } } }).plant.up.tx)).toBe(true);
  await expect(page.getByTestId("mth-critical")).toHaveCount(0);
  // The coolant gauge, full (MTH-086); level 1 has none.
  await expect(page.getByTestId("mth-coolant")).toHaveAttribute("title", "Coolant: 100%, 0 holes");
  expect(
    await hook(page, (m) => {
      const core = m.sandbox().world.bodies.find((b) => b.id === "plant-core") as unknown as { contents: { resource: string; mass: number; capacity: number }[] };
      return m.edit([{ type: "body.set", id: "plant-core", patch: { contents: core.contents.map((c) => ({ ...c, mass: 0 })) } }]);
    }),
  ).toBe(true);
  await expect(page.getByTestId("mth-critical")).toContainText("REACTOR CRITICAL", { timeout: 15_000 });
  await expect(page.getByTestId("mth-coolant")).toHaveAttribute("title", "Coolant: 0%, 0 holes");
  await expect(page.getByTestId("mth-over")).toContainText("Planet destroyed, mission failed.", { timeout: 90_000 });
  await expect(page.getByTestId("mth-again")).toBeVisible();
});

test("MTH-087 for testing, the title has a button for each level that starts the game there", async ({ page }) => {
  await page.goto("./thrust.html");
  for (const n of [5, 3, 1]) {
    await page.getByTestId(`mth-level-${n}`).click();
    await expect(page.getByTestId("mth-level")).toHaveText(`LEVEL ${n}`);
    expect(await hook(page, (m) => m.level())).toBe(n);
    await page.keyboard.press("p");
    await page.getByTestId("mth-quit").click();
    await expect(page.getByTestId("mth-start")).toBeVisible();
  }
});

test("MTH-090 for testing, the page shows the simulation's step time against its budget, with the gas and bodies", async ({ page }) => {
  await start(page);
  await expect(page.getByTestId("mth-step")).toContainText(/step \d+\.\d \/ 8\.3 ms · worst \d+ ms · gas \d+ · bodies \d+/, { timeout: 15_000 });
});

test("MTH-091 level 5, the asteroid, opens from the title's test row", async ({ page }) => {
  await page.goto("./thrust.html");
  await page.getByTestId("mth-level-5").click();
  await expect(page.getByTestId("mth-level")).toHaveText("LEVEL 5");
  expect(await hook(page, (m) => m.sandbox().world.bodies.filter((b) => b.turret).length)).toBe(13);
});

test("MTH-093 a new ship beaming in after one lost deep in level 4's cave is in view: the view doesn't go under the rock", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("./thrust.html?level=4");
  await page.getByTestId("mth-start").click();
  await expect(page.getByTestId("mth-hud")).toBeVisible();
  expect(await quiet(page)).toBe(true);
  // The ship down in the chamber, 180 m under the start, and lost there.
  await hook(page, (m) => {
    const w = m.sandbox().world;
    const hull = w.bodies.find((b) => b.id === "p1-hull")!;
    const d = { x: 20 - hull.position.x, y: -125 - hull.position.y };
    return m.edit(w.bodies.filter((b) => b.id.startsWith("p1-")).map((b) => ({ type: "body.set", id: b.id, patch: { position: { x: b.position.x + d.x, y: b.position.y + d.y }, velocity: { x: 0, y: 0 } } })));
  });
  await page.waitForTimeout(300);
  // Two presses: one stray touch doesn't cost a ship.
  await page.getByTestId("mth-destruct").click();
  await page.getByTestId("mth-destruct").click();
  await expect.poll(() => hook(page, (m) => m.thrust()!.n), { timeout: 30_000 }).toBe(2);
  await page.waitForTimeout(500);
  const gap = await hook(page, (m) => {
    const h = m.sandbox().world.bodies.find((b) => b.id === "p2-hull")!;
    const c = m.camera();
    return Math.hypot(c.x - h.position.x, c.y - h.position.y);
  });
  expect(gap).toBeLessThan(15);
});
