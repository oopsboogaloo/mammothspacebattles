// Performance diagnostics (`?diag=1`): what each frame and each worker result cost on this device, kept
// in memory so a player can copy a summary and paste it back (iPad stutters can't be seen from here).

export interface RunLog {
  /** When it arrived, ms (performance.now). */
  at: number;
  steps: number;
  /** The worker's time stepping, ms. */
  ms: number;
  /** Its slowest step, ms. */
  worst: number;
  /** Its gas time, ms. */
  gasMs: number;
  /** Main-thread time taking it in (reading the message and accepting the run), ms. */
  takeMs: number;
  /** Where its slowest step's time went. */
  worstParts?: string;
}

// Never on the game's own page (lander.html, LND-060): what players get has no log, whatever the URL.
const on = typeof location !== "undefined" && new URLSearchParams(location.search).get("diag") === "1" && !location.pathname.endsWith("/lander.html");
const MAX = 20_000;

export const diag = {
  on,
  start: 0,
  frames: [] as number[], // gaps between frames, ms
  runs: [] as RunLog[],
  /** Freezes: frame gaps and worker steps over 100 ms, and when (s into play). */
  hitches: [] as { at: number; kind: "frame" | "step"; ms: number; parts?: string }[],
  lastFrame: 0,
  frame(now: number): void {
    if (!on) return;
    if (!this.start) this.start = now;
    if (this.lastFrame) this.frames.push(now - this.lastFrame);
    this.lastFrame = now;
    if (this.frames.length > MAX) this.frames.splice(0, this.frames.length - MAX);
    if (this.frames.length && this.frames[this.frames.length - 1] > 100) this.hitch("frame", this.frames[this.frames.length - 1], now);
  },
  hitch(kind: "frame" | "step", ms: number, now: number, parts?: string): void {
    this.hitches.push({ at: (now - this.start) / 1000, kind, ms, parts });
    if (this.hitches.length > 100) this.hitches.shift();
  },
  run(r: RunLog): void {
    if (!on) return;
    this.runs.push(r);
    if (r.worst > 100) this.hitch("step", r.worst, r.at, r.worstParts);
    if (this.runs.length > MAX) this.runs.splice(0, this.runs.length - MAX);
  },
  reset(): void {
    this.start = 0;
    this.lastFrame = 0;
    this.frames = [];
    this.runs = [];
    this.hitches = [];
  },
};

const q = (xs: number[], f: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(f * s.length))];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const f1 = (x: number) => x.toFixed(1);

/** The last `secs` seconds, live: frames a second, worst frame gap, and the worker's step time. */
export function liveStats(now: number, secs = 5): { fps: number; worstFrame: number; msPerStep: number; takeMs: number } {
  let t = 0;
  let n = 0;
  let worst = 0;
  for (let i = diag.frames.length - 1; i >= 0 && t < secs * 1000; i--) {
    t += diag.frames[i];
    worst = Math.max(worst, diag.frames[i]);
    n++;
  }
  const runs = diag.runs.filter((r) => r.at > now - secs * 1000);
  const steps = runs.reduce((a, r) => a + r.steps, 0);
  return { fps: t > 0 ? (1000 * n) / t : 0, worstFrame: worst, msPerStep: steps ? runs.reduce((a, r) => a + r.ms, 0) / steps : 0, takeMs: mean(runs.map((r) => r.takeMs)) };
}

/** A plain-text summary to paste back. */
export function summary(extra: Record<string, string | number>): string {
  const secs = (diag.lastFrame - diag.start) / 1000;
  const fr = diag.frames;
  const runs = diag.runs;
  const steps = runs.reduce((a, r) => a + r.steps, 0);
  const stepMs = runs.reduce((a, r) => a + r.ms, 0) / Math.max(1, steps);
  const takes = runs.map((r) => r.takeMs);
  const gaps: number[] = [];
  for (let i = 1; i < runs.length; i++) gaps.push(runs[i].at - runs[i - 1].at);
  // Rates over the samples kept (older ones are dropped past MAX), not the whole session.
  const frameSecs = fr.reduce((a, b) => a + b, 0) / 1000;
  const runSecs = runs.length > 1 ? (runs[runs.length - 1].at - runs[0].at) / 1000 : secs;
  const lines = [
    `MSB diag ${new Date().toISOString()}`,
    `device: ${navigator.userAgent}`,
    `cores ${navigator.hardwareConcurrency ?? "?"}, dpr ${devicePixelRatio}, view ${innerWidth}x${innerHeight}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    `played ${f1(secs)} s`,
    `frames: ${fr.length} (${f1(fr.length / Math.max(1e-9, frameSecs))}/s); gap p50 ${f1(q(fr, 0.5))} p95 ${f1(q(fr, 0.95))} max ${f1(Math.max(0, ...fr))} ms; over 33 ms ${fr.filter((x) => x > 33).length}, over 50 ${fr.filter((x) => x > 50).length}, over 100 ${fr.filter((x) => x > 100).length}`,
    `worker runs: ${runs.length}, ${f1(steps / Math.max(1, runs.length))} steps each, ${f1(steps / Math.max(1e-9, runSecs))} steps/s (real time needs 120 at 1x)`,
    `worker step: mean ${f1(stepMs)} ms, gas ${f1(runs.reduce((a, r) => a + r.gasMs, 0) / Math.max(1, steps))} ms, worst ${f1(Math.max(0, ...runs.map((r) => r.worst)))} ms; worst steps over 30 ms: ${runs.filter((r) => r.worst > 30).length} runs`,
    `between results: p50 ${f1(q(gaps, 0.5))} p95 ${f1(q(gaps, 0.95))} max ${f1(Math.max(0, ...gaps))} ms`,
    `page taking a result: mean ${f1(mean(takes))} p95 ${f1(q(takes, 0.95))} max ${f1(Math.max(0, ...takes))} ms`,
    `freezes over 100 ms (s into play): ${diag.hitches.map((h) => `${f1(h.at)} ${h.kind} ${h.ms.toFixed(0)}${h.parts ? ` (${h.parts})` : ""}`).join(", ") || "none"}`,
  ];
  return lines.join("\n");
}
