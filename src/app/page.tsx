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
            ["Protocol", "#protocol"],
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
                Broker-backed
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
              The local broker
              <br />
              <em className="text-muted">for your agents.</em>
            </h1>

            <p className="animate-in delay-1 mt-6 max-w-lg text-[15px] leading-relaxed text-secondary">
              Broker-backed local communication and execution for Claude, Codex, tmux, and bridges. Durable conversations, explicit invocations, tracked flights, launch-agent runtime, and a desktop shell that makes the whole system inspectable.
            </p>

            <div className="animate-in delay-2 mt-10 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <CopyCommand command="scout init" />
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
      <section id="protocol" className="px-6">
        <div className="mx-auto max-w-4xl">
          <div className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl shadow-black/20">
            <Image
              src="/relay-tui.png"
              alt="OpenScout Relay TUI — compatibility surface over broker-backed conversations and work state"
              width={1920}
              height={1080}
              className="w-full"
              priority
            />
          </div>
          <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-muted">
            Relay is the fast compatibility surface. The broker underneath it is the durable source of truth for conversations, invocations, flights, and routing.
          </p>
        </div>
      </section>

      {/* Why it works */}
      <section className="px-6 pt-16">
        <div className="mx-auto max-w-4xl">
          <div className="border-t border-border py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Why it holds
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [MessageSquare, "Explicit", "Conversation, invocation, flight, and delivery are separate records, so chat and work do not get conflated."],
              [Layers, "Addressable", "Actors, conversations, invocations, and deliveries have stable identities you can inspect and reference."],
              [Plug, "Durable", "The broker is the single writer and the local store is canonical instead of fragile terminal state."],
              [Radio, "Observable", "Surfaces can show who owns work, what is running, and where routing or delivery failed."],
              [Zap, "Recoverable", "Broker restarts do not have to erase context because the system rebuilds from durable state."],
              [Cpu, "Harness-agnostic", "Claude, Codex, tmux, and future endpoints plug into one protocol instead of forking the model."],
            ].map(([Icon, title, desc]) => (
              <div key={title as string} className="rounded-lg border border-border bg-surface/50 p-5">
                <Icon className="h-4 w-4 text-accent" strokeWidth={1.5} />
                <h3 className="mt-3 text-[13px] font-medium">{title as string}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{desc as string}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Protocol loop */}
      <section className="px-6 pt-12">
        <div className="mx-auto max-w-4xl">
          <div className="border-t border-border py-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
              Protocol loop
            </span>
          </div>
          <div className="rounded-lg border border-border-strong bg-surface p-5 font-mono text-[12px] leading-relaxed">
            <div className="text-muted">surface  broker  store  endpoint</div>
            <div className="mt-3 space-y-1.5">
              <div><span className="text-accent">surface</span>  →  broker     post message / invocation</div>
              <div><span className="text-accent">broker</span>   →  store      persist record + control event</div>
              <div><span className="text-accent">broker</span>   →  endpoint   route delivery or wake target</div>
              <div><span className="text-accent">endpoint</span> →  broker     flight.updated (queued / running / waiting / completed)</div>
              <div><span className="text-accent">endpoint</span> →  broker     result / artifact / status</div>
              <div><span className="text-accent">broker</span>   →  surface    stream updated conversation and work state</div>
            </div>
          </div>
          <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-muted">
            This is the core lifecycle: conversation stays human-readable, work stays explicit, routing stays visible, and the system can recover after failure.
          </p>
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
              Inspect conversations, work, and machines.
            </h2>
            <p className="mt-4 max-w-lg text-[14px] leading-relaxed text-secondary">
              The Electron shell gives you one place to inspect conversations, tasks, flights, machines, and runtime health across all your agent endpoints. It is the operator surface for the broker, not a second source of truth.
            </p>
          </div>

          <div className="mb-8 overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl shadow-black/20">
            <Image
              src="/desktop-shell.png"
              alt="OpenScout Desktop Shell — unified dashboard for agents, sessions, relay, and runtime"
              width={1920}
              height={1080}
              className="w-full"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Layers className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Conversations &amp; work</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Browse direct threads, recent asks, invocations, and flight state without reconstructing context from scattered terminals.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Radio className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Machines &amp; endpoints</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                See where agents live, which harness they use, which machine owns them, and whether the broker can currently reach them.
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
              Bindings &amp; bridges
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Send className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Telegram</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Bind broker conversations to Telegram threads so outbound and inbound messages share the same durable model.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Mic className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">Voice</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Attach voice as another delivery surface. Speech is a transport and directive layer, not the canonical message body.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-surface/50 p-5">
              <Terminal className="h-4 w-4 text-accent" strokeWidth={1.5} />
              <h3 className="mt-3 text-[13px] font-medium">tmux &amp; CLI</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                Keep the fast local loop with tmux and the relay CLI while the broker remains the canonical writer underneath it.
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
              [Monitor, "Single writer", "The broker owns durable conversation and work records so surfaces do not race on shared files or terminal state."],
              [Network, "Launch-agent runtime", "Run the broker under macOS launchd so it starts cleanly, stays up, and exposes inspectable health."],
              [Plug, "Typed protocol", "Messages, invocations, flights, deliveries, and bindings share one contract across the system."],
              [Zap, "Agent discovery", "Workspace roots, project manifests, and registered endpoints map local repos to real agent identities."],
              [Globe, "External bindings", "Bridge internal conversations to Telegram, Discord, voice, webhooks, or peer brokers without changing the core model."],
              [MessageSquare, "Compatibility surfaces", "Relay read/watch, the TUI, and the desktop shell are projections over the same broker state."],
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
            <CopyCommandBlock command="bun add -g scout" label="Install the product CLI" />
            <CopyCommandBlock command="bun add -g @openscout/relay" label="Install the relay compatibility CLI" />
            <CopyCommandBlock command="scout init" label="Create local settings, discover projects, register agents, and install the broker service" />
            <CopyCommandBlock command="scout doctor" label="Inspect broker health, logs, workspace roots, and runtime paths" />
            <CopyCommandBlock command="openscout relay watch --as myagent" label="Use Relay directly when you want the advanced compatibility CLI" />
            <CopyCommandBlock command="openscout relay send --as myagent &quot;hello world&quot;" label="Send a message as any agent through the broker-backed relay" />
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
              <div className="pl-8"><span className="text-accent">protocol/</span>      <span className="text-muted/60">&larr; messages, invocations, flights, deliveries, bindings</span></div>
              <div className="pl-8"><span className="text-accent">runtime/</span>       <span className="text-muted/60">&larr; broker service, launch agent, discovery, routing</span></div>
              <div className="pl-8"><span className="text-accent">relay/</span>         <span className="text-muted/60">&larr; compatibility CLI, TUI, broker-backed read/watch</span></div>
              <div className="pl-8"><span className="text-accent">electron-app/</span>  <span className="text-muted/60">&larr; desktop shell for conversations, work, machines</span></div>
              <div className="pl-8"><span className="text-accent">voice/</span>         <span className="text-muted/60">&larr; voice bindings and delivery bridge</span></div>
              <div className="pl-8"><span className="text-accent">cli/</span>           <span className="text-muted/60">&larr; bootstrap, doctor, user-facing runtime tools</span></div>
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
              Open source &middot; Local-first &middot; Broker-backed
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
              <CopyCommand command="scout init" />
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
