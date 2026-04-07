import Link from "next/link";
import { listOpenScoutReports } from "@/lib/reports";
import { getReportsAdminToken, isReportsAdminAuthorized } from "@/lib/reports-auth";

type ReportsPageProps = {
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

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const token = readToken(resolvedSearchParams.token);
  const isAuthorized = isReportsAdminAuthorized(token);
  const requiresToken = Boolean(getReportsAdminToken());
  const reports = isAuthorized ? await listOpenScoutReports() : [];
  const reportCount = reports.length;
  const errorCount = reports.filter((report) => Boolean(report.contextInfo.lastError)).length;

  return (
    <main className="reports-shell">
      <section className="reports-hero">
        <div className="eyebrow">OpenScout Reports</div>
        <h1>Desktop feedback inbox</h1>
        <p>
          Review direct submissions from packaged Scout builds. Each report contains the user note,
          environment details, and the structured support bundle captured at submit time.
        </p>
      </section>

      {!isAuthorized ? (
        <section className="empty-state">
          <h2>Access required</h2>
          <p>
            Append <code>?token=...</code> to this URL with the configured admin token to review
            reports.
          </p>
          {!requiresToken ? (
            <p>No admin token is configured, so this should already be accessible. Check deployment env vars.</p>
          ) : null}
        </section>
      ) : (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <span className="stat-label">Reports</span>
              <strong>{reportCount}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">With errors</span>
              <strong>{errorCount}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Latest</span>
              <strong>{reports[0] ? formatTimestamp(reports[0].createdAt) : "None yet"}</strong>
            </article>
          </section>

          <section className="report-list">
            {reports.length === 0 ? (
              <div className="empty-state">
                <h2>No reports yet</h2>
                <p>The API is live, but no desktop submissions have landed yet.</p>
              </div>
            ) : (
              reports.map((report) => {
                const href = token
                  ? `/reports/${report.id}?token=${encodeURIComponent(token)}`
                  : `/reports/${report.id}`;
                return (
                  <Link key={report.id} href={href} className="report-card">
                    <div className="report-card-header">
                      <div>
                        <h2>{report.userDescription ?? "Untitled report"}</h2>
                        <p>{report.source}</p>
                      </div>
                      <span className="report-key">{report.id.slice(0, 8)}</span>
                    </div>
                    <dl className="report-meta">
                      <div>
                        <dt>Created</dt>
                        <dd>{formatTimestamp(report.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>System</dt>
                        <dd>{report.systemInfo.os} {report.systemInfo.osVersion}</dd>
                      </div>
                      <div>
                        <dt>Chip</dt>
                        <dd>{report.systemInfo.chip}</dd>
                      </div>
                      <div>
                        <dt>State</dt>
                        <dd>{report.contextInfo.connectionState ?? "Not reported"}</dd>
                      </div>
                    </dl>
                    {report.contextInfo.lastError ? (
                      <p className="report-error">{report.contextInfo.lastError}</p>
                    ) : null}
                  </Link>
                );
              })
            )}
          </section>
        </>
      )}
    </main>
  );
}
