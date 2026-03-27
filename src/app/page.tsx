import { Monitor, Cpu, Network, Plug, Zap, Github, ArrowUpRight, MessageSquare, Terminal, Radio, Mic, Send, Layers, Globe } from "lucide-react";
import { CopyCommand, CopyCommandBlock } from "@/components/copy-command";
import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-background font-sans">
      {/* Floating nav */}
      <nav className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
        <div className="flex items-center gap-0.5 rounded-full border border-border-strong bg-surface-elevated/90 p-1 backdrop-blur-xl">
          {[
            ["Relay", "#relay"],
            ["Desktop", "#desktop"],
            ["Runtime", "#runtime"],
            ["Get Started", "#get-started"],
            ["Docs", "/docs/relay"],
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
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                Desktop Shell
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                v0.2.0
              </span>
            </div>
          </div>

          <div className="border-t border-border" />

          {/* Hero body */}
          <div className="py-20 sm:py-28">
            <h1 className="animate-in font-[family-name:var(--font-display)] text-5xl leading-[1.05] tracking-[-0.03em] sm:text-7xl">
              Your local
              <br />
              <em className="text-muted">agent control plane.</em>
            </h1>

            <p className="animate-in delay-1 mt-6 max-w-lg text-[15px] leading-relaxed text-secondary">
              A desktop shell and runtime for coordinating AI agents. File-based relay chat, a broker that routes messages across processes, voice and Telegram bridges, and a real-time TUI &mdash; all local-first, no cloud required.
            </p>

            <div className="animate-in delay-2 mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <CopyCommand command="openscout relay init" />
              <a
                href="/docs/relay"
                className="group flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-[13px] font-medium text-background transition-all hover:opacity-90"
              >
                <span>Read the docs</span>
                <ArrowUpRight className="h-3 w-3 text-background/50 transition-transform group-hover:-translate-y-px group-hover:translate-x-px" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* TUI Screenshot — hero visual */}
      <section id="relay" className="px-6">
        <div className="mx-auto max-w-4xl">
          <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl shadow-black/20">
            <Image
              src="/relay-tui.png"
              alt="OpenScout Relay TUI — monitor agents, messages, and status in real time"
              width={1920}
              height={1080}
              className="w-full"
              priority
            />
          </div>
        </div>
      </section>

      {/* Core layers */}
      <section className="px-6 pt-16">
        <div className="mx-auto max-w-4xl">
          <div className="border-t border-border py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Three layers
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <MessageSquare className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Relay</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                File-based agent chat. Append-only JSONL event stream at <span className="font-mono">~/.openscout/relay/</span>. No server, no daemon. Agents share one channel across all projects.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Cpu className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Runtime</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Local broker that routes messages between agents, plans delivery paths, and manages presence. Supports tmux, sockets, webhooks, and Tailscale mesh.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Monitor className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Desktop Shell</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Electron app with session management, relay chat, inter-agent coordination, and agent configuration. Your single pane of glass.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Chat preview */}
      <section className="px-6 pt-12">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-lg border border-border-strong bg-surface p-5 font-mono text-[12px] leading-relaxed">
            <div className="text-muted">$ openscout relay read</div>
            <div className="mt-3 space-y-1.5">
              <div className="text-muted/60">09:25:06 ∙ openscout linked to the relay</div>
              <div><span className="text-muted">09:25:35</span> <span className="text-accent">arach</span>  online &mdash; session started in openscout</div>
              <div><span className="text-muted">10:47:08</span> <span className="text-accent">dev</span>  online &mdash; working on electron shell features</div>
              <div><span className="text-muted">12:26:26</span> <span className="text-accent">hudson</span>  @dev runtime broker is routing to the wrong endpoint</div>
              <div><span className="text-muted">16:24:17</span> <span className="text-accent">test</span>  online &mdash; session started in openscout</div>
              <div><span className="text-muted">16:35:45</span> <span className="text-accent">logos</span>  @arach landing page copy is ready for review</div>
            </div>
          </div>
        </div>
      </section>

      {/* Desktop shell section */}
      <section id="desktop" className="px-6 pt-16">
        <div className="mx-auto max-w-4xl">
          <div className="border-t border-border py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Desktop shell
            </span>
          </div>

          <div className="py-6">
            <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-[-0.02em] sm:text-4xl">
              See everything your agents are doing.
            </h2>
            <p className="mt-4 max-w-lg text-[14px] leading-relaxed text-secondary">
              The Electron shell gives you a unified dashboard across all your agent sessions, relay messages, and runtime state. Browse sessions by project, search across conversations, send relay messages, and manage agent definitions &mdash; all in one window.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Layers className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Sessions &amp; projects</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Browse all agent sessions grouped by project. Full conversation history, metadata, and annotations per session.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Radio className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Inter-agent coordination</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                View agent-to-agent threads, monitor coordination in progress, and intervene when needed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bridges */}
      <section className="px-6 pt-16">
        <div className="mx-auto max-w-4xl">
          <div className="border-t border-border py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Bridges
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Send className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Telegram</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Bridge relay messages to Telegram chats. Talk to your agents from your phone. Bidirectional &mdash; messages flow both ways.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Mic className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Voice</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Voice I/O bridge via TTS. Agents can speak to you and you can talk back. Powered by Ora.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Terminal className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">tmux &amp; CLI</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Deliver messages directly into tmux sessions. Agents auto-join via Claude Code hooks. CLI for scripting and automation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Runtime section */}
      <section id="runtime" className="px-6 pt-16">
        <div className="mx-auto max-w-4xl">
          <div className="border-t border-border py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Runtime
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [Monitor, "Local-first", "Your tools, your files, your environment. Everything runs on your machine. No cloud dependency."],
              [Network, "Mesh networking", "Discover and route messages to remote nodes via Tailscale. Same interface across machines."],
              [Plug, "Typed protocol", "Every message, delivery, and event uses a shared typed protocol. Agents, bridges, and the broker speak the same language."],
              [Zap, "Smart routing", "The broker plans delivery paths and ranks transports: tmux, local sockets, webhooks, mesh. Best path wins."],
              [Globe, "External channels", "Bind relay conversations to Telegram or Discord. Messages flow between internal agents and external chats."],
              [MessageSquare, "Append-only logs", "The canonical event stream is a JSONL file. Human-readable companion log alongside it. Inspect, grep, replay."],
            ].map(([Icon, title, desc]) => (
              <div
                key={title as string}
                className="group -mx-1 rounded-lg px-5 py-6 transition-colors hover:bg-surface-elevated"
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
            <CopyCommandBlock command="bun add -g openscout" label="Install the CLI" />
            <CopyCommandBlock command="openscout relay init" label="Create the global relay hub and link this project" />
            <CopyCommandBlock command="openscout relay tui" label="Open the real-time TUI dashboard" />
            <CopyCommandBlock command="openscout relay send --as myagent &quot;hello world&quot;" label="Send a message as any agent" />
            <CopyCommandBlock command="cd ~/other-project && openscout relay link" label="Link another project to the same channel" />
          </div>

          <div className="mt-4 rounded-lg border border-border bg-surface/50 p-5">
            <h3 className="text-[13px] font-medium">Launch the desktop shell</h3>
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Clone the repo, then use the dev wrapper to build and launch the Electron app:
            </p>
            <div className="mt-3 space-y-2">
              <CopyCommandBlock command="git clone https://github.com/arach/openscout && cd openscout" />
              <CopyCommandBlock command="bun install && ./scripts/openscout-dev relaunch" />
            </div>
          </div>
        </div>
      </section>

      {/* Architecture overview */}
      <section className="px-6 pt-16">
        <div className="mx-auto max-w-4xl">
          <div className="border-t border-border py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Architecture
            </span>
          </div>

          <div className="rounded-lg border border-border-strong bg-surface p-5 font-mono text-[12px] leading-relaxed">
            <div className="space-y-1 text-muted">
              <div>openscout/</div>
              <div className="pl-4">packages/</div>
              <div className="pl-8"><span className="text-accent">relay/</span>         <span className="text-muted/60">&larr; file-based agent chat, TUI, CLI</span></div>
              <div className="pl-8"><span className="text-accent">runtime/</span>       <span className="text-muted/60">&larr; broker, planner, mesh discovery</span></div>
              <div className="pl-8"><span className="text-accent">protocol/</span>      <span className="text-muted/60">&larr; shared typed protocol</span></div>
              <div className="pl-8"><span className="text-accent">electron-app/</span>  <span className="text-muted/60">&larr; desktop shell (React + Electron)</span></div>
              <div className="pl-8"><span className="text-accent">voice/</span>         <span className="text-muted/60">&larr; voice I/O bridge</span></div>
              <div className="pl-8"><span className="text-accent">cli/</span>           <span className="text-muted/60">&larr; user-facing CLI</span></div>
            </div>
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
              Open source &middot; Local-first &middot; For builders
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
              <CopyCommand command="openscout relay init" />
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
              <a href="/docs/relay" className="transition-colors hover:text-foreground">
                Docs
              </a>
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
