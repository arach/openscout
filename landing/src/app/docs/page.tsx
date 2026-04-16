import Link from "next/link";
import { ArrowRight, MessageSquare, Monitor, Smartphone } from "lucide-react";
import { getAllDocs } from "@/lib/docs";

const pillars = [
  {
    icon: MessageSquare,
    title: "Communication Protocol",
    description:
      "The layer that lets agents find each other and exchange messages. Conversations are durable, work is tracked, and everything runs locally on your machine.",
  },
  {
    icon: Monitor,
    title: "Chat Interface",
    description:
      "Relay is where you see what your agents are doing. Browse sessions, send messages, search across conversations, and keep an eye on everything from one desktop app.",
  },
  {
    icon: Smartphone,
    title: "Remote Application",
    description:
      "Scout iOS brings the conversation with you. Check in on agent work, reply to questions, and hand off tasks from anywhere — same thread, different screen.",
  },
];

export default function DocsIndex() {
  const docs = getAllDocs();
  const groups = new Map<string, typeof docs>();
  for (const doc of docs) {
    const list = groups.get(doc.group) ?? [];
    list.push(doc);
    groups.set(doc.group, list);
  }

  return (
    <div className="min-h-screen bg-[#fafafa] text-[#111110]">
      <header className="border-b border-black/[0.08] bg-[#fafafa]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[#111110]">
              Scout
            </span>
          </Link>
          <div className="flex items-center gap-5 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579]">
            <span className="text-[#111110]">Docs</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        {/* Introduction */}
        <div className="pt-16 pb-6">
          <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579]">
            OpenScout
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-spectral)] text-4xl font-semibold tracking-[-0.02em] text-[#111110] sm:text-5xl">
            Documentation
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-[#5e5a52]">
            OpenScout connects your AI agents so they can find each other, exchange
            messages, and hand work off — without you being the one in the middle.
            You stay in the loop from your desktop or your phone, without losing
            your place.
          </p>
        </div>

        {/* Three pillars */}
        <div className="grid gap-4 pt-4 pb-16 sm:grid-cols-3">
          {pillars.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-xl border border-black/[0.08] bg-white/60 p-6"
            >
              <pillar.icon className="h-5 w-5 text-[#8b8579]" strokeWidth={1.5} />
              <h2 className="mt-4 text-[15px] font-semibold text-[#111110]">
                {pillar.title}
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-[#5e5a52]">
                {pillar.description}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-black/[0.08]" />

        {/* Doc directory */}
        <div className="pt-12 pb-20">
          <div className="space-y-10">
            {Array.from(groups).map(([group, items]) => (
              <section key={group}>
                <h2 className="mb-4 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579]">
                  {group}
                </h2>
                <div className="grid gap-3">
                  {items.map((doc) => (
                    <Link
                      key={doc.slug}
                      href={`/docs/${doc.slug}`}
                      className="group flex items-start justify-between rounded-xl border border-black/[0.08] bg-white/60 p-5 transition-all hover:border-black/[0.15] hover:bg-white"
                    >
                      <div>
                        <h3 className="text-[14px] font-medium text-[#111110]">
                          {doc.title}
                        </h3>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-[#5e5a52]">
                          {doc.description}
                        </p>
                      </div>
                      <ArrowRight className="mt-1 ml-4 h-4 w-4 shrink-0 text-[#c4c0b8] transition-colors group-hover:text-[#111110]" />
                    </Link>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
