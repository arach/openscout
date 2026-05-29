/**
 * Launch attribution for a tailed transcript. The runtime/harness name shown
 * to users is carried by `source` ("claude", "codex", "quad", ...).
 */
export type TailAttribution = "scout-managed" | "hudson-managed" | "unattributed";

/** @deprecated Use TailAttribution for the `harness` field. */
export type TailHarness = TailAttribution;

export type TailDiscoveryScope = "hot" | "shallow" | "deep";

export type TailEventKind =
  | "user"
  | "assistant"
  | "tool"
  | "tool-result"
  | "system"
  | "other";

export type TailEvent = {
  id: string;
  ts: number;
  /** Runtime harness/source name, e.g. "claude", "codex", "quad". */
  source: string;
  sessionId: string;
  pid: number;
  parentPid: number | null;
  project: string;
  cwd: string;
  /** Launch attribution; retained as `harness` for wire compatibility. */
  harness: TailHarness;
  kind: TailEventKind;
  summary: string;
  raw?: unknown;
};

export type TailSessionPreviewStats = {
  eventCount: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  systemEvents: number;
  otherEvents: number;
  transcriptBytes: number | null;
  processPid: number | null;
  lastEventAt: number | null;
  updatedAt: number | null;
};

export type TailSessionPreviewFact = {
  key: string;
  label: string;
  value: string;
  title?: string;
};

export type TailSessionPreview = {
  title: string;
  subtitle: string | null;
  summary: string | null;
  detail: string | null;
  updatedAt: number | null;
  stats: TailSessionPreviewStats;
  facts: TailSessionPreviewFact[];
};

export type DiscoveredProcess = {
  pid: number;
  ppid: number;
  command: string;
  etime: string;
  cwd: string | null;
  /** Launch attribution; retained as `harness` for wire compatibility. */
  harness: TailHarness;
  parentChain: { pid: number; command: string }[];
  /** Runtime harness/source name, e.g. "claude", "codex", "quad". */
  source: string;
};

export type DiscoveredTranscript = {
  source: string;
  transcriptPath: string;
  sessionId: string | null;
  cwd: string | null;
  project: string;
  /** Launch attribution; retained as `harness` for wire compatibility. */
  harness: TailHarness;
  mtimeMs: number;
  size: number;
  preview?: TailSessionPreview;
};

export type DiscoverySnapshot = {
  generatedAt: number;
  processes: DiscoveredProcess[];
  transcripts: DiscoveredTranscript[];
  totals: {
    total: number;
    scoutManaged: number;
    hudsonManaged: number;
    unattributed: number;
    transcripts: number;
  };
};

export type TailContext = {
  process: DiscoveredProcess;
  transcript: DiscoveredTranscript;
  transcriptPath: string;
  lineOffset: number;
};

export type TailSessionPreviewInput = {
  process: DiscoveredProcess | null;
  transcript: DiscoveredTranscript;
  events: TailEvent[];
  now?: number;
};

export interface TranscriptSource {
  readonly name: string;
  discoverProcesses(): Promise<DiscoveredProcess[]> | DiscoveredProcess[];
  discoverTranscripts(
    processes: DiscoveredProcess[],
    scope?: TailDiscoveryScope,
  ): Promise<DiscoveredTranscript[]> | DiscoveredTranscript[];
  parseLine(line: string, ctx: TailContext): TailEvent | null;
  previewSession(input: TailSessionPreviewInput): TailSessionPreview;
}
