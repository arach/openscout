"use client";

/**
 * Design study — intentionally a decision surface, not production UI.
 * Sources: HomeSurface.swift, RootView.swift, AppModel.swift, mobile-push.ts.
 */
import { DeviceShell } from "@/components/DeviceShell";

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";
const ink = "#e7e9ee";
const muted = "#9aa0aa";
const edge = "#282c32";
const paper = "#121417";
const green = "#32d296";

function Phone({ children, label }: { children: React.ReactNode; label: string }) {
  // The frame is the shared studio <DeviceShell> (bezel, island, status bar,
  // home indicator); scale keeps the study's original ~330px footprint.
  return (
    <section aria-label={label}>
      <DeviceShell device="iphone" scale={0.7914} tone="dark" screenProps={{ style: { background: "#090a0c" } }}>
        {children}
      </DeviceShell>
    </section>
  );
}
function Caption({ children }: { children: React.ReactNode }) { return <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".12em", color: muted, textTransform: "uppercase" }}>{children}</div>; }
function Card({ children }: { children: React.ReactNode }) { return <div style={{ border: `1px solid ${edge}`, borderRadius: 12, background: paper, padding: 14 }}>{children}</div>; }
function Action({ children, primary = false }: { children: React.ReactNode; primary?: boolean }) { return <button type="button" style={{ border: `1px solid ${primary ? green : edge}`, borderRadius: 8, background: primary ? green : "transparent", color: primary ? "#06110d" : ink, padding: "10px 12px", fontWeight: 700, fontSize: 12 }}>{children}</button>; }

export default function ScoutIOSNotificationsStudy() {
  return <main style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 28px 72px", color: ink, fontFamily: "Inter, system-ui, sans-serif" }}>
    <Caption>Studies · iOS · concept</Caption>
    <h1 style={{ margin: "8px 0", fontSize: 32, letterSpacing: "-.04em" }}>Home, reduced. Notification, resolved.</h1>
    <p style={{ maxWidth: 720, color: "#c3c8d1", lineHeight: 1.55, fontSize: 15 }}>Home becomes an ambient status surface with one interruption doorway. A push opens a dedicated, locally-resolved notification detail—not the destination—so the operator can understand, mark read, dismiss, or take the relevant action before choosing to navigate.</p>

    <div style={{ display: "flex", flexWrap: "wrap", gap: 44, margin: "32px 0 44px" }}>
      <Phone label="Simplified Home proposal">
        <div style={{ padding: "62px 18px 22px" }}>
          <Caption>Scout · Mac Mini · online</Caption>
          <h2 style={{ margin: "8px 0 2px", fontSize: 24 }}>Good afternoon.</h2>
          <p style={{ margin: 0, color: muted, fontSize: 13 }}>2 agents working · quiet otherwise</p>
          <div style={{ height: 1, background: edge, margin: "22px 0" }} />
          <Card><Caption>Needs you · 1</Caption><div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 9 }}><div><strong style={{ fontSize: 14 }}>Approval requested</strong><div style={{ color: muted, fontSize: 12, marginTop: 3 }}>Release notes · 2m ago</div></div><span style={{ color: green }}>›</span></div></Card>
          <div style={{ marginTop: 22 }}><Caption>Now</Caption><div style={{ marginTop: 10, display: "grid", gap: 12 }}><div><strong style={{ fontSize: 14 }}>Locke</strong><span style={{ color: muted, fontSize: 12 }}> · refining iOS notification flow</span></div><div><strong style={{ fontSize: 14 }}>Huxley</strong><span style={{ color: muted, fontSize: 12 }}> · waiting for review</span></div></div></div>
          <div style={{ marginTop: 24, borderTop: `1px solid ${edge}`, paddingTop: 14, color: muted, fontSize: 12 }}>View activity in Ops <span style={{ color: green }}>→</span></div>
        </div>
      </Phone>
      <Phone label="Dedicated notification detail proposal">
        <div style={{ padding: "62px 18px 18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ color: muted }}>‹ Back</span><Caption>Notification</Caption><span style={{ color: muted }}>···</span></div>
          <div style={{ marginTop: 36 }}><Caption>Approval · unread · 2m ago</Caption><h2 style={{ fontSize: 25, lineHeight: 1.08, margin: "12px 0" }}>Approve release-note publish?</h2><p style={{ color: "#c3c8d1", lineHeight: 1.5, fontSize: 14 }}>Locke is waiting to publish the prepared release notes for OpenScout.</p></div>
          <Card><Caption>From</Caption><div style={{ marginTop: 8, fontSize: 13 }}>Locke · Claude · openscout</div><div style={{ marginTop: 6, fontFamily: mono, color: muted, fontSize: 11 }}>item_…8c1 · Mac Mini</div></Card>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 20 }}><Action>Dismiss</Action><Action primary>Approve</Action></div>
          <button type="button" style={{ marginTop: 16, color: green, background: "none", border: 0, padding: 0, fontSize: 13 }}>Open related conversation →</button>
          <p style={{ marginTop: 28, color: muted, fontSize: 11, lineHeight: 1.45 }}>Mark read is a quiet top-right menu action. Completing an approval or answer marks read only after broker acknowledgement.</p>
        </div>
      </Phone>
    </div>

    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
      <Card><Caption>Information architecture</Caption><h2 style={{ fontSize: 17 }}>One attention gateway</h2><p style={{ color: muted, fontSize: 13, lineHeight: 1.5 }}>Home: connection identity, a conditional <b style={{ color: ink }}>Needs you</b> count/row, and a compact Now list. Remove Home’s duplicate activity, terminal, tail and inline composer modules; those remain reachable in Ops, Comms, Terminal and New. Tapping an attention row opens Notification Detail. Home never becomes an inbox.</p></Card>
      <Card><Caption>Navigation & state</Caption><h2 style={{ fontSize: 17 }}>Notification Detail is a push, not a detour</h2><p style={{ color: muted, fontSize: 13, lineHeight: 1.5 }}>APNs tap → AppModel stores an opaque route → RootView presents/pushes Notification Detail over the current shell. Detail resolves against the paired broker, then is <b style={{ color: ink }}>loading | resolved unread | resolved read | action-pending | action-confirmed | stale | offline</b>. Dismiss closes to the prior surface; “Open related conversation” is explicit. Do not auto-switch to Comms for a conversation ID.</p></Card>
      <Card><Caption>Interaction rules</Caption><h2 style={{ fontSize: 17 }}>Read and dismiss are different</h2><p style={{ color: muted, fontSize: 13, lineHeight: 1.5 }}>Mark read is reversible local presentation state synchronized to the broker when possible. Dismiss removes the item from the iOS attention queue only; it must not deny, cancel, or mutate the underlying work. Decision/answer actions retain their existing confirmation semantics and only clear after acknowledgement. Retry is available for failed actions.</p></Card>
    </section>

    <section style={{ marginTop: 28 }}><Caption>Contracts, resilience & accessibility</Caption><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16, marginTop: 12 }}>
      <Card><h2 style={{ fontSize: 16 }}>Payload and read model</h2><p style={{ color: muted, fontSize: 13, lineHeight: 1.5 }}>APNs remains generic: <code>destination: inbox</code>, <code>kind</code>, opaque <code>itemId</code> plus correlation IDs only—never alert detail. Add a broker notification read model keyed by immutable item ID with title, summary, kind, source/session, related conversation, unread/dismissed state, action affordances, version and expiry. Dedupe on item ID; a newer payload refreshes the existing detail.</p></Card>
      <Card><h2 style={{ fontSize: 16 }}>Empty, stale, offline</h2><p style={{ color: muted, fontSize: 13, lineHeight: 1.5 }}>No attention: Home omits the gateway. Loading uses semantic skeleton text, not a silent blank. A missing/expired item says “This item is no longer active” with Dismiss and Home. Offline preserves the generic alert context, disables broker actions, labels them “Reconnect to act,” and offers retry; it must never fabricate an action result.</p></Card>
      <Card><h2 style={{ fontSize: 16 }}>Accessible by default</h2><p style={{ color: muted, fontSize: 13, lineHeight: 1.5 }}>Use Dynamic Type with multiline titles, minimum 44pt targets, semantic labels (“Unread approval from Locke”), announced loading/action/result states, and non-color kind/read indicators. Respect Reduce Motion. VoiceOver order is title → urgency/time → summary → provenance → primary actions → related destination. Destructive-looking Dismiss needs a clear spoken explanation.</p></Card>
    </div></section>

    <section style={{ marginTop: 28 }}><Caption>Implementation handoff</Caption><div style={{ display: "grid", gap: 10, marginTop: 12 }}>
      <Card><b>Likely iOS seams:</b> <code>apps/ios/Scout/HomeSurface.swift</code> (reduce to gateway + Now), <code>RootView.swift</code> (replace duplicate sheet and auto-Comms branch with a navigation-owned detail route), <code>AppModel.swift</code> (opaque route, pending/read/dismiss lifecycle), existing <code>NotificationLandingSheet</code> (rename/extract to NotificationDetail), <code>ScoutBrokerClient</code>/<code>MobileNotificationCapability</code> (read + acknowledgement methods).</Card>
      <Card><b>Shared seams:</b> <code>packages/runtime/src/mobile-push.ts</code> and push relay preserve opaque APNs IDs; add/extend the broker-owned notification read/dismiss acknowledgement contract in <code>packages/protocol</code> and runtime, rather than putting state in device-only storage. Ensure broker remains canonical writer.</Card>
      <Card><b>Acceptance criteria:</b> a push always opens the detail before any destination; Home shows at most one compact attention gateway and no duplicate feeds; read/dismiss survive reload and do not mutate work; expired/offline/action-failed paths explain next action; all actions are reachable with VoiceOver and Dynamic Type; APNs remains generic/opaque.</Card>
      <Card><b>Incremental delivery:</b> (1) route/detail shell backed by existing mobile notification fetch; (2) read and local dismiss presentation with contract/tests; (3) broker canonical dismiss/read state + cross-device sync; (4) simplify Home and add capture/accessibility coverage; (5) add action acknowledgement/error retries and instrumentation.</Card>
    </div></section>
  </main>;
}
