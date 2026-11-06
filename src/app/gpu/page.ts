// The GPU gas spike page (gpu-spike.html, docs/gpu-gas-plan.md Phase 0 and 0b). Runs the WebGPU gas
// in the simulation worker (on the page if the worker has no WebGPU), shows the times and the
// reference battle against the budget, and gives the results as text to copy and send.
//   (default)          Spike 2b: one work-group per cluster, every substep in one dispatch, the
//                      neighbour search in work-group memory
//   ?mode=global       Spike 2 (neighbour search from GPU main memory); ?mode=global,shared both
//   ?spike=1           Spike 1: one dispatch per pass
//   ?quick=1           a short run (CI): the correctness check and two small layouts
//   ?sizes=500,1500  ?clusters=1,5  ?wgs=256  ?batch=240  ?where=page
import baseline from "../../../docs/perf/reference-battle-baseline.json";
import type { FusedMode, FusedResult } from "./fused.ts";
import { estimate, estimateFused, type DeviceClass, type Estimate, type FusedEstimate } from "./estimate.ts";
import { DEFAULT_SPIKE, runSpike, type AdapterReport, type CheckResult, type SizeResult, type SpikeEvent, type SpikeOptions } from "./spike.ts";

const q = new URLSearchParams(location.search);
const quick = q.get("quick") === "1";
const list = (name: string) => q.get(name)?.split(",").map(Number).filter((n) => n > 0);
const spike: 1 | 2 = q.get("spike") === "1" ? 1 : 2;
const modes = (q.get("mode") ?? "").split(",").filter((m): m is FusedMode => m === "global" || m === "shared");
const opts: SpikeOptions = {
  spike,
  fused: {
    sizes: list("sizes") ?? (quick ? [250, 1000] : DEFAULT_SPIKE.fused.sizes),
    clusters: list("clusters") ?? (quick ? [5] : DEFAULT_SPIKE.fused.clusters),
    wgs: list("wgs") ?? (quick ? [256] : DEFAULT_SPIKE.fused.wgs),
    modes: modes.length ? modes : DEFAULT_SPIKE.fused.modes,
  },
  sizes: list("sizes") ?? (quick ? [1000, 4000] : DEFAULT_SPIKE.sizes),
  batch: Number(q.get("batch")) || (quick ? 20 : DEFAULT_SPIKE.batch),
  reps: quick ? 2 : DEFAULT_SPIKE.reps,
};
const deviceClass: DeviceClass = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "phone" : "laptop";

interface State {
  spike: 1 | 2;
  status: "running" | "done" | "error" | "unavailable";
  message: string;
  where?: "worker" | "page";
  adapter?: AdapterReport;
  check?: CheckResult;
  sizes: SizeResult[];
  fused: FusedResult[];
  estimate?: Estimate;
  fusedEstimate?: FusedEstimate | null;
}
const state: State = { spike, status: "running", message: "Starting…", sizes: [], fused: [] };
// For the browser test.
(window as unknown as { __spike: State }).__spike = state;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "–");
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function report(): string {
  return JSON.stringify(
    {
      page: "gpu-spike",
      spike,
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      deviceClass,
      where: state.where,
      adapter: state.adapter,
      check: state.check,
      opts: spike === 2 ? { ...opts.fused, batch: opts.batch, reps: opts.reps } : { sizes: opts.sizes, batch: opts.batch, reps: opts.reps },
      sizes: spike === 1 ? state.sizes.map((s) => ({ ...s, fullUs: round(s.fullUs), sortUs: round(s.sortUs), physicsUs: round(s.physicsUs), neighbours: round(s.neighbours) })) : undefined,
      fused: spike === 2 ? state.fused.map((f) => ({ ...f, us: Number.isFinite(f.us) ? round(f.us) : null })) : undefined,
      estimate: spike === 1 ? state.estimate : state.fusedEstimate,
      status: state.status,
      message: state.message,
    },
    null,
    1,
  );
}

function renderSpike1() {
  $("head").innerHTML = "<tr><th>Parcels</th><th>µs / substep</th><th>sort</th><th>density + force</th><th>µs per 10k</th><th>neighbours</th></tr>";
  $("rows").innerHTML = state.sizes
    .map(
      (s) =>
        `<tr><td>${s.n.toLocaleString("en")}</td><td><b>${fmt(s.fullUs)}</b></td><td>${fmt(s.sortUs)}</td><td>${fmt(s.physicsUs)}</td><td>${fmt((s.fullUs * 10000) / s.n)}</td><td>${fmt(s.neighbours, 0)}</td></tr>`,
    )
    .join("");
  const e = state.estimate;
  if (!e) return void ($("estimate").innerHTML = "");
  const line = (k: DeviceClass, label: string) =>
    `<tr${k === deviceClass ? ' class="me"' : ""}><td>${label}</td><td>${fmt(e.budgetMs[k], 2)} ms</td><td><b class="${e.go[k] ? "go" : "nogo"}">${e.go[k] ? "GO" : "NO-GO"}</b></td><td>${e.maxParcels[k].toLocaleString("en")}</td></tr>`;
  $("estimate").innerHTML = `
    <p>Reference battle at 4× detail: <b>${Math.round(e.parcels).toLocaleString("en")}</b> parcels (peak ${Math.round(e.parcelsPeak).toLocaleString("en")}),
    <b>${fmt(e.substeps, 0)}</b> substeps a step, full gas ≈ ${fmt(e.restFactor, 2)} × the spike's passes.</p>
    <p>Gas on this device: <b>${fmt(e.gasMs, 2)} ms</b> a step (peak ${fmt(e.gasMsPeak, 2)} ms). Today's CPU gas: ${fmt(e.cpuGasMs, 1)} ms a step at 1× detail (Node).</p>
    <table><thead><tr><th>If this is a…</th><th>Gas budget</th><th>Verdict</th><th>Parcels in budget</th></tr></thead><tbody>
    ${line("phone", "mid-range phone (½ step)")}${line("laptop", "laptop (¼ step)")}</tbody></table>`;
}

function renderSpike2() {
  const layouts = opts.fused.clusters;
  $("head").innerHTML = `<tr><th>Parcels a cluster</th>${layouts.map((k) => `<th>${k} cluster${k > 1 ? "s" : ""}</th>`).join("")}</tr>`;
  const sizes = [...new Set(state.fused.map((f) => f.n))];
  $("rows").innerHTML = sizes
    .map((n) => {
      const cells = layouts.map((k) => {
        const rs = state.fused.filter((f) => f.n === n && f.clusters === k);
        if (!rs.length) return "<td></td>";
        const good = rs.filter((r) => Number.isFinite(r.us));
        if (!good.length) return `<td><b class="nogo">failed</b></td>`;
        const best = good.reduce((a, b) => (b.us < a.us ? b : a));
        const tag = (r: FusedResult) => `${r.wgs}${opts.fused.modes.length > 1 ? (r.mode === "shared" ? " wg" : " main") : ""}`;
        const others = rs.filter((r) => r !== best).map((r) => `${tag(r)}: ${Number.isFinite(r.us) ? fmt(r.us) : "failed"}`);
        return `<td><b>${fmt(best.us)}</b> <span class="muted">(${tag(best)}${others.length ? `; ${others.join(", ")}` : ""})</span></td>`;
      });
      return `<tr><td>${n.toLocaleString("en")}</td>${cells.join("")}</tr>`;
    })
    .join("");
  const e = state.fusedEstimate;
  if (!e) return void ($("estimate").innerHTML = "");
  const verdict = (ok: boolean, mine: boolean) => `<b class="${ok ? "go" : "nogo"}"${mine ? ' style="text-decoration: underline"' : ""}>${ok ? "GO" : "NO-GO"}</b>`;
  $("estimate").innerHTML = `
    <p>Reference battle: ${e.clusters} gas clusters, run side by side, so the largest sets the time (measured with ${e.measuredClusters} at once).
    Full gas ≈ ${fmt(e.restFactor, 2)} × these passes. Budget: ${fmt(e.budgetMs.phone, 2)} ms (phone, ½ step), ${fmt(e.budgetMs.laptop, 2)} ms (laptop or desktop, ¼ step).</p>
    <table><thead><tr><th>Detail</th><th>Largest cluster</th><th>Substeps a step</th><th>µs / substep</th><th>Gas a step</th><th>Phone</th><th>Laptop</th></tr></thead><tbody>
    ${e.details
      .map(
        (d) =>
          `<tr><td>${d.detail}×</td><td>${Math.round(d.biggest).toLocaleString("en")}</td><td>${fmt(d.substeps, 0)}</td><td>${fmt(d.usPerSubstep)}</td><td><b>${fmt(d.gasMs, 2)} ms</b></td><td>${verdict(d.go.phone, deviceClass === "phone")}</td><td>${verdict(d.go.laptop, deviceClass === "laptop")}</td></tr>`,
      )
      .join("")}</tbody></table>
    <p class="muted">Today's CPU gas: ${fmt(baseline.steady.gasMsPerStep, 1)} ms a step at 1× detail (Node). Times in µs per substep, all clusters together; in brackets the threads a work-group used, and the other sizes tried.</p>`;
}

function render() {
  $("title").textContent =
    spike === 1 ? "GPU gas spike 1: one dispatch per pass" : opts.fused.modes.includes("shared") ? "GPU gas spike 2b: one work-group per cluster, in work-group memory" : "GPU gas spike 2: one work-group per cluster";
  $("status").textContent = state.message;
  $("status").className = state.status;
  const a = state.adapter;
  $("adapter").textContent = a
    ? `${[a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(" · ") || "unnamed adapter"}${a.fallback ? " (software fallback: not for timing)" : ""}, up to ${a.maxComputeInvocationsPerWorkgroup} threads and ${Math.round(a.maxComputeWorkgroupStorageSize / 1024)} KB a work-group — in the ${state.where}`
    : "";
  const c = state.check;
  $("check").innerHTML = c
    ? `<b class="${c.pass ? "go" : "nogo"}">${c.pass ? "Correct" : "WRONG"}</b> against the CPU: density within ${c.densityError.toExponential(1)}, sort ${c.sortOk ? "complete" : "lost parcels"}, momentum drift ${c.momentumDrift.toExponential(1)}`
    : "";
  if (spike === 2) renderSpike2();
  else renderSpike1();
  ($("report") as HTMLTextAreaElement).value = state.status === "running" && !state.sizes.length && !state.fused.length ? "" : report();
}

function onEvent(ev: SpikeEvent, where: "worker" | "page") {
  switch (ev.kind) {
    case "adapter":
      state.adapter = ev.adapter;
      state.where = where;
      break;
    case "check":
      state.check = ev.check;
      break;
    case "size":
      state.sizes.push(ev.result);
      state.estimate = estimate(baseline, state.sizes);
      break;
    case "fused":
      state.fused.push(ev.result);
      state.fusedEstimate = estimateFused(baseline, state.fused);
      break;
    case "progress":
      state.message = ev.message;
      break;
    case "done":
      state.status = "done";
      state.message = "Done. Copy the results below and send them.";
      break;
    case "error":
      state.status = "error";
      state.message = `Error: ${ev.message}`;
      break;
  }
  render();
}

async function onPage() {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) {
    state.status = "unavailable";
    state.message = "This browser has no WebGPU (navigator.gpu is missing). Chrome 113+, Edge, Safari 26+ or Firefox 141+ on Windows have it.";
    render();
    return;
  }
  await runSpike(gpu, opts, (e) => onEvent(e, "page"), "page");
}

function start() {
  render();
  if (q.get("where") === "page" || typeof Worker === "undefined") return void onPage();
  const w = new Worker(new URL("../simWorker.ts", import.meta.url), { type: "module" });
  w.onmessage = (m: MessageEvent<{ type: string; event: SpikeEvent }>) => {
    if (m.data.type !== "gpuSpike") return;
    if (m.data.event.kind === "error" && m.data.event.message === "no WebGPU in workers") {
      w.terminate();
      state.message = "No WebGPU in workers here; running on the page instead.";
      render();
      return void onPage();
    }
    onEvent(m.data.event, "worker");
  };
  w.onerror = (e) => onEvent({ kind: "error", message: e.message || "worker failed" }, "worker");
  w.postMessage({ type: "gpuSpike", opts });
}

$("copy").addEventListener("click", async () => {
  const text = report();
  try {
    await navigator.clipboard.writeText(text);
    $("copy").textContent = "Copied";
  } catch {
    const t = $("report") as HTMLTextAreaElement;
    t.select();
    $("copy").textContent = "Select-all done: copy it";
  }
});
start();
