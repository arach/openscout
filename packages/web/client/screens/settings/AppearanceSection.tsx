import { useCallback, useEffect, useState } from "react";
import {
  ACCENTS,
  accentColor,
  applyAppearance,
  loadAppearance,
  saveAppearance,
  type AppearancePrefs,
  type DensityPref,
  type ThemePref,
} from "../../lib/appearance.ts";

// Local primitives mirror SettingsDrawer's Field / SectionRule / OptionRow so
// the section reads as native. Kept in-file to respect file boundaries.

function SectionRule({ label, right }: { label: string; right?: string }) {
  return (
    <div className="s-settings-section-rule">
      <span className="s-settings-section-label">{label}</span>
      <span className="s-settings-section-line" />
      {right && <span className="s-settings-section-right">{right}</span>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="s-settings-field">
      <label className="s-settings-field-label">{label}</label>
      {children}
      {hint && <span className="s-settings-field-hint">{hint}</span>}
    </div>
  );
}

function OptionRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; sub: string }[];
}) {
  return (
    <div
      className="s-settings-option-grid"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((o) => (
        <button
          key={o.id}
          className={`s-settings-option-btn${value === o.id ? " s-settings-option-btn--active" : ""}`}
          onClick={() => onChange(o.id)}
        >
          <span className="s-settings-option-label">{o.label}</span>
          <span className="s-settings-option-sub">{o.sub}</span>
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="s-appearance-toggle-row">
      <div className="s-appearance-toggle-copy">
        <span className="s-settings-field-label">{label}</span>
        {hint && <span className="s-settings-field-hint">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`s-appearance-toggle${on ? " s-appearance-toggle--on" : ""}`}
        onClick={() => onToggle(!on)}
      />
    </div>
  );
}

export function AppearanceSection() {
  const [prefs, setPrefs] = useState<AppearancePrefs>(() => loadAppearance());

  // Apply on mount (covers first paint when this section is the entry point).
  useEffect(() => {
    applyAppearance(prefs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((patch: Partial<AppearancePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveAppearance(next);
      applyAppearance(next);
      return next;
    });
  }, []);

  const activeAccentLabel = ACCENTS.find((a) => a.id === prefs.accent)?.label ?? "";

  return (
    <div className="s-settings-col-gap">
      <SectionRule label="Theme" right="this device only" />
      <Field label="Color theme" hint="System follows your OS light/dark setting.">
        <OptionRow<ThemePref>
          value={prefs.theme}
          onChange={(v) => update({ theme: v })}
          options={[
            { id: "system", label: "System", sub: "match os" },
            { id: "dark", label: "Dark", sub: "always dark" },
            { id: "light", label: "Light", sub: "always light" },
          ]}
        />
      </Field>

      <Field label="Accent" hint="Tints buttons, focus rings, and active states.">
        <div className="s-appearance-swatch-row">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-label={a.label}
              aria-pressed={prefs.accent === a.id}
              title={a.label}
              className={`s-appearance-swatch${prefs.accent === a.id ? " s-appearance-swatch--active" : ""}`}
              style={{ background: accentColor(a.id), color: accentColor(a.id) }}
              onClick={() => update({ accent: a.id })}
            />
          ))}
          <span className="s-appearance-swatch-name">{activeAccentLabel.toLowerCase()}</span>
        </div>
      </Field>

      <SectionRule label="Layout" />
      <Field label="Density" hint="Compact tightens spacing across settings surfaces.">
        <OptionRow<DensityPref>
          value={prefs.density}
          onChange={(v) => update({ density: v })}
          options={[
            { id: "comfortable", label: "Comfortable", sub: "roomy · default" },
            { id: "compact", label: "Compact", sub: "denser rows" },
          ]}
        />
      </Field>

      <SectionRule label="Behavior" />
      <Toggle
        label="Reduce motion"
        hint="Minimizes transitions and animations across the app."
        on={prefs.reduceMotion}
        onToggle={(v) => update({ reduceMotion: v })}
      />
      <Toggle
        label="Markdown preview by default"
        hint="Open message and file editors in rendered preview instead of raw."
        on={prefs.markdownPreview}
        onToggle={(v) => update({ markdownPreview: v })}
      />
    </div>
  );
}
