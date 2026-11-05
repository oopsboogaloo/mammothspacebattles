// The simulation runs in a worker off the main thread (§10.1); its results are the page's.
import { expect, test } from "@playwright/test";
import { hash, openStarter, waitForTick } from "./helpers.ts";

type Hook = {
  __msb: {
    sim: () => { worker: boolean; runs: number; helperJobs: number };
    sandbox: () => {
      world: { tick: number; links: { kind: string; id: string; from?: string; to?: string }[]; gas: { parcels: unknown[] } };
      goTo: (t: number) => void;
      snapshots: Map<number, unknown>;
      edit: (commands: unknown[], label: string) => void;
    };
  };
};

test("ARC-006 DET-001 Gunship 2 runs in the simulation worker, and replaying the same steps on the page gives the same world", async ({ page }) => {
  await openStarter(page, "gunship-2");
  await page.keyboard.down("q"); // both engines: gas, chambers, plume
  await page.keyboard.down("e");
  await page.getByTestId("play").click();
  await waitForTick(page, 120, 60_000);
  await page.getByTestId("play").click();
  await page.keyboard.up("q");
  await page.keyboard.up("e");
  const tick = () => page.evaluate(() => (window as unknown as Hook).__msb.sandbox().world.tick);
  await expect.poll(async () => {
    const a = await tick();
    await page.waitForTimeout(100);
    return (await tick()) === a;
  }).toBe(true);
  const sim = await page.evaluate(() => (window as unknown as Hook).__msb.sim());
  expect(sim.worker).toBe(true);
  expect(sim.runs).toBeGreaterThan(0);
  const t = await tick();
  const fromWorker = await hash(page);
  // Replay from the start on the page, without the worker's snapshots, to the same tick, edits (the
  // key presses) included.
  await page.evaluate((target) => {
    const sb = (window as unknown as Hook).__msb.sandbox();
    sb.snapshots = new Map([[0, sb.snapshots.get(0)]]);
    sb.goTo(target);
  }, t);
  expect(t).toBeGreaterThan(120);
  expect(await hash(page)).toBe(fromWorker);
});

test("NFR-004 DET-001 four ships firing, once their plumes draw apart, step their gas clusters in helper threads, and a replay on the page gives the same world", async ({ page }) => {
  test.setTimeout(420_000); // 420 heavy steps (WebKit manages about 5 a second), then the same again replayed on the page
  // Helpers are off by default; ask for two.
  await page.goto("./?helpers=2");
  await page.getByTestId("pick-gunship-2").click();
  await expect(page.getByTestId("sandbox")).toBeVisible();
  // Wire the target ships' engines to the same controls as the player's.
  await page.evaluate(() => {
    const sb = (window as unknown as Hook).__msb.sandbox();
    const feeds = sb.world.links.filter((l) => l.kind === "feed" && l.from === "tank" && String(l.to).startsWith("engine"));
    const links = ["t1", "t2", "t3"].flatMap((t) => [
      ...["l", "r"].map((s) => ({ id: `ctl-${t}-${s}`, kind: "control", channel: s === "l" ? "left" : "right", to: `${t}-engine-${s}` })),
      ...feeds.map((f) => ({ ...f, id: `${t}-${f.id}`, from: `${t}-tank`, to: `${t}-${f.to}` })),
    ]);
    sb.edit(links.map((link) => ({ type: "link.add", link })), "Fleet");
  });
  await page.keyboard.down("q");
  await page.keyboard.down("e");
  await page.getByTestId("play").click();
  await waitForTick(page, 420, 300_000); // the plumes draw apart into separate clusters
  await page.getByTestId("play").click();
  await page.keyboard.up("q");
  await page.keyboard.up("e");
  const tick = () => page.evaluate(() => (window as unknown as Hook).__msb.sandbox().world.tick);
  await expect.poll(async () => {
    const a = await tick();
    await page.waitForTimeout(100);
    return (await tick()) === a;
  }).toBe(true);
  expect(await page.evaluate(() => (window as unknown as Hook).__msb.sandbox().world.gas.parcels.length)).toBeGreaterThan(300);
  expect((await page.evaluate(() => (window as unknown as Hook).__msb.sim())).helperJobs).toBeGreaterThan(0);
  const t = await tick();
  const fromWorker = await hash(page);
  await page.evaluate((target) => {
    const sb = (window as unknown as Hook).__msb.sandbox();
    sb.snapshots = new Map([[0, sb.snapshots.get(0)]]);
    sb.goTo(target);
  }, t);
  expect(await hash(page)).toBe(fromWorker);
});
