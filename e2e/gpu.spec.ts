// GPU gas spike page (docs/gpu-gas-plan.md, Phases 0 and 0b). Headless Chromium has WebGPU only
// with --enable-unsafe-webgpu, on the SwiftShader software adapter: enough to check the shaders give
// the CPU's answers, not to time them. The test launches its own Chromium with that flag (other
// engines reject it), so it asks for no page fixture and skips before any browser starts elsewhere.
import { chromium, expect, test } from "@playwright/test";

type Spike = { status: string; message: string; where: string; check: { pass: boolean; message: string }; sizes: unknown[]; fused: unknown[]; estimate: unknown; fusedEstimate: unknown };

for (const [name, query, rows] of [
  ["Spike 2b: one work-group per cluster, the neighbour search in work-group memory", "quick=1", "fused"],
  ["Spike 2: one work-group per cluster, the neighbour search from GPU main memory", "quick=1&mode=global", "fused"],
  ["Spike 1: one dispatch per pass", "spike=1&quick=1", "sizes"],
] as const) {
  test(`the GPU gas spike page, ${name}, runs in the simulation worker and matches the CPU`, async ({ browserName, baseURL }) => {
    test.skip(browserName !== "chromium", "WebGPU in CI only on Chromium's software adapter");
    test.setTimeout(240_000);
    const browser = await chromium.launch({ args: ["--enable-unsafe-webgpu"] });
    try {
      const page = await browser.newPage();
      await page.goto(new URL(`gpu-spike.html?${query}`, baseURL).href);
      await page.waitForFunction(() => (window as unknown as { __spike: Spike }).__spike.status !== "running", null, { timeout: 200_000 });
      const s = await page.evaluate(() => (window as unknown as { __spike: Spike }).__spike);
      expect(s.status, s.message).toBe("done");
      expect(s.where).toBe("worker");
      expect(s.check.pass, s.check.message).toBe(true);
      expect(s[rows]).toHaveLength(2);
      expect(rows === "fused" ? s.fusedEstimate : s.estimate).toBeTruthy();
      await expect(page.locator("#report")).toHaveValue(/"page": "gpu-spike"/);
    } finally {
      await browser.close();
    }
  });
}
