import { defineConfig } from "vite";

export default defineConfig({
  base: "/mammothspacebattles/",
  // The sandbox, and the GPU gas spike page (docs/gpu-gas-plan.md, Phase 0).
  build: { rolldownOptions: { input: { main: "index.html", gpuSpike: "gpu-spike.html" } } },
});
