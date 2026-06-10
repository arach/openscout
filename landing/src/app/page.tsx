import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Boxes,
  Github,
  LogIn,
  Network,
  Package,
  RadioTower,
  Terminal,
} from "lucide-react";
import {
  githubNativeAuthStartUrl,
  githubReleasesUrl,
  githubRepoUrl,
  npmPackageUrl,
  siteBaseUrl,
} from "@/lib/site-links";

export const metadata: Metadata = {
  title: "OpenScout",
  description:
    "OpenScout is a local-first control plane for coordinating AI agents across local machines, harnesses, and surfaces.",
  alternates: {
    canonical: siteBaseUrl,
  },
  openGraph: {
    title: "OpenScout",
    description:
      "A local-first control plane for AI agents: broker, runtime, protocol, Mac, iOS, and web surfaces.",
    url: siteBaseUrl,
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "OpenScout",
      },
    ],
  },
};

const primaryLinks = [
  {
    label: "Connect",
    href: githubNativeAuthStartUrl,
    icon: LogIn,
    external: true,
  },
  {
    label: "Read the docs",
    href: "/docs",
    icon: BookOpen,
  },
  {
    label: "Quickstart",
    href: "/docs/quickstart",
    icon: Terminal,
  },
  {
    label: "GitHub",
    href: githubRepoUrl,
    icon: Github,
    external: true,
  },
] as const;

const resourceLinks = [
  {
    label: "Remote device access",
    description: "Sign in through the Cloudflare front door and return to your Scout app.",
    href: githubNativeAuthStartUrl,
    external: true,
  },
  {
    label: "Install guide",
    description: "Bootstrap expectations and the first healthy local run.",
    href: "/docs/quickstart",
  },
  {
    label: "Current posture",
    description: "Scope, maturity, trust model, and what OpenScout is not yet.",
    href: "/docs/current-posture",
  },
  {
    label: "Architecture",
    description: "Broker, runtime, protocol, records, and local-first state.",
    href: "/docs/architecture",
  },
  {
    label: "Agent manifest",
    description: "Machine-readable public context for agents and clients.",
    href: "/scout/manifest",
  },
  {
    label: "npm package",
    description: "The public CLI package: @openscout/scout.",
    href: npmPackageUrl,
    external: true,
  },
  {
    label: "Releases",
    description: "Mac builds and tagged project releases on GitHub.",
    href: githubReleasesUrl,
    external: true,
  },
] as const;

const signals = [
  {
    label: "Broker",
    value: "durable local records",
    icon: RadioTower,
  },
  {
    label: "Mesh",
    value: "trusted machine reachability",
    icon: Network,
  },
  {
    label: "Surfaces",
    value: "CLI, web, Mac, iOS",
    icon: Boxes,
  },
] as const;

function isExternalHref(href: string) {
  return href.startsWith("http://") || href.startsWith("https://");
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[var(--site-page-bg)] text-[var(--site-ink)]">
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-black/45 text-white backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3" aria-label="OpenScout home">
            <img
              src="/openscout-icon.png"
              alt=""
              className="h-7 w-7 rounded-[6px]"
            />
            <span className="font-sans text-sm font-semibold tracking-[0.02em]">
              OpenScout
            </span>
          </Link>
          <nav className="flex items-center gap-1.5" aria-label="Primary">
            {primaryLinks.map((link) => {
              const Icon = link.icon;
              const className =
                "inline-flex h-9 items-center gap-1.5 rounded-[6px] px-3 font-sans text-[13px] font-medium text-white/78 transition hover:bg-white/10 hover:text-white";
              const content = (
                <>
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  <span className="hidden sm:inline">{link.label}</span>
                </>
              );
              if (isExternalHref(link.href)) {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className={className}
                  >
                    {content}
                  </a>
                );
              }
              return (
                <Link key={link.href} href={link.href} className={className}>
                  {content}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <section className="relative isolate flex min-h-[86svh] items-end overflow-hidden bg-black pt-28 text-white">
        <img
          src="/relay/home-command-center.png"
          alt="OpenScout web dashboard showing active agents, work in flight, and fleet activity."
          className="absolute inset-0 -z-20 h-full w-full object-cover object-[52%_32%] opacity-82"
        />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(0,0,0,0.88)_0%,rgba(0,0,0,0.68)_38%,rgba(0,0,0,0.22)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t from-black via-black/65 to-transparent" />

        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 pb-12 md:grid-cols-[minmax(0,0.82fr)_minmax(280px,0.42fr)] md:items-end">
          <div className="max-w-3xl">
            <p className="mb-5 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-white/58">
              Local-first agent control plane
            </p>
            <h1 className="max-w-[11ch] font-sans text-[clamp(4.2rem,12vw,8.5rem)] font-black leading-[0.84] tracking-normal">
              OpenScout
            </h1>
            <p className="mt-7 max-w-2xl font-sans text-[clamp(1.05rem,2vw,1.5rem)] leading-[1.35] text-white/82">
              A broker, runtime, and set of surfaces for coordinating AI agents
              across your local machines, with OpenScout Network login for remote
              device access when you need it.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href={githubNativeAuthStartUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-[6px] bg-white px-4 font-sans text-sm font-semibold text-black transition hover:bg-white/88"
              >
                <LogIn className="h-4 w-4" aria-hidden />
                Connect remote device
              </a>
              <Link
                href="/docs/quickstart"
                className="inline-flex h-11 items-center gap-2 rounded-[6px] border border-white/22 bg-white/8 px-4 font-sans text-sm font-semibold text-white transition hover:bg-white/14"
              >
                <Terminal className="h-4 w-4" aria-hidden />
                Quickstart
              </Link>
              <a
                href={githubRepoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center gap-2 rounded-[6px] border border-white/22 bg-white/8 px-4 font-sans text-sm font-semibold text-white transition hover:bg-white/14"
              >
                <Github className="h-4 w-4" aria-hidden />
                GitHub
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          </div>

          <div className="grid gap-2 border-y border-white/14 py-3 md:border-y-0 md:border-l md:py-0 md:pl-5">
            {signals.map((signal) => {
              const Icon = signal.icon;
              return (
                <div
                  key={signal.label}
                  className="grid grid-cols-[24px_88px_1fr] items-center gap-3 py-2"
                >
                  <Icon className="h-4 w-4 text-white/54" aria-hidden />
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/42">
                    {signal.label}
                  </span>
                  <span className="font-sans text-sm text-white/76">
                    {signal.value}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-[var(--site-border)] bg-[var(--site-page-bg)]">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 md:grid-cols-[0.58fr_1fr] md:py-14">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--site-muted)]">
              Start here
            </p>
            <h2 className="mt-3 max-w-md font-sans text-3xl font-bold leading-tight tracking-normal text-[var(--site-ink)]">
              Small surface, durable routes.
            </h2>
            <p className="mt-4 max-w-lg font-sans text-base leading-7 text-[var(--site-copy)]">
              OpenScout is currently built for high-trust local developer pilots:
              agents you run, machines you trust, and broker-owned coordination
              records you can inspect. OpenScout Network login starts at the
              Cloudflare mesh front door, then hands the session back to your
              Scout app.
            </p>
            <pre className="mt-6 overflow-x-auto rounded-[6px] border border-[var(--site-border)] bg-[var(--site-panel)] px-4 py-3 font-mono text-sm text-[var(--site-ink)]">
              bun add -g @openscout/scout
            </pre>
          </div>

          <div className="grid gap-px overflow-hidden rounded-[8px] border border-[var(--site-border)] bg-[var(--site-border)] sm:grid-cols-2">
            {resourceLinks.map((link) => {
              const content = (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-sans text-base font-semibold text-[var(--site-ink)]">
                      {link.label}
                    </h3>
                    {isExternalHref(link.href) ? (
                      <ArrowUpRight
                        className="h-4 w-4 shrink-0 text-[var(--site-muted)]"
                        aria-hidden
                      />
                    ) : null}
                  </div>
                  <p className="mt-2 font-sans text-sm leading-6 text-[var(--site-copy)]">
                    {link.description}
                  </p>
                </>
              );

              const className =
                "block min-h-[132px] bg-[var(--site-surface)] p-5 transition hover:bg-[var(--site-panel)]";

              if (isExternalHref(link.href)) {
                return (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className={className}
                  >
                    {content}
                  </a>
                );
              }

              return (
                <Link key={link.href} href={link.href} className={className}>
                  {content}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="bg-[var(--site-page-bg)]">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 font-sans text-sm text-[var(--site-muted)] sm:flex-row sm:items-center sm:justify-between">
          <span>OpenScout / oscout.net</span>
          <div className="flex flex-wrap gap-4">
            <a
              href={githubNativeAuthStartUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-[var(--site-ink)]"
            >
              <LogIn className="h-3.5 w-3.5" aria-hidden />
              Connect
            </a>
            <a
              href={githubRepoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-[var(--site-ink)]"
            >
              <Github className="h-3.5 w-3.5" aria-hidden />
              Source
            </a>
            <a
              href={npmPackageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-[var(--site-ink)]"
            >
              <Package className="h-3.5 w-3.5" aria-hidden />
              npm
            </a>
            <Link
              href="/privacy"
              className="inline-flex items-center gap-1.5 hover:text-[var(--site-ink)]"
            >
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
