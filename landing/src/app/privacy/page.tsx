import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  Bell,
  Camera,
  Database,
  Mic,
  Shield,
  Speech,
} from "lucide-react";
import { SiteThemeToggle } from "@/components/site-theme-toggle";

export const metadata: Metadata = {
  title: "Privacy Policy — OpenScout",
  description:
    "Privacy practices for openscout.app, api.openscout.app, and the Scout desktop and iOS apps.",
  alternates: {
    canonical: "/privacy",
  },
};

const websitePractices = [
  {
    icon: Database,
    title: "Website analytics",
    description:
      "The marketing site at openscout.app uses Google Analytics in production to measure page visits and site interactions such as navigation clicks, CTA clicks, command copy events, and lead-form activity.",
  },
  {
    icon: Shield,
    title: "Early-access form submissions",
    description:
      "If you submit the early-access form, we collect your email address, the intent you select, any note you add, basic source metadata, and a spam-prevention field. That submission is sent to api.openscout.app and stored in private blob storage.",
  },
] as const;

const appPractices = [
  {
    icon: Camera,
    title: "Camera",
    description:
      "Scout iOS asks for camera access only to scan a pairing QR code from your bridge.",
  },
  {
    icon: Mic,
    title: "Microphone",
    description:
      "Scout iOS asks for microphone access when you want to send voice input.",
  },
  {
    icon: Speech,
    title: "Speech recognition",
    description:
      "Scout iOS uses speech recognition for transcription. The current app is configured to require on-device recognition.",
  },
  {
    icon: Bell,
    title: "Notifications",
    description:
      "Scout iOS asks for notification permission so it can alert you about approvals, replies, and other events that need attention.",
  },
] as const;

export default function PrivacyPage() {
  return (
    <div className="site-docs min-h-screen bg-[var(--site-docs-bg)] text-[var(--site-ink)]">
      <header className="border-b border-[var(--site-border-soft)] bg-[var(--site-docs-bg-strong)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[var(--site-ink)]">
              Scout
            </span>
          </Link>
          <div className="flex items-center gap-5 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[var(--site-muted)]">
            <Link href="/docs" className="transition-colors hover:text-[var(--site-ink)]">
              Docs
            </Link>
            <span className="text-[var(--site-ink)]">Privacy</span>
            <SiteThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-20 pt-16">
        <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[var(--site-muted)]">
          OpenScout
        </p>
        <h1 className="mt-3 font-[family-name:var(--font-spectral)] text-4xl font-semibold tracking-[-0.02em] text-[var(--site-ink)] sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-5 max-w-3xl text-[16px] leading-relaxed text-[var(--site-copy)]">
          Last updated April 23, 2026. This policy covers the OpenScout marketing
          site at <span className="font-medium text-[var(--site-ink)]">openscout.app</span>,
          the early-access endpoint at <span className="font-medium text-[var(--site-ink)]">api.openscout.app</span>,
          and the Scout desktop and iOS apps.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--site-border-soft)] bg-[var(--site-surface)] p-6">
            <Shield className="h-5 w-5 text-[var(--site-accent)]" strokeWidth={1.7} />
            <h2 className="mt-4 text-[15px] font-semibold text-[var(--site-ink)]">
              Local-first by default
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--site-copy)]">
              OpenScout is designed so conversations, broker state, local databases,
              paired-device state, and day-to-day agent activity primarily live on
              your own machines and paired bridge rather than in a developer-run
              cloud account.
            </p>
          </div>

          <div className="rounded-2xl border border-[var(--site-border-soft)] bg-[var(--site-surface)] p-6">
            <Database className="h-5 w-5 text-[var(--site-accent)]" strokeWidth={1.7} />
            <h2 className="mt-4 text-[15px] font-semibold text-[var(--site-ink)]">
              Limited website collection
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--site-copy)]">
              If you only use the website, the data we receive is limited to website
              analytics and anything you choose to send through the early-access form.
            </p>
          </div>
        </div>

        <section className="pt-14">
          <h2 className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[var(--site-muted)]">
            Website Data We Collect
          </h2>
          <div className="mt-4 grid gap-4">
            {websitePractices.map((practice) => (
              <div
                key={practice.title}
                className="rounded-2xl border border-[var(--site-border-soft)] bg-[var(--site-surface)] p-6"
              >
                <practice.icon className="h-5 w-5 text-[var(--site-accent)]" strokeWidth={1.7} />
                <h3 className="mt-4 text-[15px] font-semibold text-[var(--site-ink)]">
                  {practice.title}
                </h3>
                <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-[var(--site-copy)]">
                  {practice.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="pt-14">
          <h2 className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[var(--site-muted)]">
            App Permissions And Local Processing
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {appPractices.map((practice) => (
              <div
                key={practice.title}
                className="rounded-2xl border border-[var(--site-border-soft)] bg-[var(--site-surface)] p-6"
              >
                <practice.icon className="h-5 w-5 text-[var(--site-accent)]" strokeWidth={1.7} />
                <h3 className="mt-4 text-[15px] font-semibold text-[var(--site-ink)]">
                  {practice.title}
                </h3>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--site-copy)]">
                  {practice.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="pt-14">
          <h2 className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[var(--site-muted)]">
            How We Use Information
          </h2>
          <div className="mt-4 rounded-2xl border border-[var(--site-border-soft)] bg-[var(--site-surface)] p-6">
            <ul className="grid gap-3 text-[14px] leading-relaxed text-[var(--site-copy)]">
              <li>
                We use website analytics to understand how people find and use the
                marketing site.
              </li>
              <li>
                We use early-access submissions to respond to interest, prioritize
                product work, and manage access requests.
              </li>
              <li>
                We do not sell personal information and we do not run third-party
                advertising profiles for OpenScout.
              </li>
            </ul>
          </div>
        </section>

        <section className="pt-14">
          <h2 className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[var(--site-muted)]">
            Infrastructure And Retention
          </h2>
          <div className="mt-4 rounded-2xl border border-[var(--site-border-soft)] bg-[var(--site-surface)] p-6">
            <p className="text-[14px] leading-relaxed text-[var(--site-copy)]">
              The public marketing site is served from GitHub Pages. Early-access
              submissions are written to private blob storage. Local app state stays
              on your own devices unless you explicitly send information through a
              service or bridge you operate. We keep website submissions for product
              and support operations until they are no longer needed.
            </p>
          </div>
        </section>

        <section className="pt-14">
          <h2 className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[var(--site-muted)]">
            Questions
          </h2>
          <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-[var(--site-border-soft)] bg-[var(--site-surface)] p-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-[14px] leading-relaxed text-[var(--site-copy)]">
              If you have a privacy question or want us to remove an early-access
              submission, contact us through the OpenScout support channel.
            </p>
            <a
              href="https://github.com/arach/openscout/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--site-ink)] px-4 text-sm font-medium text-[var(--site-ink-contrast)] transition-colors hover:bg-[var(--site-ink-hover)]"
            >
              <span>Open support</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
