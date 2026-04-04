import { spawn } from "node:child_process";
import {
  DEFAULT_RENDERER_PORT,
  buildRendererUrl,
  resolveRendererPort,
  waitForScoutRenderer,
} from "./dev-electron-lib.mjs";

const packageDir = process.cwd();
const rendererHost = process.env.OPENSCOUT_RENDERER_HOST?.trim() || "127.0.0.1";
const explicitRendererPort = process.env.OPENSCOUT_RENDERER_PORT?.trim();
const requestedRendererPort = Number(explicitRendererPort || String(DEFAULT_RENDERER_PORT));
const children = new Set();

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function spawnPackageScript(scriptName, env = {}) {
  const child = spawn(npmCommand(), ["run", scriptName], {
    cwd: packageDir,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });

  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function killChildren() {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

process.on("exit", () => {
  killChildren();
});

process.on("SIGINT", () => {
  killChildren();
  process.exit(130);
});

process.on("SIGTERM", () => {
  killChildren();
  process.exit(143);
});

try {
  const rendererPort = await resolveRendererPort({
    host: rendererHost,
    explicitPort: explicitRendererPort ? requestedRendererPort : null,
    requestedPort: requestedRendererPort,
  });
  const rendererUrl = buildRendererUrl(rendererHost, rendererPort);
  const renderer = spawnPackageScript("dev:renderer", {
    OPENSCOUT_RENDERER_HOST: rendererHost,
    OPENSCOUT_RENDERER_PORT: String(rendererPort),
  });

  renderer.on("exit", (code) => {
    if (code && code !== 0) {
      killChildren();
      process.exit(code);
    }
  });

  await waitForScoutRenderer(rendererUrl);

  const electron = spawnPackageScript("electron:web", {
    ELECTRON_START_URL: rendererUrl,
    OPENSCOUT_RENDERER_HOST: rendererHost,
    OPENSCOUT_RENDERER_PORT: String(rendererPort),
  });

  electron.on("exit", (code) => {
    killChildren();
    process.exit(code ?? 0);
  });
} catch (error) {
  killChildren();
  throw error;
}
