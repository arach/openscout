import { createScoutElectronBridge } from "../../../app/electron/bridge.ts";
import type { ScoutElectronBridge } from "../../../app/electron/bridge.ts";

const API_ROUTES: Record<string, { method: "GET" | "POST"; path: string | ((args: unknown[]) => string) }> = {
  "scout:get-app-info":            { method: "GET",  path: "/api/app" },
  "scout:get-services-state":      { method: "GET",  path: "/api/services" },
  "scout:get-home-state":          { method: "GET",  path: "/api/home" },
  "scout:get-messages-workspace-state": { method: "GET", path: "/api/messages-workspace" },
  "scout:get-shell-state":         { method: "GET",  path: "/api/shell-state" },
  "scout:refresh-shell-state":     { method: "GET",  path: "/api/shell-state/refresh" },
  "scout:get-app-settings":        { method: "GET",  path: "/api/app-settings" },
  "scout:refresh-settings-inventory": { method: "GET", path: "/api/app-settings/refresh" },
  "scout:update-app-settings":     { method: "POST", path: "/api/app-settings" },
  "scout:retire-project":          { method: "POST", path: "/api/retire-project" },
  "scout:restore-project":         { method: "POST", path: "/api/restore-project" },
  "scout:run-onboarding-command":  { method: "POST", path: "/api/onboarding/run" },
  "scout:skip-onboarding":         { method: "POST", path: "/api/onboarding/skip" },
  "scout:restart-onboarding":      { method: "POST", path: "/api/onboarding/restart" },
  "scout:get-agent-config":        { method: "GET",  path: (args) => `/api/agent-config/${args[0]}` },
  "scout:update-agent-config":     { method: "POST", path: "/api/agent-config" },
  "scout:create-agent":            { method: "POST", path: "/api/agent/create" },
  "scout:pick-directory":          { method: "GET",  path: "/api/pick-directory" },
  "scout:quit-app":                { method: "POST", path: "/api/quit" },
  "scout:reveal-path":             { method: "POST", path: "/api/reveal-path" },
  "scout:get-phone-preparation":   { method: "GET",  path: "/api/phone-preparation" },
  "scout:update-phone-preparation":{ method: "POST", path: "/api/phone-preparation" },
  "scout:get-pairing-state":       { method: "GET",  path: "/api/pairing-state" },
  "scout:refresh-pairing-state":   { method: "GET",  path: "/api/pairing-state/refresh" },
  "scout:control-pairing-service": { method: "POST", path: "/api/pairing/control" },
  "scout:update-pairing-config":   { method: "POST", path: "/api/pairing/config" },
  "scout:restart-agent":           { method: "POST", path: "/api/agent/restart" },
  "scout:send-relay-message":      { method: "POST", path: "/api/relay/send" },
  "scout:control-broker":          { method: "POST", path: "/api/broker/control" },
  "scout:get-keep-alive-state":    { method: "GET",  path: "/api/keep-alive" },
  "scout:acquire-keep-alive-lease":{ method: "POST", path: "/api/keep-alive/acquire" },
  "scout:release-keep-alive-lease":{ method: "POST", path: "/api/keep-alive/release" },
  "scout:get-agent-session":       { method: "GET",  path: (args) => `/api/agent-session/${args[0]}` },
  "scout:open-agent-session":      { method: "POST", path: (args) => `/api/agent-session/${args[0]}/open` },
  "scout:toggle-voice-capture":    { method: "POST", path: "/api/voice/toggle-capture" },
  "scout:set-voice-replies-enabled":{ method: "POST", path: "/api/voice/replies" },
  "scout:get-log-catalog":         { method: "GET",  path: "/api/log-catalog" },
  "scout:get-broker-inspector":    { method: "GET",  path: "/api/broker-inspector" },
  "scout:get-feedback-bundle":     { method: "GET",  path: "/api/feedback-bundle" },
  "scout:submit-feedback-report":  { method: "POST", path: "/api/feedback-report" },
  "scout:read-log-source":         { method: "POST", path: "/api/log-source" },
};

function resolveBaseUrl(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return "http://localhost:3200";
}

async function readApiResponse(res: Response, url: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    let message = text.trim() || `HTTP ${res.status}`;
    if (text.length > 0) {
      try {
        const body = JSON.parse(text) as { error?: string; detail?: string };
        if (typeof body.error === "string" && body.error.trim()) {
          message = body.detail ? `${body.error}: ${body.detail}` : body.error;
        }
      } catch {
        // use raw text
      }
    }
    throw new Error(`${url} → ${message}`);
  }
  if (!text.length) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} → response is not JSON`);
  }
}

async function webInvoke(channel: string, ...args: unknown[]): Promise<unknown> {
  if (channel === "scout:reload-app") {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
    return true;
  }

  const route = API_ROUTES[channel];
  if (!route) {
    console.warn(`[web-bridge] unknown channel: ${channel}`);
    return null;
  }

  const base = resolveBaseUrl();
  const path = typeof route.path === "function" ? route.path(args) : route.path;
  const url = `${base}${path}`;

  if (route.method === "GET") {
    const res = await fetch(url);
    return readApiResponse(res, url);
  }

  const body = args[0] !== undefined ? args[0] : {};
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readApiResponse(res, url);
}

export function createWebBridge(): ScoutElectronBridge {
  return { ...createScoutElectronBridge(webInvoke), isDesktop: false } as ScoutElectronBridge;
}
