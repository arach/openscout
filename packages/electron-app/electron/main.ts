import { existsSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import electron from "electron";
import type { MenuItemConstructorOptions } from "electron";
import electronUpdater from "electron-updater";
import {
  configureScoutKeepAliveHost,
  createScoutDesktopAppInfo,
  createScoutElectronIpcServices,
  normalizeScoutElectronVoiceState,
  registerScoutElectronIpcHandlers,
  resolveScoutElectronStartUrl,
  SCOUT_ELECTRON_DEFAULT_WINDOW,
  shutdownScoutKeepAliveManager,
} from "@scout/app/electron-shell";
import { SCOUT_ELECTRON_CHANNELS } from "@scout/app/electron-channels";
import { SCOUT_PRODUCT_NAME } from "@scout/app/product";
import type { ScoutDesktopAppInfo } from "@scout/app/desktop";
import { relayVoiceBridgeService } from "./voice-bridge-service.js";
import { telegramBridgeService } from "./telegram-bridge-service.js";

const {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  shell,
} = electron;
const { autoUpdater } = electronUpdater;

type StartedAppServer = {
  port: number;
  close: () => Promise<void>;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const preloadPath = path.resolve(__dirname, "preload.cjs");

let mainWindow: InstanceType<typeof BrowserWindow> | null = null;
let appServer: StartedAppServer | null = null;
const execFile = promisify(execFileCallback);
let updateCheckInFlight = false;
let interactiveUpdateCheck = false;
let updateCheckTimer: NodeJS.Timeout | null = null;
let updateIntervalTimer: NodeJS.Timeout | null = null;
const SCOUT_RELEASE_OWNER = "arach";
const SCOUT_RELEASE_REPO = "openscout";
let hasLoggedMissingUpdaterConfig = false;

function resolveProductName() {
  const fromEnv = process.env.SCOUT_PRODUCT_NAME?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const appName = app.getName()?.trim();
  if (appName && appName !== "Electron") {
    return appName;
  }
  return SCOUT_PRODUCT_NAME;
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
    surface: "electron",
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

function resolveUpdaterConfigPath() {
  return path.join(process.resourcesPath, "app-update.yml");
}

function canUseAutoUpdates() {
  if (!app.isPackaged || process.platform !== "darwin") {
    return false;
  }

  const updaterConfigPath = resolveUpdaterConfigPath();
  if (existsSync(updaterConfigPath)) {
    return true;
  }

  if (!hasLoggedMissingUpdaterConfig) {
    hasLoggedMissingUpdaterConfig = true;
    updaterLog("info", `skipping auto updates: missing ${updaterConfigPath}`);
  }

  return false;
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

function updaterLog(level: "info" | "warn" | "error", message: string, ...details: unknown[]) {
  const prefix = `[scout:update:${level}]`;
  if (level === "error") {
    console.error(prefix, message, ...details);
    return;
  }
  if (level === "warn") {
    console.warn(prefix, message, ...details);
    return;
  }
  console.log(prefix, message, ...details);
}

function consumeInteractiveUpdateCheck() {
  const nextValue = interactiveUpdateCheck;
  interactiveUpdateCheck = false;
  return nextValue;
}

async function showUpdateDownloadedPrompt(version: string) {
  const result = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: "info",
    buttons: ["Restart and Install", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: resolveProductName(),
    message: `Scout ${version} is ready to install.`,
    detail: "Restart now to apply the update, or keep working and let Scout install it when you quit.",
  });

  if (result.response === 0) {
    setImmediate(() => autoUpdater.quitAndInstall());
  }
}

async function checkForAppUpdates(options: { interactive?: boolean } = {}) {
  if (!canUseAutoUpdates()) {
    return;
  }

  if (updateCheckInFlight) {
    if (options.interactive) {
      consumeInteractiveUpdateCheck();
      await dialog.showMessageBox(mainWindow ?? undefined, {
        type: "info",
        title: resolveProductName(),
        message: "Scout is already checking for updates.",
      });
    }
    return;
  }

  interactiveUpdateCheck = options.interactive ?? false;
  updateCheckInFlight = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    updateCheckInFlight = false;
    const message = error instanceof Error ? error.message : String(error);
    updaterLog("error", "update check failed", message);
    if (consumeInteractiveUpdateCheck()) {
      await dialog.showMessageBox(mainWindow ?? undefined, {
        type: "error",
        title: resolveProductName(),
        message: "Scout could not check for updates.",
        detail: message,
      });
    }
  }
}

function configureAutoUpdates() {
  if (!canUseAutoUpdates()) {
    return;
  }

  autoUpdater.logger = {
    info(message, ...details) {
      updaterLog("info", String(message), ...details);
    },
    warn(message, ...details) {
      updaterLog("warn", String(message), ...details);
    },
    error(message, ...details) {
      updaterLog("error", String(message), ...details);
    },
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.previousBlockmapBaseUrlOverride = `https://github.com/${SCOUT_RELEASE_OWNER}/${SCOUT_RELEASE_REPO}/releases/download/v${app.getVersion()}`;

  autoUpdater.on("checking-for-update", () => {
    updaterLog("info", "checking for updates");
  });

  autoUpdater.on("update-available", (info) => {
    updateCheckInFlight = false;
    updaterLog("info", `update available: ${info.version}`);
    if (consumeInteractiveUpdateCheck()) {
      void dialog.showMessageBox(mainWindow ?? undefined, {
        type: "info",
        title: resolveProductName(),
        message: `Scout ${info.version} is downloading.`,
        detail: "The update will install after download completes.",
      });
    }
  });

  autoUpdater.on("update-not-available", () => {
    updateCheckInFlight = false;
    updaterLog("info", "no update available");
    if (consumeInteractiveUpdateCheck()) {
      void dialog.showMessageBox(mainWindow ?? undefined, {
        type: "info",
        title: resolveProductName(),
        message: "Scout is up to date.",
      });
    }
  });

  autoUpdater.on("error", (error) => {
    updateCheckInFlight = false;
    updaterLog("error", "auto updater error", error);
    if (consumeInteractiveUpdateCheck()) {
      const message = error instanceof Error ? error.message : String(error);
      void dialog.showMessageBox(mainWindow ?? undefined, {
        type: "error",
        title: resolveProductName(),
        message: "Scout could not update.",
        detail: message,
      });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    updaterLog("info", `update downloaded: ${info.version}`);
    void showUpdateDownloadedPrompt(info.version);
  });

  updateCheckTimer = setTimeout(() => {
    void checkForAppUpdates();
  }, 15_000);

  updateIntervalTimer = setInterval(() => {
    void checkForAppUpdates();
  }, 6 * 60 * 60 * 1000);
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
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = window;

  window.once("ready-to-show", () => {
    if (!window.isDestroyed()) {
      window.show();
    }
  });

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
    {
      label: "Help",
      submenu: [
        {
          label: "Knowledge Base",
          click: () => {
            mainWindow?.webContents.send(SCOUT_ELECTRON_CHANNELS.openKnowledgeBase);
          },
        },
        {
          label: "Check for Updates…",
          click: () => {
            void checkForAppUpdates({ interactive: true });
          },
        },
      ],
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
    reloadWindow: () => {
      mainWindow?.webContents.reload();
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
  configureScoutKeepAliveHost({
    startPowerSaveBlocker: (type) => powerSaveBlocker.start(type),
    stopPowerSaveBlocker: (id) => {
      if (powerSaveBlocker.isStarted(id)) {
        powerSaveBlocker.stop(id);
      }
    },
  });
  applyApplicationIcon();
  configureAutoUpdates();
  createAppMenu();
  await createMainWindow();
  void scoutElectronServices.refreshPairingState().catch((error) => {
    console.error("[scout] initial pairing refresh failed:", error);
  });
  void telegramBridgeService.refreshConfiguration().catch((error) => {
    console.error("[scout] initial telegram refresh failed:", error);
  });

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
    shutdownScoutKeepAliveManager();
    app.quit();
  }
});

app.on("before-quit", async () => {
  if (updateCheckTimer) {
    clearTimeout(updateCheckTimer);
    updateCheckTimer = null;
  }
  if (updateIntervalTimer) {
    clearInterval(updateIntervalTimer);
    updateIntervalTimer = null;
  }
  await appServer?.close();
  await relayVoiceBridgeService.shutdown();
  await telegramBridgeService.shutdown();
  shutdownScoutKeepAliveManager();
});
