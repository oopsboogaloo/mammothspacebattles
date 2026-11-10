import { defineConfig } from "vite";

export default defineConfig({
  base: "/mammothspacebattles/",
  // The sandbox, Mammoth Lander on its own (lander.html: the game alone, to deploy), and the GPU gas
  // spike page (docs/gpu-gas-plan.md, Phase 0).
  build: { rolldownOptions: { input: { main: "index.html", lander: "lander.html", gpuSpike: "gpu-spike.html" } } },
});
