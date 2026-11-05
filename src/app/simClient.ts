// The page's side of the simulation worker: hands it runs of steps and takes the results into the
// sandbox when nothing has changed meanwhile. Falls back to stepping on the page when there is no
// worker (tests, old browsers) or the run in flight has gone stale.
import type { Sandbox } from "./controller.ts";
import type { RunRequest, RunResult } from "./simWorker.ts";

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
      this.worker.onmessage = (e: MessageEvent<RunResult>) => this.take(e.data);
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

  /** Starts a run of up to `steps` steps from the sandbox's world now. */
  request(sb: Sandbox, steps: number, budgetMs: number): void {
    if (!this.worker || this.inFlight) return;
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
