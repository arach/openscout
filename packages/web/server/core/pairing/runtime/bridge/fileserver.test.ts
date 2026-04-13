import { afterEach, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";

import { startFileServer, type FileServer } from "./fileserver.ts";

const activeServers: FileServer[] = [];
const temporaryFiles: string[] = [];

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a free port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.once("error", reject);
  });
}

afterEach(async () => {
  while (activeServers.length > 0) {
    activeServers.pop()?.stop();
  }

  while (temporaryFiles.length > 0) {
    const filePath = temporaryFiles.pop();
    if (filePath) {
      await rm(filePath, { force: true });
    }
  }
});

test("pairing file server exposes health and allowed file reads", async () => {
  const port = await getFreePort();
  const server = startFileServer({ port });
  activeServers.push(server);

  const filePath = join("/tmp", `scout-fileserver-${Date.now()}.txt`);
  temporaryFiles.push(filePath);
  await writeFile(filePath, "hello from scout\n", "utf8");

  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  expect(healthResponse.status).toBe(200);
  expect(await healthResponse.json()).toEqual({ ok: true });

  const fileResponse = await fetch(
    `http://127.0.0.1:${port}/file?path=${encodeURIComponent(filePath)}`,
  );
  expect(fileResponse.status).toBe(200);
  expect(await fileResponse.text()).toBe("hello from scout\n");
});
