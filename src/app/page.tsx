import { Monitor, Cloud, Shuffle, Plug, Zap, Users, Github, ArrowUpRight } from "lucide-react";
import { CopyCommand, CopyCommandBlock } from "@/components/copy-command";

export default function Home() {
  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Floating nav */}
      <nav className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
        <div className="flex items-center gap-0.5 rounded-full border border-border-strong bg-surface-elevated/90 p-1 backdrop-blur-xl">
          {[
            ["Features", "#features"],
            ["Start", "#get-started"],
            ["GitHub", "https://github.com/arach/openscout"],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="rounded-full px-3.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted transition-colors hover:bg-border hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 pt-14">
        <div className="mx-auto max-w-4xl">
          {/* Topline */}
          <div className="flex items-center justify-between py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              OpenScout
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              v0.1.0
            </span>
          </div>

          <div className="border-t border-border" />

          {/* Hero body */}
          <div className="py-24 sm:py-32">
            <h1 className="animate-in font-[family-name:var(--font-display)] text-5xl leading-[1.05] tracking-[-0.03em] sm:text-7xl">
              Agents that work
              <br />
              <em className="text-muted">the way you do.</em>
            </h1>

            <p className="animate-in delay-1 mt-6 max-w-sm text-[15px] leading-relaxed text-secondary">
              The open platform for agent-driven development. Run locally, orchestrate remotely, integrate everywhere.
            </p>

            <div className="animate-in delay-2 mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <CopyCommand command="npx openscout init" />
              <a
                href="https://github.com/arach/openscout"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-[13px] font-medium text-background transition-all hover:opacity-90"
              >
                <Github className="h-3.5 w-3.5" />
                <span>GitHub</span>
                <ArrowUpRight className="h-3 w-3 text-background/50 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="px-6">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center gap-3 border-t border-border py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Features
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [Monitor, "Local-first", "Full access to your tools, files, and environment. No cloud required."],
              [Cloud, "Remote when you need it", "Scale to remote clusters seamlessly. Same interface, more power."],
              [Shuffle, "Any model", "OpenAI, Anthropic, local LLMs. Swap freely, no lock-in."],
              [Plug, "Plug in your stack", "MCP servers, custom tools, shell scripts. Agents speak your language."],
              [Zap, "Real-time", "Watch agents think and act. Full visibility into every step."],
              [Users, "Multi-agent", "Compose agents into pipelines. Route tasks, share context."],
            ].map(([Icon, title, desc], i) => (
              <div
                key={title as string}
                className="group -mx-1 rounded-lg px-5 py-6 transition-colors hover:bg-surface-elevated"
                style={{
                  marginLeft: i % 3 !== 0 ? undefined : undefined,
                }}
              >
                <Icon className="h-4 w-4 text-accent transition-colors group-hover:text-foreground" strokeWidth={1.5} />
                <h3 className="mt-3 text-[13px] font-medium tracking-tight">{title as string}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{desc as string}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Get started */}
      <section id="get-started" className="px-6 pt-16">
        <div className="mx-auto max-w-4xl">
          <div className="border-t border-border py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Get started
            </span>
          </div>

          <div className="space-y-3 py-6">
            <CopyCommandBlock command="npx openscout init" label="Scaffold your workspace" />
            <CopyCommandBlock command="openscout add agent --name reviewer" label="Add agents with roles and tools" />
            <CopyCommandBlock command="openscout run" label="Launch locally or deploy" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-4xl">
          <div className="border-t border-border" />
          <div className="py-20 text-center">
            <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-[-0.02em] sm:text-4xl">
              Built in the open.
            </h2>
            <p className="mt-3 text-[13px] text-muted">
              Open source &middot; Free forever &middot; For builders
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <a
                href="https://github.com/arach/openscout"
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-10 items-center gap-2 rounded-md bg-foreground px-5 text-[13px] font-medium text-background transition-all hover:opacity-90"
              >
                <Github className="h-3.5 w-3.5" />
                <span>Star on GitHub</span>
                <ArrowUpRight className="h-3 w-3 text-background/50 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
              </a>
              <CopyCommand command="npx openscout init" />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 pb-20">
        <div className="mx-auto max-w-4xl border-t border-border">
          <div className="flex items-center justify-between py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              OpenScout
            </span>
            <div className="flex gap-5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              <a href="https://github.com/arach/openscout" className="transition-colors hover:text-foreground" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              <a href="https://x.com/arabornia" className="transition-colors hover:text-foreground" target="_blank" rel="noopener noreferrer">
                Twitter
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
