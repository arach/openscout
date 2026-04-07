import Link from "next/link";
import { notFound } from "next/navigation";
import { getOpenScoutReport } from "@/lib/reports";
import { getReportsAdminToken, isReportsAdminAuthorized } from "@/lib/reports-auth";

type ReportDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
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
    dateStyle: "full",
    timeStyle: "medium",
  }).format(parsed);
}

function formatLogLines(lines: string[]): string {
  return lines.join("\n");
}

export default async function ReportDetailPage({ params, searchParams }: ReportDetailPageProps) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const token = readToken(resolvedSearchParams.token);

  if (!isReportsAdminAuthorized(token)) {
    return (
      <main className="reports-shell">
        <section className="empty-state">
          <h1>Access required</h1>
          <p>
            Append <code>?token=...</code> to this report URL with the configured admin token to
            review the submission.
          </p>
          {!getReportsAdminToken() ? (
            <p>No admin token is configured, so this should already be accessible. Check deployment env vars.</p>
          ) : null}
        </section>
      </main>
    );
  }

  const report = await getOpenScoutReport(id);
  if (!report) {
    notFound();
  }

  const backHref = token ? `/reports?token=${encodeURIComponent(token)}` : "/reports";

  return (
    <main className="reports-shell">
      <section className="detail-header">
        <Link href={backHref} className="back-link">Back to reports</Link>
        <div className="eyebrow">Report {report.id.slice(0, 8)}</div>
        <h1>{report.context.userDescription ?? "Untitled report"}</h1>
        <p>{formatTimestamp(report.timestamp)}</p>
      </section>

      <section className="detail-grid">
        <article className="detail-card">
          <h2>Context</h2>
          <dl className="detail-list">
            <div><dt>Source</dt><dd>{report.context.source}</dd></div>
            <div><dt>Connection</dt><dd>{report.context.connectionState ?? "Not reported"}</dd></div>
            <div><dt>Current directory</dt><dd>{report.context.currentDirectory ?? "Not reported"}</dd></div>
            <div><dt>Generated</dt><dd>{report.context.generatedAtLabel ?? report.context.generatedAt ?? "Not reported"}</dd></div>
          </dl>
          {report.context.lastError ? (
            <div className="detail-callout">
              <strong>Last error</strong>
              <p>{report.context.lastError}</p>
            </div>
          ) : null}
        </article>

        <article className="detail-card">
          <h2>System</h2>
          <dl className="detail-list">
            <div><dt>OS</dt><dd>{report.system.os}</dd></div>
            <div><dt>Version</dt><dd>{report.system.osVersion}</dd></div>
            <div><dt>Chip</dt><dd>{report.system.chip}</dd></div>
            <div><dt>Memory</dt><dd>{report.system.memory}</dd></div>
            <div><dt>Locale</dt><dd>{report.system.locale ?? "Not reported"}</dd></div>
          </dl>
        </article>
      </section>

      <section className="detail-card">
        <h2>Applications</h2>
        <div className="apps-grid">
          {Object.entries(report.apps).map(([appName, appInfo]) => (
            <article key={appName} className="app-card">
              <h3>{appName}</h3>
              <dl className="detail-list compact">
                <div><dt>Running</dt><dd>{appInfo.running ? "Yes" : "No"}</dd></div>
                <div><dt>Version</dt><dd>{appInfo.version ?? "Not reported"}</dd></div>
                <div><dt>PID</dt><dd>{appInfo.pid ? String(appInfo.pid) : "Not reported"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      </section>

      {report.context.reportSections?.length ? (
        <section className="detail-card">
          <h2>Support bundle</h2>
          <div className="sections-grid">
            {report.context.reportSections.map((section) => (
              <article key={section.id} className="section-card">
                <h3>{section.title}</h3>
                <dl className="detail-list compact">
                  {section.entries.map((entry) => (
                    <div key={`${section.id}-${entry.label}`}>
                      <dt>{entry.label}</dt>
                      <dd>{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {report.performance ? (
        <section className="detail-card">
          <h2>Performance</h2>
          <dl className="detail-list compact">
            {Object.entries(report.performance).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="detail-card">
        <h2>Captured logs</h2>
        <pre className="log-block">{formatLogLines(report.logs)}</pre>
      </section>
    </main>
  );
}
