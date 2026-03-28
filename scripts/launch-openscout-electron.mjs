#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const electronDir = path.resolve(rootDir, "packages", "electron-app");
const supportDir = path.resolve(
  process.env.HOME || process.env.USERPROFILE || rootDir,
  "Library",
  "Application Support",
  "OpenScout",
);
const appLogsDir = path.resolve(supportDir, "logs", "app");
const electronRuntimeDir = path.resolve(supportDir, "runtime", "electron");
const logFile =
  process.env.OPENSCOUT_ELECTRON_LOG_FILE ||
  path.resolve(appLogsDir, "electron.log");
const pidFile =
  process.env.OPENSCOUT_ELECTRON_PID_FILE ||
  path.resolve(electronRuntimeDir, "electron-dev.pid");

fs.mkdirSync(path.dirname(logFile), { recursive: true });
fs.mkdirSync(path.dirname(pidFile), { recursive: true });

const electronBinary = require(path.resolve(rootDir, "node_modules", "electron"));
const electronEntry = path.resolve(electronDir, "dist", "electron", "main.js");

if (!fs.existsSync(electronBinary)) {
  console.error(`Electron binary not found: ${electronBinary}`);
  process.exit(1);
}

if (!fs.existsSync(electronEntry)) {
  console.error(`Electron entry not found: ${electronEntry}`);
  process.exit(1);
}

const logFd = fs.openSync(logFile, "a");
const child = spawn(electronBinary, ["dist/electron/main.js"], {
  cwd: electronDir,
  detached: true,
  stdio: ["ignore", logFd, logFd],
});

if (!child.pid) {
  console.error("Detached Electron launch did not return a PID.");
  process.exit(1);
}

fs.writeFileSync(pidFile, `${child.pid}\n`, "utf8");
child.unref();
console.log(String(child.pid));
