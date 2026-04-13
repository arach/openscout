export default function HomePage() {
  return (
    <main style={{ minHeight: "100vh", padding: "48px 24px" }}>
      <div
        style={{
          maxWidth: 760,
          margin: "0 auto",
          border: "1px solid #1c2430",
          borderRadius: 24,
          padding: 32,
          background: "#0c1016",
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#7b8aa0" }}>
          OpenScout
        </div>
        <h1 style={{ margin: "12px 0 8px", fontSize: 36, lineHeight: 1.1 }}>API Surface</h1>
        <p style={{ margin: 0, color: "#a7b2c2", lineHeight: 1.7 }}>
          This deployment accepts landing-page intent captures, Scout app feedback submissions,
          and exposes a small feedback review surface.
        </p>

        <div style={{ marginTop: 28, display: "grid", gap: 12 }}>
          <EndpointCard
            method="POST"
            path="/api/intent"
            description="Public landing-page intent capture endpoint for OpenScout interest and email collection."
          />
          <EndpointCard
            method="POST"
            path="/api/feedback"
            description="Public feedback submission endpoint for Scout desktop builds."
          />
          <EndpointCard
            method="GET"
            path="/feedback?token=..."
            description="Token-gated feedback inbox and detail viewer."
          />
        </div>
        <p style={{ margin: "16px 0 0", color: "#7b8aa0", lineHeight: 1.6, fontSize: 14 }}>
          Legacy <code>/api/report</code> and <code>/reports</code> paths still resolve for older Scout builds.
        </p>
      </div>
    </main>
  );
}

function EndpointCard({
  method,
  path,
  description,
}: {
  method: string;
  path: string;
  description: string;
}) {
  return (
    <div
      style={{
        border: "1px solid #1c2430",
        borderRadius: 18,
        padding: 16,
        background: "#090c11",
      }}
    >
      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 14 }}>
        <span style={{ color: "#7dd3fc", marginRight: 10 }}>{method}</span>
        <span>{path}</span>
      </div>
      <p style={{ margin: "8px 0 0", color: "#91a0b4", lineHeight: 1.6 }}>{description}</p>
    </div>
  );
}
