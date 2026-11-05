// Sandbox UI requirements (§8.6–8.11), one or more per test, named by ID.
import { expect, test } from "@playwright/test";
import { body, dragWorld, hash, openStarter, shot, toPage, waitForTick, world } from "./helpers.ts";

test.describe("time control", () => {
  test("SBX-001 play, pause, step, step-10 and reset work by button and by key", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    await page.getByTestId("step").click();
    expect((await world(page)).tick).toBe(1);
    await page.keyboard.press(".");
    expect((await world(page)).tick).toBe(2);
    await page.getByTestId("step10").click();
    await page.keyboard.press(">");
    expect((await world(page)).tick).toBe(22);
    await page.getByTestId("play").click();
    await waitForTick(page, 60);
    await page.keyboard.press("Space");
    const paused = (await world(page)).tick;
    await page.waitForTimeout(200);
    expect((await world(page)).tick).toBe(paused);
    await page.keyboard.press("Home");
    expect((await world(page)).tick).toBe(0);
    await page.getByTestId("step10").click();
    await page.getByTestId("reset").click();
    expect((await world(page)).tick).toBe(0);
  });

  test("SBX-002 SBX-005 time scale changes steps per second, and achieved speed is shown", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    await page.getByTestId("scale-0.0625").click();
    await page.keyboard.press("Space");
    await page.waitForTimeout(1000);
    await page.keyboard.press("Space");
    const slow = (await world(page)).tick;
    expect(slow).toBeLessThan(40); // ~15 ticks/s at 1/16×
    await page.keyboard.press("]");
    await expect(page.getByTestId("scale-0.25")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("scale-0.5").click(); // half speed has its own button
    await expect(page.getByTestId("scale-0.5")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("scale-0.5")).toHaveText("1/2×");
    await page.getByTestId("scale-4").click();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("achieved")).toContainText("speed");
    await page.waitForTimeout(1000);
    await page.keyboard.press("Space");
    expect((await world(page)).tick - slow).toBeGreaterThan(400);
    await expect(page.getByTestId("achieved")).toHaveText("paused");
  });

  test("SBX-005 when it can't keep up it says slow, without moving the layout", async ({ page }) => {
    // A gas engine at 8× is more than any machine here steps in real time.
    await openStarter(page, "rs08-chemical-rocket");
    const achieved = page.getByTestId("achieved");
    await page.getByTestId("scale-8").click();
    await page.getByTestId("play").click();
    await expect(achieved).toHaveClass(/behind/, { timeout: 15_000 });
    await expect(achieved).toContainText("slow"); // for screen readers; on screen it is the colour
    // While running, falling behind and catching up change nothing in the layout.
    const sample = async () => {
      const s = (await achieved.boundingBox())!;
      const v = (await page.getByTestId("view").boundingBox())!;
      return `${s.width.toFixed(0)} ${v.y.toFixed(0)} ${v.height.toFixed(0)}`;
    };
    const first = await sample();
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(150);
      expect(await sample()).toBe(first);
    }
    await page.getByTestId("play").click();
  });
});

test.describe("creating and editing", () => {
  test("SBX-010 the palette is searchable and spawns discs, boxes and polygons", async ({ page }) => {
    await page.goto("./");
    await page.getByTestId("pick-empty").click();
    await page.keyboard.press("s");
    await page.getByTestId("palette-search").fill("hex");
    await expect(page.getByTestId("spawn-disc")).toHaveCount(0);
    await page.getByTestId("spawn-hexagon").click();
    const p = await toPage(page, 0, 0);
    await page.mouse.click(p.x, p.y);
    await page.getByTestId("palette-search").fill("");
    await page.getByTestId("spawn-box").click();
    const q = await toPage(page, 3, 0);
    await page.mouse.click(q.x, q.y);
    const w = await world(page);
    expect(w.bodies.map((b) => b.id).sort()).toEqual(["box-2", "hexagon-1"]);
  });

  test("SBX-011 SBX-019 select, move, rotate, duplicate and delete, with undo and redo", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    const start = await hash(page);
    await page.keyboard.press("m");
    await dragWorld(page, [3, 0], [3, 2]);
    expect((await body(page, "b"))!.position.y).toBeCloseTo(2, 1);
    // Rotate handle sits above the selected body.
    const c = await toPage(page, 3, 2);
    const zoom = 60;
    await page.mouse.move(c.x, c.y - 0.5 * zoom - 22);
    await page.mouse.down();
    await page.mouse.move(c.x + 60, c.y, { steps: 6 });
    await page.mouse.up();
    expect(Math.abs((await body(page, "b"))!.angle)).toBeGreaterThan(0.5);
    await page.keyboard.press("Control+d");
    expect((await world(page)).bodies).toHaveLength(3);
    await page.keyboard.press("Delete");
    expect((await world(page)).bodies).toHaveLength(2);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
    expect(await hash(page)).toBe(start);
    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+Shift+z");
    expect((await world(page)).bodies).toHaveLength(2);
    await expect(page.getByTestId("redo")).toBeDisabled();
  });

  test("SBX-018 the impulse tool previews J, Δv and Δω, then applies on release", async ({ page }) => {
    await openStarter(page, "rs02-off-centre-impact");
    await page.keyboard.press("i");
    const a = await toPage(page, 0.8, 0);
    const b = await toPage(page, 0.8, 0.5);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    // The preview is drawn on the canvas; the rod has not moved yet.
    expect((await body(page, "rod"))!.velocity.y).toBe(0);
    await page.mouse.up();
    const rod = (await body(page, "rod"))!;
    expect(rod.velocity.y).toBeCloseTo(1, 1); // 0.5 m drag × 2 = 1 m/s
    expect((await world(page)).ledger.violations).toBe(0);
  });

  test("SBX-022 right-click opens a context menu with the body's actions", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    const p = await toPage(page, 3, 0);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await expect(page.getByTestId("menu")).toBeVisible();
    await page.getByTestId("ctx-fixed").click();
    expect((await body(page, "b"))!.fixed).toBe(true);
    await page.mouse.click(p.x, p.y, { button: "right" });
    await page.getByTestId("ctx-delete").click();
    expect(await body(page, "b")).toBeUndefined();
  });
});

test.describe("inspector", () => {
  test("INS-001 INS-002 sections collapse and remember; values accept typing and drag-scrubbing with units", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    const p = await toPage(page, -3, 0);
    await page.mouse.click(p.x, p.y);
    await expect(page.getByTestId("inspector-title")).toHaveText("a");
    for (const s of ["identity", "shape", "material", "motion", "contents", "joints", "links", "live"]) await expect(page.getByTestId(`section-${s}`)).toBeVisible();
    await page.getByTestId("section-motion").click();
    await expect(page.getByTestId("field-vx")).toHaveCount(0);
    await page.reload();
    await page.getByTestId("pick-sc01-elastic-collision").click();
    await page.waitForTimeout(100);
    const p2 = await toPage(page, -3, 0);
    await page.mouse.click(p2.x, p2.y);
    await expect(page.getByTestId("inspector-title")).toHaveText("a");
    await expect(page.getByTestId("field-vx")).toHaveCount(0); // still collapsed
    await page.getByTestId("section-motion").click();
    await page.getByTestId("field-mass").fill("2.5");
    await page.getByTestId("field-mass").press("Enter");
    expect((await body(page, "a"))!.mass).toBe(2.5);
    await expect(page.locator(".field", { has: page.getByTestId("field-mass") })).toContainText("kg");
    const label = page.locator('label[for="vx"]');
    await label.scrollIntoViewIfNeeded();
    const box = (await label.boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 45, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    expect((await body(page, "a"))!.velocity.x).toBeCloseTo(3, 5); // 40 px / 4 px per step × 0.1
  });

  test("INS-003 INS-004 derived values are read-only with tooltips; invalid input is rejected inline", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    const p = await toPage(page, -3, 0);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator(".row[title*='÷ area']")).toContainText("kg/m²");
    await page.getByTestId("field-mass").fill("-1");
    await page.getByTestId("field-mass").press("Enter");
    await expect(page.getByTestId("error-mass")).toHaveText("Must be greater than 0");
    await expect(page.getByTestId("field-mass")).toHaveValue("1");
    expect((await body(page, "a"))!.mass).toBe(1);
  });

  test("INS-005 multi-selection edits shared values together and shows mixed ones", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    const a = await toPage(page, -3, 0);
    const b = await toPage(page, 3, 0);
    await page.mouse.click(a.x, a.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up("Shift");
    await expect(page.getByTestId("inspector-title")).toHaveText("2 bodies");
    await expect(page.getByTestId("field-mass")).toHaveAttribute("placeholder", "mixed");
    await page.getByTestId("field-friction").fill("0.3");
    await page.getByTestId("field-friction").press("Enter");
    const w = await world(page);
    expect(w.bodies.map((x) => (x as unknown as { friction: number }).friction)).toEqual([0.3, 0.3]);
  });
});

test.describe("seeing what's happening", () => {
  test("SBX-030 pan, zoom to the cursor, zoom to fit and follow", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    const before = await toPage(page, 0, 0);
    await dragWorld(page, [0, 2], [1, 2]); // select tool: drag empty space pans
    const after = await toPage(page, 0, 0);
    expect(after.x - before.x).toBeGreaterThan(40);
    const anchor = await toPage(page, 3, 0);
    await page.mouse.move(anchor.x, anchor.y);
    await page.mouse.wheel(0, -400);
    const still = await toPage(page, 3, 0);
    expect(Math.abs(still.x - anchor.x)).toBeLessThan(2);
    await page.keyboard.press("z");
    const fitted = await toPage(page, 0, 0);
    expect(fitted.x).toBeGreaterThan(0);
    const bNow = await toPage(page, 3, 0);
    await page.mouse.click(bNow.x, bNow.y);
    await expect(page.getByTestId("inspector-title")).toHaveText("b");
    await page.keyboard.press("f");
    await page.keyboard.press("Space");
    await page.waitForTimeout(500);
    const followed = await toPage(page, (await body(page, "b"))!.position.x, 0);
    const view = (await page.getByTestId("view").boundingBox())!;
    expect(Math.abs(followed.x - (view.x + view.width / 2))).toBeLessThan(30);
  });

  test("SBX-031 SBX-038 overlays toggle and show a legend with shape and line-style cues", async ({ page }) => {
    await openStarter(page, "rs04-box-stack");
    await page.getByTestId("overlay-com").click();
    await expect(page.getByTestId("overlay-com")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Overlay legend")).toContainText("white circled cross");
    await expect(page.getByLabel("Overlay legend")).toContainText("dashed line");
    await page.getByTestId("overlay-com").click();
    await expect(page.getByLabel("Overlay legend")).not.toContainText("circled cross");
  });

  test("SBX-033 graphs show ledger totals and probes with a selectable window and hover readout", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    await page.getByTestId("series-ledger.total").click();
    await expect(page.getByTestId("graph-ledger.total")).toBeVisible();
    await page.keyboard.press("Space");
    await waitForTick(page, 480);
    await page.keyboard.press("Space");
    await page.getByRole("group", { name: "Graph window" }).getByText("All").click();
    const g = page.getByTestId("graph-vax").locator("canvas");
    const box = (await g.boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + box.height / 2);
    await expect(page.getByTestId("graph-value-vax")).toContainText("2.0000");
    await expect(page.getByTestId("graph-value-vax")).toContainText("@");
  });

  test("SBX-036 hovering a body shows type, mass, speed and spin", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    const p = await toPage(page, 3, 0);
    await page.mouse.move(p.x, p.y);
    await expect(page.getByTestId("hovercard")).toContainText("b · disc · 3.00 kg · 1.00 m/s · 0.00 rad/s");
  });

  test("SBX-037 the event log lists collisions; clicking one jumps to its step", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    await page.keyboard.press("Space");
    await expect(page.getByTestId("event").first()).toContainText("Collision a–b", { timeout: 10_000 });
    await page.keyboard.press("Space");
    const collisionTick = (await world(page)).events.find((e) => e.type === "collision")!.tick;
    await page.getByTestId("event").first().click();
    const w = await world(page);
    expect(w.tick).toBe(collisionTick + 1); // the state just after the collision
    expect(w.events.some((e) => e.type === "collision")).toBe(true);
  });
});

test.describe("onboarding and discoverability", () => {
  test("UX-001 the picker lists the starters first, then references, then an empty world", async ({ page }, info) => {
    await page.goto("./");
    const ids = await page.locator(".card .id").allTextContents();
    expect(ids).toEqual(["SC-01", "SC-02", "SC-03", "FLY", "LAND", "FT", "FT-B", "GUN", "GUN-X", "GS", "GS2", "GS-R", "GS-X", "GS3", "TRC", "BASE", "AI-1", "AI-2", "AST-C", "RS-02", "RS-03", "RS-04", "RS-05", "RS-05b", "RS-07", "RS-08", "RS-09", "RS-10", "RS-11", "RS-16", "RS-00", "NEW"]);
    await shot(page, info, "picker");
  });

  test("UX-002 UX-003 the command palette runs any action; controls have tooltips with shortcuts", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    await expect(page.getByTestId("play")).toHaveAttribute("title", "Play (Space)");
    await expect(page.getByTestId("tool-impulse")).toHaveAttribute("title", "Impulse (I)");
    await page.keyboard.press("Control+k");
    await page.getByTestId("cmdk-input").fill("step 10");
    await page.keyboard.press("Enter");
    expect((await world(page)).tick).toBe(10);
  });

  test("UX-004 the status bar always shows a hint for the active tool", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    await expect(page.getByTestId("status-hint")).toContainText("Click an object");
    await page.keyboard.press("i");
    await expect(page.getByTestId("status-hint")).toContainText("Drag from a point on a body");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("status-hint")).toContainText("Click an object");
  });

  test("UX-005 overlay choices and the last unsaved experiment survive a reload", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    await page.getByTestId("overlay-com").click();
    await page.getByTestId("step10").click();
    await page.keyboard.press("i");
    await dragWorld(page, [-2.95, 0.1], [-2.95, 0.6]);
    await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
    await page.goto("./");
    await expect(page.getByTestId("resume")).toContainText("Elastic collision");
    await page.getByTestId("resume").click();
    await expect(page.getByTestId("overlay-com")).toHaveAttribute("aria-pressed", "true");
  });

  test("UX-006 an invalid scenario file shows its errors with JSON paths and keeps the current world", async ({ page }, info) => {
    await openStarter(page, "sc01-elastic-collision");
    const before = await hash(page);
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press("Control+o");
    await (await chooser).setFiles("e2e/fixtures/invalid.json");
    await expect(page.getByTestId("dialog-error")).toBeVisible();
    await expect(page.getByTestId("dialog-errors")).toContainText("$.profile");
    await expect(page.getByTestId("dialog-errors")).toContainText("$.world.bodies[0].shape.radius");
    await shot(page, info, "error-dialog");
    await page.getByTestId("dialog-close").click();
    expect(await hash(page)).toBe(before);
  });

  test("UX-007 leaving with unsaved changes asks first", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    await page.getByTestId("step10").click();
    await page.keyboard.press("Delete"); // nothing selected: no change
    const p = await toPage(page, 3, 0);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press("Delete");
    await page.getByTestId("scenarios").click();
    await expect(page.getByTestId("dialog-confirm")).toBeVisible();
    await page.getByTestId("dialog-cancel").click();
    await expect(page.getByTestId("sandbox")).toBeVisible();
    await page.getByTestId("scenarios").click();
    await page.getByTestId("dialog-ok").click();
    await expect(page.getByTestId("picker")).toBeVisible();
  });
});

test.describe("scenarios in the sandbox", () => {
  test("SCN-008 changing a parameter resets and reruns the scenario", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    await page.getByTestId("field-param-mB").fill("1");
    await page.getByTestId("field-param-mB").press("Enter");
    expect((await body(page, "b"))!.mass).toBe(1);
    expect((await world(page)).tick).toBe(0);
    await page.keyboard.press("Space");
    await waitForTick(page, 500);
    // Equal masses swap velocities.
    await expect(page.getByTestId("graph-value-vax")).toContainText("-1.0000");
  });

  test("SCN-010 starters open with their note, overlays and graphs switched on", async ({ page }) => {
    await openStarter(page, "rs02-off-centre-impact");
    await expect(page.getByTestId("look-for")).toContainText("off-centre");
    await expect(page.getByTestId("overlay-com")).toHaveAttribute("aria-pressed", "true");
    for (const g of ["rodVy", "rodW", "L"]) await expect(page.getByTestId(`graph-${g}`)).toBeVisible();
  });
});

test.describe("quality and accessibility", () => {
  test("SBX-042 SBX-043 every control has an accessible name and test id, and keyboard reaches them with a visible focus ring", async ({ page }) => {
    await openStarter(page, "sc01-elastic-collision");
    const unnamed = await page.$$eval("button, input", (els) =>
      els.filter((el) => !(el.getAttribute("aria-label") || el.textContent?.trim() || (el as HTMLInputElement).labels?.length || el.getAttribute("title"))).map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
    for (const id of ["play", "step", "step10", "reset", "undo", "redo", "save", "violations", "scrub"]) await expect(page.getByTestId(id)).toHaveCount(1);
    // Tab from the start of the page until Play has keyboard focus.
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      if (await page.getByTestId("play").evaluate((el) => el === document.activeElement)) break;
    }
    const outline = await page.getByTestId("play").evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
    await page.keyboard.press("Enter");
    await waitForTick(page, 30);
  });

  test("SBX-045 SBX-047 below 900 px the sandbox switches to a compact layout: sheets, and the tools as a strip under the world", async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStarter(page, "sc01-elastic-collision");
    // The tools stay, as a horizontal strip below the world (SBX-047), not a column beside it.
    const tools = await page.getByLabel("Tools").boundingBox();
    const view = await page.getByTestId("view").boundingBox();
    expect(tools!.y).toBeGreaterThan(view!.y + view!.height - 1);
    expect(tools!.width).toBeGreaterThan(tools!.height);
    await expect(page.getByTestId("play")).toBeVisible();
    await expect(page.getByTestId("scrub")).toBeVisible();
    await page.getByRole("button", { name: "Inspector" }).click();
    await expect(page.getByRole("dialog", { name: "Inspector" })).toBeVisible();
    await shot(page, info, "phone");
  });

  test("SBX-046 UI animations are off when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStarter(page, "sc01-elastic-collision");
    const d = await page.getByTestId("play").evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(d === "0s" || d === "").toBe(true);
  });

  test("SBX-040 RS-00 renders smoothly while running (frame rate recorded for review)", async ({ page }, info) => {
    await openStarter(page, "rs00-workload");
    await page.keyboard.press("Space");
    const fps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let n = 0;
          const t0 = performance.now();
          const f = () => {
            n++;
            if (performance.now() - t0 < 2000) requestAnimationFrame(f);
            else resolve((n * 1000) / (performance.now() - t0));
          };
          requestAnimationFrame(f);
        }),
    );
    info.annotations.push({ type: "fps", description: fps.toFixed(1) });
    await shot(page, info, "rs00-running");
    // CI machines have no GPU. The 60 fps target is for Chromium on the reference hardware (DEC-09,
    // docs/reviews/M1.md); other engines only record their rate here.
    if (info.project.name === "chromium") expect(fps).toBeGreaterThan(20);
    else expect(fps).toBeGreaterThan(0);
  });

  test("TST-010 UXV-004 screenshots of each reference scenario and panel state for review", async ({ page }, info) => {
    for (const s of ["sc01-elastic-collision", "rs02-off-centre-impact", "rs03-bullet-thin-wall", "rs04-box-stack"]) {
      await openStarter(page, s);
      for (let i = 0; i < 6; i++) await page.getByTestId("step10").click();
      await shot(page, info, `${s}-t60`);
    }
    const p = await toPage(page, 0, 0.5);
    await page.mouse.click(p.x, p.y);
    await shot(page, info, "inspector-selected");
    await page.keyboard.press("Control+k");
    await shot(page, info, "command-palette");
  });
});
