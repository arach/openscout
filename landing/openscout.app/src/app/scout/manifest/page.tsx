import type { Metadata } from "next";
import Link from "next/link";
import {
  Braces,
  ExternalLink,
  FileJson,
  Network,
  Radio,
  Route,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { SiteThemeToggle } from "@/components/site-theme-toggle";
import manifest from "../../../../public/.well-known/scout.json";

export const metadata: Metadata = {
  title: "Scout Manifest — OpenScout",
  description:
    "A human-readable view of OpenScout's well-known manifest for agents, CLIs, SDKs, and broker integrations.",
  openGraph: {
    title: "Scout Manifest — OpenScout",
    description:
      "A human-readable view of OpenScout's well-known manifest for agents, CLIs, SDKs, and broker integrations.",
    url: "https://openscout.app/scout/manifest",
    images: [{ url: "/og-docs.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-docs.png"],
  },
};

type ManifestRecord = (typeof manifest.records)[number];

const capabilityLabels: Record<string, string> = {
  agent_registration: "Agent registration",
  messages: "Messages",
  invocations: "Invocations",
  flights: "Flights",
  deliveries: "Deliveries",
  bindings: "Bindings",
  questions: "Questions",
  work_items: "Work items",
  mesh_forwarding: "Mesh forwarding",
  sse_events: "SSE events",
};

const transportLabels: Record<string, string> = {
  local_http: "Local HTTP",
  local_sse: "Local SSE",
  mesh_http: "Mesh HTTP",
  mcp: "MCP",
};

function ScoutMark() {
  return (
    <span
      className="flex shrink-0 items-center justify-center text-[var(--site-ink)]"
      style={{ width: 26, height: 26 }}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" width={26} height={26} fill="none" stroke="currentColor">
        <line x1="16" y1="16" x2="16" y2="6" strokeWidth="1" opacity="0.45" />
        <line x1="16" y1="16" x2="6" y2="22" strokeWidth="1" opacity="0.45" />
        <line x1="16" y1="16" x2="26" y2="22" strokeWidth="1" opacity="0.45" />
        <circle cx="16" cy="6" r="2" fill="currentColor" stroke="none" />
        <circle cx="6" cy="22" r="2" fill="currentColor" stroke="none" />
        <circle cx="26" cy="22" r="2" fill="currentColor" stroke="none" />
        <circle cx="16" cy="16" r="3.4" fill="currentColor" stroke="none" />
        <circle cx="16" cy="16" r="3.4" fill="none" stroke="var(--site-page-bg)" strokeWidth="1.2" opacity="0.9" />
        <circle cx="16" cy="16" r="2" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex min-h-8 items-center rounded border border-[var(--site-border-soft)] bg-[var(--site-surface)] px-3 font-[family-name:var(--font-geist-mono)] text-[12px] text-[var(--site-copy)]">
      {children}
    </span>
  );
}

function ActionLink({
  href,
  children,
  primary = false,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      className={
        primary
          ? "inline-flex min-h-10 items-center gap-2 rounded border border-[var(--site-accent-border)] bg-[var(--site-accent)] px-4 font-[family-name:var(--font-geist-mono)] text-[12px] font-semibold text-[var(--site-ink-contrast)] transition hover:bg-[var(--site-ink)]"
          : "inline-flex min-h-10 items-center gap-2 rounded border border-[var(--site-border)] bg-[var(--site-surface)] px-4 font-[family-name:var(--font-geist-mono)] text-[12px] font-semibold text-[var(--site-ink)] transition hover:border-[var(--site-accent-border)] hover:text-[var(--site-accent)]"
      }
    >
      {children}
    </a>
  );
}

function RecordBlock({ record, index }: { record: ManifestRecord; index: number }) {
  return (
    <article className="rfc-block">
      <div className="rfc-block__num">
        <span className="rfc-block__num-mark">§2.{index + 1}</span> · record
      </div>
      <h3 className="rfc-block__title">{record.type}</h3>
      <p className="rfc-block__body">{record.description}</p>
    </article>
  );
}

export default function ScoutManifestPage() {
  const json = JSON.stringify(manifest, null, 2);

  return (
    <div className="min-h-screen bg-[var(--site-page-bg)] text-[var(--site-ink)]">
      <header className="operator-console">
        <div className="operator-row mx-auto flex max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <ScoutMark />
            <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[var(--site-ink)]">
              Scout
            </span>
          </Link>
          <nav className="flex items-center gap-5">
            <Link href="/docs" className="operator-link hidden sm:inline-flex">
              <span className="operator-link__sigil">:</span>docs
            </Link>
            <span className="operator-link text-[var(--site-ink)]">
              <span className="operator-link__sigil">:</span>manifest
            </span>
            <SiteThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="grid gap-10 border-b border-[var(--site-border-soft)] py-14 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
          <div>
            <div className="rfc-section-eyebrow">
              <span className="rfc-section-eyebrow__num">§</span>
              <span>{manifest.kind} · {manifest.status}</span>
            </div>
            <h1 className="mt-4 max-w-4xl font-[family-name:var(--font-spectral)] text-4xl font-semibold leading-[1.03] text-[var(--site-ink)] sm:text-5xl">
              Scout Manifest
            </h1>
            <p className="mt-5 max-w-3xl font-[family-name:var(--font-mono-display)] text-[13.5px] leading-relaxed text-[var(--site-copy)]">
              {manifest.summary}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ActionLink href="/.well-known/scout.json" primary>
                <FileJson size={16} /> Raw JSON
              </ActionLink>
              <ActionLink href="/install.md">
                <Terminal size={16} /> Install guide
              </ActionLink>
              <ActionLink href="https://github.com/arach/openscout">
                <ExternalLink size={16} /> Repository
              </ActionLink>
            </div>
          </div>

          <aside className="border-l border-[var(--site-border-soft)] pl-6">
            <div className="rfc-block border-t-0 pt-0">
              <div className="rfc-block__num">endpoint</div>
              <h2 className="rfc-block__title">/.well-known/scout.json</h2>
              <p className="rfc-block__body">
                {manifest.mediaType} · version {manifest.version}
              </p>
            </div>
          </aside>
        </section>

        <section className="grid gap-10 border-b border-[var(--site-border-soft)] py-12 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div>
            <div className="rfc-section-eyebrow">
              <span className="rfc-section-eyebrow__num">§1</span>
              <span>Broker</span>
            </div>
            <h2 className="mt-4 font-[family-name:var(--font-spectral)] text-3xl font-semibold leading-tight text-[var(--site-ink)]">
              Local-first control plane.
            </h2>
            <p className="rfc-section-lead mt-5">
              {manifest.broker.role}. Default local brokers listen at{" "}
              <code className="font-[family-name:var(--font-geist-mono)] text-[var(--site-accent)]">
                {manifest.broker.defaultLocalUrl}
              </code>
              .
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center gap-2 font-[family-name:var(--font-geist-mono)] text-[11px] font-semibold uppercase text-[var(--site-muted)]">
                <Radio size={14} /> capabilities
              </div>
              <div className="flex flex-wrap gap-2">
                {manifest.broker.capabilities.map((capability) => (
                  <Pill key={capability}>{capabilityLabels[capability] ?? capability}</Pill>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-3 flex items-center gap-2 font-[family-name:var(--font-geist-mono)] text-[11px] font-semibold uppercase text-[var(--site-muted)]">
                <Network size={14} /> transports
              </div>
              <div className="flex flex-wrap gap-2">
                {manifest.broker.transports.map((transport) => (
                  <Pill key={transport}>{transportLabels[transport] ?? transport}</Pill>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-[var(--site-border-soft)] py-12">
          <div className="rfc-section-eyebrow mb-6">
            <span className="rfc-section-eyebrow__num">§2</span>
            <span>Records</span>
          </div>
          <div className="grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-4">
            {manifest.records.map((record, index) => (
              <RecordBlock key={record.type} record={record} index={index} />
            ))}
          </div>
        </section>

        <section className="grid gap-10 border-b border-[var(--site-border-soft)] py-12 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div>
            <div className="rfc-section-eyebrow">
              <span className="rfc-section-eyebrow__num">§3</span>
              <span>Addressing</span>
            </div>
            <h2 className="mt-4 font-[family-name:var(--font-spectral)] text-3xl font-semibold leading-tight text-[var(--site-ink)]">
              Explicit routes, short handles.
            </h2>
            <div className="mt-6 overflow-x-auto rounded border border-[var(--site-border)] bg-[var(--site-panel)] p-4">
              <code className="font-[family-name:var(--font-geist-mono)] text-[12px] text-[var(--site-ink)]">
                {manifest.addressing.canonicalPattern}
              </code>
            </div>
          </div>
          <div className="space-y-4">
            {manifest.addressing.routingRules.map((rule) => (
              <div key={rule} className="flex gap-3 border-t border-[var(--site-border-soft)] pt-4">
                <Route size={16} className="mt-1 shrink-0 text-[var(--site-accent)]" />
                <p className="font-[family-name:var(--font-mono-display)] text-[12.5px] leading-relaxed text-[var(--site-copy)]">
                  {rule}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div>
            <div className="rfc-section-eyebrow">
              <span className="rfc-section-eyebrow__num">§4</span>
              <span>Raw manifest</span>
            </div>
            <div className="mt-6 max-h-[36rem] overflow-auto rounded border border-[var(--site-border)] bg-[var(--site-panel)] p-5">
              <pre className="font-[family-name:var(--font-geist-mono)] text-[11.5px] leading-relaxed text-[var(--site-copy)]">
                {json}
              </pre>
            </div>
          </div>
          <aside className="space-y-6">
            <div className="rfc-block">
              <div className="rfc-block__num">
                <span className="rfc-block__num-mark">§4.1</span> · posture
              </div>
              <h3 className="rfc-block__title">{manifest.posture.maturity}</h3>
              <p className="rfc-block__body">{manifest.posture.license}</p>
            </div>
            <div className="rfc-block">
              <div className="rfc-block__num">
                <span className="rfc-block__num-mark">§4.2</span> · boundaries
              </div>
              <div className="space-y-2">
                {manifest.posture.notReadyFor.map((item) => (
                  <div key={item} className="flex gap-2 font-[family-name:var(--font-mono-display)] text-[12.5px] text-[var(--site-copy)]">
                    <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--site-muted)]" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rfc-block">
              <div className="rfc-block__num">
                <span className="rfc-block__num-mark">§4.3</span> · install
              </div>
              <h3 className="rfc-block__title">{manifest.install.command}</h3>
              <div className="flex flex-wrap gap-2">
                {manifest.install.nextSteps.map((step) => (
                  <Pill key={step}>{step}</Pill>
                ))}
              </div>
            </div>
            <div className="rfc-block">
              <div className="rfc-block__num">
                <span className="rfc-block__num-mark">§4.4</span> · tools
              </div>
              <div className="flex flex-wrap gap-2">
                {manifest.mcp.preferredTools.map((tool) => (
                  <Pill key={tool}>
                    <Braces size={13} className="mr-1.5" />
                    {tool}
                  </Pill>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </main>

      <footer className="status-bar">
        <div className="mx-auto flex max-w-6xl items-center px-6">
          <div className="status-bar__inner overflow-x-auto whitespace-nowrap">
            <span className="status-bar__zone">
              <span className="status-bar__cell">
                <span className="status-dot" aria-hidden />
                <span>scout manifest ready</span>
              </span>
              <span className="status-bar__sep hidden sm:inline">·</span>
              <span className="status-bar__cell hidden sm:inline-flex">
                <b>{manifest.version}</b>
              </span>
              <span className="status-bar__sep hidden md:inline">·</span>
              <span className="status-bar__cell hidden md:inline-flex">{manifest.status}</span>
            </span>
            <span className="status-bar__zone status-bar__zone--right">
              <a href="/.well-known/scout.json" className="status-bar__link">
                <span className="status-bar__sigil">:</span>json
              </a>
              <Link href="/docs" className="status-bar__link">
                <span className="status-bar__sigil">:</span>docs
              </Link>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
