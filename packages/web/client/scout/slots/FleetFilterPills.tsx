import "./fleet-shared.css";

export type FleetStateToken = "working" | "available" | "offline";

const STATE_TOKENS: readonly FleetStateToken[] = ["working", "available", "offline"];

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
            className={`fleet-pill fleet-pill--${t}${on ? " fleet-pill--on" : ""}`}
            onClick={() => onToggle(t)}
            aria-pressed={on}
          >
            {t}
          </button>
        );
      })}
    </div>
  );
}
