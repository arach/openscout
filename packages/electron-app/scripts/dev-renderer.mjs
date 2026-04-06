import { spawn } from "node:child_process";
import path from "node:path";

const packageDir = process.cwd();
const workspaceRoot = path.resolve(packageDir, "../..");
const scoutAppDir = path.resolve(workspaceRoot, "apps/scout");
const rendererHost = process.env.OPENSCOUT_RENDERER_HOST?.trim() || "127.0.0.1";
const rendererPort = process.env.OPENSCOUT_RENDERER_PORT?.trim() || "43173";
const webHost = process.env.SCOUT_WEB_HOST?.trim() || "127.0.0.1";
const webPort = process.env.SCOUT_WEB_PORT?.trim() || "3200";
const webApiUrl = `http://${webHost}:${webPort}/api/app-info`;
const children = new Set();

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function bunCommand() {
  return process.platform === "win32" ? "bun.exe" : "bun";
}

function spawnChild(command, args, options) {
  const child = spawn(command, args, options);
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

async function waitForUrl(url, timeoutMs = 15_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for Scout web API at ${url}`);
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

const scoutWeb = spawnChild(bunCommand(), ["run", "web"], {
  cwd: scoutAppDir,
  stdio: "inherit",
  env: {
    ...process.env,
    OPENSCOUT_SETUP_CWD: workspaceRoot,
    SCOUT_WEB_HOST: webHost,
    SCOUT_WEB_PORT: webPort,
    SCOUT_VITE_URL: `http://${rendererHost}:${rendererPort}`,
  },
});

scoutWeb.on("exit", (code) => {
  if (code && code !== 0) {
    killChildren();
    process.exit(code);
  }
});

try {
  await waitForUrl(webApiUrl);

  const vite = spawnChild(npmCommand(), ["exec", "--", "vite"], {
    cwd: packageDir,
    stdio: "inherit",
    env: {
      ...process.env,
      OPENSCOUT_RENDERER_HOST: rendererHost,
      OPENSCOUT_RENDERER_PORT: rendererPort,
      SCOUT_WEB_HOST: webHost,
      SCOUT_WEB_PORT: webPort,
    },
  });

  vite.on("exit", (code) => {
    killChildren();
    process.exit(code ?? 0);
  });
} catch (error) {
  killChildren();
  throw error;
}
