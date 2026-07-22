import { fileURLToPath } from "node:url";
import { startOpenScoutWebEdge } from "./edge.ts";

async function waitForWorkers(
  edge: Awaited<ReturnType<typeof startOpenScoutWebEdge>>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (edge.workers.every((worker) => worker.ready)) return;
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for parent-death fixture workers");
}

const workerPortBase = 48_000 + Math.floor(Math.random() * 500);
const edge = await startOpenScoutWebEdge({
  hostname: "127.0.0.1",
  port: 0,
  workerCount: 2,
  workerPortBase,
  workerEntry: fileURLToPath(new URL("./edge-fixture-worker.ts", import.meta.url)),
  healthIntervalMs: 50,
  healthTimeoutMs: 500,
  env: process.env,
});
await waitForWorkers(edge);
console.log(`OPENSCOUT_PARENT_DEATH_READY ${JSON.stringify({
  workerPids: edge.workers.map((worker) => worker.child?.pid),
})}`);
setInterval(() => {}, 60_000);
