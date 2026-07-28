import { DECK_TREATMENT_META, useDeckController } from "./deck-controller.ts";
import { TreatmentSwitch } from "./deck-parts.tsx";
import { DeckBrief } from "./treatments/DeckBrief.tsx";
import { DeckConsole } from "./treatments/DeckConsole.tsx";
import { DeckYoke } from "./treatments/DeckYoke.tsx";
import "./scout-deck.css";

export { buildDeckLanes } from "./deck-controller.ts";

/**
 * The Deck shell. It owns one controller and mounts one of three treatments
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
          <span className="scout-deck__mark" aria-hidden="true">S</span>
          <span className="scout-deck__wordmark">
            <strong>Deck</strong>
            <small>{DECK_TREATMENT_META[model.treatment].tagline}</small>
          </span>
          {model.preview ? (
            <span
              className="scout-deck__sim"
              title="Every lane, thread, and turn on screen is local sample data. No host is attached."
            >
              Sample data
            </span>
          ) : null}
        </div>
        <TreatmentSwitch model={model} />
      </header>

      {model.treatment === "console"
        ? <DeckConsole model={model} />
        : model.treatment === "brief"
          ? <DeckBrief model={model} />
          : <DeckYoke model={model} />}
    </main>
  );
}
