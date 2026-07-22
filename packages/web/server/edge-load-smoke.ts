import { fileURLToPath } from "node:url";
import { startOpenScoutWebEdge } from "./edge.ts";

type ProfileResult = {
  requests: number;
  concurrency: number;
  errors: number;
  requestsPerSecond: number;
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  workers: Record<string, number>;
  statuses: Record<string, number>;
};

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

async function runProfile(input: {
  url: string;
  requests: number;
  concurrency: number;
}): Promise<ProfileResult> {
  const latencies: number[] = [];
  const workers = new Map<string, number>();
  const statuses = new Map<string, number>();
  let errors = 0;
  let nextRequest = 0;
  const startedAt = performance.now();

  await Promise.all(Array.from({ length: input.concurrency }, async () => {
    while (true) {
      const requestIndex = nextRequest;
      nextRequest += 1;
      if (requestIndex >= input.requests) return;
      const requestStartedAt = performance.now();
      try {
        const response = await fetch(input.url);
        await response.arrayBuffer();
        latencies.push(performance.now() - requestStartedAt);
        if (!response.ok) errors += 1;
        statuses.set(String(response.status), (statuses.get(String(response.status)) ?? 0) + 1);
        const worker = response.headers.get("x-openscout-worker") ?? "edge";
        workers.set(worker, (workers.get(worker) ?? 0) + 1);
      } catch {
        latencies.push(performance.now() - requestStartedAt);
        errors += 1;
      }
    }
  }));

  const elapsedSeconds = (performance.now() - startedAt) / 1_000;
  latencies.sort((left, right) => left - right);
  return {
    requests: input.requests,
    concurrency: input.concurrency,
    errors,
    requestsPerSecond: rounded(input.requests / elapsedSeconds),
    latencyMs: {
      p50: rounded(percentile(latencies, 0.50)),
      p95: rounded(percentile(latencies, 0.95)),
      p99: rounded(percentile(latencies, 0.99)),
      max: rounded(latencies.at(-1) ?? 0),
    },
    workers: Object.fromEntries([...workers].sort(([left], [right]) => left.localeCompare(right))),
    statuses: Object.fromEntries([...statuses].sort(([left], [right]) => left.localeCompare(right))),
  };
}

async function waitForReady(url: string, workerCount: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/api/health`).catch(() => null);
    const body = response?.ok
      ? await response.json().catch(() => null) as { workers?: { ready?: number } } | null
      : null;
    if (body?.workers?.ready === workerCount) return;
    await Bun.sleep(25);
  }
  throw new Error("Timed out waiting for load-test workers");
}

async function monitorHealth(url: string, stop: { value: boolean }): Promise<ProfileResult> {
  const latencies: number[] = [];
  let errors = 0;
  let requests = 0;
  while (!stop.value) {
    const startedAt = performance.now();
    const response = await fetch(`${url}/api/health`).catch(() => null);
    latencies.push(performance.now() - startedAt);
    requests += 1;
    if (!response?.ok) errors += 1;
    await Bun.sleep(10);
  }
  latencies.sort((left, right) => left - right);
  return {
    requests,
    concurrency: 1,
    errors,
    requestsPerSecond: 0,
    latencyMs: {
      p50: rounded(percentile(latencies, 0.50)),
      p95: rounded(percentile(latencies, 0.95)),
      p99: rounded(percentile(latencies, 0.99)),
      max: rounded(latencies.at(-1) ?? 0),
    },
    workers: { edge: requests },
    statuses: errors === 0 ? { "200": requests } : { mixed: requests },
  };
}

async function runSynthetic(): Promise<void> {
  const workerCount = 4;
  const workerPortBase = 49_000 + Math.floor(Math.random() * 400);
  const edge = await startOpenScoutWebEdge({
    hostname: "127.0.0.1",
    port: 0,
    workerCount,
    workerPortBase,
    workerEntry: fileURLToPath(new URL("./edge-fixture-worker.ts", import.meta.url)),
    env: process.env,
  });

  try {
    const origin = `http://127.0.0.1:${edge.server.port}`;
    await waitForReady(origin, workerCount);
    const fast = await runProfile({
      url: `${origin}/echo`,
      requests: 10_000,
      concurrency: 128,
    });
    const stopHealth = { value: false };
    const health = monitorHealth(origin, stopHealth);
    const mockLlm = await runProfile({
      url: `${origin}/mock-llm`,
      requests: 2_000,
      concurrency: 120,
    });
    stopHealth.value = true;
    const edgeHealthDuringMockLlm = await health;
    if (fast.errors > 0 || mockLlm.errors > 0 || edgeHealthDuringMockLlm.errors > 0) {
      throw new Error("Synthetic edge load smoke encountered request failures");
    }
    console.log(JSON.stringify({
      mode: "synthetic",
      syntheticOnly: true,
      providerCalls: 0,
      fast,
      mockLlm,
      edgeHealthDuringMockLlm,
    }, null, 2));
  } finally {
    await edge.stop();
  }
}

async function runRealReadOnly(origin: string): Promise<void> {
  const worktree = process.env.OPENSCOUT_LOAD_WORKTREE?.trim() || process.cwd();
  const sessionId = process.env.OPENSCOUT_LOAD_SESSION?.trim();
  const sessionUrl = sessionId
    ? `${origin}/api/session/${encodeURIComponent(sessionId)}`
    : `${origin}/api/sessions`;
  const stopHealth = { value: false };
  const health = monitorHealth(origin, stopHealth);
  const [agentSummary, session, tail, repoDiff] = await Promise.all([
    runProfile({
      url: `${origin}/api/agents?detail=summary&limit=25`,
      requests: 500,
      concurrency: 40,
    }),
    runProfile({
      url: sessionUrl,
      requests: 120,
      concurrency: 12,
    }),
    runProfile({
      url: `${origin}/api/tail/recent?limit=500&transcripts=1`,
      requests: 120,
      concurrency: 12,
    }),
    runProfile({
      url: `${origin}/api/repo-diff/worktree?path=${encodeURIComponent(worktree)}&tier=summary&force=1&layer=unstaged&layer=staged`,
      requests: 24,
      concurrency: 4,
    }),
  ]);
  stopHealth.value = true;
  console.log(JSON.stringify({
    mode: "real-read-only",
    providerCalls: 0,
    mutations: 0,
    agentMessages: 0,
    agentSummary,
    session,
    tail,
    repoDiff,
    edgeHealthDuringMixedLoad: await health,
  }, null, 2));
}

const realOrigin = process.env.OPENSCOUT_LOAD_ORIGIN?.trim().replace(/\/$/, "");
if (realOrigin) {
  await runRealReadOnly(realOrigin);
} else {
  await runSynthetic();
}
