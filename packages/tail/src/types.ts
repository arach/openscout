export type TailHarness = "scout-managed" | "hudson-managed" | "unattributed";

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
  source: string;
  sessionId: string;
  pid: number;
  parentPid: number | null;
  project: string;
  cwd: string;
  harness: TailHarness;
  kind: TailEventKind;
  summary: string;
  raw?: unknown;
};

export type DiscoveredProcess = {
  pid: number;
  ppid: number;
  command: string;
  etime: string;
  cwd: string | null;
  harness: TailHarness;
  parentChain: { pid: number; command: string }[];
  source: string;
};

export type DiscoveredTranscript = {
  source: string;
  transcriptPath: string;
  sessionId: string | null;
  cwd: string | null;
  project: string;
  harness: TailHarness;
  mtimeMs: number;
  size: number;
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

export interface TranscriptSource {
  readonly name: string;
  discoverProcesses(): Promise<DiscoveredProcess[]> | DiscoveredProcess[];
  discoverTranscripts(
    processes: DiscoveredProcess[],
    scope?: TailDiscoveryScope,
  ): Promise<DiscoveredTranscript[]> | DiscoveredTranscript[];
  parseLine(line: string, ctx: TailContext): TailEvent | null;
}
