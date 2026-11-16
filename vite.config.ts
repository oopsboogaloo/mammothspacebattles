import { defineConfig } from "vite";

export default defineConfig({
  base: "/mammothspacebattles/",
  // The sandbox, Mammoth Lander, Mammoth Asteroids, Mammoth Thrust and Moon Mammoth each on its own page, the blueprint designer on its own (blueprint.html),
  // (lander.html, asteroids.html, thrust.html, moon.html: the game alone, to deploy), and the GPU gas
  // spike page (docs/gpu-gas-plan.md, Phase 0).
  build: { rolldownOptions: { input: { main: "index.html", lander: "lander.html", asteroids: "asteroids.html", thrust: "thrust.html", moon: "moon.html", blueprint: "blueprint.html", gpuSpike: "gpu-spike.html" } } },
});
