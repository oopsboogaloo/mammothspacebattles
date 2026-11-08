// The simulation worker (§10.1, PRF): steps the world off the main thread, so drawing and input stay
// smooth while the physics runs. It keeps its own copy of the world between runs; the page sends a new
// one only when its own has changed (an edit, undo, scrub). Same code as the page, so same results.
/// <reference lib="webworker" />
import { applyCommands, getProfile, runClusterJob, runGasJob, stepGasClustered, type ClusterJob, type ClusterResult, type Command, type GasJob, type World } from "../core/index.ts";
import { runStepsAsync, type Edit, type Series, type StepRun } from "./controller.ts";

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
  /** Gas helper threads to use (the page's `?helpers=N`); default none. */
  helpers?: number;
  /** Live input to apply to this copy first (the page has: its version is one past this copy's). */
  inputs?: Command[];
}

export interface RunResult {
  type: "done";
  version: number;
  run: StepRun;
  /** Gas cluster jobs the helper threads ran in this run. */
  helperJobs: number;
}

let world: World | null = null;
let version = -1;

// Gas helper threads (§10.1): each step's gas clusters are spread over this thread and them. Off unless
// the page asks (`?helpers=N`): on a 4-core machine, copying clusters to and from them every step cost
// more than it saved (a four-ship fleet: 27 ms a step alone, 42 with one helper, 47 with two).
const MAX_HELPERS = typeof Worker === "undefined" ? 0 : Math.max(0, Math.min(4, (navigator.hardwareConcurrency ?? 2) - 1));
let HELPERS = 0;
const helpers: Worker[] = [];
const waiting = new Map<number, (r: ClusterResult) => void>();
let nextJob = 0;
let helperJobs = 0;
function helper(k: number): Worker {
  while (helpers.length <= k) {
    const w = new Worker(new URL("./gasHelper.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; result: ClusterResult }>) => {
      waiting.get(e.data.id)?.(e.data.result);
      waiting.delete(e.data.id);
    };
    helpers.push(w);
  }
  return helpers[k];
}
const clock = () => performance.now();
/** Spreads the clusters over this thread and the helpers, biggest first to the least loaded. */
async function runClusters(jobs: ClusterJob[]): Promise<ClusterResult[]> {
  const load = new Array(HELPERS + 1).fill(0); // 0 is this thread
  const lanes: number[][] = load.map(() => []);
  const order = jobs.map((_, k) => k).sort((a, b) => jobs[b].parcels.length - jobs[a].parcels.length || a - b);
  for (const k of order) {
    let best = 0;
    for (let t = 1; t < load.length; t++) if (load[t] < load[best]) best = t;
    load[best] += jobs[k].parcels.length;
    lanes[best].push(k);
  }
  const results: ClusterResult[] = new Array(jobs.length);
  const sent = lanes.slice(1).flatMap((lane, t) =>
    lane.map(
      (k) =>
        new Promise<void>((resolve) => {
          const id = nextJob++;
          waiting.set(id, (r) => {
            results[k] = r;
            resolve();
          });
          helper(t).postMessage({ id, job: jobs[k] });
          helperJobs++;
        }),
    ),
  );
  for (const k of lanes[0]) results[k] = runClusterJob(jobs[k], clock);
  await Promise.all(sent);
  return results;
}
async function runGas(job: GasJob) {
  if (HELPERS === 0) return stepGasClustered(job.gas, job.bodies, job.joints, job.dt, job.bounds, job.gravity, job.closed, job.timings);
  return runGasJob(job, async (jobs) => (jobs.length < 2 ? jobs.map((j) => runClusterJob(j, clock)) : runClusters(jobs)));
}

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
  HELPERS = Math.min(MAX_HELPERS, req.helpers ?? 0);
  if (req.world) world = req.world;
  else if (version !== (req.inputs ? req.version - 1 : req.version) || !world) return; // a stale request: the page will resend
  if (req.inputs && !req.world) applyCommands(world, req.inputs, getProfile(req.profile));
  const start = performance.now();
  helperJobs = 0;
  const run = await runStepsAsync(world, { profile: getProfile(req.profile), timeline: new Map(req.timeline), edits: req.edits, series: req.series }, req.steps, runGas, {
    deadline: () => performance.now() - start > req.budgetMs,
    stopOnVerdict: req.stopOnVerdict,
  });
  // The page takes the result as its next version; this copy carries on from it.
  version = req.version + 1;
  (self as unknown as Worker).postMessage({ type: "done", version: req.version, run, helperJobs } satisfies RunResult);
};
