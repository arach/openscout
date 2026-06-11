"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import { ScoutWindow } from "@/components/scout/ScoutWindow";
import styles from "./page.module.css";

/**
 * Scout — Settings (Appearance).
 *
 * The implementation spec for `ScoutSettingsView.appearancePage`. The deltas
 * from today's Swift: accent moves from big tiles to an inline dot row, the
 * sections are reordered (Theme → Mode → Accent → Window material), and a
 * "Preview accents on hover" toggle is added. Reads only `--s-*` tokens.
 */

type Preset = {
  name: string;
  tone: string;
  bg: string;
  chrome: string;
  surface: string;
  accent: string;
  active?: boolean;
};

/* The four presets the app ships (ScoutThemePreset.settingsCases). Swatch
   colors are each preset's own surfaces, so the card previews the real skin. */
const PRESETS: Preset[] = [
  { name: "Paper", tone: "Light", bg: "#fafafb", chrome: "#f1f2f4", surface: "#ffffff", accent: "#4954c4" },
  { name: "Mist", tone: "Light", bg: "#f5f7fa", chrome: "#e9edf2", surface: "#ffffff", accent: "#4954c4" },
  { name: "Graphite", tone: "Soft dark", bg: "#121214", chrome: "#08080a", surface: "#242428", accent: "#6d7ae8" },
  { name: "Nocturne", tone: "Soft dark", bg: "#0f131b", chrome: "#090c12", surface: "#222c3b", accent: "#6d7ae8", active: true },
];

const ACCENTS: { name: string; color: string; active?: boolean }[] = [
  { name: "Indigo", color: "#4954c4", active: true },
  { name: "Forest", color: "#387a57" },
  { name: "Cyan", color: "#007d87" },
  { name: "Amber", color: "#bf6917" },
  { name: "Rose", color: "#b34a61" },
];

const MODES = ["Light", "Dark", "Auto"] as const;
const SET_NAV = ["Appearance", "About"] as const;

export default function ScoutSettingsStudy() {
  return (
    <ScoutStudyShell
      pageId="scout-settings"
      title="Scout — Settings"
      blurb={
        <>
          The Appearance page as it should ship. Deltas from today&apos;s{" "}
          <code className="font-mono text-[11px] text-studio-ink">ScoutSettingsView</code>:
          accent becomes an inline dot row (not big tiles), the sections reorder to
          Theme → Mode → Accent → Window material, and a Preview-accents-on-hover
          toggle is added. The opacity slider stays.
        </>
      }
    >
      <ScoutWindow title="scout · settings">
        <div className={styles.settings}>
          <nav className={styles.nav}>
            <div className={styles.navTitle}>Settings</div>
            {SET_NAV.map((n, i) => (
              <div key={n} className={`${styles.navItem} ${i === 0 ? styles.active : ""}`}>
                <span className={styles.navGlyph}>{i === 0 ? <PaletteGlyph /> : <InfoGlyph />}</span>
                {n}
              </div>
            ))}
          </nav>

          <div className={styles.pane}>
            <header className={styles.pageHead}>
              <PaletteGlyph className={styles.pageHeadIcon} />
              <h2 className={styles.pageTitle}>Appearance</h2>
              <p className={styles.pageSub}>Theme, accent, and window material.</p>
            </header>

            {/* Theme */}
            <section className={styles.block}>
              <div className={styles.blockTitle}>Theme</div>
              <div className={styles.blockHint}>
                The preset sets the surfaces; mode and accent layer on top.
              </div>
              <div className={styles.presetGrid}>
                {PRESETS.map((p) => (
                  <div key={p.name} className={`${styles.presetCard} ${p.active ? styles.active : ""}`}>
                    <div className={styles.swatch} style={{ background: p.bg }}>
                      <span className={styles.swatchChrome} style={{ background: p.chrome }} />
                      <span className={styles.swatchSurface} style={{ background: p.surface }} />
                      <span className={styles.swatchAccent} style={{ background: p.accent }} />
                    </div>
                    <div className={styles.presetMeta}>
                      <span className={styles.presetName}>{p.name}</span>
                      <span className={styles.presetTone}>{p.tone}</span>
                    </div>
                    <span className={`${styles.check} ${p.active ? styles.checkOn : ""}`} />
                  </div>
                ))}
              </div>
            </section>

            {/* Mode · Accent · Window */}
            <section className={styles.block}>
              <Row label="Mode" hint="Render the preset in its light or dark tone.">
                <div className={styles.seg}>
                  {MODES.map((m, i) => (
                    <span key={m} className={`${styles.segBtn} ${i === 0 ? styles.active : ""}`}>
                      {m}
                    </span>
                  ))}
                </div>
              </Row>

              <Row label="Accent" hint="Tints actions, selection, and live state.">
                <div className={styles.accentRow}>
                  {ACCENTS.map((a) => (
                    <span
                      key={a.name}
                      title={a.name}
                      className={`${styles.accentDot} ${a.active ? styles.active : ""}`}
                      style={{ background: a.color }}
                    />
                  ))}
                </div>
              </Row>

              <Row label="Window opacity" hint="100% — fully opaque.">
                <div className={styles.sliderWrap}>
                  <div className={styles.slider}>
                    <span className={styles.sliderFill} style={{ width: "100%" }} />
                    <span className={styles.sliderKnob} style={{ left: "100%" }} />
                  </div>
                  <div className={styles.sliderEnds}>
                    <span>Clear</span>
                    <span>Solid</span>
                  </div>
                </div>
              </Row>

              <Row
                label="Preview on hover"
                hint="Flash a preset's accent when hovering its card."
              >
                <div className={`${styles.toggle} ${styles.on}`}>
                  <span className={styles.toggleKnob} />
                </div>
              </Row>
            </section>
          </div>
        </div>
      </ScoutWindow>
    </ScoutStudyShell>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabelCol}>
        <div className={styles.rowLabel}>{label}</div>
        <div className={styles.rowHint}>{hint}</div>
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

function PaletteGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3a9 9 0 1 0 0 18 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 9 9 0 0 0-9-9z" />
      <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" />
      <circle cx="16.5" cy="10.5" r="1" fill="currentColor" />
    </svg>
  );
}

function InfoGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}
