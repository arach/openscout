import { herdrTerminalHost } from "./herdr.ts";
import { tmuxTerminalHost } from "./tmux.ts";
import { zellijTerminalHost } from "./zellij.ts";
import type {
  TerminalHostAdapter,
  TerminalHostAvailability,
  TerminalHostCapabilities,
  TerminalHostContext,
  TerminalHostControlAction,
} from "./types.ts";

/**
 * The terminal host registry.
 *
 * Modelled on `db/internal/paths.ts`'s `HARNESS_SESSION_RESOLVERS` — a record
 * plus a `?? default` fallback. Transports already had a registry; terminal
 * backends had thirty-five if/else branches spread across three languages.
 * Adding a host is an entry here, not a migration.
 */
export const TERMINAL_HOST_ADAPTERS: Record<string, TerminalHostAdapter> = {
  [tmuxTerminalHost.id]: tmuxTerminalHost,
  [zellijTerminalHost.id]: zellijTerminalHost,
  [herdrTerminalHost.id]: herdrTerminalHost,
};

/**
 * The host an unqualified request lands on. tmux is the default because it is
 * the only host every Scout delivery path already drives; the point of naming
 * it here is that it is a CHOICE, not a fallthrough at the end of four
 * different functions.
 */
export const DEFAULT_TERMINAL_HOST_ID = tmuxTerminalHost.id;

export function terminalHostAdapters(): TerminalHostAdapter[] {
  return Object.values(TERMINAL_HOST_ADAPTERS);
}

export function terminalHostAdapter(id: string | null | undefined): TerminalHostAdapter | null {
  const key = id?.trim();
  return key ? TERMINAL_HOST_ADAPTERS[key] ?? null : null;
}

export function resolveTerminalHostAdapter(id: string | null | undefined): TerminalHostAdapter {
  return terminalHostAdapter(id) ?? TERMINAL_HOST_ADAPTERS[DEFAULT_TERMINAL_HOST_ID]!;
}

export function isKnownTerminalHost(id: string | null | undefined): boolean {
  return terminalHostAdapter(id) !== null;
}

/**
 * Whether a host performs a verb itself, or performs it through Scout's
 * harness-aware layer. A UI asks this before drawing the button; a route asks
 * it before doing the work.
 */
export function terminalHostSupportsControl(
  id: string | null | undefined,
  action: TerminalHostControlAction,
): { supported: boolean; via: "host" | "harness" | null } {
  const adapter = terminalHostAdapter(id);
  if (!adapter) return { supported: false, via: null };
  if (adapter.capabilities.control.includes(action)) return { supported: true, via: "host" };
  if (adapter.capabilities.harnessControl.includes(action)) return { supported: true, via: "harness" };
  return { supported: false, via: null };
}

/**
 * Availability is cached briefly per host.
 *
 * A binary does not get uninstalled while an operator works, but a `--version`
 * shell-out CAN time out on a loaded machine — and when it did, the host
 * silently disappeared from "start something new". Holding the last successful
 * answer for a short window means a busy box no longer looks like a machine
 * without tmux. Failures are never cached, so a genuinely missing host is
 * reported as soon as it is asked about.
 */
const HOST_AVAILABILITY_TTL_MS = 30_000;
const availabilityCache = new Map<string, { at: number; value: TerminalHostAvailability }>();

/** Test seam: drop cached availability. */
export function resetTerminalHostAvailabilityCache(): void {
  availabilityCache.clear();
}

async function probeTerminalHostAvailability(
  adapter: TerminalHostAdapter,
  context: TerminalHostContext,
): Promise<TerminalHostAvailability> {
  const cached = availabilityCache.get(adapter.id);
  const fresh = cached && Date.now() - cached.at < HOST_AVAILABILITY_TTL_MS;
  const availability = await adapter.probe(context).catch((error): TerminalHostAvailability => ({
    installed: false,
    reason: error instanceof Error ? error.message : String(error),
  }));
  if (availability.installed) {
    availabilityCache.set(adapter.id, { at: Date.now(), value: availability });
    return availability;
  }
  return fresh && cached ? cached.value : availability;
}

export type TerminalHostDescriptor = {
  id: string;
  label: string;
  description: string;
  capabilities: TerminalHostCapabilities;
  availability: TerminalHostAvailability;
};

/**
 * Every registered host with its live availability. Sorted so installed hosts
 * come first: an operator picking a host should see what they can actually use,
 * and should never have to know which multiplexer is which to get a sane one.
 */
export async function describeTerminalHosts(
  context: TerminalHostContext = {},
): Promise<TerminalHostDescriptor[]> {
  const descriptors = await Promise.all(terminalHostAdapters().map(async (adapter) => ({
    id: adapter.id,
    label: adapter.label,
    description: adapter.description,
    capabilities: adapter.capabilities,
    availability: await probeTerminalHostAvailability(adapter, context),
  })));
  return descriptors.sort((left, right) =>
    Number(right.availability.installed) - Number(left.availability.installed)
    || left.id.localeCompare(right.id)
  );
}

/**
 * The host Scout picks when the operator has not chosen one: the first
 * installed host that the web relay can actually render, preferring the
 * declared default. Returns null when nothing durable is installed — the caller
 * must then offer a plain shell and say so, not default to a host that is not
 * there.
 */
export async function resolvePreferredTerminalHost(
  context: TerminalHostContext = {},
): Promise<TerminalHostDescriptor | null> {
  const hosts = await describeTerminalHosts(context);
  const usable = hosts.filter((host) => host.availability.installed && host.capabilities.relayAttach);
  return usable.find((host) => host.id === DEFAULT_TERMINAL_HOST_ID) ?? usable[0] ?? null;
}
