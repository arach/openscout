import { startWebWorkerParentWatchdog } from "./edge.ts";

const port = Number.parseInt(process.env.OPENSCOUT_WEB_PORT ?? "0", 10);
const workerIndex = Number.parseInt(process.env.OPENSCOUT_WEB_WORKER_INDEX ?? "-1", 10);
startWebWorkerParentWatchdog();
let pairingState: "idle" | "pending" | "approved" = "idle";

const server = Bun.serve<{ workerIndex: number }>({
  hostname: "127.0.0.1",
  port,
  async fetch(request, bunServer) {
    const pathname = new URL(request.url).pathname;
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return bunServer.upgrade(request, { data: { workerIndex } })
        ? (undefined as unknown as Response)
        : new Response("upgrade failed", { status: 500 });
    }
    if (pathname === "/api/health") {
      return Response.json({ ok: true, surface: "openscout-web" });
    }
    if (pathname === "/pair") {
      if (new URL(request.url).searchParams.get("poll") === "1") {
        return Response.json({ workerIndex, pairingState });
      }
      pairingState = "pending";
      return Response.json({ workerIndex, pairingState, token: "fixture-token" }, { status: 202 });
    }
    if (pathname === "/api/notifications") {
      return Response.json({ workerIndex, pairingState });
    }
    if (pathname === "/api/pairing/requests/fixture-token/decide") {
      pairingState = "approved";
      return Response.json({ workerIndex, pairingState });
    }
    if (pathname === "/hang") {
      return new Promise<Response>(() => {});
    }
    if (pathname === "/mock-llm") {
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let chunkIndex = 0;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          await Bun.sleep(40 + Math.max(0, workerIndex) * 4);
          const emit = () => {
            controller.enqueue(encoder.encode(`${JSON.stringify({
              model: "minimax-synthetic",
              workerIndex,
              delta: `mock-token-${chunkIndex}`,
            })}\n`));
            chunkIndex += 1;
            if (chunkIndex >= 8) {
              controller.close();
              return;
            }
            timer = setTimeout(emit, 20);
          };
          emit();
        },
        cancel() {
          if (timer) clearTimeout(timer);
        },
      });
      return new Response(body, {
        headers: {
          "content-type": "application/x-ndjson",
          "x-mock-model": "minimax-synthetic",
        },
      });
    }
    return Response.json({
      workerIndex,
      pathname,
      body: request.method === "GET" || request.method === "HEAD" ? "" : await request.text(),
    });
  },
  websocket: {
    message(socket, message) {
      socket.send(`${socket.data.workerIndex}:${message}`);
    },
  },
});

const shutdown = async () => {
  await server.stop(true);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
