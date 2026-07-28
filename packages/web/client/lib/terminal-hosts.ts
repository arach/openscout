import { useEffect, useState } from "react";

import { api } from "./api.ts";

export type TerminalHostControlAction =
  | "interrupt"
  | "quit"
  | "stop-job"
  | "restart-resume"
  | "detach"
  | "force-quit"
  | "force-quit-bridge";

export type TerminalHostCapabilities = {
  attach: boolean;
  relayAttach: boolean;
  observe: boolean;
  sendInput: boolean;
  capture: boolean;
  create: boolean;
  list: boolean;
  observedAgentState: boolean;
  control: TerminalHostControlAction[];
  harnessControl: TerminalHostControlAction[];
};

export type TerminalHostDescriptor = {
  id: string;
  label: string;
  description: string;
  capabilities: TerminalHostCapabilities;
  availability: { installed: boolean; version?: string | null; reason?: string | null };
};

export type TerminalHostsPayload = {
  ok: true;
  count: number;
  preferredHostId: string | null;
  hosts: TerminalHostDescriptor[];
};

export async function fetchTerminalHosts(): Promise<TerminalHostsPayload> {
  return api<TerminalHostsPayload>("/api/terminal-hosts");
}

/**
 * Whether a host performs a control verb, by either route.
 *
 * The default when the inventory has not loaded is FALSE: an action the server
 * would reject must not be drawn on the strength of an optimistic guess. A
 * button that appears a beat late is better than one that fails after a click.
 */
export function terminalHostSupportsControl(
  hosts: readonly TerminalHostDescriptor[],
  backend: string | null | undefined,
  action: TerminalHostControlAction,
): boolean {
  const host = hosts.find((candidate) => candidate.id === backend);
  if (!host) return false;
  return host.capabilities.control.includes(action)
    || host.capabilities.harnessControl.includes(action);
}

export function terminalHostById(
  hosts: readonly TerminalHostDescriptor[],
  backend: string | null | undefined,
): TerminalHostDescriptor | null {
  return hosts.find((candidate) => candidate.id === backend) ?? null;
}

// The inventory is a probe of installed binaries; it changes when someone
// installs a multiplexer, not while an operator works. One fetch per mount,
// shared through a module-level cache so a screen full of tiles does not probe
// the host once per tile.
let cachedHosts: TerminalHostsPayload | null = null;
let inFlight: Promise<TerminalHostsPayload> | null = null;

export function loadTerminalHosts(): Promise<TerminalHostsPayload> {
  if (cachedHosts) return Promise.resolve(cachedHosts);
  inFlight ??= fetchTerminalHosts()
    .then((payload) => {
      cachedHosts = payload;
      return payload;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test seam: drop the cached inventory. */
export function resetTerminalHostsCache(): void {
  cachedHosts = null;
  inFlight = null;
}

export function useTerminalHosts(): {
  hosts: TerminalHostDescriptor[];
  preferredHostId: string | null;
  loaded: boolean;
} {
  const [payload, setPayload] = useState<TerminalHostsPayload | null>(cachedHosts);

  useEffect(() => {
    if (payload) return;
    let cancelled = false;
    void loadTerminalHosts()
      .then((next) => {
        if (!cancelled) setPayload(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [payload]);

  return {
    hosts: payload?.hosts ?? [],
    preferredHostId: payload?.preferredHostId ?? null,
    loaded: payload !== null,
  };
}
