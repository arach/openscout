import { existsSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import electron from "electron";
import type { MenuItemConstructorOptions } from "electron";

import {
  buildDesktopShellState,
  controlBroker,
  getAgentConfig,
  getAgentSession,
  getAppSettings,
  getBrokerInspector,
  getLogCatalog,
  getPhonePreparation,
  readLogSource,
  restartOnboarding,
  restartAgent,
  runOnboardingCommand,
  skipOnboarding,
  sendRelayMessage,
  setVoiceRepliesEnabled,
  toggleVoiceCapture,
  updateAgentConfig,
  updateAppSettings,
  updatePhonePreparation,
} from "./openscout-runtime.js";
import type {
  BrokerControlAction,
  DesktopAppInfo,
  RunOnboardingCommandInput,
  ReadLogSourceInput,
  RestartAgentInput,
  SendRelayMessageInput,
  UpdateAgentConfigInput,
  UpdateAppSettingsInput,
  UpdateDispatchConfigInput,
  UpdatePhonePreparationInput,
} from "../src/lib/openscout-desktop.js";
import { dispatchService } from "./dispatch-service.js";
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

function expandHomePath(value: string | null) {
  if (!value) {
    return null;
  }
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function escapeAppleScriptString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function openAgentSessionSurface(agentId: string) {
  const session = await getAgentSession(agentId);
  if (session.mode === "tmux" && session.commandLabel) {
    if (process.platform !== "darwin") {
      throw new Error("Direct tmux attach is only wired for macOS right now.");
    }
    await execFile("osascript", [
      "-e",
      'tell application "Terminal" to activate',
      "-e",
      `tell application "Terminal" to do script "${escapeAppleScriptString(session.commandLabel)}"`,
    ]);
    return true;
  }

  const targetPath = expandHomePath(session.directoryPath);
  if (targetPath) {
    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return true;
  }

  throw new Error("No live tmux pane or session logs are available for this agent yet.");
}

function resolveProductName() {
  return process.env.OPENSCOUT_PRODUCT_NAME?.trim() || app.getName() || "OpenScout";
}

function envFlagEnabled(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function createDesktopAppInfo(): DesktopAppInfo {
  const enableAll = envFlagEnabled(process.env.ENABLE_ALL) || envFlagEnabled(process.env.OPENSCOUT_ENABLE_ALL);

  return {
    productName: resolveProductName(),
    appVersion: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    features: {
      enableAll,
      overview: true,
      relay: true,
      dispatch: true,
      interAgent: true,
      agents: true,
      settings: true,
      logs: true,
      activity: enableAll,
      machines: enableAll,
      plans: enableAll,
      sessions: true,
      search: true,
      phonePreparation: enableAll,
      telegram: enableAll,
      voice: enableAll,
    },
  };
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

  const dockIcon = nativeImage.createFromPath(resolveDesktopAssetPath("openscout-icon.png"));
  if (!dockIcon.isEmpty()) {
    app.dock.setIcon(dockIcon);
  }
}

function getStartUrl(port?: number) {
  const explicitUrl = process.env.ELECTRON_START_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }

  if (!port) {
    throw new Error("Desktop start URL requires a server port when ELECTRON_START_URL is not set.");
  }

  return `http://127.0.0.1:${port}`;
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
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    title: resolveProductName(),
    icon: resolveDesktopAssetPath("openscout-icon.png"),
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

ipcMain.handle("openscout:get-app-info", async () => createDesktopAppInfo());

ipcMain.handle("openscout:get-shell-state", async () =>
  buildDesktopShellState(createDesktopAppInfo()),
);

ipcMain.handle("openscout:refresh-shell-state", async () =>
  buildDesktopShellState(createDesktopAppInfo()),
);

ipcMain.handle("openscout:get-app-settings", async () =>
  getAppSettings(),
);

ipcMain.handle("openscout:update-app-settings", async (_event, input: UpdateAppSettingsInput) =>
  updateAppSettings(input),
);

ipcMain.handle("openscout:run-onboarding-command", async (_event, input: RunOnboardingCommandInput) =>
  runOnboardingCommand(input),
);

ipcMain.handle("openscout:skip-onboarding", async () =>
  skipOnboarding(),
);

ipcMain.handle("openscout:restart-onboarding", async () =>
  restartOnboarding(),
);

ipcMain.handle("openscout:pick-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ["openDirectory"],
  });
  if (result.canceled) {
    return null;
  }
  return result.filePaths[0] ?? null;
});

ipcMain.handle("openscout:quit-app", async () => {
  setImmediate(() => {
    app.quit();
  });
  return true;
});

ipcMain.handle("openscout:get-phone-preparation", async () =>
  getPhonePreparation(),
);

ipcMain.handle("openscout:update-phone-preparation", async (_event, input: UpdatePhonePreparationInput) =>
  updatePhonePreparation(input),
);

ipcMain.handle("openscout:get-agent-config", async (_event, agentId: string) =>
  getAgentConfig(agentId),
);

ipcMain.handle("openscout:update-agent-config", async (_event, input: UpdateAgentConfigInput) =>
  updateAgentConfig(input),
);

ipcMain.handle("openscout:restart-agent", async (_event, input: RestartAgentInput) =>
  restartAgent(createDesktopAppInfo(), input),
);

ipcMain.handle("openscout:send-relay-message", async (_event, input: SendRelayMessageInput) =>
  sendRelayMessage(createDesktopAppInfo(), input),
);

ipcMain.handle("openscout:control-broker", async (_event, action: BrokerControlAction) =>
  controlBroker(createDesktopAppInfo(), action),
);

ipcMain.handle("openscout:get-log-catalog", async () =>
  getLogCatalog(),
);

ipcMain.handle("openscout:get-broker-inspector", async () =>
  getBrokerInspector(),
);

ipcMain.handle("openscout:read-log-source", async (_event, input: ReadLogSourceInput) =>
  readLogSource(input),
);

ipcMain.handle("openscout:get-dispatch-state", async () =>
  dispatchService.getState(),
);

ipcMain.handle("openscout:refresh-dispatch-state", async () =>
  dispatchService.refreshState(),
);

ipcMain.handle("openscout:control-dispatch-service", async (_event, action: "start" | "stop" | "restart") =>
  dispatchService.control(action),
);

ipcMain.handle("openscout:update-dispatch-config", async (_event, input: UpdateDispatchConfigInput) =>
  dispatchService.updateConfig(input),
);

ipcMain.handle("openscout:get-agent-session", async (_event, agentId: string) =>
  getAgentSession(agentId),
);

ipcMain.handle("openscout:open-agent-session", async (_event, agentId: string) =>
  openAgentSessionSurface(agentId),
);

ipcMain.handle("openscout:toggle-voice-capture", async () =>
  toggleVoiceCapture(createDesktopAppInfo()),
);

ipcMain.handle("openscout:set-voice-replies-enabled", async (_event, enabled: boolean) =>
  setVoiceRepliesEnabled(createDesktopAppInfo(), enabled),
);

app.whenReady().then(async () => {
  applyApplicationIcon();
  createAppMenu();
  await dispatchService.refreshState();
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
    await dispatchService.shutdown();
    await relayVoiceBridgeService.shutdown();
    await telegramBridgeService.shutdown();
    app.quit();
  }
});

app.on("before-quit", async () => {
  await appServer?.close();
  await dispatchService.shutdown();
  await relayVoiceBridgeService.shutdown();
  await telegramBridgeService.shutdown();
});
