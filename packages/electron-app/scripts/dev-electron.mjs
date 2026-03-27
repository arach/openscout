import { spawn } from "node:child_process";

const packageDir = process.cwd();
const rendererUrl = "http://127.0.0.1:5173";
const children = new Set();

function spawnBun(args, env = {}) {
  const child = spawn("bun", args, {
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

async function waitForRenderer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // renderer not up yet
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for renderer at ${url}`);
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

process.on("SIGINT", () => {
  killChildren();
  process.exit(130);
});

process.on("SIGTERM", () => {
  killChildren();
  process.exit(143);
});

const renderer = spawnBun(["run", "dev:renderer"]);

renderer.on("exit", (code) => {
  if (code && code !== 0) {
    killChildren();
    process.exit(code);
  }
});

await waitForRenderer(rendererUrl);

const electron = spawnBun(["run", "electron:web"]);

electron.on("exit", (code) => {
  killChildren();
  process.exit(code ?? 0);
});
