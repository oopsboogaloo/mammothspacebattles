// Mammoth Lander on its own page (lander.html): the game alone, for deploying. It is the same game
// as the sandbox's (`?game=lander`), with nothing that leads back to the sandbox.
import { render } from "preact";
import { useEffect } from "preact/hooks";
import "./styles.css";
import { gameKeyDown, gameKeyUp, LanderApp, openLander, standalone } from "./Lander.tsx";
import { camera, sandbox } from "./state.ts";
import { toScreen } from "./camera.ts";
import { hashValue } from "../core/index.ts";
import { shown } from "./smooth.ts";
import { sim } from "./View.tsx";

standalone.value = true;
openLander();

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

function Game() {
  useEffect(() => {
    // Typing initials for a high score is just typing.
    const down = (e: KeyboardEvent) => !isTyping(e) && gameKeyDown(e);
    const up = (e: KeyboardEvent) => gameKeyUp(e);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  return <LanderApp />;
}

// Test hook, as on the sandbox page: the live world and where world points are on the page.
(window as unknown as { __msb: unknown }).__msb = {
  sandbox: () => sandbox.value,
  toPage: (x: number, y: number) => {
    const view = document.querySelector('[data-testid="view"]')!.getBoundingClientRect();
    const s = toScreen(camera.value, { width: view.width, height: view.height }, { x, y });
    return { x: view.left + s.x, y: view.top + s.y };
  },
  hash: () => (sandbox.value ? hashValue(sandbox.value.world) : null),
  shown: () => shown.time,
  sim: () => ({ worker: sim.available, runs: sim.runs, helperJobs: sim.helperJobs }),
};

render(<Game />, document.getElementById("root")!);
