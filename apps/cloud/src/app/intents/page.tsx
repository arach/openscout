import { listOpenScoutIntentCaptures } from "@/lib/intent-capture";
import { getFeedbackAdminToken, isFeedbackAdminAuthorized } from "@/lib/feedback-auth";

type IntentsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function readToken(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function relativeTime(value: string): string {
  const ms = Date.now() - Date.parse(value);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const INTENT_LABELS: Record<string, string> = {
  "manage-agents": "Managing agents",
  "pairing": "Scout iOS",
  "multi-agent": "Multi-agent",
  "desktop": "Desktop app",
  "building": "Building on runtime",
  "curious": "Just curious",
};

function intentBadgeColor(intent: string): string {
  switch (intent) {
    case "manage-agents": return "rgba(125, 211, 252, 0.15)";
    case "pairing": return "rgba(167, 139, 250, 0.15)";
    case "multi-agent": return "rgba(134, 239, 172, 0.15)";
    case "desktop": return "rgba(253, 186, 116, 0.15)";
    case "building": return "rgba(252, 165, 165, 0.15)";
    case "curious": return "rgba(148, 163, 184, 0.12)";
    default: return "rgba(148, 163, 184, 0.12)";
  }
}

function intentTextColor(intent: string): string {
  switch (intent) {
    case "manage-agents": return "#7dd3fc";
    case "pairing": return "#a78bfa";
    case "multi-agent": return "#86efac";
    case "desktop": return "#fdba74";
    case "building": return "#fca5a5";
    case "curious": return "#94a3b8";
    default: return "#94a3b8";
  }
}

export default async function IntentsPage({ searchParams }: IntentsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const token = readToken(resolvedSearchParams.token);
  const isAuthorized = isFeedbackAdminAuthorized(token);
  const requiresToken = Boolean(getFeedbackAdminToken());
  const captures = isAuthorized ? await listOpenScoutIntentCaptures() : [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const todayCount = captures.filter((c) => new Date(c.createdAt) >= today).length;
  const weekCount = captures.filter((c) => new Date(c.createdAt) >= weekAgo).length;
  const withIntent = captures.filter((c) => Boolean(c.intent)).length;
  const withInterest = captures.filter((c) => Boolean(c.interest)).length;
  const returningCount = captures.filter((c) => c.submissions > 1).length;

  const intentBreakdown = new Map<string, number>();
  for (const c of captures) {
    const key = c.intent || "unspecified";
    intentBreakdown.set(key, (intentBreakdown.get(key) ?? 0) + 1);
  }

  return (
    <main className="reports-shell">
      <section className="reports-hero">
        <div className="eyebrow">OpenScout Intents</div>
        <h1>Interest captures</h1>
        <p>
          People who clicked &ldquo;Download for macOS&rdquo; on the landing page and
          left their email. Each entry includes what brought them here and what
          they&apos;re most interested in.
        </p>
      </section>

      {!isAuthorized ? (
        <section className="empty-state">
          <h2>Access required</h2>
          <p>
            Append <code>?token=...</code> to this URL with the configured admin token to view
            intent captures.
          </p>
          {!requiresToken ? (
            <p>No admin token is configured, so this should already be accessible. Check deployment env vars.</p>
          ) : null}
        </section>
      ) : (
        <>
          {/* Stats row */}
          <section className="stats-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <article className="stat-card">
              <span className="stat-label">Total</span>
              <strong style={{ fontSize: 32 }}>{captures.length}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Today</span>
              <strong style={{ fontSize: 32 }}>{todayCount}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">This week</span>
              <strong style={{ fontSize: 32 }}>{weekCount}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">With intent</span>
              <strong style={{ fontSize: 32 }}>{withIntent}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">With note</span>
              <strong style={{ fontSize: 32 }}>{withInterest}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Returning</span>
              <strong style={{ fontSize: 32 }}>{returningCount}</strong>
            </article>
          </section>

          {/* Intent breakdown */}
          {intentBreakdown.size > 0 ? (
            <section style={{ marginBottom: 24 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Array.from(intentBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([intent, count]) => (
                    <span
                      key={intent}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        borderRadius: 999,
                        background: intentBadgeColor(intent),
                        color: intentTextColor(intent),
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    >
                      {INTENT_LABELS[intent] ?? intent}
                      <span style={{
                        background: "rgba(255,255,255,0.1)",
                        borderRadius: 999,
                        padding: "1px 7px",
                        fontSize: 11,
                        fontWeight: 600,
                      }}>
                        {count}
                      </span>
                    </span>
                  ))}
              </div>
            </section>
          ) : null}

          {/* Capture list */}
          <section className="report-list">
            {captures.length === 0 ? (
              <div className="empty-state">
                <h2>No intents yet</h2>
                <p>The API is live, but no landing page submissions have landed yet.</p>
              </div>
            ) : (
              captures.map((capture) => (
                <article key={capture.id} className="report-card" style={{ cursor: "default" }}>
                  <div className="report-card-header">
                    <div>
                      <h2 style={{ fontSize: 18 }}>{capture.email}</h2>
                      {capture.interest ? (
                        <p style={{ marginTop: 6, color: "#c8d1dc", fontStyle: "italic" }}>
                          &ldquo;{capture.interest}&rdquo;
                        </p>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {capture.submissions > 1 ? (
                        <span style={{
                          padding: "4px 10px",
                          borderRadius: 999,
                          background: "rgba(253, 186, 116, 0.12)",
                          color: "#fdba74",
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                        }}>
                          {capture.submissions}x
                        </span>
                      ) : null}
                      {capture.intent ? (
                        <span style={{
                          padding: "4px 10px",
                          borderRadius: 999,
                          background: intentBadgeColor(capture.intent),
                          color: intentTextColor(capture.intent),
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                        }}>
                          {INTENT_LABELS[capture.intent] ?? capture.intent}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <dl className="report-meta">
                    <div>
                      <dt>Signed up</dt>
                      <dd>{formatTimestamp(capture.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Last seen</dt>
                      <dd>{relativeTime(capture.updatedAt)}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>{capture.source}</dd>
                    </div>
                  </dl>
                </article>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}
