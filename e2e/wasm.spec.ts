import { expect, test, type Page } from "@playwright/test";

// The constraint solve runs in WebAssembly by default (docs/perf/rust-trial.md), in the simulation
// worker and on the page; `?wasm=0` uses the TypeScript one. The game must play the same either way.
async function playOrbital(page: Page, query: string): Promise<string> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("worker", (w) => w.on("console", (m) => m.type() === "error" && errors.push(m.text())));
  await page.goto(`./?game=lander&diag=1${query}`);
  await page.getByTestId("lander-title").click();
  await page.getByTestId("lander-pick-lander-orbital").click();
  const hud = page.getByTestId("lander-hud");
  await expect(hud).toBeVisible();
  const start = await hud.innerText();
  await page.keyboard.down("e");
  await expect(hud).not.toHaveText(start, { timeout: 10_000 });
  await page.waitForTimeout(2000);
  await page.keyboard.up("e");
  await page.getByTestId("lander-diag-copy").click();
  const log = await page.getByLabel("Diagnostics log (copied)").inputValue();
  // The worker delivered runs of steps (so it stepped, with the module loaded there).
  expect(Number(/worker runs: (\d+)/.exec(log)?.[1] ?? 0)).toBeGreaterThan(5);
  expect(errors).toEqual([]);
  return log;
}

test("the game steps with the WebAssembly solver in the worker by default", async ({ page }) => {
  expect(await playOrbital(page, "")).toContain("solver: WebAssembly");
});

test("?wasm=0 steps with the TypeScript solver", async ({ page }) => {
  expect(await playOrbital(page, "&wasm=0")).toContain("solver: TypeScript");
});
