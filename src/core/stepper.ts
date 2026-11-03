// Fixed-timestep accumulator for real-time clients (ARC-006, SBX-002, SBX-005).
// The UI reports elapsed wall time; this says how many fixed steps to run.
// Time scale changes the number of steps, never the step length.

export interface StepperState {
  accumulator: number; // simulated seconds owed
}

export interface StepperResult {
  steps: number;
  /** Simulated seconds advanced per real second this frame. */
  achievedScale: number;
  /** True when the step cap was hit and owed time was dropped. */
  fellBehind: boolean;
}

export function createStepper(): StepperState {
  return { accumulator: 0 };
}

export function advanceStepper(
  state: StepperState,
  realSeconds: number,
  opts: { timestep: number; timeScale: number; maxStepsPerFrame: number },
): StepperResult {
  if (!(realSeconds > 0)) return { steps: 0, achievedScale: 0, fellBehind: false };
  state.accumulator += realSeconds * opts.timeScale;
  // Small epsilon so 1/60 s at 1/240 s steps gives exactly 4 steps despite rounding.
  let steps = Math.floor(state.accumulator / opts.timestep + 1e-9);
  let fellBehind = false;
  if (steps > opts.maxStepsPerFrame) {
    steps = opts.maxStepsPerFrame;
    fellBehind = true;
    state.accumulator = 0;
  } else {
    state.accumulator = Math.max(0, state.accumulator - steps * opts.timestep);
  }
  return { steps, achievedScale: (steps * opts.timestep) / realSeconds, fellBehind };
}
