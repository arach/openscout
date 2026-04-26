import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const UPLOAD_DIR = "/tmp/scout-uploads";

export async function handleRelayUpload(req: Request): Promise<Response> {
  const { name, data } = (await req.json()) as { name: string; data: string };
  if (!name || !data) {
    return Response.json({ error: "Missing name or data" }, { status: 400 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}-${name}`;
  const filepath = join(UPLOAD_DIR, filename);
  await Bun.write(filepath, Buffer.from(data, "base64"));
  return Response.json({ path: filepath });
}

type RelayProxySocket = {
  readyState: number;
  send(data: string | Buffer | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  data: RelayWSData;
};

type UpstreamPayload = string | Buffer | ArrayBuffer | Uint8Array;

export interface RelayWSData {
  upstream: WebSocket | null;
  pending: UpstreamPayload[];
  upstreamUrl: string | null;
}

function flushPending(ws: RelayProxySocket) {
  const upstream = ws.data.upstream;
  if (!upstream || upstream.readyState !== WebSocket.OPEN) {
    return;
  }
  for (const payload of ws.data.pending) {
    upstream.send(payload);
  }
  ws.data.pending.length = 0;
}

function forwardToClient(
  ws: RelayProxySocket,
  data: string | ArrayBuffer | Uint8Array | Blob,
) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  if (typeof data === "string") {
    ws.send(data);
    return;
  }
  if (data instanceof Blob) {
    void data.arrayBuffer().then((buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buffer);
      }
    }).catch(() => {});
    return;
  }
  ws.send(data);
}

export function createRelayWebSocketProxy() {
  return {
    open(ws: RelayProxySocket) {
      ws.data.pending = [];
      const targetUrl = ws.data.upstreamUrl;
      if (!targetUrl) {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1011, "Missing relay upstream");
        }
        return;
      }

      const upstream = new WebSocket(targetUrl);
      upstream.binaryType = "arraybuffer";
      ws.data.upstream = upstream;

      upstream.onopen = () => {
        flushPending(ws);
      };

      upstream.onmessage = (event) => {
        forwardToClient(ws, event.data);
      };

      upstream.onerror = () => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      upstream.onclose = () => {
        ws.data.upstream = null;
        ws.data.pending.length = 0;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };
    },

    message(
      ws: RelayProxySocket,
      raw: string | Buffer,
    ) {
      const upstream = ws.data.upstream;
      const payload = raw as UpstreamPayload;

      if (!upstream || upstream.readyState === WebSocket.CONNECTING) {
        ws.data.pending.push(payload);
        return;
      }
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(payload);
      }
    },

    close(ws: RelayProxySocket) {
      const upstream = ws.data.upstream;
      ws.data.upstream = null;
      ws.data.pending.length = 0;
      ws.data.upstreamUrl = null;
      if (!upstream) {
        return;
      }
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    },
  };
}
