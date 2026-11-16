// Renders each mockup HTML to a PNG beside it. Run from the repo root: node docs/blueprint/mockups/shoot.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sizes = { "06-ipad-landscape.html": [1180, 820] };
const browser = await chromium.launch();
for (const f of readdirSync(here).filter((n) => n.endsWith(".html")).sort()) {
  const [width, height] = sizes[f] ?? [1280, 800];
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  await page.goto("file://" + join(here, f));
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(here, f.replace(".html", ".png")) });
  await page.close();
  console.log("shot", f);
}
await browser.close();
