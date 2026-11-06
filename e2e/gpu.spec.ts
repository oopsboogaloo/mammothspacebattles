// GPU gas spike page (docs/gpu-gas-plan.md, Phase 0). Headless Chromium has WebGPU only with
// --enable-unsafe-webgpu, on the SwiftShader software adapter: enough to check the shaders give the
// CPU's answers, not to time them.
import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--enable-unsafe-webgpu"] } });

test("the GPU spike runs its sort and SPH passes in the simulation worker and matches the CPU", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebGPU in CI only on Chromium's software adapter");
  test.setTimeout(240_000);
  await page.goto("./gpu-spike.html?quick=1");
  await page.waitForFunction(() => (window as unknown as { __spike: { status: string } }).__spike.status !== "running", null, { timeout: 200_000 });
  const s = await page.evaluate(() => (window as unknown as { __spike: { status: string; message: string; where: string; check: { pass: boolean; message: string }; sizes: unknown[]; estimate: unknown } }).__spike);
  expect(s.status, s.message).toBe("done");
  expect(s.where).toBe("worker");
  expect(s.check.pass, s.check.message).toBe(true);
  expect(s.sizes).toHaveLength(2);
  expect(s.estimate).toBeTruthy();
  await expect(page.locator("#report")).toHaveValue(/"page": "gpu-spike"/);
});
