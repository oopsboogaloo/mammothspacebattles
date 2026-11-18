// Moon Mammoth's page: the sprite sheet's frames, where the view looks, the clock and the best time.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLUMNS, FRAME, frameOf, ROWS, SHEET, STAND_PX } from "../../src/app/moon/sheet.ts";
import { aimFrom, bestTime, cameraFor, clock, LEVELS, LOWER, saveBest, snapAim, zoomFor } from "../../src/app/moonHud.ts";
import { aimPath, moonTurn, moonView } from "../../src/app/moonRender.ts";
import { renderFrame, type Ctx } from "../../src/app/render.ts";
import { RockStubs } from "../../src/app/rockStubs.ts";
import { unpackMoon } from "../../src/app/simClient.ts";
import { applyCommands, getProfile, initialWorld, parseScenario, type MoonAction, type World } from "../../src/core/index.ts";

const world = (name = "moon-test"): World => initialWorld(parseScenario(JSON.parse(readFileSync(new URL(`../../scenarios/${name}.json`, import.meta.url), "utf8"))));
const mam = (w: World) => w.bodies.find((b) => b.id === "mammoth")!;
// The moon's radius, 40 m as the level was set: 160 m in the game's units (lengths ×4). Places along
// it and heights over it are written in the first, scaled here.
const L = 4;
const R = 40 * L;
const place = (w: World, s: number, above = 1) => (mam(w).position = { x: (R + above * L) * Math.sin((s * L) / R), y: (R + above * L) * Math.cos((s * L) / R) });

describe("Moon Mammoth's sprite sheet", () => {
  it("MMN-061 every action has a row inside the sheet, and its frames fit across it", () => {
    const actions: MoonAction[] = ["idle", "walk", "turn", "jump", "fall", "roll", "sit", "slide"];
    for (const a of actions) {
      expect(SHEET[a].row).toBeLessThan(ROWS);
      expect(SHEET[a].frames).toBeGreaterThan(0);
      expect(SHEET[a].frames).toBeLessThanOrEqual(COLUMNS);
    }
  });

  it("MMN-061 a looping action goes round its frames; one that plays once holds its last", () => {
    const walk = Array.from({ length: 10 }, (_, k) => frameOf("walk", 1, 1 + (k + 0.5) / SHEET.walk.rate, 0).col);
    expect(walk).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
    expect(frameOf("sit", 0, 0, 0)).toEqual({ col: 0, row: SHEET.sit.row });
    expect(frameOf("sit", 0, 10, 0)).toEqual({ col: 1, row: SHEET.sit.row });
    expect(frameOf("turn", 0, 10, 0).col).toBe(2);
    expect(frameOf("roll", 0, 10, 0)).toEqual({ col: 0, row: SHEET.roll.row });
  });

  it("MMN-061 a jump's frame is by its speed up or down: rising, the top, falling", () => {
    expect(frameOf("jump", 0, 0.1, 20).col).toBe(0);
    expect(frameOf("jump", 0, 0.1, 3).col).toBe(1);
    expect(frameOf("fall", 0, 0.1, -3).col).toBe(1);
    expect(frameOf("fall", 0, 0.1, -20).col).toBe(2);
  });

  it("MMN-062 the sheet file is the layout the table says: frames across and rows down, with the mammoth's circle inside a frame", () => {
    const svg = readFileSync(new URL("../../src/app/moon/mammoth.svg", import.meta.url), "utf8");
    expect(svg).toContain(`width="${COLUMNS * FRAME}" height="${ROWS * FRAME}"`);
    const frames = Object.values(SHEET).reduce((seen, s) => seen.add(s.row), new Set<number>()).size;
    expect(frames).toBe(ROWS);
    expect(STAND_PX).toBeLessThan(FRAME / 2);
  });
});

describe("Moon Mammoth's view", () => {
  const vp = { width: 1280, height: 720 };

  it("MMN-060 the view looks along the line from the moon's centre through the mammoth, the mammoth a little below the middle", () => {
    const w = world();
    place(w, 30);
    const c = cameraFor(w, 0, vp, null, 0.016)!;
    const m = mam(w).position;
    // On the same line from the centre: no sideways offset.
    expect(Math.abs(c.x * m.y - c.y * m.x)).toBeLessThan(1e-6);
    expect(Math.hypot(c.x, c.y) - Math.hypot(m.x, m.y)).toBeCloseTo((LOWER * vp.height) / c.zoom, 6);
    expect(c.zoom).toBe(zoomFor(vp));
  });

  it("MMN-060 the view's turn is the mammoth's place round the moon; the title turns by itself", () => {
    const w = world();
    place(w, 30);
    expect(moonTurn(w, 0)).toBeCloseTo((30 * L) / R, 6);
    place(w, -50);
    expect(moonTurn(w, 0)).toBeCloseTo((-50 * L) / R, 6);
    moonView.title = true;
    expect(moonTurn(w, 20000)).toBeGreaterThan(moonTurn(w, 0));
    moonView.title = false;
  });

  it("MMN-060 a jump doesn't bob the view: its height eases after the mammoth's; a move to a flag is followed at once", () => {
    const w = world();
    place(w, 30);
    const before = cameraFor(w, 0, vp, null, 0.016)!;
    place(w, 30, 4);
    const jump = cameraFor(w, 0, vp, before.cam, 0.016)!;
    expect(jump.cam.radius - before.cam.radius).toBeLessThan(0.3 * L);
    place(w, 30, 20);
    expect(cameraFor(w, 0, vp, before.cam, 0.016)!.cam.radius).toBeCloseTo(R + 20 * L, 6);
  });

  it("MMN-060 a narrow screen shows as much to the sides: the zoom is by the smaller of height and width", () => {
    expect(zoomFor({ width: 390, height: 800 })).toBeLessThan(zoomFor({ width: 800, height: 800 }));
  });

  it("a canvas that can't be turned (a test recorder) still draws the world, plainly", () => {
    const calls: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => void calls.push(k)), set: (t, k: string, v) => ((t[k] = v), true) }) as unknown as Ctx;
    renderFrame(ctx, world(), { x: 0, y: 40, zoom: 20 }, vp, { overlays: new Set(), selection: new Set(), hover: null, moon: true });
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("Moon Mammoth's aim", () => {
  const vp = { width: 1280, height: 720 };

  it("MMN-103 a pointer aims from where the mammoth is drawn: to its right is 0, straight over it a quarter turn, to its left a half", () => {
    const below = 40;
    const at = { x: 640, y: 400 };
    expect(aimFrom({ x: at.x + 100, y: at.y }, vp, below)).toBeCloseTo(0, 9);
    expect(aimFrom({ x: at.x, y: at.y - 100 }, vp, below)).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(aimFrom({ x: at.x - 100, y: at.y }, vp, below))).toBeCloseTo(Math.PI, 9);
    expect(aimFrom({ x: at.x + 100, y: at.y + 100 }, vp, below)).toBeCloseTo(-Math.PI / 4, 9);
    // And the view says how far under its middle the mammoth is drawn.
    const w = world("moon-test-2");
    const c = cameraFor(w, 0, vp, null, 0.016)!;
    expect(c.below).toBeCloseTo(LOWER * vp.height, 6);
  });

  it("MMN-103 the aim is sent only when it has changed by a hundredth of a radian, and is kept within a turn", () => {
    expect(snapAim(0.123)).toBe(0.12);
    expect(snapAim(0.124)).toBe(snapAim(0.121));
    expect(snapAim(2 * Math.PI + 0.5)).toBe(0.5);
    expect(snapAim(-Math.PI - 0.1)).toBeCloseTo(Math.PI - 0.1, 2);
  });

  it("MMN-102 the aim's line is the path a shot would take: it starts along the aim, and bends toward the moon", () => {
    const w = world("moon-test-2");
    applyCommands(w, [{ type: "control.set", channel: "aim", value: 0 }], getProfile("sandbox"));
    w.moon!.state.aim = 0;
    const tools = w.moon!.spec.tools!;
    const dots = aimPath(w, tools.rifle.speed, 26 * L, 1.3 * L);
    expect(dots.length).toBe(20);
    const m = w.bodies.find((b) => b.id === "mammoth")!.position;
    // Aimed level to the right from the top of the moon: +x, and a little lower with each dot than a straight line would be.
    expect(dots[0].x - m.x).toBeGreaterThanOrEqual(1.3 * L);
    expect(dots[0].x - m.x).toBeLessThan(1.5 * L);
    expect(Math.abs(dots[0].y - m.y)).toBeLessThan(0.01 * L);
    const drop = (k: number) => m.y - dots[k].y;
    expect(drop(19)).toBeGreaterThan(drop(9));
    expect(drop(9)).toBeGreaterThan(drop(1));
    // 26 m at 400 m/s under about 100 m/s²: a fifth of a metre. Slight.
    expect(drop(19)).toBeGreaterThan(0.1 * L);
    expect(drop(19)).toBeLessThan(0.5 * L);
    // The slower hook's path bends more over the same distance.
    const hook = aimPath(w, tools.hook.speed, 13 * L, 13 * L);
    expect(m.y - hook[0].y).toBeGreaterThan(drop(9));
    // No tools, no line.
    expect(aimPath(world(), 400 * L, 26 * L, 1.3 * L)).toEqual([]);
  });

  it("the title offers levels 1 and 2", () => {
    expect(LEVELS.map((l) => l.name)).toEqual(["moon-1", "moon-2"]);
  });
});

describe("Moon Mammoth's HUD", () => {
  it("a time reads to a tenth, with minutes once there are any", () => {
    expect(clock(0)).toBe("0.0");
    expect(clock(42.46)).toBe("42.5");
    expect(clock(67.3)).toBe("1:07.3");
    expect(clock(-1)).toBe("0.0");
  });

  it("MMN-055 the best time is kept for each level, and only a better one replaces it", () => {
    const data: Record<string, string> = {};
    const store = { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
    expect(bestTime("moon-1", store)).toBeNull();
    expect(saveBest("moon-1", 61.2, store)).toBe(true);
    expect(saveBest("moon-1", 70, store)).toBe(false);
    expect(saveBest("moon-test", 20, store)).toBe(true);
    expect(saveBest("moon-1", 58.4, store)).toBe(true);
    expect(bestTime("moon-1", store)).toBe(58.4);
    expect(bestTime("moon-test", store)).toBe(20);
    expect(bestTime("moon-1", null)).toBeNull();
  });
});

describe("Moon Mammoth and the simulation worker", () => {
  it("the game's spec is sent once: after that a stub goes, and the page puts its own back", () => {
    const w = world();
    const stubs = new RockStubs();
    expect(stubs.packMoon(w)).toBe(w.moon);
    const sent = { moon: stubs.packMoon(w) };
    expect(sent.moon!.spec).toEqual({ kept: true });
    expect(sent.moon!.state).toBe(w.moon!.state);
    expect(unpackMoon(sent, w)).toBe(true);
    expect(sent.moon!.spec).toBe(w.moon!.spec);
    expect(unpackMoon({ moon: stubs.packMoon(w) }, {})).toBe(false);
    stubs.forget();
    expect(stubs.packMoon(w)).toBe(w.moon);
  });
});
