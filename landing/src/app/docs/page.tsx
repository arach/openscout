import type { Metadata } from "next";
import Link from "next/link";
import { SiteThemeToggle } from "@/components/site-theme-toggle";
import { getAllDocs } from "@/lib/docs";
import type { DocMeta } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Documentation — Scout",
  description:
    "Reference material for OpenScout/Ø.1 — the local-first broker protocol for inter-agent messaging.",
  openGraph: {
    title: "Documentation — Scout",
    description:
      "Reference material for OpenScout/Ø.1 — the local-first broker protocol for inter-agent messaging.",
    url: "https://openscout.app/docs",
    images: [{ url: "/og-docs.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-docs.png"],
  },
};

function DocEntry({
  doc,
  sectionNum,
}: {
  doc: DocMeta;
  sectionNum: string;
}) {
  return (
    <Link href={`/docs/${doc.slug}`} className="rfc-block group block">
      <div className="rfc-block__num">{sectionNum}</div>
      <h3 className="rfc-block__title transition-colors group-hover:text-[var(--site-accent)]">
        {doc.title}
      </h3>
      <p className="rfc-block__body">{doc.description}</p>
    </Link>
  );
}

export default function DocsIndex() {
  const docs = getAllDocs();
  const coreDocs = docs.filter((d) => d.group === "Core Concepts");
  const annexDocs = docs.filter((d) => d.group === "OpenAgents Tracks");
  const otherGroups = new Map<string, DocMeta[]>();
  for (const doc of docs) {
    if (doc.group === "Core Concepts" || doc.group === "OpenAgents Tracks") continue;
    const list = otherGroups.get(doc.group) ?? [];
    list.push(doc);
    otherGroups.set(doc.group, list);
  }

  return (
    <div className="site-docs min-h-screen bg-[var(--site-page-bg)] text-[var(--site-ink)]">
      <header className="operator-console">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 operator-row">
          <Link href="/" className="flex items-center gap-2.5">
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
            <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[var(--site-ink)]">
              Scout
            </span>
          </Link>
          <nav className="flex items-center gap-5">
            <Link href="/privacy" className="operator-link hidden sm:inline-flex">
              <span className="operator-link__sigil">:</span>privacy
            </Link>
            <span className="operator-link text-[var(--site-ink)]">
              <span className="operator-link__sigil">:</span>docs
            </span>
            <SiteThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6">
        {/* RFC front matter */}
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
          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { href: "/llms.txt", label: "llms.txt", body: "Compact LLM index" },
              { href: "/llms-full.txt", label: "llms-full.txt", body: "Full context bundle" },
              { href: "/agents.md", label: "agents.md", body: "Agent instructions" },
              { href: "/install.md", label: "install.md", body: "Bootstrap checklist" },
            ].map((item) => (
              <a key={item.href} href={item.href} className="rfc-block group block border-t-0 pt-0">
                <h2 className="rfc-block__title text-[15px] transition-colors group-hover:text-[var(--site-accent)]">
                  {item.label}
                </h2>
                <p className="rfc-block__body text-[12.5px]">{item.body}</p>
              </a>
            ))}
          </div>
        </div>

        {/* §1 + §A side by side */}
        <div className="grid gap-x-16 gap-y-14 pb-24 pt-10 lg:grid-cols-2">
          {/* §1 Core Concepts */}
          {coreDocs.length > 0 && (
            <section>
              <div className="rfc-section-eyebrow mb-5">
                <span className="rfc-section-eyebrow__num">§1</span>
                <span>Core Concepts</span>
              </div>
              {coreDocs.map((doc, i) => (
                <DocEntry key={doc.slug} doc={doc} sectionNum={`§1.${i + 1}`} />
              ))}
            </section>
          )}

          {/* §A Annexes */}
          {annexDocs.length > 0 && (
            <section>
              <div className="rfc-section-eyebrow mb-5">
                <span className="rfc-section-eyebrow__num">§A</span>
                <span>Annexes</span>
              </div>
              {annexDocs.map((doc, i) => (
                <DocEntry key={doc.slug} doc={doc} sectionNum={`§A.${i + 1}`} />
              ))}
            </section>
          )}

          {/* Any additional groups span full width */}
          {Array.from(otherGroups).map(([group, items], gi) => (
            <section key={group} className="lg:col-span-2">
              <div className="rfc-section-eyebrow mb-5">
                <span className="rfc-section-eyebrow__num">§{gi + 2}</span>
                <span>{group}</span>
              </div>
              <div className="grid gap-x-16 lg:grid-cols-2">
                {items.map((doc, i) => (
                  <DocEntry key={doc.slug} doc={doc} sectionNum={`§${gi + 2}.${i + 1}`} />
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
              <span className="status-bar__cell hidden md:inline-flex">license pending</span>
            </span>
            <span className="status-bar__zone status-bar__zone--right">
              <Link href="/" className="status-bar__link">
                <span className="status-bar__sigil">:</span>home
              </Link>
              <a
                href="https://github.com/arach/openscout"
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
