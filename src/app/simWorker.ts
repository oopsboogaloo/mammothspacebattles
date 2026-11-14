// The simulation worker (§10.1, PRF): steps the world off the main thread, so drawing and input stay
// smooth while the physics runs. It keeps its own copy of the world between runs; the page sends a new
// one only when its own has changed (an edit, undo, scrub). Same code as the page, so same results.
/// <reference lib="webworker" />
import { applyCommands, getProfile, type Body, type Command, type World } from "../core/index.ts";
import { RockStubs, runChangesBodies } from "./rockStubs.ts";
import { runSteps, type Edit, type Series, type StepRun } from "./controller.ts";
import { eventDelta, type EventDelta } from "./eventDelta.ts";

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
  /** Live input to apply to this copy first (the page has: its version is one past this copy's). */
  inputs?: Command[];
}

export interface RunResult {
  type: "done";
  version: number;
  /** Its world's event log is left empty: `events` is the change to the page's log. */
  run: StepRun;
  events: EventDelta;
}

let world: World | null = null;
let version = -1;

const rock = new RockStubs();

/** The GPU gas spike page (gpu-spike.html) runs its WebGPU passes here, in the simulation worker. */
export interface GpuSpikeRequest {
  type: "gpuSpike";
  opts: import("./gpu/spike.ts").SpikeOptions;
}
async function gpuSpike(req: GpuSpikeRequest) {
  const post = (event: import("./gpu/spike.ts").SpikeEvent) => (self as unknown as Worker).postMessage({ type: "gpuSpike", event });
  const gpu = (self.navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return post({ kind: "error", message: "no WebGPU in workers" });
  const { runSpike } = await import("./gpu/spike.ts");
  await runSpike(gpu, req.opts, post, "worker");
}

self.onmessage = async (e: MessageEvent<RunRequest | GpuSpikeRequest>) => {
  if (e.data.type === "gpuSpike") return gpuSpike(e.data);
  const req = e.data;
  if (req.world) {
    world = req.world;
    rock.forget();
  }
  else if (version !== (req.inputs ? req.version - 1 : req.version) || !world) return; // a stale request: the page will resend
  if (req.inputs && !req.world) applyCommands(world, req.inputs, getProfile(req.profile));
  const before = world.events.slice();
  const start = performance.now();
  const run = runSteps(world, { profile: getProfile(req.profile), timeline: new Map(req.timeline), edits: req.edits, series: req.series }, req.steps, {
    deadline: () => performance.now() - start > req.budgetMs,
    stopOnVerdict: req.stopOnVerdict,
  });
  // A command that can change a body in place applied in this run: every body goes whole this time.
  if (runChangesBodies(req, run.from, run.steps)) rock.forget();
  // The page takes the result as its next version; this copy carries on from it.
  version = req.version + 1;
  const events = eventDelta(before, world.events);
  const sent: StepRun = { ...run, world: { ...world, events: [], bodies: rock.pack(world) as Body[] } };
  (self as unknown as Worker).postMessage({ type: "done", version: req.version, run: sent, events } satisfies RunResult);
};
