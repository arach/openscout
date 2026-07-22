import { fileURLToPath } from "node:url";
import { startOpenScoutWebEdge } from "./edge.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for edge integration condition");
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLineWithPrefix(
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  timeoutMs = 10_000,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      Bun.sleep(remaining).then(() => ({ done: true, value: undefined })),
    ]);
    if (result.done) break;
    buffered += decoder.decode(result.value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    const match = lines.find((line) => line.startsWith(prefix));
    if (match) {
      await reader.cancel().catch(() => {});
      return match.slice(prefix.length);
    }
  }
  await reader.cancel().catch(() => {});
  throw new Error(`Timed out waiting for ${prefix.trim()}`);
}

const workerPortBase = 47_000 + Math.floor(Math.random() * 500);
const edge = await startOpenScoutWebEdge({
  hostname: "127.0.0.1",
  port: 0,
  workerCount: 2,
  workerPortBase,
  workerEntry: fileURLToPath(new URL("./edge-fixture-worker.ts", import.meta.url)),
  upstreamHeaderTimeoutMs: 50,
  healthIntervalMs: 100,
  healthTimeoutMs: 500,
  unhealthyThreshold: 5,
  workerStartupGraceMs: 10_000,
  env: process.env,
});

try {
  await waitFor(() => edge.workers.every((candidate) => candidate.ready));
  const origin = `http://127.0.0.1:${edge.server.port}`;

  const ordinary = await fetch(`${origin}/echo`);
  assert(ordinary.status === 200, "ordinary request failed");
  assert(ordinary.headers.get("x-openscout-worker") === "1", "ordinary request was not sent to request worker 1");
  assert((await ordinary.json() as { workerIndex?: number }).workerIndex === 1, "ordinary response came from wrong worker");

  const forbidden = await fetch(`${origin}/api/scoutbot/threads`, {
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  });
  assert(forbidden.status === 403, "edge did not reject cross-origin API request");
  assert(forbidden.headers.get("x-openscout-edge") === "1", "cross-origin rejection did not come from edge");

  const singleton = await fetch(`${origin}/api/scoutbot/threads`);
  assert(singleton.headers.get("x-openscout-worker") === "0", "singleton route was not pinned to worker zero");

  const pairRequest = await fetch(`${origin}/pair`);
  const pairRequestBody = await pairRequest.json() as { workerIndex?: number; pairingState?: string };
  assert(
    pairRequest.headers.get("x-openscout-worker") === "0"
      && pairRequestBody.workerIndex === 0
      && pairRequestBody.pairingState === "pending",
    "pairing request producer was not pinned to worker zero",
  );
  const notifications = await fetch(`${origin}/api/notifications`);
  const notificationBody = await notifications.json() as { workerIndex?: number; pairingState?: string };
  assert(
    notificationBody.workerIndex === 0 && notificationBody.pairingState === "pending",
    "notifications did not observe the primary worker pairing request",
  );
  const decision = await fetch(`${origin}/api/pairing/requests/fixture-token/decide`, { method: "POST" });
  const decisionBody = await decision.json() as { workerIndex?: number; pairingState?: string };
  assert(
    decisionBody.workerIndex === 0 && decisionBody.pairingState === "approved",
    "pairing decision did not update the primary worker store",
  );
  const pairPoll = await fetch(`${origin}/pair?poll=1`);
  const pairPollBody = await pairPoll.json() as { workerIndex?: number; pairingState?: string };
  assert(
    pairPollBody.workerIndex === 0 && pairPollBody.pairingState === "approved",
    "pairing poll did not observe the primary worker decision",
  );

  const post = await fetch(`${origin}/echo`, { method: "POST", body: "hello edge" });
  const postBody = await post.json() as { workerIndex?: number; body?: string };
  assert(postBody.workerIndex === 1 && postBody.body === "hello edge", "request body was not proxied intact");

  const socketPayload = await new Promise<string>((resolve, reject) => {
    const socket = new WebSocket(`${origin.replace("http:", "ws:")}/echo-ws`);
    const timer = setTimeout(() => reject(new Error("WebSocket echo timed out")), 2_000);
    socket.onopen = () => socket.send("hello socket");
    socket.onerror = () => reject(new Error("WebSocket echo failed"));
    socket.onmessage = (event) => {
      clearTimeout(timer);
      resolve(String(event.data));
      socket.close();
    };
  });
  assert(socketPayload === "1:hello socket", "WebSocket was not proxied through request worker 1");

  const startedAt = Date.now();
  const timeout = await fetch(`${origin}/hang`);
  assert(timeout.status === 504, "edge did not enforce the upstream header deadline");
  assert(Date.now() - startedAt < 500, "edge header deadline took too long");

  await waitFor(() => edge.workers[1]?.ready === true);
  const oldWorkerPid = edge.workers[1]?.child?.pid;
  assert(typeof oldWorkerPid === "number", "request worker has no pid");
  edge.workers[1]?.child?.kill("SIGTERM");
  await waitFor(() => edge.workers[1]?.ready === false);
  const degradedHealth = await fetch(`${origin}/api/health`);
  const degraded = await degradedHealth.json() as { workers?: { ready?: number; total?: number } };
  assert(degradedHealth.status === 200, "edge went down with one request worker");
  assert(degraded.workers?.ready === 1 && degraded.workers.total === 2, "degraded worker capacity was not reported");
  await waitFor(() => {
    const requestWorker = edge.workers[1];
    return requestWorker?.ready === true && requestWorker.child?.pid !== oldWorkerPid;
  });
  const recovered = await fetch(`${origin}/echo`);
  assert(recovered.headers.get("x-openscout-worker") === "1", "respawned request worker did not rejoin the pool");
} finally {
  await edge.stop();
}

const parentDeathFixture = fileURLToPath(new URL("./edge-parent-death-fixture.ts", import.meta.url));
const doomedEdge = Bun.spawn([process.execPath, parentDeathFixture], {
  cwd: fileURLToPath(new URL("../../..", import.meta.url)),
  env: process.env,
  stdout: "pipe",
  stderr: "pipe",
});
let orphanPids: number[] = [];
try {
  const payload = await readLineWithPrefix(
    doomedEdge.stdout,
    "OPENSCOUT_PARENT_DEATH_READY ",
  );
  orphanPids = (JSON.parse(payload) as { workerPids?: unknown[] }).workerPids
    ?.filter((pid): pid is number => typeof pid === "number") ?? [];
  assert(orphanPids.length === 2, "parent-death fixture did not report both worker pids");
  doomedEdge.kill(9);
  await doomedEdge.exited;
  await waitFor(() => orphanPids.every((pid) => !processExists(pid)), 3_000);
} finally {
  doomedEdge.kill(9);
  for (const pid of orphanPids) {
    if (processExists(pid)) process.kill(pid, "SIGKILL");
  }
}
