// Mammoth Asteroids on its own page (asteroids.html): the game alone, with nothing that leads to
// the sandbox (MAS-008).
import { render } from "preact";
import { useEffect } from "preact/hooks";
import "./styles.css";
import { asteroidsKeyDown, asteroidsKeyUp, AsteroidsApp } from "./Asteroids.tsx";
import { camera, sandbox } from "./state.ts";
import { toScreen } from "./camera.ts";
import { hashValue } from "../core/index.ts";
import { shown } from "./smooth.ts";
import { sim } from "./View.tsx";

function Game() {
  useEffect(() => {
    window.addEventListener("keydown", asteroidsKeyDown);
    window.addEventListener("keyup", asteroidsKeyUp);
    return () => {
      window.removeEventListener("keydown", asteroidsKeyDown);
      window.removeEventListener("keyup", asteroidsKeyUp);
    };
  }, []);
  return <AsteroidsApp />;
}

// Test hook, as on Lander's page: the live world, where world points are on the page, and the game's state.
(window as unknown as { __msb: unknown }).__msb = {
  sandbox: () => sandbox.value,
  toPage: (x: number, y: number) => {
    const view = document.querySelector('[data-testid="view"]')!.getBoundingClientRect();
    const s = toScreen(camera.value, { width: view.width, height: view.height }, { x, y });
    return { x: view.left + s.x, y: view.top + s.y };
  },
  hash: () => (sandbox.value ? hashValue(sandbox.value.world) : null),
  shown: () => shown.time,
  sim: () => ({ worker: sim.available, runs: sim.runs }),
  arcade: () => sandbox.value?.world.arcade?.state ?? null,
};

render(<Game />, document.getElementById("root")!);
