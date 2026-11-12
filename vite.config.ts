import { defineConfig } from "vite";

export default defineConfig({
  base: "/mammothspacebattles/",
  // The sandbox, Mammoth Lander, Mammoth Asteroids and Mammoth Thrust each on its own page
  // (lander.html, asteroids.html, thrust.html: the game alone, to deploy), and the GPU gas
  // spike page (docs/gpu-gas-plan.md, Phase 0).
  build: { rolldownOptions: { input: { main: "index.html", lander: "lander.html", asteroids: "asteroids.html", thrust: "thrust.html", gpuSpike: "gpu-spike.html" } } },
});
