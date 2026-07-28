import { DECK_TREATMENT_META, useDeckController } from "./deck-controller.ts";
import { TreatmentSwitch } from "./deck-parts.tsx";
import { DeckBrief } from "./treatments/DeckBrief.tsx";
import { DeckConsole } from "./treatments/DeckConsole.tsx";
import { DeckOps } from "./treatments/DeckOps.tsx";
import { DeckYoke } from "./treatments/DeckYoke.tsx";
import "./scout-deck.css";

export { buildDeckLanes } from "./deck-controller.ts";

/**
 * The Deck shell. It owns one controller and mounts one of four treatments
 * against it. Switching treatments re-parents the layout but never the state:
 * the same snapshot, binding, and in-flight turn carry straight across.
 */
export function ScoutDeckSurface() {
  const model = useDeckController();

  return (
    <main
      className="scout-deck"
      data-connection={model.connection}
      data-treatment={model.treatment}
      data-preview={model.preview || undefined}
    >
      <header className="scout-deck__strip">
        <div className="scout-deck__brand">
          {model.treatment === "ops" ? (
            <>
              <span className="scout-deck__ops-brand">
                <strong>SCOUT</strong>
                <i>·</i>
                <small>OPS</small>
              </span>
              <span className="scout-deck__ops-mode"><i />AGENT DECK</span>
            </>
          ) : (
            <>
              <span className="scout-deck__mark" aria-hidden="true">S</span>
              <span className="scout-deck__wordmark">
                <strong>Deck</strong>
                <small>{DECK_TREATMENT_META[model.treatment].tagline}</small>
              </span>
            </>
          )}
          {model.preview ? (
            <span
              className="scout-deck__sim"
              title="Every lane, thread, and turn on screen is local sample data. No host is attached."
            >
              Sample data
            </span>
          ) : null}
        </div>
        {model.treatment === "ops" ? (
          <span className="scout-deck__ops-count">
            {model.hosts.length} HOST{model.hosts.length === 1 ? "" : "S"} · {model.scopedLanes.length} AGENT{model.scopedLanes.length === 1 ? "" : "S"}
          </span>
        ) : null}
        <TreatmentSwitch model={model} />
      </header>

      {model.treatment === "ops"
        ? <DeckOps model={model} />
        : model.treatment === "console"
        ? <DeckConsole model={model} />
        : model.treatment === "brief"
          ? <DeckBrief model={model} />
          : <DeckYoke model={model} />}
    </main>
  );
}
