import { get, list, put } from "@vercel/blob";

export type OpenScoutReportSectionEntry = {
  label: string;
  value: string;
};

export type OpenScoutReportSection = {
  id: string;
  title: string;
  entries: OpenScoutReportSectionEntry[];
};

export type OpenScoutReport = {
  id: string;
  timestamp: string;
  system: {
    os: string;
    osVersion: string;
    chip: string;
    memory: string;
    locale?: string;
  };
  apps: Record<string, {
    running: boolean;
    pid?: number;
    version?: string;
    uptime?: number;
    memoryMB?: number;
  }>;
  context: {
    source: string;
    connectionState?: string;
    lastError?: string;
    userDescription?: string;
    reportSections?: OpenScoutReportSection[];
    generatedAt?: string;
    generatedAtLabel?: string;
    currentDirectory?: string;
  };
  logs: string[];
  performance?: Record<string, string>;
};

export type OpenScoutReportSummary = {
  id: string;
  source: string;
  userDescription: string | null;
  systemInfo: OpenScoutReport["system"];
  contextInfo: OpenScoutReport["context"];
  createdAt: string;
};

const REPORTS_PREFIX = "reports/";
const DEFAULT_REPORTS_BASE_URL = "https://api.openscout.app";

function reportPath(id: string): string {
  return `${REPORTS_PREFIX}${id}.json`;
}

export function getOpenScoutReportsBaseUrl(): string {
  return (
    process.env.OPENSCOUT_REPORTS_BASE_URL?.trim()
    || process.env.NEXT_PUBLIC_OPENSCOUT_REPORTS_BASE_URL?.trim()
    || DEFAULT_REPORTS_BASE_URL
  );
}

export function getOpenScoutReportAdminUrl(id: string): string {
  return `${getOpenScoutReportsBaseUrl()}/reports/${id}`;
}

function sanitizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function sanitizeSections(value: unknown): OpenScoutReportSection[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sections = value
    .map((section) => {
      if (!section || typeof section !== "object") {
        return null;
      }

      const entries = Array.isArray((section as { entries?: unknown[] }).entries)
        ? ((section as { entries: unknown[] }).entries
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return null;
              }
              const label = sanitizeString((entry as { label?: unknown }).label);
              const entryValue = sanitizeString((entry as { value?: unknown }).value);
              if (!label || !entryValue) {
                return null;
              }
              return { label, value: entryValue };
            })
            .filter((entry): entry is OpenScoutReportSectionEntry => entry !== null))
        : [];

      const id = sanitizeString((section as { id?: unknown }).id);
      const title = sanitizeString((section as { title?: unknown }).title);
      if (!id || !title || entries.length === 0) {
        return null;
      }

      return { id, title, entries };
    })
    .filter((section): section is OpenScoutReportSection => section !== null);

  return sections.length > 0 ? sections : undefined;
}

export function normalizeOpenScoutReport(input: unknown): OpenScoutReport | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<OpenScoutReport>;
  const id = sanitizeString(candidate.id);
  const timestamp = sanitizeString(candidate.timestamp);
  const source = sanitizeString(candidate.context?.source);
  const system = candidate.system;

  if (
    !id
    || !timestamp
    || !source
    || !system
    || typeof system !== "object"
    || !sanitizeString(system.os)
    || !sanitizeString(system.osVersion)
    || !sanitizeString(system.chip)
    || !sanitizeString(system.memory)
  ) {
    return null;
  }

  return {
    id,
    timestamp,
    system: {
      os: sanitizeString(system.os)!,
      osVersion: sanitizeString(system.osVersion)!,
      chip: sanitizeString(system.chip)!,
      memory: sanitizeString(system.memory)!,
      locale: sanitizeString(system.locale),
    },
    apps: typeof candidate.apps === "object" && candidate.apps ? candidate.apps : {},
    context: {
      source,
      connectionState: sanitizeString(candidate.context?.connectionState),
      lastError: sanitizeString(candidate.context?.lastError),
      userDescription: sanitizeString(candidate.context?.userDescription),
      reportSections: sanitizeSections(candidate.context?.reportSections),
      generatedAt: sanitizeString(candidate.context?.generatedAt),
      generatedAtLabel: sanitizeString(candidate.context?.generatedAtLabel),
      currentDirectory: sanitizeString(candidate.context?.currentDirectory),
    },
    logs: Array.isArray(candidate.logs)
      ? candidate.logs.map((line) => String(line)).filter((line) => line.length > 0)
      : [],
    performance: candidate.performance && typeof candidate.performance === "object"
      ? Object.fromEntries(Object.entries(candidate.performance).map(([key, value]) => [key, String(value)]))
      : undefined,
  };
}

export async function storeOpenScoutReport(report: OpenScoutReport) {
  return put(reportPath(report.id), JSON.stringify(report, null, 2), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  });
}

async function readBlobJson(pathname: string): Promise<OpenScoutReport | null> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) {
    return null;
  }

  const raw = await new Response(result.stream).text();
  const parsed = JSON.parse(raw) as unknown;
  return normalizeOpenScoutReport(parsed);
}

export async function getOpenScoutReport(id: string): Promise<OpenScoutReport | null> {
  return readBlobJson(reportPath(id));
}

export async function listOpenScoutReports(limit = 50): Promise<OpenScoutReportSummary[]> {
  const listed = await list({
    prefix: REPORTS_PREFIX,
    limit,
  });

  const reports = await Promise.all(
    listed.blobs.map(async (blob) => {
      const report = await readBlobJson(blob.pathname);
      if (!report) {
        return null;
      }

      return {
        id: report.id,
        source: report.context.source,
        userDescription: report.context.userDescription ?? null,
        systemInfo: report.system,
        contextInfo: report.context,
        createdAt: report.timestamp,
      } satisfies OpenScoutReportSummary;
    }),
  );

  return reports
    .filter((report): report is OpenScoutReportSummary => report !== null)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}
