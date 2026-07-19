import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { getAllDocs } from "@/lib/docs";
import { absoluteSiteUrl, githubRepoUrl } from "@/lib/site-links";
import type { DocMeta } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Documentation — Scout",
  description:
    "Reference material for OpenScout/Ø.1 — the local-first broker protocol for inter-agent messaging.",
  openGraph: {
    title: "Documentation — Scout",
    description:
      "Reference material for OpenScout/Ø.1 — the local-first broker protocol for inter-agent messaging.",
    url: absoluteSiteUrl("/docs"),
    images: [{ url: "/og-docs.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-docs.png"],
  },
};

const DISCOVERY_LINKS = [
  { href: "/.well-known/scout.json", label: "scout.json", body: "Broker manifest" },
  { href: "/.well-known/agent.md", label: "agent.md", body: "Well-known discovery" },
  { href: "/llms.txt", label: "llms.txt", body: "Compact LLM index" },
  { href: "/llms-full.txt", label: "llms-full.txt", body: "Full context bundle" },
  { href: "/nav.json", label: "nav.json", body: "Docs graph" },
  { href: "/agents.md", label: "agents.md", body: "Agent instructions" },
  { href: "/install.md", label: "install.md", body: "Bootstrap checklist" },
] as const;

function DocEntry({
  doc,
  sectionNum,
}: {
  doc: DocMeta;
  sectionNum: string;
}) {
  return (
    <Link href={`/docs/${doc.slug}`} className="docs-index-entry group">
      <div className="rfc-block__num">{sectionNum}</div>
      <h3 className="rfc-block__title transition-colors group-hover:text-[var(--site-accent)]">
        {doc.title}
      </h3>
      <p className="rfc-block__body">{doc.description}</p>
    </Link>
  );
}

function groupDocs(docs: DocMeta[]): Array<[string, DocMeta[]]> {
  const groups = new Map<string, DocMeta[]>();
  for (const doc of docs) {
    const list = groups.get(doc.group) ?? [];
    list.push(doc);
    groups.set(doc.group, list);
  }
  return Array.from(groups.entries());
}

export default function DocsIndex() {
  const sections = groupDocs(getAllDocs());

  return (
    <div className="site-docs min-h-screen bg-[var(--site-page-bg)] text-[var(--site-ink)]">
      <SiteHeader active="docs" />

      <main className="mx-auto max-w-4xl px-6">
        <div className="border-b border-[var(--site-border-soft)] pb-10 pt-16">
          <div className="rfc-section-eyebrow">
            <span className="rfc-section-eyebrow__num">§</span>
            <span>OpenScout · draft-scout-Ø.1</span>
          </div>
          <h1 className="mt-4 font-[family-name:var(--font-spectral)] text-4xl font-semibold tracking-[-0.02em] text-[var(--site-ink)] sm:text-5xl">
            Documentation
          </h1>
          <p className="mt-4 max-w-2xl font-[family-name:var(--font-mono-display)] text-[13.5px] leading-relaxed text-[var(--site-copy)]">
            Reference material for OpenScout/Ø.1 — the local-first broker protocol
            for inter-agent messaging. Covers topology, identity, record types,
            and implementation guidance.
          </p>

          <div className="docs-index-discovery mt-8">
            <div className="rfc-section-eyebrow mb-3">
              <span className="rfc-section-eyebrow__num">§0</span>
              <span>Machine-readable</span>
            </div>
            <ul className="docs-index-discovery__list">
              {DISCOVERY_LINKS.map((item) => (
                <li key={item.href}>
                  <a href={item.href} className="docs-index-discovery__link group">
                    <span className="docs-index-discovery__label">{item.label}</span>
                    <span className="docs-index-discovery__body">{item.body}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="docs-index-sections pb-24 pt-12">
          {sections.map(([group, items], gi) => (
            <section key={group} className="docs-index-section">
              <div className="rfc-section-eyebrow mb-6">
                <span className="rfc-section-eyebrow__num">§{gi + 1}</span>
                <span>{group}</span>
              </div>
              <div className="docs-index-grid">
                {items.map((doc, i) => (
                  <DocEntry key={doc.slug} doc={doc} sectionNum={`§${gi + 1}.${i + 1}`} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer className="status-bar">
        <div className="mx-auto flex max-w-4xl items-center px-6">
          <div className="status-bar__inner overflow-x-auto whitespace-nowrap">
            <span className="status-bar__zone">
              <span className="status-bar__cell">
                <span className="status-dot" aria-hidden />
                <span>scout/Ø ready</span>
              </span>
              <span className="status-bar__sep hidden sm:inline">·</span>
              <span className="status-bar__cell hidden sm:inline-flex">
                <b>v0.2.65</b>
              </span>
              <span className="status-bar__sep hidden md:inline">·</span>
              <span className="status-bar__cell hidden md:inline-flex">apache-2.0</span>
            </span>
            <span className="status-bar__zone status-bar__zone--right">
              <Link href="/" className="status-bar__link">
                <span className="status-bar__sigil">:</span>home
              </Link>
              <a
                href={githubRepoUrl}
                className="status-bar__link"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="status-bar__sigil">:</span>github
              </a>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
