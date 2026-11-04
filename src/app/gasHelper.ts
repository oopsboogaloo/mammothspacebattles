// A gas helper thread (§10.1): steps the gas clusters the simulation worker hands it. Pure: the same
// job gives the same result wherever it runs.
/// <reference lib="webworker" />
import { runClusterJob, type ClusterJob } from "../core/index.ts";

self.onmessage = (e: MessageEvent<{ id: number; job: ClusterJob }>) => {
  const { id, job } = e.data;
  (self as unknown as Worker).postMessage({ id, result: runClusterJob(job, () => performance.now()) });
};
