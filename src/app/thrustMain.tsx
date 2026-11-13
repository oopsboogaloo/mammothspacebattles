// Mammoth Thrust on its own page (thrust.html): the game alone, with nothing that leads to the sandbox.
import { render } from "preact";
import { useEffect } from "preact/hooks";
import "./styles.css";
import { startThrust, thrustKeyDown, thrustKeyUp, ThrustApp } from "./Thrust.tsx";
import { camera, edit, sandbox } from "./state.ts";
import { toScreen } from "./camera.ts";
import { hashValue, type Command } from "../core/index.ts";
import { shown } from "./smooth.ts";
import { sim } from "./View.tsx";

function Game() {
  useEffect(() => {
    window.addEventListener("keydown", thrustKeyDown);
    window.addEventListener("keyup", thrustKeyUp);
    return () => {
      window.removeEventListener("keydown", thrustKeyDown);
      window.removeEventListener("keyup", thrustKeyUp);
    };
  }, []);
  return <ThrustApp />;
}

// Test hook, as on the other games' pages: the live world, where world points are on the page, and the game's state.
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
  camera: () => camera.value,
  thrust: () => sandbox.value?.world.thrust?.state ?? null,
  level: () => sandbox.value?.world.thrust?.spec.level ?? null,
  // For tests: play from level n.
  play: (n: number) => startThrust(n),
  // For tests: an edit to the world, as the sandbox makes them (to put the ship where a test needs it).
  edit: (commands: Command[]) => edit(commands, "Test", Math.floor(Math.random() * 1e9)),
};

render(<Game />, document.getElementById("root")!);
