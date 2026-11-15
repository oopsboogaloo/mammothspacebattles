// Moon Mammoth on its own page (moon.html): the game alone, with nothing that leads to the sandbox.
import { render } from "preact";
import { useEffect } from "preact/hooks";
import "./styles.css";
import { MoonApp, moonKeyDown, moonKeyUp, startMoon } from "./Moon.tsx";
import { camera, edit, sandbox } from "./state.ts";
import { hashValue, moonAim, moonRope, type Command } from "../core/index.ts";
import { shown } from "./smooth.ts";
import { sim } from "./View.tsx";
import { moonTurn } from "./moonRender.ts";

function Game() {
  useEffect(() => {
    window.addEventListener("keydown", moonKeyDown);
    window.addEventListener("keyup", moonKeyUp);
    return () => {
      window.removeEventListener("keydown", moonKeyDown);
      window.removeEventListener("keyup", moonKeyUp);
    };
  }, []);
  return <MoonApp />;
}

// Test hook, as on the other games' pages: the live world, the game's state, and the view.
(window as unknown as { __msb: unknown }).__msb = {
  sandbox: () => sandbox.value,
  hash: () => (sandbox.value ? hashValue(sandbox.value.world) : null),
  shown: () => shown.time,
  sim: () => ({ worker: sim.available, runs: sim.runs }),
  camera: () => camera.value,
  moon: () => sandbox.value?.world.moon?.state ?? null,
  mammoth: () => {
    const w = sandbox.value?.world;
    return w?.bodies.find((b) => b.id === w.moon?.spec.mammoth) ?? null;
  },
  // How far the drawing is turned, rad clockwise.
  turn: () => (sandbox.value ? moonTurn(sandbox.value.world, performance.now()) : 0),
  // Where the tools point, and the mammoth's rope, if it has one out.
  aim: () => (sandbox.value ? moonAim(sandbox.value.world) : null),
  rope: () => (sandbox.value ? (moonRope(sandbox.value.world) ?? null) : null),
  play: (level?: string) => startMoon(level),
  // For tests: an edit to the world, as the sandbox makes them (to put the mammoth where a test needs it).
  edit: (commands: Command[]) => edit(commands, "Test", Math.floor(Math.random() * 1e9)),
};

render(<Game />, document.getElementById("root")!);
