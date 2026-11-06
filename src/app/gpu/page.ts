// The GPU gas spike page (gpu-spike.html, docs/gpu-gas-plan.md Phase 0). Runs the WebGPU sort and
// SPH passes in the simulation worker (on the page if the worker has no WebGPU), shows each size's
// substep time and the reference battle at 4× detail against the budget, and gives the results as
// text to copy and send.
//   ?quick=1           a short run (CI): the correctness check and two small sizes
//   ?sizes=4000,10000  sizes to time      ?batch=240  substeps per submit      ?where=page
import baseline from "../../../docs/perf/reference-battle-baseline.json";
import { estimate, type DeviceClass, type Estimate } from "./estimate.ts";
import { DEFAULT_SPIKE, runSpike, type AdapterReport, type CheckResult, type SizeResult, type SpikeEvent, type SpikeOptions } from "./spike.ts";

const q = new URLSearchParams(location.search);
const quick = q.get("quick") === "1";
const opts: SpikeOptions = {
  sizes: q.get("sizes")?.split(",").map(Number).filter((n) => n > 0) ?? (quick ? [1000, 4000] : DEFAULT_SPIKE.sizes),
  batch: Number(q.get("batch")) || (quick ? 20 : DEFAULT_SPIKE.batch),
  reps: quick ? 2 : DEFAULT_SPIKE.reps,
};
const deviceClass: DeviceClass = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? "phone" : "laptop";

interface State {
  status: "running" | "done" | "error" | "unavailable";
  message: string;
  where?: "worker" | "page";
  adapter?: AdapterReport;
  check?: CheckResult;
  sizes: SizeResult[];
  estimate?: Estimate;
}
const state: State = { status: "running", message: "Starting…", sizes: [] };
// For the browser test.
(window as unknown as { __spike: State }).__spike = state;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "–");

function report(): string {
  return JSON.stringify(
    {
      page: "gpu-spike",
      date: new Date().toISOString(),
      userAgent: navigator.userAgent,
      deviceClass,
      where: state.where,
      adapter: state.adapter,
      check: state.check,
      opts,
      sizes: state.sizes.map((s) => ({ ...s, fullUs: +s.fullUs.toFixed(1), sortUs: +s.sortUs.toFixed(1), physicsUs: +s.physicsUs.toFixed(1), neighbours: +s.neighbours.toFixed(1) })),
      estimate: state.estimate && { ...state.estimate, gasMs: +state.estimate.gasMs.toFixed(3), gasMsPeak: +state.estimate.gasMsPeak.toFixed(3) },
      status: state.status,
      message: state.message,
    },
    null,
    1,
  );
}

function render() {
  $("status").textContent = state.message;
  $("status").className = state.status;
  const a = state.adapter;
  $("adapter").textContent = a
    ? `${[a.vendor, a.architecture, a.device, a.description].filter(Boolean).join(" · ") || "unnamed adapter"}${a.fallback ? " (software fallback: not for timing)" : ""} — in the ${state.where}`
    : "";
  const c = state.check;
  $("check").innerHTML = c
    ? `<b class="${c.pass ? "go" : "nogo"}">${c.pass ? "Correct" : "WRONG"}</b> against the CPU: density within ${c.densityError.toExponential(1)}, sort ${c.sortOk ? "complete" : "lost parcels"}, momentum drift ${c.momentumDrift.toExponential(1)}`
    : "";
  $("rows").innerHTML = state.sizes
    .map(
      (s) =>
        `<tr><td>${s.n.toLocaleString("en")}</td><td><b>${fmt(s.fullUs)}</b></td><td>${fmt(s.sortUs)}</td><td>${fmt(s.physicsUs)}</td><td>${fmt((s.fullUs * 10000) / s.n)}</td><td>${fmt(s.neighbours, 0)}</td></tr>`,
    )
    .join("");
  const e = state.estimate;
  if (e) {
    const line = (k: DeviceClass, label: string) =>
      `<tr${k === deviceClass ? ' class="me"' : ""}><td>${label}</td><td>${fmt(e.budgetMs[k], 2)} ms</td><td><b class="${e.go[k] ? "go" : "nogo"}">${e.go[k] ? "GO" : "NO-GO"}</b></td><td>${e.maxParcels[k].toLocaleString("en")}</td></tr>`;
    $("estimate").innerHTML = `
      <p>Reference battle at 4× detail: <b>${Math.round(e.parcels).toLocaleString("en")}</b> parcels (peak ${Math.round(e.parcelsPeak).toLocaleString("en")}),
      <b>${fmt(e.substeps, 0)}</b> substeps a step, full gas ≈ ${fmt(e.restFactor, 2)} × the spike's passes.</p>
      <p>Gas on this device: <b>${fmt(e.gasMs, 2)} ms</b> a step (peak ${fmt(e.gasMsPeak, 2)} ms). Today's CPU gas: ${fmt(e.cpuGasMs, 1)} ms a step at 1× detail (Node).</p>
      <table><thead><tr><th>If this is a…</th><th>Gas budget</th><th>Verdict</th><th>Parcels in budget</th></tr></thead><tbody>
      ${line("phone", "mid-range phone (½ step)")}${line("laptop", "laptop (¼ step)")}</tbody></table>`;
  } else $("estimate").innerHTML = "";
  ($("report") as HTMLTextAreaElement).value = state.status === "running" && !state.sizes.length ? "" : report();
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
