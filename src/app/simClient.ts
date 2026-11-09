// The page's side of the simulation worker: hands it runs of steps and takes the results into the
// sandbox when nothing has changed meanwhile. Falls back to stepping on the page when there is no
// worker (tests, old browsers) or the run in flight has gone stale.
import type { Sandbox } from "./controller.ts";
import type { RunRequest, RunResult } from "./simWorker.ts";
import type { Command } from "../core/index.ts";
import { diag } from "./diag.ts";
import { applyEventDelta } from "./eventDelta.ts";

export class SimClient {
  private worker: Worker | null = null;
  /** The sandbox and version the worker's world copy matches, if any. */
  private holds: { sb: Sandbox; version: number } | null = null;
  /** The run in flight, if any. */
  inFlight: { sb: Sandbox; version: number; cancelled: boolean } | null = null;
  /** Gas helper threads to use (`?helpers=N` on the page); none by default. */
  private helpers: number | undefined;
  /** Runs taken in so far, and gas cluster jobs helper threads ran in them (for tests and diagnostics). */
  runs = 0;
  helperJobs = 0;
  /** Live input waiting for the next run (see `input`). */
  private pending: Command[] = [];
  /** Called with each result taken in: steps applied, and whether a landing verdict stopped the run. */
  onRun: (steps: number, verdict: boolean) => void = () => {};

  constructor() {
    if (typeof Worker === "undefined") return;
    // `?worker=0` steps on the page instead (for comparison and debugging).
    const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
    if (q?.get("worker") === "0") return;
    if (q?.has("helpers")) this.helpers = Math.max(0, Number(q.get("helpers")) || 0);
    try {
      this.worker = new Worker(new URL("./simWorker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<RunResult>) => {
        const t0 = performance.now();
        const res = e.data;
        this.take(res);
        if (diag.on && res.run) diag.run({ at: t0, steps: res.run.steps, ms: res.run.timing.ms, worst: res.run.timing.worstMs, gasMs: res.run.timing.gasMs, takeMs: performance.now() - t0, worstParts: res.run.timing.worstParts });
      };
      this.worker.onerror = () => {
        this.worker = null; // carry on stepping on the page
        this.inFlight = null;
      };
    } catch {
      this.worker = null;
    }
  }

  get available(): boolean {
    return this.worker !== null;
  }

  /** Is a run in flight that the sandbox has since changed under (so its result will be dropped)? */
  stale(sb: Sandbox): boolean {
    return !!this.inFlight && (this.inFlight.sb !== sb || this.inFlight.version !== sb.version || this.inFlight.cancelled);
  }

  /**
   * Live input while running (a game's thrust buttons): applied at the start of the next run, on the
   * page and in the worker alike, so the run in flight carries on and the world isn't sent again
   * (an edit would do both: a stall of a run or two at every press). Returns false if there is no
   * worker, for the caller to edit instead.
   */
  input(commands: Command[]): boolean {
    if (!this.worker) return false;
    this.pending.push(...commands);
    return true;
  }

  /**
   * Applies queued live input now, on the page (pausing): edits made while paused then come after
   * it, so a release while paused isn't undone by its press on resume. The worker's copy is sent
   * again with the next run.
   */
  flush(sb: Sandbox): void {
    if (!this.pending.length) return;
    sb.input(this.pending);
    this.pending = [];
  }

  /** Starts a run of up to `steps` steps from the sandbox's world now. */
  request(sb: Sandbox, steps: number, budgetMs: number): void {
    if (!this.worker || this.inFlight) return;
    // Live input goes in at this tick: recorded on the page, and applied by the worker to its copy.
    let inputs: Command[] | undefined;
    if (this.pending.length) {
      inputs = this.pending;
      this.pending = [];
      const inSync = this.holds?.sb === sb && this.holds.version === sb.version;
      sb.input(inputs);
      if (inSync) this.holds = { sb, version: sb.version };
      else inputs = undefined; // the world goes whole, with them in it
    }
    const fresh = this.holds?.sb === sb && this.holds.version === sb.version;
    const req: RunRequest = {
      type: "run",
      version: sb.version,
      world: fresh ? undefined : sb.world,
      profile: sb.scenario.profile,
      timeline: [...sb.plan.timeline],
      edits: sb.edits,
      series: sb.series,
      steps,
      budgetMs,
      stopOnVerdict: true,
      helpers: this.helpers,
      inputs,
    };
    this.inFlight = { sb, version: sb.version, cancelled: false };
    this.holds = { sb, version: sb.version };
    this.worker.postMessage(req);
  }

  /** Drops the result of the run in flight (pause, scenario switch). */
  cancel(): void {
    if (this.inFlight) this.inFlight.cancelled = true;
  }

  private take(res: RunResult): void {
    const f = this.inFlight;
    this.inFlight = null;
    if (!f || f.version !== res.version) return;
    // The run began from the page's world at this version, so its log is the one the change is to.
    res.run.world.events = applyEventDelta(f.sb.world.events, res.events);
    if (!f.cancelled && f.sb.acceptRun(res.run, res.version)) {
      f.sb.version++;
      // The worker's copy carries on from the world just taken in.
      this.holds = { sb: f.sb, version: f.sb.version };
      this.runs++;
      this.helperJobs += res.helperJobs;
      this.onRun(res.run.steps, res.run.verdict);
      return;
    }
    this.holds = null; // the worker ran on from a world the page has dropped
  }
}
