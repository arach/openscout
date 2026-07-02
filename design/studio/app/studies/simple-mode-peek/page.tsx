"use client";

import { useState } from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import styles from "./page.module.css";

type MainView = "today" | "chats";
type Stage = "first" | "settling" | "pro";
type Tone = "ok" | "warn" | "info" | "dim" | "error";

const MAIN_NAV: Array<{ id: MainView; label: string }> = [
  { id: "today", label: "Today" },
  { id: "chats", label: "Chats" },
];

const STAGES: Array<{ id: Stage; label: string; caption: string }> = [
  {
    id: "first",
    label: "First open",
    caption:
      "Two places and a command palette. Every pro room already exists and ⌘K reaches all of them — the furniture just hasn't arrived yet.",
  },
  {
    id: "settling",
    label: "Settling in",
    caption:
      "Each section grows a quiet door to the room behind it — lanes, dispatch, activity. Step through, look around, pin what you like.",
  },
  {
    id: "pro",
    label: "Pro",
    caption:
      "Pinned rooms dock in the rail below a divider and the top bar gains a live readout. Today is still the front page — pro adds to simple mode, it never replaces it.",
  },
];

const PINNED_ROOMS = ["Lanes", "Dispatch", "Terminals"];

const NEEDS_YOU = [
  {
    title: "Fable's nav review came back",
    detail: "Pick a direction for simple mode so openscout can keep going.",
    agent: "openscout",
    action: "Review",
  },
  {
    title: "A message to woolf didn't get through",
    detail: "The delivery failed once. One tap to retry.",
    agent: "openscout",
    action: "Retry",
  },
];

const WORKING = [
  { agent: "hudson", doing: "is comparing broker state for the settings sync", age: "14m" },
  { agent: "debussy", doing: "is writing up the navigation critique", age: "21m" },
];

const DONE = [
  { agent: "hudson", did: "finished the Talkie build", age: "28m", action: "View" },
  { agent: "openscout", did: "captured 27 screenshots of the current nav", age: "41m", action: "Open" },
];

const CREW: Array<{ name: string; tone: Tone }> = [
  { name: "openscout", tone: "warn" },
  { name: "hudson", tone: "info" },
  { name: "debussy", tone: "info" },
  { name: "talkie", tone: "dim" },
  { name: "spinoza", tone: "dim" },
];

const AGENT_CARDS: Record<
  string,
  { project: string; now: string; last: string; tone: Tone }
> = {
  openscout: {
    project: "~/dev/openscout",
    now: "Waiting on your call about the simple-mode direction.",
    last: "Captured 27 screenshots of the current nav · 41m ago",
    tone: "warn",
  },
  hudson: {
    project: "~/dev/hudson",
    now: "Comparing broker state for the settings sync.",
    last: "Finished the Talkie build · 28m ago",
    tone: "info",
  },
  debussy: {
    project: "~/dev/openscout",
    now: "Writing up the navigation critique.",
    last: "Reviewed the nav inventory · 1h ago",
    tone: "info",
  },
  talkie: {
    project: "~/dev/talkie",
    now: "Nothing running. Quiet since this morning.",
    last: "Parked the capture follow-up · 4h ago",
    tone: "dim",
  },
  spinoza: {
    project: "~/dev/openscout",
    now: "Nothing running.",
    last: "Queued a mechanical task · 22m ago",
    tone: "dim",
  },
};

const CHATS = [
  {
    from: "debussy",
    preview: "Recommended top level: a briefing and your chats — keep power tools one level down.",
    meta: "5m",
    unread: true,
  },
  {
    from: "hudson",
    preview: "Settings sync is comparing broker state now. Nothing needed from you yet.",
    meta: "14m",
    unread: false,
  },
  {
    from: "talkie",
    preview: "Capture follow-up is parked until the screenshot path question settles.",
    meta: "4h",
    unread: false,
  },
];

function Dot({ tone = "dim" }: { tone?: Tone }) {
  return <span className={styles.dot} data-tone={tone} />;
}

export default function SimpleModePeekStudy() {
  const [view, setView] = useState<MainView>("today");
  const [stage, setStage] = useState<Stage>("first");
  const [cardAgent, setCardAgent] = useState<string | null>(null);

  const current = MAIN_NAV.find((item) => item.id === view) ?? MAIN_NAV[0];
  const currentStage = STAGES.find((item) => item.id === stage) ?? STAGES[0];
  const card = cardAgent ? AGENT_CARDS[cardAgent] : null;
  const doors = stage !== "first";

  return (
    <ScoutStudyShell
      pageId="simple-mode-peek"
      title="Simple mode: the app opens to the answer"
      blurb="The calm end-of-day shape, plus how it unfolds toward pro. Two places — Today is the briefing you read, Chats is where you talk — and agents are a tappable card layer. Pro arrives as doors, not modes: each section carries a quiet door to the room behind it, and pinned rooms dock in the rail. Use the stage control to walk the path."
      surface="web"
      initialSkin="juniper-d"
    >
      <div className={styles.study}>
        <div className={styles.stageStrip}>
          <div className={styles.stageBtns} role="tablist" aria-label="Unfold stage">
            {STAGES.map((item) => (
              <button
                key={item.id}
                type="button"
                data-active={stage === item.id || undefined}
                onClick={() => setStage(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <p className={styles.stageCaption}>{currentStage.caption}</p>
        </div>

        <section className={styles.app} aria-label="Simple mode mock-up">
          <aside className={styles.rail}>
            <div className={styles.brand}>
              <span className={styles.brandMark}>S</span>
              <span className={styles.brandText}>Scout</span>
            </div>
            <nav className={styles.primaryNav} aria-label="Primary">
              {MAIN_NAV.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={styles.navItem}
                  data-active={view === item.id || undefined}
                  onClick={() => setView(item.id)}
                >
                  <span className={styles.navGlyph}>{item.label.slice(0, 1)}</span>
                  <span className={styles.navLabel}>{item.label}</span>
                  {item.id === "chats" ? <span className={styles.navBadge}>1</span> : null}
                </button>
              ))}
              {stage === "pro" ? (
                <div className={styles.railGroup}>
                  <div className={styles.railGroupLabel}>Pinned</div>
                  {PINNED_ROOMS.map((room) => (
                    <button key={room} type="button" className={styles.navItem}>
                      <span className={styles.navGlyph}>{room.slice(0, 1)}</span>
                      <span className={styles.navLabel}>{room}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </nav>
            <div className={styles.railFoot}>
              <span className={styles.statusPip} />
              <span>Connected</span>
            </div>
          </aside>

          <main className={styles.main}>
            <header className={styles.topbar}>
              <div className={styles.titleCluster}>
                <div className={styles.kicker}>Simple mode</div>
                <h2>{current.label}</h2>
              </div>
              <div className={styles.topActions}>
                {stage === "pro" ? (
                  <span className={styles.proPill}>
                    <span className={styles.pillGroup}>
                      <Dot tone="warn" />
                      <span>2 need you</span>
                    </span>
                    <span className={styles.pillGroup}>
                      <Dot tone="info" />
                      <span>2 working</span>
                    </span>
                  </span>
                ) : null}
                <button type="button" className={styles.textButton}>
                  New chat
                </button>
                <button type="button" className={styles.kbd} aria-label="Open command palette">
                  ⌘K
                </button>
              </div>
            </header>

            {view === "today" ? <TodayView doors={doors} onOpenAgent={setCardAgent} /> : null}
            {view === "chats" ? <ChatsView /> : null}
          </main>

          {card && cardAgent ? (
            <>
              <button
                type="button"
                className={styles.scrim}
                aria-label="Close agent card"
                onClick={() => setCardAgent(null)}
              />
              <aside className={styles.sideCard} aria-label={`About ${cardAgent}`}>
                <header className={styles.sideCardHead}>
                  <span className={styles.bigAvatar}>{cardAgent.slice(0, 2)}</span>
                  <div className={styles.sideCardTitle}>
                    <div className={styles.inspectorTitle}>{cardAgent}</div>
                    <div className={styles.inspectorSub}>{card.project}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Close agent card"
                    onClick={() => setCardAgent(null)}
                  >
                    ×
                  </button>
                </header>
                <div className={styles.sideCardBody}>
                  <div className={styles.inspectorBlock}>
                    <span className={styles.blockLabel}>Right now</span>
                    <strong>
                      <Dot tone={card.tone} /> {card.now}
                    </strong>
                  </div>
                  <div className={styles.inspectorBlock}>
                    <span className={styles.blockLabel}>Last result</span>
                    <strong>{card.last}</strong>
                  </div>
                  {doors ? (
                    <button type="button" className={styles.doorLink}>
                      full session ›
                    </button>
                  ) : null}
                </div>
                <div className={styles.inspectorActions}>
                  <button type="button">Chat</button>
                  <button type="button">Watch</button>
                </div>
              </aside>
            </>
          ) : null}
        </section>

        <section className={styles.map} aria-label="Direction notes">
          <MapCard
            label="The app opens to the answer"
            job="Today is a briefing, not a dashboard: what needs you, who is still working, what got done, who is quiet — readable in ten seconds at the end of a long day. Chats is the only other place; agents are a card you tap, not a section you visit."
          />
          <MapCard
            label="Doors, not modes"
            job="Every simple section is a projection of a pro room, and its header carries a quiet door — Still working opens Lanes, a failed delivery opens Dispatch, Done today opens Activity. Nothing is locked behind a mode: ⌘K reaches every room from day one."
          />
          <MapCard
            label="The rail grows downward"
            job="Step through a door often and you pin the room; pinned rooms dock in the rail under a divider. A pro's rail reads Today / Chats / — / Lanes / Dispatch / Terminals. Same house, more furniture — and Today stays the front page."
          />
          <MapCard
            label="One product, one grammar"
            job="The same fact wears different clothes at different depths: a sentence on Today is a card in Lanes is a row in Dispatch. Opening a door never renames anything, so moving between simple and pro never feels like switching products."
          />
        </section>
      </div>
    </ScoutStudyShell>
  );
}

function TodayView({
  doors,
  onOpenAgent,
}: {
  doors: boolean;
  onOpenAgent: (name: string) => void;
}) {
  return (
    <section className={styles.pageGrid} aria-label="Today">
      <div className={styles.briefing}>
        <div className={styles.kicker}>Wednesday · 6:42 pm</div>
        <h3>Two small things need you.</h3>
        <p className={styles.heroSub}>
          Everything else is handled — two agents are still working, and two things finished while
          you were away.
        </p>
      </div>

      <section className={styles.listPanel}>
        <SectionHead title="Needs you" door={doors ? "dispatch" : undefined} />
        {NEEDS_YOU.map((item) => (
          <button key={item.title} type="button" className={styles.actionRow}>
            <Dot tone="warn" />
            <span className={styles.rowCopy}>
              <span>{item.title}</span>
              <small>{item.detail}</small>
            </span>
            <span className={styles.rowButton}>{item.action}</span>
          </button>
        ))}
      </section>

      <section className={styles.twoCol}>
        <div className={styles.listPanel}>
          <SectionHead title="Still working" door={doors ? "lanes" : undefined} />
          {WORKING.map((item) => (
            <button
              key={item.agent}
              type="button"
              className={styles.actionRow}
              onClick={() => onOpenAgent(item.agent)}
            >
              <Dot tone="info" />
              <span className={styles.rowCopy}>
                <span>
                  <strong>{item.agent}</strong> {item.doing}
                </span>
                <small>{item.age}</small>
              </span>
            </button>
          ))}
        </div>
        <div className={styles.listPanel}>
          <SectionHead title="Done today" door={doors ? "activity" : undefined} />
          {DONE.map((item) => (
            <button key={item.did} type="button" className={styles.actionRow}>
              <Dot tone="ok" />
              <span className={styles.rowCopy}>
                <span>
                  <strong>{item.agent}</strong> {item.did}
                </span>
                <small>{item.age}</small>
              </span>
              <span className={styles.rowAction}>{item.action}</span>
            </button>
          ))}
        </div>
      </section>

      <div className={styles.crewStrip}>
        <span className={styles.crewLabel}>Your crew</span>
        <span className={styles.crewChips}>
          {CREW.map((member) => (
            <button
              key={member.name}
              type="button"
              className={styles.crewChip}
              onClick={() => onOpenAgent(member.name)}
            >
              <span className={styles.chipAvatar}>{member.name.slice(0, 2)}</span>
              <span className={styles.chipName}>{member.name}</span>
              <Dot tone={member.tone} />
            </button>
          ))}
        </span>
        {doors ? (
          <button type="button" className={`${styles.doorLink} ${styles.crewDoor}`}>
            agents ›
          </button>
        ) : null}
      </div>

      <div className={styles.askBar}>
        <span className={styles.askPrompt}>Ask for anything…</span>
        <span className={styles.askChips}>
          <button type="button">Review a branch</button>
          <button type="button">Fix a bug</button>
          <button type="button">Summarize today</button>
        </span>
      </div>
    </section>
  );
}

function ChatsView() {
  return (
    <section className={styles.chatLayout} aria-label="Chats">
      <aside className={styles.threadList}>
        <div className={styles.searchBox}>Search chats</div>
        {CHATS.map((chat) => (
          <button key={chat.from} type="button" className={styles.chatRow}>
            <span className={styles.chatAvatar}>{chat.from.slice(0, 2)}</span>
            <span className={styles.chatCopy}>
              <span className={styles.chatFrom}>
                {chat.from}
                {chat.unread ? <Dot tone="info" /> : null}
              </span>
              <span className={styles.chatPreview}>{chat.preview}</span>
            </span>
            <span className={styles.chatMeta}>{chat.meta}</span>
          </button>
        ))}
      </aside>

      <article className={styles.thread}>
        <header className={styles.threadHead}>
          <div>
            <div className={styles.kicker}>debussy</div>
            <h3>Nav review</h3>
          </div>
          <span className={styles.threadBadge}>replied</span>
        </header>
        <div className={styles.messageStack}>
          <Message
            who="You"
            body="Review the current navigation and recommend a simpler shape for normal users."
          />
          <Message
            who="debussy"
            body="Recommended shape: a briefing you read and the chats where you talk. Keep the power tools one level down, and let agent detail be a card you tap, not a place you visit."
          />
          <Message who="You" body="Let's mock that — the app should open to the answer." />
        </div>
        <div className={styles.composer}>Reply…</div>
      </article>
    </section>
  );
}

function MapCard({ label, job }: { label: string; job: string }) {
  return (
    <article className={styles.mapCard}>
      <div className={styles.mapLabel}>{label}</div>
      <p>{job}</p>
    </article>
  );
}

function SectionHead({ title, door }: { title: string; door?: string }) {
  return (
    <header className={styles.sectionHead}>
      <h4>{title}</h4>
      {door ? (
        <button type="button" className={styles.doorLink}>
          {door} ›
        </button>
      ) : null}
    </header>
  );
}

function Message({ who, body }: { who: string; body: string }) {
  return (
    <div className={styles.message}>
      <span>{who}</span>
      <p>{body}</p>
    </div>
  );
}
