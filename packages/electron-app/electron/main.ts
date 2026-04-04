import { existsSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import electron from "electron";
import type { MenuItemConstructorOptions } from "electron";
import {
  createScoutDesktopAppInfo,
  createScoutElectronIpcServices,
  normalizeScoutElectronVoiceState,
  registerScoutElectronIpcHandlers,
  resolveScoutElectronStartUrl,
  SCOUT_ELECTRON_DEFAULT_WINDOW,
} from "../../../apps/scout/src/app/index.ts";
import { SCOUT_PRODUCT_NAME } from "../../../apps/scout/src/shared/product.ts";
import type { ScoutDesktopAppInfo } from "../../../apps/scout/src/app/desktop/index.ts";
import { relayVoiceBridgeService } from "./voice-bridge-service.js";
import { telegramBridgeService } from "./telegram-bridge-service.js";

const {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} = electron;

type StartedAppServer = {
  port: number;
  close: () => Promise<void>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.resolve(__dirname, "preload.cjs");

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let appServer: StartedAppServer | null = null;
const execFile = promisify(execFileCallback);

function resolveProductName() {
  return process.env.SCOUT_PRODUCT_NAME?.trim() || app.getName() || SCOUT_PRODUCT_NAME;
}

function envFlagEnabled(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function createScoutHostAppInfo(): ScoutDesktopAppInfo {
  const enableAll = envFlagEnabled(process.env.ENABLE_ALL) || envFlagEnabled(process.env.SCOUT_ENABLE_ALL);
  return createScoutDesktopAppInfo({
    productName: resolveProductName(),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    features: { enableAll },
  });
}

function resolveDesktopAssetPath(filename: string) {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, filename),
        path.join(process.resourcesPath, "app", "dist", "client", filename),
      ]
    : [path.resolve(__dirname, "..", "..", "public", filename)];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function applyApplicationIcon() {
  if (process.platform !== "darwin" || !app.dock) {
    return;
  }

  const dockIcon = nativeImage.createFromPath(resolveDesktopAssetPath("scout-icon.png"));
  if (!dockIcon.isEmpty()) {
    app.dock.setIcon(dockIcon);
  }
}

function getStartUrl(port?: number) {
  return resolveScoutElectronStartUrl({
    explicitUrl: process.env.ELECTRON_START_URL?.trim(),
    port,
  });
}

async function ensureAppServer() {
  if (process.env.ELECTRON_START_URL?.trim()) {
    return null;
  }

  if (appServer) {
    return appServer;
  }

  const serverModuleUrl = pathToFileURL(path.resolve(__dirname, "..", "index.js")).href;
  const serverModule = (await import(serverModuleUrl)) as {
    startAppServer: (options?: { host?: string; port?: number; log?: boolean }) => Promise<StartedAppServer>;
  };

  appServer = await serverModule.startAppServer({
    host: "127.0.0.1",
    port: 0,
    log: false,
  });

  return appServer;
}

async function createMainWindow() {
  const server = await ensureAppServer();
  const isMac = process.platform === "darwin";
  const window = new BrowserWindow({
    width: SCOUT_ELECTRON_DEFAULT_WINDOW.width,
    height: SCOUT_ELECTRON_DEFAULT_WINDOW.height,
    minWidth: SCOUT_ELECTRON_DEFAULT_WINDOW.minWidth,
    minHeight: SCOUT_ELECTRON_DEFAULT_WINDOW.minHeight,
    title: resolveProductName(),
    icon: resolveDesktopAssetPath("scout-icon.png"),
    backgroundColor: "#F9F9F8",
    frame: !isMac,
    titleBarStyle: isMac ? "hidden" : "default",
    trafficLightPosition: isMac ? { x: -100, y: -100 } : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;

  await window.loadURL(getStartUrl(server?.port));

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("closed", () => {
    mainWindow = null;
  });

  return window;
}

function createAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: resolveProductName(),
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const scoutElectronServices = createScoutElectronIpcServices({
  currentDirectory: process.cwd(),
  appInfo: createScoutHostAppInfo(),
  settings: {
    getTelegramRuntimeState: () => telegramBridgeService.getRuntimeState(),
    refreshTelegramConfiguration: () => telegramBridgeService.refreshConfiguration(),
  },
  host: {
    pickDirectory: async () => {
      const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
        properties: ["openDirectory"],
      });
      if (result.canceled) {
        return null;
      }
      return result.filePaths[0] ?? null;
    },
    requestQuit: () => {
      setImmediate(() => {
        app.quit();
      });
    },
    openPath: (targetPath) => shell.openPath(targetPath),
    showItemInFolder: (targetPath) => shell.showItemInFolder(targetPath),
  },
  agentSessionHost: {
    platform: process.platform,
    execFile: async (file, args) => {
      await execFile(file, args);
    },
    openPath: (targetPath) => shell.openPath(targetPath),
  },
  voice: {
    getVoiceState: () => normalizeScoutElectronVoiceState(relayVoiceBridgeService.getRelayVoiceState()),
    toggleVoiceCapture: () => relayVoiceBridgeService.toggleCapture(),
    setVoiceRepliesEnabled: (enabled) => relayVoiceBridgeService.setRepliesEnabled(enabled),
  },
});

registerScoutElectronIpcHandlers((channel, handler) => {
  ipcMain.handle(channel, handler);
}, scoutElectronServices);

app.whenReady().then(async () => {
  applyApplicationIcon();
  createAppMenu();
  await scoutElectronServices.refreshPairingState();
  await createMainWindow();
  await telegramBridgeService.refreshConfiguration();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", async () => {
  if (process.platform !== "darwin") {
    await appServer?.close();
    await relayVoiceBridgeService.shutdown();
    await telegramBridgeService.shutdown();
    app.quit();
  }
});

app.on("before-quit", async () => {
  await appServer?.close();
  await relayVoiceBridgeService.shutdown();
  await telegramBridgeService.shutdown();
});
