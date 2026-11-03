import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

interface Hook {
  __msb: {
    sandbox: () => { world: World; tick: number; maxTick: number; dirty: boolean } | null;
    toPage: (x: number, y: number) => { x: number; y: number };
    hash: () => string | null;
  };
}
interface World {
  tick: number;
  bodies: { id: string; position: { x: number; y: number }; velocity: { x: number; y: number }; angle: number; mass: number; fixed: boolean }[];
  events: { tick: number; type: string; data: Record<string, unknown> }[];
  ledger: { violations: number };
}

/** Counts user actions in a workflow so its action budget can be enforced (UXV-001). */
export class Budget {
  count = 0;
  private readonly page: Page;
  private readonly limit: number;
  constructor(page: Page, limit: number) {
    this.page = page;
    this.limit = limit;
  }
  async click(target: Locator): Promise<void> {
    this.count++;
    await target.click();
  }
  async press(key: string): Promise<void> {
    this.count++;
    await this.page.keyboard.press(key);
  }
  async clickWorld(x: number, y: number): Promise<void> {
    this.count++;
    const p = await toPage(this.page, x, y);
    await this.page.mouse.click(p.x, p.y);
  }
  async dragWorld(from: [number, number], to: [number, number]): Promise<void> {
    this.count++;
    await dragWorld(this.page, from, to);
  }
  done(): void {
    expect(this.count, `workflow used ${this.count} actions, budget ${this.limit}`).toBeLessThanOrEqual(this.limit);
  }
}

export async function toPage(page: Page, x: number, y: number) {
  return page.evaluate(([x, y]) => (window as unknown as Hook).__msb.toPage(x, y), [x, y] as const);
}

export async function dragWorld(page: Page, from: [number, number], to: [number, number], steps = 8) {
  const a = await toPage(page, ...from);
  const b = await toPage(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

export async function world(page: Page): Promise<World> {
  return page.evaluate(() => (window as unknown as Hook).__msb.sandbox()!.world);
}

export async function hash(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as Hook).__msb.hash());
}

export async function body(page: Page, id: string) {
  const w = await world(page);
  return w.bodies.find((b) => b.id === id);
}

export async function openStarter(page: Page, file: string) {
  await page.goto("./");
  await page.getByTestId(`pick-${file}`).click();
  await expect(page.getByTestId("sandbox")).toBeVisible();
  // Let layout settle (two frames) before tests aim at world coordinates.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

export async function waitForTick(page: Page, atLeast: number, timeout = 15_000) {
  // Read only the step count: copying the whole world (every gas parcel) out of the page on each poll is slow in some engines.
  const tick = () => page.evaluate(() => (window as unknown as Hook).__msb.sandbox()!.world.tick);
  await expect.poll(tick, { timeout }).toBeGreaterThanOrEqual(atLeast);
}

/** Saves a screenshot for milestone review (TST-010, UXV-004). */
export async function shot(page: Page, info: TestInfo, name: string) {
  const path = join("test-results", "screens", info.project.name, `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}
