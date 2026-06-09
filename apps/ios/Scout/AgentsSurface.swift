import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Agents — the bridge's full directory as a **project navigator**. Each row is
/// the agent's coordinate (project / name / session). Two orderings: a **project
/// tree** (agents nest under their project; a solo project collapses to one
/// inline row) or **most-recent** (a flat list by last activity). State is a
/// quiet per-row dot — only *live* lights up; no repeated badges, no harness
/// color-coding (harness is a muted token). Tapping an agent with a live session
/// opens it; tapping a project — or a dormant agent — opens project info with a
/// launcher to start a fresh session on the harness/model of your choice.
struct AgentsSurface: View {
    let client: any ScoutBrokerClient
    var reloadToken: Int = 0
    /// Publishes the pushed conversation's runtime/project/model context into
    /// the global protected-area status bar.
    var onConversationStatusContext: (String?) -> Void = { _ in }

    @State private var agents: [AgentSummary] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var sort: SortMode = Self.initialSort
    @State private var route: ConversationRoute?
    @State private var projectSheet: ProjectNode?
    @State private var didDebugOpen = false

    enum SortMode: String, CaseIterable, Identifiable {
        case project, recent
        var id: String { rawValue }
        var label: String { self == .project ? "PROJECT" : "RECENT" }
    }

    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    /// Default ordering; in DEBUG a `SCOUT_AGENT_SORT=recent` env jumps the
    /// simulator straight to a mode so it can be verified without touch input.
    private static var initialSort: SortMode {
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["SCOUT_AGENT_SORT"],
           let m = SortMode(rawValue: raw) { return m }
        #endif
        return .project
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                HudField("Search agents", text: $searchText, icon: "magnifyingglass")
                    .padding(.horizontal, HudSpacing.xxl)
                    .padding(.top, HudSpacing.lg)
                    .padding(.bottom, HudSpacing.md)

                if isLoading {
                    HudEmptyState(title: "Loading agents", icon: "person.2")
                        .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
                } else if agents.isEmpty {
                    HudEmptyState(title: "No agents", subtitle: "Connect to your Mac to see the directory.", icon: "person.2.slash")
                        .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
                } else {
                    summaryBar
                    content
                }
            }
        }
        .refreshable { await load() }
        .task(id: reloadToken) { await load(); openDebugProjectIfRequested() }
        .navigationDestination(item: $route) { route in
            ConversationSurface(
                client: client,
                conversationId: route.id,
                title: route.title,
                onClose: { self.route = nil },
                onStatusContextChange: onConversationStatusContext
            )
        }
        .sheet(item: $projectSheet) { node in
            ProjectDetailSheet(
                node: node,
                client: client,
                onOpenSession: { agent in projectSheet = nil; openSession(agent) },
                onStarted: { conversationId, title in
                    projectSheet = nil
                    route = ConversationRoute(id: conversationId, title: title)
                }
            )
        }
    }

    // MARK: - Summary + sort

    /// One chrome row: the count on the left, the sort toggle on the right —
    /// integrated, not stacked into its own strip.
    private var summaryBar: some View {
        let live = agents.filter { $0.state == .live }.count
        let text = live > 0
            ? "\(visibleAgents.count) agents · \(live) live"
            : "\(visibleAgents.count) agents · \(projects.count) projects"
        return HStack(alignment: .firstTextBaseline) {
            HudSectionLabel(text.uppercased())
            Spacer(minLength: HudSpacing.md)
            SortToggle(sort: $sort)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.bottom, HudSpacing.sm)
    }

    @ViewBuilder
    private var content: some View {
        if visibleAgents.isEmpty {
            HudEmptyState(title: "No matches", subtitle: "Nothing matches “\(searchText)”.", icon: "magnifyingglass")
                .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
        } else if sort == .project {
            ForEach(projects) { project in
                ProjectSection(
                    project: project,
                    onOpenProject: { projectSheet = $0 },
                    onTapAgent: tapAgent
                )
            }
        } else {
            // Most-recent: a flat list, newest first. The name + harness + age is
            // the identity here; we don't repeat the project (that's PROJECT mode's
            // job) — the second line only appears when the agent is on a branch.
            ForEach(Array(recents.enumerated()), id: \.element.id) { idx, agent in
                AgentRow(
                    agent: agent,
                    connector: nil,
                    showProject: false,
                    onTap: { tapAgent(agent) }
                )
                if idx < recents.count - 1 { rowDivider }
            }
        }
    }

    private var rowDivider: some View {
        Rectangle().fill(HudPalette.ink.opacity(0.06)).frame(height: 0.5)
            .padding(.leading, HudSpacing.xxl)
    }

    // MARK: - Routing

    /// Live session → open it. No session → there's nothing to resume, so land on
    /// the project (info + a launcher to start one).
    private func tapAgent(_ agent: AgentSummary) {
        if agent.sessionId != nil {
            openSession(agent)
        } else {
            projectSheet = projectNode(for: agent)
        }
    }

    private func openSession(_ agent: AgentSummary) {
        // Route by the agent's real broker conversation (its operator DM), NOT
        // `sessionId` — that's a harness label (e.g. "relay-openscout-claude"),
        // shared across agents, that resolves to no conversation. Fall back to the
        // canonical `dm.operator.<id>` the broker creates on first send.
        let conversationId = agent.conversationId ?? "dm.operator.\(agent.id)"
        route = ConversationRoute(id: conversationId, title: agent.title)
    }

    // MARK: - Grouping / ordering

    private var visibleAgents: [AgentSummary] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return agents }
        return agents.filter { a in
            [a.title, a.projectName, a.harness, a.statusLabel, a.branch]
                .compactMap { $0?.lowercased() }.contains { $0.contains(q) }
        }
    }

    private var projects: [ProjectNode] {
        let grouped = Dictionary(grouping: visibleAgents) { projectKey($0) }
        return grouped
            .map { key, value in ProjectNode(id: key, name: key, agents: value.sorted(by: Self.agentOrder)) }
            .sorted(by: Self.projectOrder)
    }

    private var recents: [AgentSummary] {
        visibleAgents.sorted { lhs, rhs in
            if (lhs.state == .live) != (rhs.state == .live) { return lhs.state == .live }
            let l = lhs.lastActiveAt ?? .distantPast
            let r = rhs.lastActiveAt ?? .distantPast
            if l != r { return l > r }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    private func projectKey(_ a: AgentSummary) -> String {
        displayProjectName(a.projectName) ?? a.title
    }

    private func projectNode(for agent: AgentSummary) -> ProjectNode {
        let key = projectKey(agent)
        let members = agents.filter { projectKey($0) == key }.sorted(by: Self.agentOrder)
        return ProjectNode(id: key, name: key, agents: members)
    }

    private static func agentOrder(_ a: AgentSummary, _ b: AgentSummary) -> Bool {
        if (a.state == .live) != (b.state == .live) { return a.state == .live }
        let l = a.lastActiveAt ?? .distantPast
        let r = b.lastActiveAt ?? .distantPast
        if l != r { return l > r }
        return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
    }

    private static func projectOrder(_ a: ProjectNode, _ b: ProjectNode) -> Bool {
        if a.hasLive != b.hasLive { return a.hasLive }
        return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    private func load() async {
        isLoading = true
        agents = (try? await client.listAgents(query: nil, limit: 100)) ?? []
        isLoading = false
    }

    /// DEBUG-only: `SCOUT_OPEN_PROJECT=<name>` auto-presents that project's
    /// detail sheet on the simulator so the launcher can be seen without touch.
    private func openDebugProjectIfRequested() {
        #if DEBUG
        guard !didDebugOpen,
              let want = ProcessInfo.processInfo.environment["SCOUT_OPEN_PROJECT"]?.lowercased(),
              !want.isEmpty else { return }
        // Only latch once we've actually matched — the first (pre-connect) load
        // has no agents yet, so keep trying until data arrives.
        if let node = projects.first(where: { $0.name.lowercased() == want })
            ?? projects.first(where: { $0.name.lowercased().contains(want) }) {
            didDebugOpen = true
            projectSheet = node
        }
        #endif
    }
}

// MARK: - Model

struct ProjectNode: Identifiable, Hashable {
    let id: String
    let name: String
    let agents: [AgentSummary]
    var hasLive: Bool { agents.contains { $0.state == .live } }
    var liveCount: Int { agents.filter { $0.state == .live }.count }
    /// Best-effort local checkout path for the project (the workspace lives under
    /// ~/dev). Editable in the launcher before starting a session.
    var guessedPath: String { "/Users/arach/dev/\(name)" }

    static func == (lhs: ProjectNode, rhs: ProjectNode) -> Bool { lhs.id == rhs.id && lhs.agents == rhs.agents }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - Sort toggle

private struct SortToggle: View {
    @Binding var sort: AgentsSurface.SortMode

    var body: some View {
        HStack(spacing: 2) {
            ForEach(AgentsSurface.SortMode.allCases) { mode in
                Button { sort = mode } label: {
                    Text(mode.label)
                        .font(HudFont.mono(HudTextSize.micro, weight: sort == mode ? .bold : .regular))
                        .tracking(0.6)
                        .foregroundStyle(sort == mode ? HudPalette.accent : HudPalette.muted)
                        .padding(.horizontal, HudSpacing.sm)
                        .padding(.vertical, 3)
                        .background(
                            Capsule().fill(sort == mode ? HudPalette.accent.opacity(0.12) : .clear)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Project section (tree)

private struct ProjectSection: View {
    let project: ProjectNode
    let onOpenProject: (ProjectNode) -> Void
    let onTapAgent: (AgentSummary) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if project.agents.count == 1 {
                AgentRow(agent: project.agents[0], connector: nil, showProject: false) {
                    onTapAgent(project.agents[0])
                }
            } else {
                ProjectHeaderRow(project: project) { onOpenProject(project) }
                ForEach(Array(project.agents.enumerated()), id: \.element.id) { idx, agent in
                    AgentRow(
                        agent: agent,
                        connector: AgentRow.Connector(isLast: idx == project.agents.count - 1),
                        showProject: false
                    ) { onTapAgent(agent) }
                }
            }
            Rectangle().fill(HudPalette.ink.opacity(0.06)).frame(height: 0.5)
                .padding(.leading, HudSpacing.xxl)
        }
    }
}

// MARK: - Rows

private struct ProjectHeaderRow: View {
    let project: ProjectNode
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HudSpacing.md) {
                ProjectGlyph()
                    .foregroundStyle(HudPalette.muted)
                    .frame(width: 13, height: 13)
                Text(project.name)
                    .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: HudSpacing.sm)
                if project.liveCount > 0 {
                    HudStatusDot(color: HudPalette.accent, size: 5, pulses: true)
                }
                Text("\(project.agents.count)")
                    .font(HudFont.mono(HudTextSize.xs)).monospacedDigit()
                    .foregroundStyle(HudPalette.muted)
                Glyphic.chevron(.trailing, size: 13)
                    .foregroundStyle(HudPalette.dim)
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.top, HudSpacing.lg)
            .padding(.bottom, HudSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct AgentRow: View {
    let agent: AgentSummary
    /// Non-nil ⇒ a leaf under a multi-agent project (tree rail + indent).
    let connector: Connector?
    /// When set, prepends the project to the session line — only useful where no
    /// header carries it. Recent mode leaves this off (name + age is enough).
    var showProject: Bool = false
    let onTap: () -> Void

    struct Connector { let isLast: Bool }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HudSpacing.md) {
                if let connector {
                    TreeConnector(isLast: connector.isLast)
                        .stroke(HudHairline.standard, style: StrokeStyle(lineWidth: 1, lineCap: .round))
                        .frame(width: HudSpacing.xl)
                        .frame(maxHeight: .infinity)
                }
                AgentStateDot(state: agent.state).frame(width: 8)
                VStack(alignment: .leading, spacing: 1) {
                    Text(agent.title)
                        .font(HudFont.ui(HudTextSize.base, weight: connector == nil ? .medium : .regular))
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1).truncationMode(.tail)
                    if let session = sessionLine {
                        Text(session)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(HudPalette.muted)
                            .lineLimit(1).truncationMode(.middle)
                    }
                }
                Spacer(minLength: HudSpacing.sm)
                if let age = relativeAge(agent.lastActiveAt) {
                    Text(age)
                        .font(HudFont.mono(HudTextSize.micro)).monospacedDigit()
                        .foregroundStyle(HudPalette.dim)
                }
                if let harness = agent.harness, !harness.isEmpty {
                    Text(harness.lowercased())
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.muted)
                }
            }
            .padding(.leading, connector == nil ? HudSpacing.xxl : HudSpacing.lg)
            .padding(.trailing, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The session coordinate beneath the name: the working branch when the agent
    /// is on one (recency is already shown as the age on the right — no point
    /// repeating the idle "Available" status). With `showProject`, the project is
    /// prefixed for rows that have no header to carry it.
    private var sessionLine: String? {
        let branch = agent.branch.flatMap { $0.isEmpty ? nil : $0 }
        let parts = [showProject ? displayProjectName(agent.projectName) : nil, branch].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - State dot

private struct AgentStateDot: View {
    let state: AgentSummary.State

    var body: some View {
        switch state {
        case .live:
            HudStatusDot(color: HudPalette.accent, size: 6, pulses: true)
        case .idle:
            Circle().fill(HudPalette.muted).frame(width: 5, height: 5)
        case .offline, .unknown:
            Circle().stroke(HudPalette.dim, lineWidth: 1).frame(width: 5, height: 5)
        }
    }
}

// MARK: - Project detail + session launcher

/// Tapping a project (or a dormant agent) lands here: what's in the project, and
/// a launcher to start a fresh session on the harness/model of your choice.
private struct ProjectDetailSheet: View {
    let node: ProjectNode
    let client: any ScoutBrokerClient
    let onOpenSession: (AgentSummary) -> Void
    let onStarted: (_ conversationId: String, _ title: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var harness: String = "claude"
    @State private var model: String = ""
    @State private var path: String
    @State private var instructions: String = ""
    @State private var isStarting = false
    @State private var errorText: String?

    private static let harnesses = ["claude", "codex"]

    init(node: ProjectNode, client: any ScoutBrokerClient,
         onOpenSession: @escaping (AgentSummary) -> Void,
         onStarted: @escaping (String, String) -> Void) {
        self.node = node
        self.client = client
        self.onOpenSession = onOpenSession
        self.onStarted = onStarted
        _path = State(initialValue: node.guessedPath)
        // Default the harness to whatever the project already runs most.
        let common = Dictionary(grouping: node.agents.compactMap { $0.harness?.lowercased() }, by: { $0 })
            .max { $0.value.count < $1.value.count }?.key
        _harness = State(initialValue: common ?? "claude")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                    agentsSection
                    launcherSection
                    if let errorText {
                        Text(errorText)
                            .font(HudFont.mono(HudTextSize.xs))
                            .foregroundStyle(HudPalette.statusError)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(HudSpacing.xxl)
            }
            .background(HudPalette.bg)
            .navigationTitle(node.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(HudPalette.muted)
                }
            }
        }
    }

    private var agentsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HudSectionLabel("\(node.agents.count) AGENTS")
            ForEach(node.agents) { agent in
                Button { onOpenSession(agent) } label: {
                    HStack(spacing: HudSpacing.md) {
                        AgentStateDot(state: agent.state).frame(width: 8)
                        Text(agent.title)
                            .font(HudFont.ui(HudTextSize.base, weight: .medium))
                            .foregroundStyle(HudPalette.ink)
                        Spacer(minLength: HudSpacing.sm)
                        if let h = agent.harness { Text(h.lowercased()).font(HudFont.mono(HudTextSize.xs)).foregroundStyle(HudPalette.muted) }
                        if agent.sessionId != nil {
                            Glyphic.chevron(.trailing, size: 13).foregroundStyle(HudPalette.dim)
                        }
                    }
                    .padding(.vertical, HudSpacing.sm)
                    .contentShape(Rectangle())
                    .opacity(agent.sessionId != nil ? 1 : HudOpacity.muted)
                }
                .buttonStyle(.plain)
                .disabled(agent.sessionId == nil)
            }
        }
    }

    private var launcherSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("START A SESSION")

            // Harness
            HStack(spacing: HudSpacing.sm) {
                ForEach(Self.harnesses, id: \.self) { h in
                    Button { harness = h } label: {
                        Text(h)
                            .font(HudFont.mono(HudTextSize.sm, weight: harness == h ? .bold : .regular))
                            .foregroundStyle(harness == h ? HudPalette.bg : HudPalette.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, HudSpacing.md)
                            .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .fill(harness == h ? HudPalette.accent : HudSurface.inset))
                    }
                    .buttonStyle(.plain)
                }
            }

            HudField("Model (optional)", text: $model, icon: "cpu")
            HudField("Project path", text: $path, icon: "folder")

            TextEditor(text: $instructions)
                .font(HudFont.ui(HudTextSize.base))
                .foregroundStyle(HudPalette.ink)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 88)
                .padding(HudSpacing.md)
                .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
                .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard))
                .overlay(alignment: .topLeading) {
                    if instructions.isEmpty {
                        Text("First instruction (optional)…")
                            .font(HudFont.ui(HudTextSize.base))
                            .foregroundStyle(HudPalette.dim)
                            .padding(.horizontal, HudSpacing.md + 4)
                            .padding(.vertical, HudSpacing.md + 8)
                            .allowsHitTesting(false)
                    }
                }

            HStack {
                if isStarting { ProgressView().controlSize(.small) }
                Spacer()
                HudButton("Start \(harness)", icon: "paperplane.fill", style: .primary(.green)) { start() }
                    .disabled(isStarting || path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func start() {
        let trimmedPath = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPath.isEmpty, !isStarting else { return }
        isStarting = true
        errorText = nil
        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedInstr = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        let spec = SessionInitiationSpec(
            target: .init(projectPath: trimmedPath),
            execution: .init(
                harness: harness,
                model: trimmedModel.isEmpty ? nil : trimmedModel,
                session: .new
            ),
            agent: .init(persistence: "sticky"),
            seed: .init(instructions: trimmedInstr.isEmpty ? nil : trimmedInstr)
        )
        Task {
            do {
                let outcome = try await client.startSession(spec)
                isStarting = false
                if let conversationId = outcome.conversationId {
                    onStarted(conversationId, node.name)
                } else {
                    errorText = "Session started, but no conversation was returned."
                }
            } catch {
                isStarting = false
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

// MARK: - Hand-drawn glyphs (not SF Symbols)

/// A compact 2×2-dot "workspace" mark anchoring a project header.
private struct ProjectGlyph: View {
    var body: some View {
        VStack(spacing: 3) {
            HStack(spacing: 3) { dot; dot }
            HStack(spacing: 3) { dot; dot }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    private var dot: some View { Circle().frame(width: 3, height: 3) }
}

/// Tree rail connecting a project's agent leaves: a vertical line with a tick
/// into each row; the last leaf elbows (`└`) so the rail doesn't dangle.
private struct TreeConnector: Shape {
    let isLast: Bool
    func path(in r: CGRect) -> Path {
        var p = Path()
        let x = r.minX + 1
        let midY = r.midY
        p.move(to: CGPoint(x: x, y: r.minY))
        p.addLine(to: CGPoint(x: x, y: isLast ? midY : r.maxY))
        p.move(to: CGPoint(x: x, y: midY))
        p.addLine(to: CGPoint(x: r.maxX, y: midY))
        return p
    }
}

// MARK: - Shared

/// A human project label, or nil when the field is empty or an opaque id — a
/// UUID where a name should be (a broker-side data gap we don't surface as a
/// "project"; such agents fall back to grouping under their own name).
func displayProjectName(_ raw: String?) -> String? {
    guard let p = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty else { return nil }
    let uuid = #"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"#
    if p.range(of: uuid, options: .regularExpression) != nil { return nil }
    return p
}

/// Compact relative age ("now" / "3m" / "2h" / "1d") for a row's right edge.
private func relativeAge(_ date: Date?) -> String? {
    guard let date else { return nil }
    let s = max(0, Int(Date().timeIntervalSince(date)))
    if s < 60 { return "now" }
    if s < 3600 { return "\(s / 60)m" }
    if s < 86_400 { return "\(s / 3600)h" }
    return "\(s / 86_400)d"
}
