/**
 * ObserveStatsMatrix — the 2×N grid of trace metrics.
 *
 * Each cell: a small mono eyebrow + a numeric value. Used in the agent
 * inspector to surface Turns / Tools / Thinks / Asks / Reads / Edits /
 * Files / Window in one compact block.
 *
 * Lifted from: packages/web/client/scout/inspector/AgentsInspector.tsx:344-356
 *              (the Trace stats section + TraceMetric).
 */
export interface ObserveMetric {
  label: string;
  value: string | number;
}

interface ObserveStatsMatrixProps {
  metrics: ObserveMetric[];
}

export function ObserveStatsMatrix({ metrics }: ObserveStatsMatrixProps) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="rounded border border-studio-edge bg-studio-canvas-alt px-2 py-1.5"
        >
          <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            {m.label}
          </div>
          <div className="mt-0.5 font-display text-[18px] leading-none tracking-tight text-studio-ink tabular-nums">
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}
