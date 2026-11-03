import { defineConfig, devices } from "@playwright/test";

// E2E_BROWSERS=chromium,firefox,webkit selects engines (SBX-041). Default: chromium.
const wanted = (process.env.E2E_BROWSERS ?? "chromium").split(",").map((s) => s.trim());
const all = {
  chromium: devices["Desktop Chrome"],
  firefox: devices["Desktop Firefox"],
  webkit: devices["Desktop Safari"],
} as const;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4173/mammothspacebattles/", trace: "retain-on-failure" },
  projects: wanted.filter((n): n is keyof typeof all => n in all).map((name) => ({ name, use: { ...all[name] } })),
  webServer: {
    command: "pnpm exec vite --port 4173 --strictPort",
    url: "http://localhost:4173/mammothspacebattles/",
    reuseExistingServer: !process.env.CI,
  },
});
