export type TailHarness = "scout-managed" | "hudson-managed" | "unattributed";

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

export type DiscoverySnapshot = {
  generatedAt: number;
  processes: DiscoveredProcess[];
  totals: {
    total: number;
    scoutManaged: number;
    hudsonManaged: number;
    unattributed: number;
  };
};

export type TailContext = {
  process: DiscoveredProcess;
  transcriptPath: string;
  lineOffset: number;
};

export interface TranscriptSource {
  readonly name: string;
  discoverProcesses(): Promise<DiscoveredProcess[]> | DiscoveredProcess[];
  resolveTranscriptPath(p: DiscoveredProcess): string | null;
  parseLine(line: string, ctx: TailContext): TailEvent | null;
}
