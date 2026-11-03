// Placeholder UI for M0: drives the headless core through the fixed-step
// accumulator (ARC-006). The real sandbox UI arrives in M1.
import { advanceStepper, createStepper, createWorld, getProfile, stepInPlace } from "./core/index.ts";

const profile = getProfile("sandbox");
const world = createWorld(1);
const stepper = createStepper();

const root = document.getElementById("root");
if (root) {
  root.innerHTML = `
    <h1>Mammoth Space Battles</h1>
    <p>Physics sandbox rebuild in progress — milestone M0 (foundation). See the
      <a href="https://github.com/oopsboogaloo/mammothspacebattles/blob/main/docs/spec.md">spec</a>.</p>
    <p>Core running headless in your browser: tick <span data-testid="tick">0</span>,
      t = <span data-testid="time">0.000</span> s.</p>`;
}
const tickEl = document.querySelector<HTMLElement>('[data-testid="tick"]');
const timeEl = document.querySelector<HTMLElement>('[data-testid="time"]');

let last = performance.now();
function frame(now: number): void {
  const { steps } = advanceStepper(stepper, (now - last) / 1000, { timestep: profile.timestep, timeScale: 1, maxStepsPerFrame: 40 });
  last = now;
  for (let i = 0; i < steps; i++) stepInPlace(world, [], profile);
  if (tickEl) tickEl.textContent = String(world.tick);
  if (timeEl) timeEl.textContent = world.time.toFixed(3);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
