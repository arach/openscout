import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import styles from "./ScoutSurface.module.css";

/**
 * Scout main-view chrome — the shared system every main surface (Tail, Repos,
 * Agents, Comms) speaks, so they stay coherent by construction rather than by
 * hand-copying tokens.
 *
 *   ScoutPageHeader   — the 52px identity bar: title + LIVE + counts | actions
 *   ScoutInspector    — the right panel: `| TYPE` + status head, body slot
 *     └ ScoutInspectorCard / ScoutInspectorTop / ScoutGroup / ScoutKV
 *
 * The inspector head lands on the same 52px line as the page header, so both
 * hairlines fuse into one chrome line across the surface.
 */

type Tone = "ok" | "warn" | "accent" | "info" | "dim" | "error";

const TONE: Record<Tone, string> = {
  ok: "var(--s-ok)",
  warn: "var(--s-warn)",
  accent: "var(--s-accent)",
  info: "var(--s-info)",
  dim: "var(--s-dim)",
  error: "var(--s-error)",
};

const toneVar = (tone?: Tone): CSSProperties | undefined =>
  tone ? ({ "--tone": TONE[tone] } as CSSProperties) : undefined;

/* ── Page header ───────────────────────────────────────────────────── */

export type HeaderCount = { n: ReactNode; label: string; tone?: Tone };

export function ScoutPageHeader({
  title,
  glyph,
  live,
  counts,
  pill,
  actions,
}: {
  title: string;
  /** Optional identity mark, sits before the title (e.g. Tail's pulse glyph). */
  glyph?: ReactNode;
  live?: boolean;
  counts?: HeaderCount[];
  pill?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHead}>
      {/* Identity cluster: glyph + title + LIVE read as one object. */}
      <span className={styles.identity}>
        {glyph ? <span className={styles.glyph}>{glyph}</span> : null}
        <span className={styles.title}>{title}</span>
        {live ? (
          <span className={styles.live}>
            <span className={styles.livePip} /> Live
          </span>
        ) : null}
      </span>
      {/* Inline metric read-out — quiet, ranked below the identity. */}
      {counts?.length ? (
        <span className={styles.counts}>
          {counts.map((c) => (
            <span key={c.label} className={styles.count}>
              <span className={styles.countNum} style={toneVar(c.tone)}>
                {c.n}
              </span>{" "}
              {c.label}
            </span>
          ))}
        </span>
      ) : null}
      {pill || actions ? (
        <div className={styles.right}>
          {pill ? <span className={styles.pill}>{pill}</span> : null}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function ScoutGhostButton({
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={styles.ghostBtn} {...rest}>
      {children}
    </button>
  );
}

export function ScoutIconButton({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <button className={styles.iconBtn} aria-label={label}>
      {children}
    </button>
  );
}

export function ScoutHeaderDivider() {
  return <span className={styles.vDivider} />;
}

/* ── Inspector ─────────────────────────────────────────────────────── */

export function ScoutInspector({
  type,
  status,
  children,
}: {
  type: string;
  status?: { label: string; tone?: Tone };
  children: ReactNode;
}) {
  return (
    <aside className={styles.inspector}>
      <span className={styles.grip} aria-hidden />
      <div className={styles.inspHead}>
        <span className={styles.type}>
          <span className={styles.typeTick} />
          <span className={styles.typeLabel}>{type}</span>
        </span>
        {status ? (
          <span className={styles.status} style={toneVar(status.tone)}>
            <span className={styles.statusDot} /> {status.label}
          </span>
        ) : null}
      </div>
      <div className={styles.inspBody}>{children}</div>
    </aside>
  );
}

export function ScoutInspectorCard({ children }: { children: ReactNode }) {
  return <div className={styles.card}>{children}</div>;
}

export function ScoutInspectorTop({
  avatar,
  name,
  sub,
}: {
  avatar: ReactNode;
  name: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className={styles.cardTop}>
      <span className={styles.avatar}>{avatar}</span>
      <div className={styles.ident}>
        <div className={styles.name}>{name}</div>
        {sub ? <div className={styles.sub}>{sub}</div> : null}
      </div>
    </div>
  );
}

export function ScoutGroup({
  label,
  action,
  children,
}: {
  label: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.group}>
      <div className={styles.groupLabel}>
        {label}
        {action ? <span style={{ marginLeft: "auto" }}>{action}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function ScoutKV({
  k,
  v,
  tone,
}: {
  k: ReactNode;
  v: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={styles.kv}>
      <span className={styles.kvKey}>{k}</span>
      <span
        className={styles.kvVal}
        style={tone ? { color: TONE[tone] } : undefined}
      >
        {v}
      </span>
    </div>
  );
}
