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
  // The drawing is turned by the mammoth's place round the moon.
  const view = await hook(page, (m) => ({ turn: m.turn(), at: Math.atan2(m.mammoth().position.x, m.mammoth().position.y) }));
  expect(view.turn).toBeCloseTo(view.at, 6);
  expect(view.at).toBeLessThan(-66 / 40);
  await page.keyboard.up("ArrowLeft");
  // And the view looks along that line. At a run it looks where the mammoth is drawn, a little on
  // from where the world last had it; stopped, the two are the same place.
  await expect.poll(() => hook(page, (m) => Math.abs(Math.atan2(m.camera().x, m.camera().y) - Math.atan2(m.mammoth().position.x, m.mammoth().position.y)))).toBeLessThan(0.002);
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
  test.setTimeout(120_000);
  await start(page);
  await place(page, 58);
  await page.keyboard.down("ArrowRight");
  await expect.poll(() => hook(page, (m) => m.moon()!.flag)).toBe(1);
  // On along the ground into the crater's spikes (78 to 82 m). Paused the moment it is sent back,
  // so what is checked next doesn't depend on how fast the browser is: the note is still up, and
  // the mammoth hasn't run on.
  await expect.poll(() => hook(page, (m) => m.moon()!.tries), { intervals: [50] }).toBeGreaterThan(0);
  await page.getByTestId("mmn-pause").click();
  await page.keyboard.up("ArrowRight");
  await expect(page.getByTestId("mmn-paused")).toBeVisible();
  const tries = await hook(page, (m) => m.moon()!.tries);
  expect(await hook(page, (m) => m.moon()!.back!.why)).toBe("spikes");
  // Back at the flag at 60 m: on the near side of the crater (its rim is at 73 m).
  const at = await along(page);
  expect(at).toBeGreaterThan(59);
  expect(at).toBeLessThan(73);
  await expect(page.getByTestId("mmn-back")).toContainText("OUCH");
  await expect(page.getByTestId("mmn-tries")).toHaveText(`TRIES ${tries}`);
  await shot(page, info, "mmn-back");
  // Standing still, the leg's 16 s (as the player sees them) run out.
  await page.getByTestId("mmn-resume").click();
  await expect.poll(() => hook(page, (m) => m.moon()!.back!.why), { timeout: 90_000 }).toBe("time");
  expect(await hook(page, (m) => m.moon()!.tries)).toBe(tries + 1);
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

// Level 2's tools, on the second test moon (moon.html?level=test2: a block under a roof at 20 m,
// a pit at 60 m under a beam, a cliff at 100 m under a beam).
interface Tools {
  aim: () => { angle: number } | null;
  rope: () => { mode: string; anchor?: { body: string }; points: unknown[] } | null;
  sandbox: () => { world: { controls: Record<string, number>; bodies: { id: string; integrity: number }[] } };
  moon: () => (State & { shots?: number }) | null;
}
const tools = <T,>(page: Page, f: (m: Tools) => T): Promise<T> => page.evaluate(`(${f.toString()})(window.__msb)`) as Promise<T>;
/** Where the mammoth is drawn on the page: under the view's middle. */
const drawnAt = async (page: Page) => {
  const box = (await page.getByTestId("mmn-mouse").boundingBox())!;
  const d = await page.evaluate(() => {
    const m = (window as unknown as { __msb: Hook }).__msb;
    const c = m.camera();
    const p = m.mammoth().position;
    return (Math.hypot(c.x, c.y) - Math.hypot(p.x, p.y)) * c.zoom;
  });
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 + d };
};

test("MMN-101 the title offers level 2, which has the rifle and the hook; the main page links to the game", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("open-moon")).toHaveAttribute("href", "moon.html");
  await page.goto("./moon.html");
  await page.getByTestId("mmn-level-2").click();
  await expect(page.getByTestId("mmn-hud")).toBeVisible();
  await expect(page.getByTestId("mmn-flag")).toHaveText("FLAG 0/7");
  await expect(page.getByTestId("mmn-tools-note")).toBeVisible();
  for (const id of ["mmn-aim", "mmn-fire", "mmn-hook", "mmn-up"]) await expect(page.getByTestId(id)).toBeVisible();
  expect(await tools(page, (m) => !!m.aim())).toBe(true);
  // Level 1 has none of them.
  await page.getByTestId("mmn-pause").click();
  await page.getByTestId("mmn-quit").click();
  await page.getByTestId("mmn-level-1").click();
  await expect(page.getByTestId("mmn-hud")).toBeVisible();
  await expect(page.getByTestId("mmn-aim")).toHaveCount(0);
  expect(await tools(page, (m) => m.aim())).toBeNull();
});

test("MMN-103 MMN-113 the mouse aims from the mammoth to the pointer; held down it fires, and the block breaks", async ({ page }, info) => {
  await start(page, "?level=test2");
  await place(page, 13);
  await expect.poll(() => hook(page, (m) => Math.hypot(m.mammoth().velocity.x, m.mammoth().velocity.y))).toBeLessThan(0.05);
  let at = await drawnAt(page);
  // Up and to the left of it: three quarters of a turn's half.
  await page.mouse.move(at.x - 150, at.y - 150);
  await expect.poll(() => tools(page, (m) => m.aim()!.angle)).toBeCloseTo((3 * Math.PI) / 4, 1);
  // At the block: ahead and a little up.
  at = await drawnAt(page);
  await page.mouse.move(at.x + 300, at.y - 40);
  await expect.poll(() => tools(page, (m) => m.aim()!.angle)).toBeCloseTo(Math.atan2(40, 300), 1);
  await shot(page, info, "mmn-aim");
  await page.mouse.down();
  await expect.poll(() => tools(page, (m) => m.sandbox().world.controls.fire)).toBe(1);
  await expect.poll(() => tools(page, (m) => m.sandbox().world.bodies.filter((b) => b.id.startsWith("block-")).length), { timeout: 15_000 }).toBe(0);
  await page.mouse.up();
  await expect.poll(() => tools(page, (m) => m.sandbox().world.controls.fire)).toBe(0);
  expect(await tools(page, (m) => m.moon()!.shots)).toBeGreaterThanOrEqual(3);
});

test("MMN-103 MMN-120 MMN-124 the right button casts the hook where the mouse points, and jump lets it go", async ({ page }, info) => {
  await start(page, "?level=test2");
  await place(page, 51.5);
  await expect.poll(() => hook(page, (m) => Math.hypot(m.mammoth().velocity.x, m.mammoth().velocity.y))).toBeLessThan(0.05);
  // The beam over the pit: 8.5 m on and 7 m up, as the view draws it.
  const at = await drawnAt(page);
  const zoom = await hook(page, (m) => m.camera().zoom);
  await page.mouse.move(at.x + 8.3 * zoom, at.y - 6.6 * zoom);
  await expect.poll(() => tools(page, (m) => m.aim()!.angle)).toBeCloseTo(Math.atan2(6.6, 8.3), 1);
  await page.mouse.down({ button: "right" });
  await expect.poll(() => tools(page, (m) => m.rope()?.mode ?? null)).toBe("held");
  await page.mouse.up({ button: "right" });
  expect(await tools(page, (m) => m.rope()!.anchor!.body)).toBe("girder-2");
  await shot(page, info, "mmn-rope");
  await page.keyboard.down("Space");
  await expect.poll(() => tools(page, (m) => m.rope())).toBeNull();
  await page.keyboard.up("Space");
});

test("MMN-103 Q and E swing the aim; F fires and G casts the hook; the touch stick and its buttons do the same", async ({ page }) => {
  await start(page, "?level=test2");
  await place(page, -40);
  const from = await tools(page, (m) => m.aim()!.angle);
  await page.keyboard.down("KeyQ");
  await expect.poll(() => tools(page, (m) => m.aim()!.angle)).toBeGreaterThan(from + 0.3);
  await page.keyboard.up("KeyQ");
  const up = await tools(page, (m) => m.aim()!.angle);
  await page.keyboard.down("KeyE");
  await expect.poll(() => tools(page, (m) => m.aim()!.angle)).toBeLessThan(up - 0.3);
  await page.keyboard.up("KeyE");
  await page.keyboard.down("KeyF");
  await expect.poll(() => tools(page, (m) => m.moon()!.shots ?? 0)).toBeGreaterThan(0);
  await page.keyboard.up("KeyF");
  await page.keyboard.down("KeyG");
  await expect.poll(() => tools(page, (m) => !!m.rope())).toBe(true);
  await page.keyboard.up("KeyG");
  await expect.poll(() => tools(page, (m) => m.rope())).toBeNull();
  // The stick: pressed at its top, the aim is straight up; at its left, to the left.
  const stick = (await page.getByTestId("mmn-aim").boundingBox())!;
  const press = (dx: number, dy: number) =>
    page.getByTestId("mmn-aim").dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", bubbles: true, clientX: stick.x + stick.width / 2 + dx, clientY: stick.y + stick.height / 2 + dy });
  await press(0, -40);
  await expect.poll(() => tools(page, (m) => m.aim()!.angle)).toBeCloseTo(Math.PI / 2, 1);
  await press(-40, 0);
  await expect.poll(() => tools(page, (m) => Math.abs(m.aim()!.angle))).toBeCloseTo(Math.PI, 1);
  const shotsBefore = await tools(page, (m) => m.moon()!.shots ?? 0);
  await hold(page, "mmn-fire", true);
  await expect.poll(() => tools(page, (m) => m.moon()!.shots ?? 0)).toBeGreaterThan(shotsBefore);
  await hold(page, "mmn-fire", false);
  await hold(page, "mmn-hook", true);
  await expect.poll(() => tools(page, (m) => !!m.rope())).toBe(true);
  await hold(page, "mmn-hook", false);
});

test("MMN-103 a controller: the right stick aims, the right trigger fires, the left trigger casts the hook", async ({ page }) => {
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
  const rightStick = (x: number, y: number) => page.evaluate(([a, b]) => void Object.assign((window as unknown as { __pad: { axes: number[] } }).__pad.axes, { 2: a, 3: b }), [x, y] as const);
  await start(page, "?level=test2");
  await place(page, -40);
  // Pushed up (the stick's y runs down): straight up. Pushed left: to the left.
  await rightStick(0, -1);
  await expect.poll(() => tools(page, (m) => m.aim()!.angle)).toBeCloseTo(Math.PI / 2, 1);
  await rightStick(-1, 0);
  await expect.poll(() => tools(page, (m) => Math.abs(m.aim()!.angle))).toBeCloseTo(Math.PI, 1);
  // Let go, the aim stays.
  await rightStick(0, 0);
  await button(7, true);
  await expect.poll(() => tools(page, (m) => m.sandbox().world.controls.fire)).toBe(1);
  await button(7, false);
  await expect.poll(() => tools(page, (m) => m.sandbox().world.controls.fire)).toBe(0);
  expect(Math.abs((await tools(page, (m) => m.aim()!.angle)))).toBeCloseTo(Math.PI, 1);
  await button(6, true);
  await expect.poll(() => tools(page, (m) => !!m.rope())).toBe(true);
  await button(6, false);
});
