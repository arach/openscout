"use client";

import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import styles from "./tail-header.module.css";

/**
 * Tail — header treatments.
 *
 * Four directions for the Tail header bar, same content, so we can pick before
 * porting to `ScoutTailView`. Each carries the same payload — identity (ECG +
 * Tail), inventory (logs/procs/sessions), search, source filter, the
 * Ledger/Timeline toggle, and Follow/Pause — arranged differently, with relief
 * + a whisper of color. Rendered through the real `--s-*` skins (dark = the app).
 */

export default function TailHeaderStudy() {
  return (
    <ScoutStudyShell
      pageId="tail-header"
      title="Tail — header treatments"
      blurb={
        <>
          Four header bars for the firehose, same payload, different structure +
          relief. <b>Instrument</b> boxes the vitals as a gauge cluster;{" "}
          <b>Editorial</b> splits identity from controls across two tiers;{" "}
          <b>Command</b> makes search the hero; <b>Console</b> packs it dense on
          one line. Pick one and I port it to the app.
        </>
      }
    >
      <div className={styles.stack}>
        <Bar n="01" name="Instrument" desc="Vitals as a recessed gauge cluster (figures + hairline rules); controls grouped right. Cockpit relief, one tier.">
          <InstrumentHeader />
        </Bar>
        <Bar n="02" name="Editorial · two-tier" desc="Identity + a stat strip on top; search · source · toggle · state on the control row below. Most breathing room + hierarchy.">
          <EditorialHeader />
        </Bar>
        <Bar n="03" name="Command bar" desc="Search is the hero (wide, centered); identity small left, vitals as a quiet sub-line, controls right. Browser / command-palette energy.">
          <CommandHeader />
        </Bar>
        <Bar n="04" name="Console · dense" desc="Everything on one tight line — compressed counts, inline search + source, a segmented toggle. Maximum stream below the fold.">
          <ConsoleHeader />
        </Bar>
      </div>
    </ScoutStudyShell>
  );
}

function Bar({ n, name, desc, children }: { n: string; name: string; desc: string; children: React.ReactNode }) {
  return (
    <section className={styles.variant}>
      <div className={styles.vLabel}>
        <span className={styles.vNum}>TREATMENT {n}</span>
        <span className={styles.vName}>{name}</span>
        <span className={styles.vDesc}>{desc}</span>
      </div>
      <div className={styles.frame}>
        {children}
        {/* a couple of ghost stream rows for context */}
        <div className={styles.ghost}>
          <Row t="20:14:08" who="@scout" act="Edit broker/service.ts" />
          <Row t="20:14:08" who="openscout" act="→ 12 lines" dim />
          <Row t="20:14:11" who="@hudson" act="Grep data-scout-skin" />
        </div>
      </div>
    </section>
  );
}

function Row({ t, who, act, dim }: { t: string; who: string; act: string; dim?: boolean }) {
  return (
    <div className={styles.row}>
      <span className={styles.rTime}>{t}</span>
      <span className={styles.rDot} />
      <span className={`${styles.rWho} ${who.startsWith("@") ? styles.rAgent : styles.rProj}`}>{who}</span>
      <span className={`${styles.rAct} ${dim ? styles.rDim : ""}`}>{act}</span>
    </div>
  );
}

/* ── 01 · Instrument ───────────────────────────────────────────────── */
function InstrumentHeader() {
  return (
    <header className={`${styles.bar} ${styles.instrument}`}>
      <span className={styles.identity}>
        <Ecg />
        <span className={styles.title}>Tail</span>
      </span>
      <span className={styles.gauges}>
        <Gauge n="25" l="logs" />
        <span className={styles.rule} />
        <Gauge n="43" l="procs" />
        <span className={styles.rule} />
        <Gauge n="3" l="sessions" />
      </span>
      <span className={styles.search}><Search /> Search</span>
      <span className={styles.source}><Tag /> All sources <Caret /></span>
      <span className={styles.spring} />
      <Toggle />
      <span className={styles.vrule} />
      <Pause />
      <IconBtn><Refresh /></IconBtn>
    </header>
  );
}

/* ── 02 · Editorial (two-tier) ─────────────────────────────────────── */
function EditorialHeader() {
  return (
    <div className={styles.twoTier}>
      <header className={`${styles.bar} ${styles.editorialTop}`}>
        <span className={styles.identity}>
          <Ecg big />
          <span className={styles.titleBig}>Tail</span>
        </span>
        <span className={styles.spring} />
        <span className={styles.statStrip}>
          <Stat n="25" l="logs" />
          <Stat n="43" l="procs" />
          <Stat n="3" l="sessions" />
        </span>
      </header>
      <header className={`${styles.bar} ${styles.editorialBottom}`}>
        <span className={styles.search}><Search /> Search the stream</span>
        <span className={styles.source}><Tag /> All sources <Caret /></span>
        <span className={styles.spring} />
        <Toggle />
        <Pause />
      </header>
    </div>
  );
}

/* ── 03 · Command bar ──────────────────────────────────────────────── */
function CommandHeader() {
  return (
    <div className={styles.twoTier}>
      <header className={`${styles.bar} ${styles.commandTop}`}>
        <span className={styles.identity}>
          <Ecg />
          <span className={styles.title}>Tail</span>
        </span>
        <span className={styles.cmdSearch}><Search /> Search the firehose…</span>
        <Toggle />
        <Pause />
      </header>
      <header className={`${styles.bar} ${styles.commandBottom}`}>
        <span className={styles.subline}>
          <b>25</b> logs <span className={styles.mid}>·</span> <b>43</b> procs <span className={styles.mid}>·</span> <b>3</b> sessions
          <span className={styles.mid}>·</span> <Tag /> All sources <Caret />
        </span>
      </header>
    </div>
  );
}

/* ── 04 · Console (dense) ──────────────────────────────────────────── */
function ConsoleHeader() {
  return (
    <header className={`${styles.bar} ${styles.console}`}>
      <span className={styles.identity}>
        <Ecg />
        <span className={styles.title}>Tail</span>
      </span>
      <span className={styles.compact}><b>25</b>·<b>43</b>·<b>3</b></span>
      <span className={styles.searchSm}><Search /> Search</span>
      <span className={styles.sourceSm}><Tag /> all <Caret /></span>
      <span className={styles.spring} />
      <Toggle />
      <Pause sm />
      <IconBtn><Refresh /></IconBtn>
    </header>
  );
}

/* ── shared bits ───────────────────────────────────────────────────── */
function Gauge({ n, l }: { n: string; l: string }) {
  return (
    <span className={styles.gauge}>
      <span className={styles.gNum}>{n}</span>
      <span className={styles.gLabel}>{l}</span>
    </span>
  );
}
function Stat({ n, l }: { n: string; l: string }) {
  return (
    <span className={styles.stat}>
      <span className={styles.statNum}>{n}</span>
      <span className={styles.statLabel}>{l}</span>
    </span>
  );
}
function Toggle() {
  return (
    <span className={styles.toggle}>
      <span className={`${styles.seg} ${styles.segOn}`}>Ledger</span>
      <span className={styles.seg}>Timeline</span>
    </span>
  );
}
function Pause({ sm }: { sm?: boolean }) {
  return (
    <span className={`${styles.pause} ${sm ? styles.pauseSm : ""}`}>
      <PauseGlyph /> {sm ? null : "Pause"}
    </span>
  );
}
function IconBtn({ children }: { children: React.ReactNode }) {
  return <span className={styles.iconBtn}>{children}</span>;
}

function Ecg({ big }: { big?: boolean }) {
  const s = big ? 22 : 18;
  return (
    <svg className={styles.ecg} width={s} height={Math.round(s * 0.72)} viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 7h4.2l2-4.5 3 9 2.4-6 1.6 3H21" />
    </svg>
  );
}
function Search() {
  return <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}
function Tag() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 7v5l9 9 5-5-9-9H3z" /><circle cx="7" cy="11" r="1.2" fill="currentColor" stroke="none" /></svg>;
}
function PauseGlyph() {
  return <svg width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></svg>;
}
function Refresh() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>;
}
function Caret() {
  return <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ marginLeft: 1, opacity: 0.7 }}><path d="M4 6l4 4 4-4" /></svg>;
}
