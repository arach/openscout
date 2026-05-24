/**
 * Almanac — study.
 *
 * The broker's overnight summary as a printed morning brief. Three
 * editorial columns (Artifacts Landed · Decisions · Quiet Lanes), a
 * lede in italic, and a small "weather" widget that reads the fleet's
 * current temperature. The point is to NOT be a dashboard — to be a
 * page you'd actually read with coffee.
 *
 * Typography is the whole study. Instrument Serif at scale for the
 * masthead and section titles, Inter Tight for body, mono ONLY for
 * facts (filenames, handles, counts). Hairline rules between columns.
 * No widgets, no charts.
 */

import Link from "next/link";

const BRIEF = {
  date: "2026-05-24",
  filed: "08:24 PT",
  vol: 1,
  no: 53,
  lede: "The fleet shipped a 182-line auth refactor, opened two new branches, and burned 19 minutes of silence between 02:00 and 02:19. Three decisions are still on the operator's desk; Vault is two hours past its last snapshot.",
  weather: {
    label: "Calm with a developing cell over @qb",
    swatch: ["ok", "ok", "warn", "ok", "info", "ok", "neutral", "warn"] as const,
  },
  quote: {
    body: "I don't think anyone is going to read this PR description, but it's still worth writing.",
    by: "@hudson",
    where: "in #scout-engineering, 22:47 last night",
  },
};

interface Artifact {
  what: string;
  diff?: { add: number; del: number };
  by: string;
  ago: string;
}
const ARTIFACTS: Artifact[] = [
  { what: "auth.diff", diff: { add: 182, del: 47 }, by: "@hudson", ago: "01:42" },
  { what: "fleet-report.md", by: "@scout", ago: "02:38" },
  { what: "icon-set.svg", by: "@atlas", ago: "03:11" },
  { what: "fixtures/seed-001.sql", diff: { add: 64, del: 0 }, by: "@cody", ago: "04:05" },
  { what: "merged → main", by: "@hudson", ago: "05:20" },
];

interface Decision {
  body: string;
  by: string;
  ago?: string;
  pending?: boolean;
}
const DECISIONS_LANDED: Decision[] = [
  { body: "Approve flight 0c8f for the runtime upgrade.", by: "@qb", ago: "00:51" },
  { body: "Retry the TTS provider after the third failure.", by: "@vox", ago: "01:14" },
  { body: "Ship PR #214 after the second reviewer signed.", by: "@hudson", ago: "05:19" },
];
const DECISIONS_PENDING: Decision[] = [
  { body: "Choose between drizzle's prepared-statement cache and a hand-rolled one.", by: "@scout → @qb", pending: true },
  { body: "Decide whether @ranger keeps watching channel.shared past 09:00 PT.", by: "@scout → @arach", pending: true },
  { body: "Approve the auth-middleware deletion (legal flagged on 2026-03-21).", by: "@hudson → @arach", pending: true },
];

interface Quiet {
  agent: string;
  silenceFor: string;
  why: string;
  suggested?: string;
}
const QUIET: Quiet[] = [
  { agent: "@vault", silenceFor: "2h 14m", why: "missed its 06:00 snapshot window", suggested: "ping or restart" },
  { agent: "@mira", silenceFor: "8h", why: "offline since OS update; archie node still up", suggested: "reattach" },
  { agent: "@stark", silenceFor: "1d 4h", why: "cloud instance idle-killed", suggested: "warm pool?" },
];

export default function AlmanacPage() {
  return (
    <main className="mx-auto max-w-[940px] px-7 py-10 font-sans text-studio-ink">
      <Masthead />

      <p className="mt-6 max-w-prose font-sans text-[14.5px] italic leading-[1.6] text-studio-ink">
        {BRIEF.lede}
      </p>

      <Weather />

      <div className="mt-10 grid grid-cols-1 gap-x-7 gap-y-10 lg:grid-cols-3 lg:[&>*+*]:border-l lg:[&>*+*]:border-studio-edge lg:[&>*+*]:pl-7">
        <Column title="Artifacts landed" kicker="Five files touched the tree.">
          <ul className="m-0 space-y-3 p-0 font-sans text-[13px] leading-snug text-studio-ink">
            {ARTIFACTS.map((a, i) => (
              <li key={i} className="list-none">
                <div className="font-mono text-[12px] tracking-tight text-studio-ink">
                  {a.what}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-studio-ink-faint">
                  {a.diff ? (
                    <>
                      <span style={{ color: "var(--status-ok-fg)" }}>
                        +{a.diff.add}
                      </span>
                      <span className="px-0.5">/</span>
                      <span style={{ color: "var(--status-error-fg)" }}>
                        −{a.diff.del}
                      </span>
                      <Sep />
                    </>
                  ) : null}
                  <span>{a.by}</span>
                  <Sep />
                  <span>{a.ago}</span>
                </div>
              </li>
            ))}
          </ul>
        </Column>

        <Column title="Decisions" kicker="Three on the desk; three already taken.">
          <SubsectionTitle>Pending</SubsectionTitle>
          <ol className="m-0 list-decimal space-y-2 pl-5 marker:font-mono marker:text-[10px] marker:text-studio-ink-faint">
            {DECISIONS_PENDING.map((d, i) => (
              <li key={i} className="font-sans text-[13px] leading-relaxed text-studio-ink">
                {d.body}
                <span className="ml-1 font-mono text-[10px] text-studio-ink-faint">
                  {d.by}
                </span>
              </li>
            ))}
          </ol>

          <SubsectionTitle className="mt-5">Landed</SubsectionTitle>
          <ul className="m-0 space-y-2 p-0">
            {DECISIONS_LANDED.map((d, i) => (
              <li key={i} className="list-none font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
                <span className="text-studio-ink">{d.body}</span>
                <span className="ml-1 font-mono text-[10px]">
                  {d.by}
                  {d.ago ? (
                    <>
                      <Sep />
                      {d.ago}
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Column>

        <Column title="Quiet lanes" kicker="Three agents are unaccounted for.">
          <ul className="m-0 space-y-3 p-0">
            {QUIET.map((q, i) => (
              <li key={i} className="list-none">
                <div className="flex items-baseline gap-2 font-mono text-[12px]">
                  <span className="text-studio-ink">{q.agent}</span>
                  <span className="text-[10px] text-studio-ink-faint">
                    silent {q.silenceFor}
                  </span>
                </div>
                <div className="mt-0.5 font-sans text-[12.5px] leading-snug text-studio-ink-faint">
                  {q.why}.
                  {q.suggested ? (
                    <span className="ml-1 text-studio-ink">— {q.suggested}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </Column>
      </div>

      <Quote q={BRIEF.quote} />

      <Footer />
    </main>
  );
}

// ── Masthead ─────────────────────────────────────────────────────────
function Masthead() {
  return (
    <header className="border-b border-studio-edge pb-4">
      <div className="flex items-baseline justify-between gap-4 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>· studies · web · almanac</span>
        <span>
          vol. {BRIEF.vol} · no. {BRIEF.no}
        </span>
      </div>
      <div className="mt-1.5 flex items-baseline justify-between gap-4">
        <h1 className="m-0 font-display text-[64px] font-medium leading-none tracking-tight text-studio-ink">
          Almanac
        </h1>
        <div className="text-right font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
          <div>fleet brief</div>
          <div className="mt-0.5 text-studio-ink">
            {BRIEF.date} · {BRIEF.filed}
          </div>
        </div>
      </div>
    </header>
  );
}

// ── Weather ──────────────────────────────────────────────────────────
type SwatchKind = "ok" | "warn" | "error" | "info" | "neutral";
const SWATCH_BG: Record<SwatchKind, string> = {
  ok: "var(--status-ok-fg)",
  warn: "var(--status-warn-fg)",
  error: "var(--status-error-fg)",
  info: "var(--status-info-fg)",
  neutral: "var(--status-neutral-fg)",
};

function Weather() {
  return (
    <div className="mt-5 flex items-baseline gap-3 border-y border-studio-edge py-2.5 font-mono text-[10px] uppercase tracking-eyebrow">
      <span className="text-studio-ink-faint">weather</span>
      <div className="flex items-center gap-px">
        {BRIEF.weather.swatch.map((k, i) => (
          <span
            key={i}
            aria-hidden
            className="inline-block h-3 w-3"
            style={{ background: SWATCH_BG[k as SwatchKind] }}
          />
        ))}
      </div>
      <span className="font-sans text-[11.5px] italic normal-case tracking-normal text-studio-ink-faint">
        {BRIEF.weather.label}
      </span>
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────────
function Column({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="m-0 font-display text-[20px] font-medium tracking-tight text-studio-ink">
        {title}
      </h2>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        {kicker}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function SubsectionTitle({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={`mb-1.5 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint ${className}`}
    >
      · {children}
    </h3>
  );
}

// ── Quote ────────────────────────────────────────────────────────────
function Quote({ q }: { q: typeof BRIEF.quote }) {
  return (
    <figure className="mt-12 border-l-2 border-studio-edge-strong pl-5">
      <blockquote className="m-0 font-display text-[24px] italic leading-[1.4] tracking-tight text-studio-ink">
        “{q.body}”
      </blockquote>
      <figcaption className="mt-2 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        — <span className="text-studio-ink">{q.by}</span>{" "}
        <span className="normal-case tracking-normal">{q.where}</span>
      </figcaption>
    </figure>
  );
}

// ── Footer ───────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="mt-14 border-t border-studio-edge pt-3 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
      <span>filed by </span>
      <Link
        href="/eng"
        className="rounded-[2px] text-studio-ink hover:text-scout-accent"
      >
        @scout
      </Link>
      <Sep />
      <span className="normal-case tracking-normal">
        inquiry:{" "}
        <code className="font-mono text-[10px] text-studio-ink">
          @scout brief --since yesterday
        </code>
      </span>
    </footer>
  );
}

function Sep() {
  return <span aria-hidden className="mx-1.5 text-studio-ink-faint">·</span>;
}
