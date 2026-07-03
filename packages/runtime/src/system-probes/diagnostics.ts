import { gitBuildInfoProbe } from "./git-build-info.js";
import { getScoutdProbeClient } from "./scoutd-client.js";
import { tailscaleStatusProbe } from "./tailscale-status.js";
import type { ProbeBackend, ProbeStatus } from "./registry.js";

const FALLBACK_WARNING_MS = 30_000;

export type SystemProbeDoctorFamily = {
  id: string;
  key?: string;
  backend: ProbeBackend;
  status: ProbeStatus;
  lastRunAt: number | null;
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  fallbackSince: number | null;
  fallbackReason: string | null;
  fallbackAgeMs: number | null;
  warning: string | null;
};

export type SystemProbeDoctorReport = {
  socketPath: string;
  socketExists: boolean;
  daemonObserved: boolean;
  daemonVersion: string | null;
  supportedProbeIds: string[];
  lastCapabilityCheckAt: number | null;
  lastError: string | null;
  families: SystemProbeDoctorFamily[];
  warnings: string[];
};

export async function loadSystemProbeDoctorReport(input: { repoRoot: string }): Promise<SystemProbeDoctorReport> {
  await Promise.allSettled([
    tailscaleStatusProbe.fresh(),
    gitBuildInfoProbe.for(input.repoRoot).fresh(),
  ]);

  const diagnostics = getScoutdProbeClient().diagnostics();
  const families = [
    familyReport({
      id: "tailscale.status",
      snapshot: tailscaleStatusProbe.snapshot(),
      metrics: tailscaleStatusProbe.metrics(),
    }),
    familyReport({
      id: "git.buildInfo",
      key: gitBuildInfoProbe.for(input.repoRoot).snapshot().key,
      snapshot: gitBuildInfoProbe.for(input.repoRoot).snapshot(),
      metrics: gitBuildInfoProbe.for(input.repoRoot).metrics(),
    }),
  ];
  const warnings = families.flatMap((family) => family.warning ? [family.warning] : []);

  return {
    socketPath: diagnostics.socketPath,
    socketExists: diagnostics.socketExists,
    daemonObserved: diagnostics.daemonObserved,
    daemonVersion: diagnostics.daemonVersion,
    supportedProbeIds: diagnostics.supportedProbeIds,
    lastCapabilityCheckAt: diagnostics.lastCapabilityCheckAt,
    lastError: diagnostics.lastError,
    families,
    warnings,
  };
}

function familyReport(input: {
  id: string;
  key?: string;
  snapshot: {
    status: ProbeStatus;
    backend: ProbeBackend;
    fallbackSince?: number;
    fallbackReason?: string;
  };
  metrics: {
    lastRunAt: number | null;
    lastSuccessAt: number | null;
    consecutiveFailures: number;
    fallbackSince?: number;
    fallbackReason?: string;
  };
}): SystemProbeDoctorFamily {
  const fallbackSince = input.snapshot.fallbackSince ?? input.metrics.fallbackSince ?? null;
  const fallbackReason = input.snapshot.fallbackReason ?? input.metrics.fallbackReason ?? null;
  const fallbackAgeMs = fallbackSince === null ? null : Math.max(0, Date.now() - fallbackSince);
  const warning = input.snapshot.backend === "local-fallback" && fallbackAgeMs !== null && fallbackAgeMs >= FALLBACK_WARNING_MS
    ? `${input.id} has used local fallback for ${Math.round(fallbackAgeMs / 1000)}s: ${fallbackReason ?? "unknown reason"}`
    : null;

  return {
    id: input.id,
    ...(input.key ? { key: input.key } : {}),
    backend: input.snapshot.backend,
    status: input.snapshot.status,
    lastRunAt: input.metrics.lastRunAt,
    lastSuccessAt: input.metrics.lastSuccessAt,
    consecutiveFailures: input.metrics.consecutiveFailures,
    fallbackSince,
    fallbackReason,
    fallbackAgeMs,
    warning,
  };
}
