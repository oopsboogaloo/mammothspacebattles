import { expect, test, type Page } from "@playwright/test";

// The constraint solve and the gas loop run in WebAssembly (docs/perf/rust-trial.md), in the
// simulation worker and on the page: the module must load and step in both.
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

test("the game steps in the worker, with the WebAssembly module loaded there", async ({ page }) => {
  expect(await playOrbital(page, "")).toContain("scenario: lander-orbital");
});

test("?worker=0 steps on the page, with the module loaded there", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./?game=lander&diag=1&worker=0");
  await page.getByTestId("lander-title").click();
  await page.getByTestId("lander-pick-lander-orbital").click();
  const hud = page.getByTestId("lander-hud");
  await expect(hud).toBeVisible();
  const start = await hud.innerText();
  await page.keyboard.down("e");
  await expect(hud).not.toHaveText(start, { timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.keyboard.up("e");
  expect(errors).toEqual([]);
});
