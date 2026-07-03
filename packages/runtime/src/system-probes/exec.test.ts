import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  execSystemFile,
  execSystemTransportMetadata,
  resetExecSystemTransportForTests,
  setExecSystemSpawnForTests,
} from "./exec.js";
import { resetScoutdProbeClientForTests } from "./scoutd-client.js";

const originalSocket = process.env.OPENSCOUT_PROBES_SOCKET;
let tempRoot = "";

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "openscout-exec-verbs-"));
  resetExecSystemTransportForTests();
  resetScoutdProbeClientForTests();
});

afterEach(() => {
  resetExecSystemTransportForTests();
  resetScoutdProbeClientForTests();
  if (originalSocket === undefined) delete process.env.OPENSCOUT_PROBES_SOCKET;
  else process.env.OPENSCOUT_PROBES_SOCKET = originalSocket;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("execSystemFile scoutd verb transport", () => {
  test("routes supported tmux send/kill/new verbs over scoutd without spawning locally", async () => {
    const socketPath = join(tempRoot, "probes.sock");
    process.env.OPENSCOUT_PROBES_SOCKET = socketPath;
    const requests: Array<Record<string, unknown>> = [];
    const server = await startExecServer(socketPath, (request) => {
      requests.push(request);
      if (request.schema === "openscout.probe.capabilities/v1") {
        return capabilities(["tmux.sendKeys", "tmux.killSession", "tmux.newSession"]);
      }
      return execEnvelope(String(request.verb), {
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
    });
    let spawns = 0;
    setExecSystemSpawnForTests((() => {
      spawns += 1;
      throw new Error("spawn should not be used when scoutd serves tmux verbs");
    }) as never);

    try {
      const output = await execSystemFile("tmux", ["send-keys", "-t", "scout-test", "C-c"], { timeoutMs: 2_000 });
      const kill = await execSystemFile("tmux", ["kill-session", "-t", "scout-test"], { timeoutMs: 2_000 });
      const created = await execSystemFile(
        "tmux",
        ["new-session", "-d", "-s", "scout-test", "-c", tempRoot, "echo hello"],
        { timeoutMs: 5_000 },
      );

      expect(spawns).toBe(0);
      expect(output).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      expect(kill).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      expect(created).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      expect(execSystemTransportMetadata(output)).toMatchObject({
        backend: "scoutd",
        daemonVersion: "test-daemon",
        verb: "tmux.sendKeys",
      });
      expect(requests).toEqual([
        { schema: "openscout.probe.capabilities/v1" },
        {
          schema: "openscout.exec.request/v1",
          verb: "tmux.sendKeys",
          args: {
            target: "scout-test",
            keys: ["C-c"],
            timeoutMs: 2000,
          },
        },
        {
          schema: "openscout.exec.request/v1",
          verb: "tmux.killSession",
          args: {
            target: "scout-test",
            timeoutMs: 2000,
          },
        },
        {
          schema: "openscout.exec.request/v1",
          verb: "tmux.newSession",
          args: {
            detached: true,
            printPane: false,
            sessionName: "scout-test",
            cwd: tempRoot,
            command: "echo hello",
            timeoutMs: 5000,
          },
        },
      ]);
    } finally {
      await closeServer(server);
    }
  });

  test("falls back to the local bounded exec helper when the daemon lacks a verb", async () => {
    const socketPath = join(tempRoot, "probes.sock");
    process.env.OPENSCOUT_PROBES_SOCKET = socketPath;
    const server = await startExecServer(socketPath, (request) => {
      if (request.schema === "openscout.probe.capabilities/v1") return capabilities([]);
      throw new Error("exec request should not be sent without capability");
    });
    const tmux = writeFakeTmux();

    try {
      const output = await execSystemFile(tmux, ["send-keys", "-t", "scout-test", "Enter"], { timeoutMs: 2_000 });

      expect(output.stdout.trim()).toBe("fake tmux send-keys -t scout-test Enter");
      expect(execSystemTransportMetadata(output)).toMatchObject({
        backend: "local-fallback",
        verb: "tmux.sendKeys",
      });
    } finally {
      await closeServer(server);
    }
  });
});

function writeFakeTmux(): string {
  const script = join(tempRoot, "tmux");
  writeFileSync(script, [
    "#!/bin/sh",
    "printf 'fake tmux'",
    "for arg in \"$@\"; do printf ' %s' \"$arg\"; done",
    "printf '\\n'",
  ].join("\n"));
  chmodSync(script, 0o755);
  return script;
}

async function startExecServer(
  socketPath: string,
  handler: (request: Record<string, unknown>, socket: Socket) => unknown,
): Promise<Server> {
  const server = createServer((socket) => {
    let raw = "";
    let handled = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      raw += chunk;
      if (handled || !raw.includes("\n")) return;
      handled = true;
      const line = raw.slice(0, raw.indexOf("\n"));
      const response = handler(JSON.parse(line) as Record<string, unknown>, socket);
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolvePromise();
    });
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
}

function capabilities(verbs: string[]): Record<string, unknown> {
  return {
    schema: "openscout.probe.capabilities/v1",
    daemonVersion: "test-daemon",
    families: [],
    verbs: verbs.map((verb) => ({ verb, schemaVersion: 1 })),
  };
}

function execEnvelope(verb: string, value: unknown): Record<string, unknown> {
  return {
    schema: "openscout.exec.response/v1",
    verb,
    ok: true,
    value,
    daemonVersion: "test-daemon",
  };
}
