import HudsonUI
import SwiftUI

enum ScoutAgentsTreeSort {
    case alpha
    case recent
}

/// The Agents view as the fleet's real hierarchy — **project → agent →
/// session** — replacing the flat card grid. Keyboard-first (the window-level
/// chords in `ScoutRootView` drive it: `j/k` move, `h/l` fold, `g/⇧G` edges,
/// `⌘O` observe, `⌘↩` open); the trailing inspector slaves to the cursor.
///
/// The view is purely presentational: expansion + selection live in
/// `ScoutAgentsTreeModel`, and selection is pushed into `ScoutCommsStore`
/// (`selectAgent`) so the existing inspector follows along untouched.
///
/// Ported from the studio prototype `design/studio/app/studies/agents-tree`.

// MARK: - Model

@MainActor
final class ScoutAgentsTreeModel: ObservableObject {
    /// Projects default to expanded (empty = none collapsed); agents default to
    /// collapsed (empty = none expanded) so the tree opens at project→agent.
    @Published var collapsedProjects: Set<String> = []
    @Published var expandedAgents: Set<String> = []

    @Published private(set) var selectedID: String?
    @Published private(set) var selectedProjectKey: String?
    @Published private(set) var selectedAgentID: String?
    @Published private(set) var selectedSessionCId: String?

    struct ProjectGroup: Identifiable {
        let key: String
        let label: String
        let path: String
        let agents: [ScoutAgent]
        let sessions: [String: [ScoutChannel]]
        let live: Int
        var id: String { key }
    }

    struct Row: Identifiable, Equatable {
        enum Kind: Equatable {
            case project(String)
            case agent(String)
            case session(agent: String, cId: String)
        }

        let kind: Kind
        let depth: Int

        var id: String {
            switch kind {
            case .project(let k): return "p:\(k)"
            case .agent(let a): return "a:\(a)"
            case .session(_, let c): return "s:\(c)"
            }
        }

        var collapsible: Bool {
            if case .session = kind { return false }
            return true
        }

        var agentID: String? {
            switch kind {
            case .agent(let a): return a
            case .session(let a, _): return a
            case .project: return nil
            }
        }

        var sessionCId: String? {
            if case .session(_, let c) = kind { return c }
            return nil
        }

        var projectKey: String? {
            if case .project(let k) = kind { return k }
            return nil
        }
    }

    // MARK: Grouping

    /// Fold the flat roster into project groups keyed by workspace, with each
    /// agent's conversations as its sessions.
    static func groups(agents: [ScoutAgent], channels: [ScoutChannel]) -> [ProjectGroup] {
        func label(for agent: ScoutAgent) -> String {
            if let project = agent.project?.nilIfEmpty { return project }
            let workspace = agent.workspace
            if workspace == "—" { return "ungrouped" }
            return workspace.split(separator: "/").last.map(String.init) ?? workspace
        }

        var order: [String] = []
        var byKey: [String: [ScoutAgent]] = [:]
        var labelByKey: [String: String] = [:]
        var pathByKey: [String: String] = [:]
        for agent in agents {
            let key = agent.workspace
            if byKey[key] == nil {
                order.append(key)
                labelByKey[key] = label(for: agent)
                pathByKey[key] = agent.workspace
            }
            byKey[key, default: []].append(agent)
        }

        return order.map { key in
            let groupAgents = (byKey[key] ?? []).sorted {
                $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
            }
            var sessions: [String: [ScoutChannel]] = [:]
            for agent in groupAgents {
                let convos = channels
                    .filter { $0.agentId == agent.id }
                    .sorted { ($0.lastMessageAt ?? 0) > ($1.lastMessageAt ?? 0) }
                if !convos.isEmpty { sessions[agent.id] = convos }
            }
            let live = groupAgents.filter { $0.state == .working || $0.state == .needsAttention }.count
            return ProjectGroup(
                key: key,
                label: labelByKey[key] ?? key,
                path: pathByKey[key] ?? key,
                agents: groupAgents,
                sessions: sessions,
                live: live
            )
        }
        .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    /// Flatten the groups into the visible-row list keyboard nav walks.
    func rows(_ groups: [ProjectGroup], showProjects: Bool = true, sort: ScoutAgentsTreeSort = .alpha) -> [Row] {
        var out: [Row] = []
        for group in groups {
            if showProjects {
                out.append(Row(kind: .project(group.key), depth: 0))
                if collapsedProjects.contains(group.key) { continue }

                var children: [(row: Row, recency: TimeInterval, rank: Int, label: String)] = []
                for agent in group.agents {
                    children.append((
                        row: Row(kind: .agent(agent.id), depth: 1),
                        recency: agent.updatedAt ?? 0,
                        rank: 0,
                        label: agent.displayName
                    ))
                }
                for (agentID, channels) in group.sessions {
                    for channel in channels {
                        children.append((
                            row: Row(kind: .session(agent: agentID, cId: channel.cId), depth: 1),
                            recency: channel.lastMessageAt ?? 0,
                            rank: 1,
                            label: channel.rowTitle
                        ))
                    }
                }
                out.append(contentsOf: children.sorted {
                        if sort == .recent, $0.recency != $1.recency { return $0.recency > $1.recency }
                        if $0.rank != $1.rank { return $0.rank < $1.rank }
                        let labelOrder = $0.label.localizedCaseInsensitiveCompare($1.label)
                        return labelOrder == .orderedAscending
                    }
                    .map { $0.row }
                )
                continue
            }
            let agents = group.agents.sorted {
                if sort == .recent, ($0.updatedAt ?? 0) != ($1.updatedAt ?? 0) {
                    return ($0.updatedAt ?? 0) > ($1.updatedAt ?? 0)
                }
                return $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
            }
            for agent in agents {
                out.append(Row(kind: .agent(agent.id), depth: 0))
                if expandedAgents.contains(agent.id) {
                    for session in group.sessions[agent.id] ?? [] {
                        out.append(Row(kind: .session(agent: agent.id, cId: session.cId), depth: 1))
                    }
                }
            }
        }
        return out
    }

    // MARK: Selection

    func selectRow(_ row: Row, groups: [ProjectGroup]) {
        selectedID = row.id
        selectedSessionCId = row.sessionCId
        if let agentID = row.agentID {
            selectedAgentID = agentID
            selectedProjectKey = groups.first { $0.agents.contains { $0.id == agentID } }?.key
        } else if let projectKey = row.projectKey {
            selectedProjectKey = projectKey
            selectedAgentID = nil
        } else {
            selectedProjectKey = nil
            selectedAgentID = nil
        }
    }

    func move(_ delta: Int, groups: [ProjectGroup], showProjects: Bool = true, sort: ScoutAgentsTreeSort = .alpha) {
        let rows = rows(groups, showProjects: showProjects, sort: sort)
        guard !rows.isEmpty else { return }
        let current = rows.firstIndex { $0.id == selectedID } ?? 0
        let next = min(max(current + delta, 0), rows.count - 1)
        selectRow(rows[next], groups: groups)
    }

    func moveToEdge(last: Bool, groups: [ProjectGroup], showProjects: Bool = true, sort: ScoutAgentsTreeSort = .alpha) {
        let rows = rows(groups, showProjects: showProjects, sort: sort)
        guard let target = last ? rows.last : rows.first else { return }
        selectRow(target, groups: groups)
    }

    func expandOrDescend(groups: [ProjectGroup], showProjects: Bool = true, sort: ScoutAgentsTreeSort = .alpha) {
        let rows = rows(groups, showProjects: showProjects, sort: sort)
        guard let row = rows.first(where: { $0.id == selectedID }) ?? rows.first else { return }
        switch row.kind {
        case .project(let key):
            if collapsedProjects.contains(key) { collapsedProjects.remove(key) } else { move(1, groups: groups, showProjects: showProjects, sort: sort) }
        case .agent(let id):
            let hasSessions = !showProjects && groups.contains { !($0.sessions[id]?.isEmpty ?? true) }
            if hasSessions, !expandedAgents.contains(id) { expandedAgents.insert(id) } else { move(1, groups: groups, showProjects: showProjects, sort: sort) }
        case .session:
            move(1, groups: groups, showProjects: showProjects, sort: sort)
        }
    }

    func collapseOrParent(groups: [ProjectGroup], showProjects: Bool = true, sort: ScoutAgentsTreeSort = .alpha) {
        let rows = rows(groups, showProjects: showProjects, sort: sort)
        guard let row = rows.first(where: { $0.id == selectedID }) ?? rows.first else { return }
        switch row.kind {
        case .project(let key):
            collapsedProjects.insert(key)
        case .agent(let id):
            if expandedAgents.contains(id) {
                expandedAgents.remove(id)
            } else if showProjects,
                      let group = groups.first(where: { $0.agents.contains { $0.id == id } }),
                      let parent = rows.first(where: { $0.id == "p:\(group.key)" }) {
                selectRow(parent, groups: groups)
            }
        case .session(let agentID, _):
            if showProjects,
               let group = groups.first(where: { $0.agents.contains { $0.id == agentID } }),
               let parent = rows.first(where: { $0.id == "p:\(group.key)" }) {
                selectRow(parent, groups: groups)
            } else if let parent = rows.first(where: { $0.id == "a:\(agentID)" }) {
                selectRow(parent, groups: groups)
            }
        }
    }

    func toggle(_ row: Row) {
        switch row.kind {
        case .project(let key):
            if collapsedProjects.contains(key) { collapsedProjects.remove(key) } else { collapsedProjects.insert(key) }
        case .agent(let id):
            if expandedAgents.contains(id) { expandedAgents.remove(id) } else { expandedAgents.insert(id) }
        case .session:
            break
        }
    }

    func isExpanded(_ row: Row) -> Bool {
        switch row.kind {
        case .project(let key): return !collapsedProjects.contains(key)
        case .agent(let id): return expandedAgents.contains(id)
        case .session: return false
        }
    }

    /// External selection (e.g. from Comms) — move the cursor onto that agent,
    /// expanding its project. No-op while already on that agent so a selected
    /// session row keeps its highlight.
    func syncToAgent(_ agentID: String?, groups: [ProjectGroup], showProjects: Bool = true, sort: ScoutAgentsTreeSort = .alpha) {
        guard let agentID, selectedAgentID != agentID else { return }
        if let group = groups.first(where: { $0.agents.contains { $0.id == agentID } }) {
            collapsedProjects.remove(group.key)
            selectedProjectKey = group.key
        }
        if let row = rows(groups, showProjects: showProjects, sort: sort).first(where: { $0.id == "a:\(agentID)" }) { selectRow(row, groups: groups) }
    }

    /// Seed a selection when there isn't a valid one yet.
    func ensureSelection(groups: [ProjectGroup], fallbackAgentID: String?, showProjects: Bool = true, sort: ScoutAgentsTreeSort = .alpha) {
        if let selectedID, rows(groups, showProjects: showProjects, sort: sort).contains(where: { $0.id == selectedID }) { return }
        if let agentID = fallbackAgentID {
            if let group = groups.first(where: { $0.agents.contains { $0.id == agentID } }) {
                collapsedProjects.remove(group.key)
            }
            if let row = rows(groups, showProjects: showProjects, sort: sort).first(where: { $0.id == "a:\(agentID)" }) {
                selectRow(row, groups: groups)
                return
            }
        }
        if let first = rows(groups, showProjects: showProjects, sort: sort).first { selectRow(first, groups: groups) }
    }
}

// MARK: - State dot (with sonar ping for live states)

private struct ScoutTreeStateDot: View {
    let state: ScoutAgentState
    var size: CGFloat = 7

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animate = false

    private var color: Color {
        switch state {
        case .working: return ScoutPalette.accent
        case .needsAttention: return ScoutPalette.statusWarn
        case .available: return ScoutPalette.muted
        case .done, .offline: return ScoutPalette.dim
        }
    }

    private var live: Bool { state == .working || state == .needsAttention }

    var body: some View {
        // Only live/attention states carry a dot — the accent `working` ping and
        // the needs-attention mark are the precedence layer. Idle/done/offline rows
        // render an empty slot (footprint reserved so the avatar column stays
        // aligned), so the tree reads as calm ambient rather than a field of
        // zero-signal gray status dots.
        Group {
            if live {
                Circle()
                    .fill(color)
                    .overlay {
                        if !reduceMotion {
                            Circle()
                                .stroke(color, lineWidth: 1)
                                .scaleEffect(animate ? 2.2 : 1)
                                .opacity(animate ? 0 : 0.5)
                        }
                    }
            } else {
                Color.clear
            }
        }
        .frame(width: size, height: size)
        .onAppear {
            guard live, !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.7).repeatForever(autoreverses: false)) { animate = true }
        }
    }
}

// MARK: - Row chrome

private let agentsTreeSelectionMatchID = "agentsTreeSelection"

private func agentsTreeHomeTilde(_ path: String) -> String {
    let home = NSHomeDirectory()
    guard !home.isEmpty, path.hasPrefix(home) else { return path }
    return "~" + path.dropFirst(home.count)
}

/// Padding, selection/hover background, and gestures for one tree row. Hover
/// is deliberately local `@State` so a mouse enter/exit invalidates only this
/// row — when it lived on `ScoutAgentsTree`, every transition rebuilt the
/// whole `ForEach` (twice per row crossing), which is what made the highlight
/// trail the cursor.
private struct ScoutTreeRowChrome<Content: View, Menu: View>: View {
    let depth: Int
    let project: Bool
    let selected: Bool
    let selectionNamespace: Namespace.ID
    let onTap: () -> Void
    let onDoubleTap: () -> Void
    private let content: Content
    private let menu: Menu

    @State private var hovered = false

    init(
        depth: Int,
        project: Bool,
        selected: Bool,
        selectionNamespace: Namespace.ID,
        onTap: @escaping () -> Void,
        onDoubleTap: @escaping () -> Void,
        @ViewBuilder content: () -> Content,
        @ViewBuilder menu: () -> Menu
    ) {
        self.depth = depth
        self.project = project
        self.selected = selected
        self.selectionNamespace = selectionNamespace
        self.onTap = onTap
        self.onDoubleTap = onDoubleTap
        self.content = content()
        self.menu = menu()
    }

    var body: some View {
        HStack(spacing: HudSpacing.sm) { content }
            .padding(.vertical, 5)
            .padding(.trailing, HudSpacing.lg)
            .padding(.leading, CGFloat(10 + depth * 8))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(alignment: .leading) {
                if selected {
                    // Selection is the fill alone — the left-edge accent bar is a
                    // banned styleguide treatment (see ScoutTailView / composer well).
                    ScoutPalette.accent.opacity(0.14)
                        .matchedGeometryEffect(id: agentsTreeSelectionMatchID, in: selectionNamespace)
                } else if project {
                    ScoutSurface.inset.opacity(0.76)
                } else if hovered {
                    ScoutPalette.surface
                }
            }
            .contentShape(Rectangle())
            .onHover { hovered = $0 }
            .onTapGesture(count: 2) { onDoubleTap() }
            .onTapGesture { onTap() }
            .contextMenu { menu }
    }
}

// MARK: - Tree

struct ScoutAgentsTree: View {
    @ObservedObject var model: ScoutAgentsTreeModel
    let groups: [ScoutAgentsTreeModel.ProjectGroup]
    let showProjects: Bool
    let sort: ScoutAgentsTreeSort
    /// Push the model's current selection into the store (inspector follows).
    let onSelect: () -> Void
    /// Open the selected row (agent DM / session conversation).
    let onActivate: () -> Void
    let onObserve: (ScoutAgent) -> Void
    let onOpenDM: (ScoutAgent) -> Void

    // Lookup tables are built once per view value (`groups` is immutable on
    // it) — as computed properties they re-ran the full flatMap per row per
    // body evaluation.
    private let agentsByID: [String: ScoutAgent]
    private let channelsByCId: [String: ScoutChannel]
    private let groupsByKey: [String: ScoutAgentsTreeModel.ProjectGroup]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var selectionNamespace

    init(
        model: ScoutAgentsTreeModel,
        groups: [ScoutAgentsTreeModel.ProjectGroup],
        showProjects: Bool = true,
        sort: ScoutAgentsTreeSort = .alpha,
        onSelect: @escaping () -> Void,
        onActivate: @escaping () -> Void,
        onObserve: @escaping (ScoutAgent) -> Void,
        onOpenDM: @escaping (ScoutAgent) -> Void
    ) {
        self.model = model
        self.groups = groups
        self.showProjects = showProjects
        self.sort = sort
        self.onSelect = onSelect
        self.onActivate = onActivate
        self.onObserve = onObserve
        self.onOpenDM = onOpenDM
        self.agentsByID = Dictionary(groups.flatMap { $0.agents }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        self.channelsByCId = Dictionary(groups.flatMap { $0.sessions.values.flatMap { $0 } }.map { ($0.cId, $0) }, uniquingKeysWith: { a, _ in a })
        self.groupsByKey = Dictionary(groups.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
    }

    /// Fast spring so the highlight reads as one quick glide between rows, not a
    /// teleport — short enough to stay "blazing fast" under a held j/k.
    private var moveAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.15, dampingFraction: 0.85)
    }

    private var rows: [ScoutAgentsTreeModel.Row] { model.rows(groups, showProjects: showProjects, sort: sort) }

    var body: some View {
        // A plain VStack (the tree is only a few dozen rows) so every row is
        // always realized — `matchedGeometryEffect` can then slide the
        // selection band reliably, and scrollTo never has to wait on lazy
        // realization.
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                // A breath above each project group (except the first) so the
                // project→agent chunks read at a glance — indent alone doesn't
                // separate groups in a flat uniform-height list.
                if case .project = row.kind, row.id != rows.first?.id {
                    Color.clear.frame(height: HudSpacing.md)
                }
                rowView(row)
                    .id(row.id)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, HudSpacing.sm)
        .animation(moveAnimation, value: model.selectedID)
    }

    @ViewBuilder
    private func rowView(_ row: ScoutAgentsTreeModel.Row) -> some View {
        ScoutTreeRowChrome(
            depth: row.depth,
            project: {
                if case .project = row.kind { return true }
                return false
            }(),
            selected: row.id == model.selectedID,
            selectionNamespace: selectionNamespace,
            onTap: { select(row) },
            onDoubleTap: { activate(row) }
        ) {
            content(for: row)
        } menu: {
            contextMenu(for: row)
        }
    }

    @ViewBuilder
    private func content(for row: ScoutAgentsTreeModel.Row) -> some View {
        switch row.kind {
        case .project(let key):
            projectRow(groupsByKey[key])
        case .agent(let id):
            agentRow(row, agent: agentsByID[id])
        case .session(_, let cId):
            sessionRow(channelsByCId[cId])
        }
    }

    // MARK: Project

    @ViewBuilder
    private func projectRow(_ group: ScoutAgentsTreeModel.ProjectGroup?) -> some View {
        if let group {
            let sessionCount = group.sessions.values.reduce(0) { $0 + $1.count }
            chevron(for: .init(kind: .project(group.key), depth: 0))
            HStack(spacing: HudSpacing.xxs) {
                Text("/")
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(ScoutPalette.dim)
                Text(group.label)
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
            }
            Text(agentsTreeHomeTilde(group.path))
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.middle)
                .help(group.path)
            Spacer(minLength: HudSpacing.sm)
            Text("\(group.agents.count) agent\(group.agents.count == 1 ? "" : "s") · \(sessionCount) chat\(sessionCount == 1 ? "" : "s")")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .frame(width: ScoutDesign.agentsStateColumnWidth, alignment: .trailing)
            Group {
                if group.live > 0 { ScoutTreeStateDot(state: .working, size: 6) }
            }
            .frame(width: ScoutDesign.agentsUpdatedColumnWidth, alignment: .trailing)
        }
    }

    // MARK: Agent

    @ViewBuilder
    private func agentRow(_ row: ScoutAgentsTreeModel.Row, agent: ScoutAgent?) -> some View {
        if let agent {
            let hasSessions = !showProjects && groupsByKey.values.contains { !($0.sessions[agent.id]?.isEmpty ?? true) }
            if hasSessions {
                chevron(for: row)
            } else {
                Color.clear.frame(width: 12, height: 12)
            }
            ScoutTreeStateDot(state: agent.state)
            SpriteAvatarView(agent: agent, size: 18)
            Text(agent.displayName)
                .font(HudFont.ui(HudTextSize.base, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
            if !agent.detail.isEmpty {
                Text(agent.detail)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: HudSpacing.sm)
            // State lives in the leading dot (color + sonar ping for working /
            // needs-attention). A text column reading "AVAILABLE" on every row
            // was ~zero-cardinality noise and squeezed the title, so the row's
            // trailing metadata is just recency.
            Text(agent.updatedLabel)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
                .contentTransition(.numericText())
                .frame(width: ScoutDesign.agentsUpdatedColumnWidth, alignment: .trailing)
        }
    }

    // MARK: Session

    @ViewBuilder
    private func sessionRow(_ channel: ScoutChannel?) -> some View {
        if let channel {
            Color.clear.frame(width: 12, height: 12)
            Color.clear.frame(width: 7, height: 7)
            Image(systemName: "bubble.left")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(ScoutPalette.dim)
                .frame(width: 18, height: 18)
            Text(channel.rowTitle)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
            Spacer(minLength: HudSpacing.sm)
            Text(channel.sessionIdShort ?? channel.chatIdShort)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .help(channel.sessionId.map { "Session id: \($0)" } ?? "Chat ID: \(channel.chatId)")
                .frame(width: ScoutDesign.agentsStateColumnWidth, alignment: .trailing)
            Text(channel.ageLabel)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
                .contentTransition(.numericText())
                .frame(width: ScoutDesign.agentsUpdatedColumnWidth, alignment: .trailing)
        }
    }

    // MARK: Chevron

    private func chevron(for row: ScoutAgentsTreeModel.Row) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.82)) {
                model.toggle(row)
            }
        } label: {
            Image(systemName: "chevron.right")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)
                .rotationEffect(.degrees(model.isExpanded(row) ? 90 : 0))
                .frame(width: 12, height: 12)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
    }

    @ViewBuilder
    private func contextMenu(for row: ScoutAgentsTreeModel.Row) -> some View {
        if let id = row.agentID, let agent = agentsByID[id] {
            Button("Open DM") { onOpenDM(agent) }
            Button("Observe") { onObserve(agent) }
        }
    }

    private func select(_ row: ScoutAgentsTreeModel.Row) {
        model.selectRow(row, groups: groups)
        onSelect()
    }

    private func activate(_ row: ScoutAgentsTreeModel.Row) {
        model.selectRow(row, groups: groups)
        if case .project = row.kind {
            withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.82)) { model.toggle(row) }
        } else {
            onActivate()
        }
        onSelect()
    }
}
