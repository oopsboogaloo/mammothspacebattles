// The simulation worker (§10.1, PRF): steps the world off the main thread, so drawing and input stay
// smooth while the physics runs. It keeps its own copy of the world between runs; the page sends a new
// one only when its own has changed (an edit, undo, scrub). Same code as the page, so same results.
/// <reference lib="webworker" />
import { getProfile, type Command, type World } from "../core/index.ts";
import { runSteps, type Edit, type Series, type StepRun } from "./controller.ts";

export interface RunRequest {
  type: "run";
  /** The page's sandbox version this run starts from. */
  version: number;
  /** The world to start from, if the worker's copy is not the one at `version`. */
  world?: World;
  profile: string;
  timeline: [number, Command[]][];
  edits: Edit[];
  series: Series[];
  steps: number;
  /** Stop after this long, ms, so results keep coming. */
  budgetMs: number;
  stopOnVerdict: boolean;
}

export interface RunResult {
  type: "done";
  version: number;
  run: StepRun;
}

let world: World | null = null;
let version = -1;

self.onmessage = (e: MessageEvent<RunRequest>) => {
  const req = e.data;
  if (req.world) world = req.world;
  else if (version !== req.version || !world) return; // a stale request: the page will resend
  const start = performance.now();
  const run = runSteps(world, { profile: getProfile(req.profile), timeline: new Map(req.timeline), edits: req.edits, series: req.series }, req.steps, {
    deadline: () => performance.now() - start > req.budgetMs,
    stopOnVerdict: req.stopOnVerdict,
  });
  // The page takes the result as its next version; this copy carries on from it.
  version = req.version + 1;
  (self as unknown as Worker).postMessage({ type: "done", version: req.version, run } satisfies RunResult);
};
