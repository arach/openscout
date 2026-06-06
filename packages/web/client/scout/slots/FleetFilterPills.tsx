import "./fleet-shared.css";

export type FleetStateToken = "working" | "ready" | "not_ready";

const STATE_TOKENS: readonly FleetStateToken[] = ["working", "ready", "not_ready"];

const STATE_LABELS: Record<FleetStateToken, string> = {
  working: "working",
  ready: "ready",
  not_ready: "not ready",
};

const STATE_CLASS_TOKENS: Record<FleetStateToken, string> = {
  working: "working",
  ready: "available",
  not_ready: "offline",
};

type Props = {
  active: ReadonlySet<FleetStateToken>;
  onToggle: (token: FleetStateToken) => void;
};

export function FleetFilterPills({ active, onToggle }: Props) {
  return (
    <div className="fleet-pills" role="group" aria-label="State filters">
      {STATE_TOKENS.map((t) => {
        const on = active.has(t);
        return (
          <button
            key={t}
            type="button"
            className={`fleet-pill fleet-pill--${STATE_CLASS_TOKENS[t]}${on ? " fleet-pill--on" : ""}`}
            onClick={() => onToggle(t)}
            aria-pressed={on}
          >
            {STATE_LABELS[t]}
          </button>
        );
      })}
    </div>
  );
}
