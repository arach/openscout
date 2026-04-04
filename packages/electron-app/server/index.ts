import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import express from "express";

function serializeState(value: unknown) {
  return JSON.stringify(value ?? null).replace(/</g, "\\u003c");
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

export type AppServerOptions = {
  host?: string;
  port?: number;
  log?: boolean;
};

export type AppServerHandle = {
  app: ReturnType<typeof express>;
  server: http.Server;
  host: string;
  port: number;
  close: () => Promise<void>;
};

export async function createAppServer() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(__dirname, "./client");
  const serverDist = path.resolve(__dirname, "./server");
  const template = await fs.readFile(path.resolve(clientDist, "index.html"), "utf8");
  const app = express();

  app.use(
    express.static(clientDist, {
      index: false,
      extensions: ["html"],
    }),
  );

  app.use(async (req, res, next) => {
    try {
      const entryServerUrl = pathToFileURL(path.resolve(serverDist, "entry-server.js")).href;
      const { render } = await import(entryServerUrl);
      const rendered = await render(req.originalUrl);

      const html = template
        .replace("<!--app-head-->", rendered.head ?? "")
        .replace("<!--app-html-->", rendered.html)
        .replace(
          "<!--app-state-->",
          `<script>window.__INITIAL_STATE__=${serializeState(rendered.initialState)};</script>`,
        );

      res.status(200).setHeader("Content-Type", "text/html").end(html);
    } catch (error) {
      next(error);
    }
  });

  return app;
}

export async function startAppServer(
  options: AppServerOptions = {},
): Promise<AppServerHandle> {
  const requestedPort = options.port ?? Number(process.env.PORT ?? 4173);
  const host = options.host ?? "127.0.0.1";
  const app = await createAppServer();

  const server = await new Promise<http.Server>((resolve, reject) => {
    const instance = app.listen(requestedPort, host);
    instance.once("listening", () => resolve(instance));
    instance.once("error", reject);
  });

  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : requestedPort;

  if (options.log ?? true) {
    console.log(`Scout Electron server running at http://${host}:${port}`);
  }

  return {
    app,
    server,
    host,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

if (isMainModule()) {
  void startAppServer();
}
