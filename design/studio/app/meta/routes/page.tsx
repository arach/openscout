type RouteKind = "canonical" | "ui" | "query" | "legacy" | "parser" | "gated";

type RouteItem = {
  path: string;
  label: string;
  kind: RouteKind;
  source: string;
  note?: string;
};

type PageInventory = {
  title: string;
  view: string;
  concept: string;
  canonical: string;
  routes: RouteItem[];
};

type ComponentInventory = {
  name: string;
  file: string;
  role: string;
  routes: RouteItem[];
};

const KIND_LABEL: Record<RouteKind, string> = {
  canonical: "Canonical",
  ui: "UI offer",
  query: "Query",
  legacy: "Legacy",
  parser: "Parser",
  gated: "Gated",
};

function route(
  path: string,
  label: string,
  kind: RouteKind,
  source: string,
  note?: string,
): RouteItem {
  return { path, label, kind, source, ...(note ? { note } : {}) };
}

const PAGES: PageInventory[] = [
  {
    title: "Home, Fleet, Activity",
    view: "inbox | fleet | activity | briefings",
    concept: "Operator dashboard, fleet status, recent activity, and briefings.",
    canonical: "/",
    routes: [
      route("/", "Home dashboard", "canonical", "Top nav, jump dock, routePath(inbox)"),
      route("/fleet", "Fleet summary", "canonical", "Parser and TanStack route tree"),
      route("/activity", "Activity history", "canonical", "Home links and route tree"),
      route("/briefings", "Briefings index", "canonical", "TanStack adoption prefix"),
      route("/briefings/:briefingId", "Briefing detail", "canonical", "TanStack adoption prefix"),
    ],
  },
  {
    title: "Projects And Agents",
    view: "agents-v2",
    concept: "Project registry plus scoped agent, chat, and session resources.",
    canonical: "/projects",
    routes: [
      route("/projects", "Project inbox", "canonical", "Top nav and ProjectsRail"),
      route("/projects/:projectSlug", "Project scope", "canonical", "ProjectsRail"),
      route("/projects/:projectSlug/agents", "Project agent index", "canonical", "Project index switcher"),
      route("/projects/:projectSlug/agents/:agentId", "Project agent profile", "canonical", "ProjectAgentProfile"),
      route("/projects/:projectSlug/agents/:agentId/c/:conversationId", "Project agent chat", "canonical", "Project sessions and chat actions"),
      route("/projects/:projectSlug/agents/:agentId/sessions/:sessionId", "Project agent session focus", "canonical", "ProjectSessionsPanel selection"),
      route("/projects/:projectSlug/sessions", "Project sessions index", "canonical", "Project index switcher"),
      route("/projects/:projectSlug/sessions/:sessionId", "Project session focus", "canonical", "routePath(agents-v2)"),
      route("/agents", "Global agent directory alias", "canonical", "Parser and route tree"),
      route("/agents/:agentId", "Global agent profile", "canonical", "Agent hover cards and profile links"),
      route("/agents/:agentId/c/:conversationId", "Global agent chat", "canonical", "AgentProfileBar"),
      route("/agents/:agentId/sessions/:sessionId", "Global agent-scoped session resource", "canonical", "routePath(agents-v2)", "This is still the Projects surface, not standalone Sessions."),
      route("/agents-v2", "Old project inbox input", "legacy", "Parser compatibility"),
      route("/agents-v2/:agentId", "Old agent profile input", "legacy", "Parser compatibility"),
      route("/agents-v2/sessions/:sessionId", "Old unscoped session input", "legacy", "Parser compatibility"),
    ],
  },
  {
    title: "Sessions",
    view: "sessions",
    concept: "Standalone session catalog and session observe surface.",
    canonical: "/sessions",
    routes: [
      route("/sessions", "Session catalog", "canonical", "Clean top nav, Agents subnav, jump dock"),
      route("/sessions/:sessionId", "Session detail or observe", "canonical", "openContent session links"),
      route("/sessions/:sessionId?agentId=:agentId", "Session detail with agent context", "query", "Agent lane and session actions", "Agent context is quiet metadata; session remains primary."),
      route("/sessions?agentId=:agentId", "Session catalog with agent context", "query", "routePath(sessions)"),
      route("/scope/sessions", "Scope session catalog", "canonical", "Scope namespace"),
      route("/scope/sessions/:sessionId", "Scope session detail", "canonical", "Scope namespace"),
      route("/agents.deprecated/:agentId/sessions/:sessionId", "Deprecated agent session input", "legacy", "Parser compatibility"),
    ],
  },
  {
    title: "Chat And Channels",
    view: "messages | conversation | channels | agent-info",
    concept: "Conversation list, direct conversation detail, channels, and agent context from chat.",
    canonical: "/messages",
    routes: [
      route("/messages", "Messages index", "canonical", "Top nav and Chat subnav"),
      route("/messages/:conversationId", "Messages index with selected conversation", "canonical", "MessagesScreen"),
      route("/messages/:conversationId?filter=dm|channel&sort=recent|name|unread", "Filtered/sorted message list", "query", "Chat left rail state"),
      route("/c/:conversationId", "Conversation detail", "canonical", "Conversation links throughout app"),
      route("/c/:conversationId?compose=ask", "Conversation detail with ask composer", "query", "Composer links"),
      route("/conversations", "Legacy conversation index", "legacy", "Parser and route tree"),
      route("/channels", "Channel index", "canonical", "Chat subnav"),
      route("/channels/:channelId", "Channel detail", "canonical", "Channels left rail"),
      route("/agent/:conversationId", "Agent info from conversation", "canonical", "ConversationHeader"),
    ],
  },
  {
    title: "Work And Follow",
    view: "work | follow",
    concept: "Work item detail and portable follow handles for flights, asks, sessions, and chats.",
    canonical: "/work/:workId",
    routes: [
      route("/work/:workId", "Work detail", "canonical", "WorkList, Ops inspector, WorkDetailScreen"),
      route("/follow", "Follow handle landing", "canonical", "routePath(follow)"),
      route("/follow?view=tail|session|chat|work&flightId=:flightId", "Follow a flight with preferred pane", "query", "Follow route serializer"),
      route("/follow?invocationId=:invocationId", "Follow invocation", "query", "Follow route serializer"),
      route("/follow?conversationId=:conversationId", "Follow conversation", "query", "Follow route serializer"),
      route("/follow?workId=:workId", "Follow work item", "query", "Follow route serializer"),
      route("/follow?sessionId=:sessionId", "Follow session", "query", "Follow route serializer"),
      route("/follow?targetAgentId=:agentId", "Follow target agent", "query", "Follow route serializer"),
      route("/follow/flight/:flightId", "Path-form flight input", "parser", "Parser compatibility"),
      route("/follow/invocation/:invocationId", "Path-form invocation input", "parser", "Parser compatibility"),
      route("/follow/conversation/:conversationId", "Path-form conversation input", "parser", "Parser compatibility"),
      route("/follow/work/:workId", "Path-form work input", "parser", "Parser compatibility"),
      route("/follow/session/:sessionId", "Path-form session input", "parser", "Parser compatibility"),
      route("/follow/agent/:agentId", "Path-form agent input", "parser", "Parser compatibility"),
    ],
  },
  {
    title: "Ops",
    view: "ops | broker | mesh",
    concept: "Operational modes, dispatch, mesh, tail, plans, and runtime status.",
    canonical: "/ops/control",
    routes: [
      route("/ops", "Ops default", "canonical", "Top nav"),
      route("/ops/control", "Control / mission mode", "canonical", "Ops subnav"),
      route("/ops/lanes", "Agent lanes", "canonical", "Ops subnav and scope namespace"),
      route("/ops/tail", "Tail", "canonical", "Clean top nav, Ops subnav, jump dock"),
      route("/ops/tail?q=:query", "Tail focused query", "query", "Work and mission links"),
      route("/ops/atop", "Runtime status", "canonical", "Ops subnav"),
      route("/ops/plan", "Plans", "canonical", "Ops subnav"),
      route("/ops/plan?plan=:planDocumentId", "Focused plan document", "query", "PlanView"),
      route("/ops/issues", "Issues mode", "canonical", "Parser alias"),
      route("/ops/errors", "Error alias for issues", "parser", "Parser alias"),
      route("/ops/warnings", "Warning alias for issues", "parser", "Parser alias"),
      route("/broker", "Dispatch", "canonical", "Clean top nav, Ops subnav, jump dock"),
      route("/mesh", "Mesh", "canonical", "Ops subnav and mesh panels"),
      route("/ops/control?no-ops", "Ops disabled fallback", "gated", "Feature flag fallback"),
    ],
  },
  {
    title: "Terminals",
    view: "terminal",
    concept: "Terminal directory, agent terminal, registered surface, and fresh terminal launch.",
    canonical: "/terminal",
    routes: [
      route("/terminal", "Terminal directory", "canonical", "Top nav and jump dock"),
      route("/terminal/:agentId", "Agent terminal", "canonical", "AgentLiveActions"),
      route("/terminal/:agentId?mode=observe|takeover", "Agent terminal mode", "query", "AgentLiveActions"),
      route("/terminal/:backend/:sessionName", "Registered terminal surface", "canonical", "terminal-relay"),
      route("/terminal/:backend/:sessionName?mode=observe|takeover", "Registered terminal mode", "query", "terminal-relay"),
      route("/terminal/new?backend=pty|tmux|zellij&agent=shell|claude|pi&name=:sessionName&tab=:tabId", "Fresh terminal launch", "query", "Terminal launch routes"),
      route("/terminal?session=:terminalSessionId&surface=:surfaceKey&mode=observe", "Legacy registered surface query", "parser", "Parser compatibility"),
    ],
  },
  {
    title: "Search, Repos, Providers, Settings",
    view: "search | repos | repo-diff | harnesses | settings",
    concept: "Knowledge search, repository state, provider setup, and app configuration.",
    canonical: "/search",
    routes: [
      route("/search", "Knowledge search", "canonical", "Top nav, ProjectsRail, jump dock"),
      route("/search/knowledge", "Knowledge search alias", "parser", "Search subnav"),
      route("/search/indexer", "Indexer", "canonical", "Search subnav"),
      route("/repos", "Repositories", "canonical", "Ops subnav and jump dock"),
      route("/repo-diff?path=:repoPath", "Repository diff", "query", "Agent and work detail links"),
      route("/repo-diff?path=:repoPath&layer=unstaged&file=:file", "Repository diff focus", "query", "Files rail"),
      route("/harnesses", "Providers", "canonical", "Ops subnav and Home gauges"),
      route("/settings", "Settings", "canonical", "Settings links"),
      route("/settings/agents", "Agent configuration index", "canonical", "Agents subnav"),
      route("/settings/agents/:agentId", "Agent configuration detail", "canonical", "SettingsScreen"),
    ],
  },
  {
    title: "Scope Namespace And Deprecated Agents",
    view: "scope routes | agents",
    concept: "Chrome-free scope URLs plus the older agent directory surface.",
    canonical: "/scope",
    routes: [
      route("/scope", "Scope default lanes", "canonical", "Scope namespace"),
      route("/scope/lanes", "Scope lanes", "canonical", "Scope namespace"),
      route("/scope/tail", "Scope tail", "canonical", "Scope namespace"),
      route("/scope/tail?q=:query", "Scope tail query", "query", "Scope namespace"),
      route("/scope/sessions", "Scope sessions", "canonical", "Scope namespace"),
      route("/scope/sessions/:sessionId", "Scope session detail", "canonical", "Scope namespace"),
      route("/scope/agents", "Scope agents", "canonical", "Scope namespace"),
      route("/scout/*", "Legacy scope redirect", "legacy", "TanStack redirect"),
      route("/agents.deprecated", "Deprecated agent directory", "legacy", "Agents secondary nav"),
      route("/agents.deprecated/:agentId", "Deprecated agent profile", "legacy", "Legacy agent library"),
      route("/agents.deprecated/:agentId/c/:conversationId", "Deprecated agent chat", "legacy", "Legacy agent library"),
    ],
  },
];

const COMPONENTS: ComponentInventory[] = [
  {
    name: "Top nav",
    file: "packages/web/client/scout/topNavConfig.ts",
    role: "Primary app sections.",
    routes: [
      route("/", "Home", "ui", "TOP_NAV_ITEMS"),
      route("/projects", "Projects", "ui", "TOP_NAV_ITEMS"),
      route("/terminal", "Terminals", "ui", "TOP_NAV_ITEMS"),
      route("/messages", "Chat", "ui", "TOP_NAV_ITEMS"),
      route("/search", "Search", "ui", "TOP_NAV_ITEMS"),
      route("/ops", "Ops", "ui", "TOP_NAV_ITEMS"),
      route("/sessions", "Sessions in lean nav", "ui", "CLEAN_TOP_NAV_ITEMS"),
      route("/ops/tail", "Tail in lean nav", "ui", "CLEAN_TOP_NAV_ITEMS"),
      route("/broker", "Dispatch in lean nav", "ui", "CLEAN_TOP_NAV_ITEMS"),
    ],
  },
  {
    name: "Secondary nav",
    file: "packages/web/client/scout/secondaryNavConfig.ts",
    role: "Section-level navigation under Projects, Chat, Search, and Ops.",
    routes: [
      route("/projects", "Projects", "ui", "AGENTS_SECONDARY_NAV"),
      route("/agents.deprecated", "Directory .deprecated", "legacy", "AGENTS_SECONDARY_NAV"),
      route("/sessions", "Sessions", "ui", "AGENTS_SECONDARY_NAV"),
      route("/settings/agents", "Config", "ui", "AGENTS_SECONDARY_NAV"),
      route("/messages", "Messages", "ui", "CHAT_SECONDARY_NAV"),
      route("/channels", "Channels", "ui", "CHAT_SECONDARY_NAV"),
      route("/search", "Knowledge", "ui", "SEARCH_SECONDARY_NAV"),
      route("/search/indexer", "Indexer", "ui", "SEARCH_SECONDARY_NAV"),
      route("/ops/lanes", "Lanes", "ui", "OPS_SECONDARY_NAV"),
      route("/ops/control", "Control", "ui", "OPS_SECONDARY_NAV"),
      route("/broker", "Dispatch", "ui", "OPS_SECONDARY_NAV"),
      route("/repos", "Repos", "ui", "OPS_SECONDARY_NAV"),
      route("/harnesses", "Providers", "ui", "OPS_SECONDARY_NAV"),
      route("/mesh", "Mesh", "ui", "OPS_SECONDARY_NAV"),
      route("/ops/tail", "Tail", "ui", "OPS_SECONDARY_NAV"),
      route("/ops/atop", "Runtime", "ui", "OPS_SECONDARY_NAV"),
      route("/ops/plan", "Plans", "ui", "OPS_SECONDARY_NAV"),
    ],
  },
  {
    name: "Global jump dock",
    file: "packages/web/client/scout/slots/GlobalJumpDock.tsx",
    role: "Persistent quick jumps.",
    routes: [
      route("/sessions", "Sessions", "ui", "JUMPS"),
      route("/terminal", "Terminals", "ui", "JUMPS"),
      route("/repos", "Repos", "ui", "JUMPS"),
      route("/search", "Search", "ui", "JUMPS"),
      route("/ops/tail", "Tail", "ui", "JUMPS"),
      route("/ops/control", "Ops", "gated", "JUMPS"),
      route("/", "Home", "ui", "JUMPS"),
      route("/broker", "Dispatch", "ui", "JUMPS"),
    ],
  },
  {
    name: "Projects rail and inbox",
    file: "packages/web/client/screens/projects",
    role: "Project picker, smart views, thread click resolution, and search affordance.",
    routes: [
      route("/projects", "Smart view reset", "ui", "ProjectsRail.selectSmartView"),
      route("/projects/:projectSlug", "Open project", "ui", "ProjectsRail.openProject"),
      route("/search", "Search agents and sessions", "ui", "ProjectsRail footer"),
      route("/sessions/:sessionId", "Native session thread", "ui", "threadOpenRoute"),
      route("/c/:conversationId", "Conversation thread", "ui", "threadOpenRoute"),
      route("/projects/:projectSlug/agents/:agentId", "Agent thread", "ui", "openProjectAgentProfile"),
    ],
  },
  {
    name: "Project sessions panel",
    file: "packages/web/client/screens/projects/ProjectSessionsPanel.tsx",
    role: "Agent session selection and terminal engagement.",
    routes: [
      route("/projects/:projectSlug/agents/:agentId/sessions/:sessionId", "Select session in profile", "ui", "selectSession"),
      route("/sessions/:sessionId", "Resume session", "ui", "resumeSession"),
      route("/terminal/:agentId?mode=observe", "Observe terminal", "ui", "observeTerminal"),
      route("/terminal/:agentId?mode=takeover", "Take over terminal", "ui", "takeoverTerminal"),
      route("/projects/:projectSlug/agents/:agentId?tab=observe", "Trace tab", "ui", "onTrace"),
      route("/projects/:projectSlug/agents/:agentId/c/:conversationId", "Continue chat", "ui", "openMessage"),
    ],
  },
  {
    name: "Agent actions and profiles",
    file: "packages/web/client/components/AgentLiveActions.tsx + screens/agents/profile.tsx",
    role: "Agent profile, observe, terminal, repo diff, and session actions.",
    routes: [
      route("/agents/:agentId", "Agent profile", "ui", "AgentHoverCard and profile bars"),
      route("/agents/:agentId?tab=observe", "Observe tab", "ui", "AgentLiveActions"),
      route("/agents/:agentId?tab=config", "Config tab", "ui", "AgentConfigurationScreen"),
      route("/agents/:agentId/c/:conversationId", "Message tab", "ui", "Agent profile message action"),
      route("/sessions/:sessionId", "Open session", "ui", "AgentSessions"),
      route("/terminal/:agentId?mode=observe", "Observe terminal", "ui", "AgentLiveActions"),
      route("/terminal/:agentId?mode=takeover", "Take over terminal", "ui", "AgentLiveActions"),
      route("/repo-diff?path=:repoPath&agentId=:agentId", "Open repo diff", "query", "Agent detail"),
    ],
  },
  {
    name: "Chat surfaces",
    file: "packages/web/client/screens/chat",
    role: "Conversation, channel, and participant navigation.",
    routes: [
      route("/messages", "Conversation list", "ui", "MessagesScreen"),
      route("/messages/:conversationId", "Selected message row", "ui", "Chat left rail"),
      route("/c/:conversationId", "Open conversation", "ui", "ConversationPanels"),
      route("/c/:conversationId?compose=ask", "Ask compose", "query", "ConversationScreen"),
      route("/channels", "Channel list", "ui", "Chat subnav"),
      route("/channels/:channelId", "Open channel", "ui", "Channels left rail"),
      route("/agent/:conversationId", "Agent info from header", "ui", "ConversationHeader"),
      route("/agents/:agentId", "Participant agent profile", "ui", "ConversationPanels"),
      route("/work/:workId", "Run work detail", "ui", "channels-right"),
      route("/follow?flightId=:flightId&view=chat", "Follow flight from chat", "query", "channels-right"),
    ],
  },
  {
    name: "Home and Ops panels",
    file: "packages/web/client/screens/home + screens/ops",
    role: "Operational drilldowns from dashboard, lanes, tail, plans, and inspectors.",
    routes: [
      route("/mesh", "Open mesh", "ui", "Home content"),
      route("/harnesses", "Open providers", "ui", "HomeHero"),
      route("/ops/tail", "Open tail", "ui", "Home content and Ops nav"),
      route("/ops/tail?q=:query", "Focused tail query", "query", "left-mission and WorkDetailScreen"),
      route("/ops/plan", "Plans", "ui", "PlanView"),
      route("/ops/plan?plan=:planDocumentId", "Plan document", "query", "AgentLaneDetailSheet"),
      route("/work/:workId", "Work detail", "ui", "Ops inspector and WorkList"),
      route("/c/:conversationId", "Conversation detail", "ui", "Ops inspector"),
      route("/agents/:agentId", "Agent detail", "ui", "Ops inspector and lanes"),
      route("/sessions/:sessionId?agentId=:agentId", "Lane trace session", "query", "agent-lane-navigation"),
    ],
  },
  {
    name: "Router and route tree",
    file: "packages/web/client/lib/router.ts + router/tanstack/route-tree.ts",
    role: "Canonical parse/serialize contract and explicit TanStack prefixes.",
    routes: [
      route("/scope/*", "Scope namespace", "canonical", "parseScopeRouteFromUrl"),
      route("/projects/*", "Project registry routes", "canonical", "ADOPTED_SCOUT_PREFIXES"),
      route("/agents/*", "Canonical agent detail routes", "canonical", "ADOPTED_SCOUT_PREFIXES"),
      route("/sessions/*", "Session routes", "canonical", "ADOPTED_SCOUT_PREFIXES"),
      route("/messages/*", "Messages routes", "canonical", "ADOPTED_SCOUT_PREFIXES"),
      route("/terminal/*", "Terminal routes", "canonical", "ADOPTED_SCOUT_PREFIXES"),
      route("/ops/*", "Ops splat routes", "parser", "routeFromUrl fallback"),
      route("/repo-diff?path=:repoPath", "Repo diff splat route", "query", "routeFromUrl fallback"),
      route("/scout/*", "Legacy scope redirect", "legacy", "scoutLegacyRoute"),
    ],
  },
];

const NOTES = [
  ["Resource-shaped", "Projects, agents, sessions, messages, channels, work, settings/agents, and briefings read as resource routes."],
  ["Mode-shaped", "Ops and terminal URLs are operational modes. They are app surfaces, not pure REST resources."],
  ["Compatibility-shaped", "agents-v2, agents.deprecated, scout, and follow path forms remain parser inputs while serializers prefer canonical shapes."],
  ["Session cleanup", "Standalone session observe stays under /sessions/:sessionId; optional agent context rides as agentId query metadata."],
];

const pageRouteCount = PAGES.reduce((sum, page) => sum + page.routes.length, 0);
const componentRouteCount = COMPONENTS.reduce((sum, component) => sum + component.routes.length, 0);
const uniqueRouteCount = new Set([
  ...PAGES.flatMap((page) => page.routes.map((item) => item.path)),
  ...COMPONENTS.flatMap((component) => component.routes.map((item) => item.path)),
]).size;

export default function RouteInventoryPage() {
  return (
    <main className="mx-auto max-w-[1500px] px-7 py-8">
      <header className="mb-8 border-b border-studio-edge pb-5">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          meta / route inventory
        </div>
        <div className="mt-2 grid gap-5 lg:grid-cols-[minmax(0,1fr)_520px]">
          <div>
            <h1 className="font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
              OpenScout route inventory
            </h1>
            <p className="mt-3 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
              Pages, canonical URL structures, compatibility routes, and the UI
              components that offer navigation into them.
            </p>
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-studio-edge bg-studio-surface md:grid-cols-4">
            <Metric label="pages" value={PAGES.length} />
            <Metric label="page routes" value={pageRouteCount} />
            <Metric label="components" value={COMPONENTS.length} />
            <Metric label="unique shapes" value={uniqueRouteCount} />
          </div>
        </div>
      </header>

      <section className="mb-8 grid gap-3 lg:grid-cols-4">
        {NOTES.map(([title, body]) => (
          <article key={title} className="rounded-md border border-studio-edge bg-studio-surface p-4">
            <h2 className="font-sans text-[13px] font-semibold text-studio-ink">{title}</h2>
            <p className="mt-2 font-sans text-[12px] leading-relaxed text-studio-ink-faint">{body}</p>
          </article>
        ))}
      </section>

      <InventorySection title="Pages" count={`${pageRouteCount} route shapes`}>
        <div className="grid gap-4 xl:grid-cols-2">
          {PAGES.map((page) => (
            <article key={page.title} className="overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
              <div className="grid gap-3 border-b border-studio-edge p-4 md:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-studio-ink-faint">
                    {page.view}
                  </div>
                  <h2 className="mt-1 font-display text-[20px] font-medium leading-tight text-studio-ink">
                    {page.title}
                  </h2>
                  <p className="mt-2 font-sans text-[12px] leading-relaxed text-studio-ink-faint">
                    {page.concept}
                  </p>
                </div>
                <code className="h-fit rounded-sm border border-studio-edge bg-code-bg px-2 py-1 font-mono text-[11px] text-studio-ink">
                  {page.canonical}
                </code>
              </div>
              <RouteList routes={page.routes} />
            </article>
          ))}
        </div>
      </InventorySection>

      <InventorySection title="Components" count={`${componentRouteCount} offered links`}>
        <div className="grid gap-4 xl:grid-cols-2">
          {COMPONENTS.map((component) => (
            <article key={component.name} className="overflow-hidden rounded-md border border-studio-edge bg-studio-surface">
              <div className="border-b border-studio-edge p-4">
                <div className="font-mono text-[9px] tracking-[0.12em] text-studio-ink-faint">
                  {component.file}
                </div>
                <h2 className="mt-1 font-display text-[19px] font-medium leading-tight text-studio-ink">
                  {component.name}
                </h2>
                <p className="mt-2 font-sans text-[12px] leading-relaxed text-studio-ink-faint">
                  {component.role}
                </p>
              </div>
              <RouteList routes={component.routes} compact />
            </article>
          ))}
        </div>
      </InventorySection>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-r border-studio-edge p-4 md:border-b-0">
      <div className="font-mono text-[24px] leading-none text-studio-ink">{value}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-studio-ink-faint">{label}</div>
    </div>
  );
}

function InventorySection({
  title,
  count,
  children,
}: {
  title: string;
  count: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-3 border-b border-studio-edge pb-2">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          {title}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.20em] text-studio-ink-faint">
          {count}
        </div>
      </div>
      {children}
    </section>
  );
}

function RouteList({ routes, compact = false }: { routes: RouteItem[]; compact?: boolean }) {
  return (
    <ul className="divide-y divide-studio-edge">
      {routes.map((item) => (
        <li
          key={`${item.path}:${item.label}:${item.source}`}
          className={`grid gap-2 p-3 ${compact ? "md:grid-cols-[86px_minmax(0,1fr)]" : "md:grid-cols-[92px_minmax(180px,1.1fr)_minmax(130px,0.8fr)_minmax(120px,0.8fr)]"}`}
        >
          <span className={`h-fit w-fit rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] ${kindClass(item.kind)}`}>
            {KIND_LABEL[item.kind]}
          </span>
          <code className="break-words font-mono text-[11px] leading-relaxed text-studio-ink">
            {item.path}
          </code>
          <span className="font-sans text-[12px] leading-relaxed text-studio-ink-muted">
            {item.label}
          </span>
          <span className="break-words font-mono text-[9px] leading-relaxed text-studio-ink-faint">
            {item.source}
          </span>
          {item.note ? (
            <span className="md:col-start-2 md:col-end-5 font-sans text-[11px] leading-relaxed text-studio-ink-faint">
              {item.note}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function kindClass(kind: RouteKind): string {
  switch (kind) {
    case "canonical":
    case "ui":
      return "border-[color:var(--scout-accent)] text-[color:var(--scout-accent)]";
    case "query":
      return "border-status-warn-fg text-status-warn-fg";
    case "legacy":
    case "parser":
    case "gated":
      return "border-studio-edge-strong text-studio-ink-faint";
  }
}
