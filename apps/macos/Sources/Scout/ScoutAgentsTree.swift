import HudsonUI
import SwiftUI

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
    func rows(_ groups: [ProjectGroup]) -> [Row] {
        var out: [Row] = []
        for group in groups {
            out.append(Row(kind: .project(group.key), depth: 0))
            if collapsedProjects.contains(group.key) { continue }
            for agent in group.agents {
                out.append(Row(kind: .agent(agent.id), depth: 1))
                if expandedAgents.contains(agent.id) {
                    for session in group.sessions[agent.id] ?? [] {
                        out.append(Row(kind: .session(agent: agent.id, cId: session.cId), depth: 2))
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
        } else if let projectKey = row.projectKey {
            // Focusing a project header previews its lead agent in the inspector.
            selectedAgentID = groups.first { $0.key == projectKey }?.agents.first?.id
        }
    }

    func move(_ delta: Int, groups: [ProjectGroup]) {
        let rows = rows(groups)
        guard !rows.isEmpty else { return }
        let current = rows.firstIndex { $0.id == selectedID } ?? 0
        let next = min(max(current + delta, 0), rows.count - 1)
        selectRow(rows[next], groups: groups)
    }

    func moveToEdge(last: Bool, groups: [ProjectGroup]) {
        let rows = rows(groups)
        guard let target = last ? rows.last : rows.first else { return }
        selectRow(target, groups: groups)
    }

    func expandOrDescend(groups: [ProjectGroup]) {
        let rows = rows(groups)
        guard let row = rows.first(where: { $0.id == selectedID }) ?? rows.first else { return }
        switch row.kind {
        case .project(let key):
            if collapsedProjects.contains(key) { collapsedProjects.remove(key) } else { move(1, groups: groups) }
        case .agent(let id):
            let hasSessions = groups.contains { !($0.sessions[id]?.isEmpty ?? true) }
            if hasSessions, !expandedAgents.contains(id) { expandedAgents.insert(id) } else { move(1, groups: groups) }
        case .session:
            move(1, groups: groups)
        }
    }

    func collapseOrParent(groups: [ProjectGroup]) {
        let rows = rows(groups)
        guard let row = rows.first(where: { $0.id == selectedID }) ?? rows.first else { return }
        switch row.kind {
        case .project(let key):
            collapsedProjects.insert(key)
        case .agent(let id):
            if expandedAgents.contains(id) {
                expandedAgents.remove(id)
            } else if let group = groups.first(where: { $0.agents.contains { $0.id == id } }),
                      let parent = rows.first(where: { $0.id == "p:\(group.key)" }) {
                selectRow(parent, groups: groups)
            }
        case .session(let agentID, _):
            if let parent = rows.first(where: { $0.id == "a:\(agentID)" }) { selectRow(parent, groups: groups) }
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
    func syncToAgent(_ agentID: String?, groups: [ProjectGroup]) {
        guard let agentID, selectedAgentID != agentID else { return }
        if let group = groups.first(where: { $0.agents.contains { $0.id == agentID } }) {
            collapsedProjects.remove(group.key)
        }
        if let row = rows(groups).first(where: { $0.id == "a:\(agentID)" }) { selectRow(row, groups: groups) }
    }

    /// Seed a selection when there isn't a valid one yet.
    func ensureSelection(groups: [ProjectGroup], fallbackAgentID: String?) {
        if let selectedID, rows(groups).contains(where: { $0.id == selectedID }) { return }
        if let agentID = fallbackAgentID {
            if let group = groups.first(where: { $0.agents.contains { $0.id == agentID } }) {
                collapsedProjects.remove(group.key)
            }
            if let row = rows(groups).first(where: { $0.id == "a:\(agentID)" }) {
                selectRow(row, groups: groups)
                return
            }
        }
        if let first = rows(groups).first { selectRow(first, groups: groups) }
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
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .overlay {
                if live, !reduceMotion {
                    Circle()
                        .stroke(color, lineWidth: 1)
                        .scaleEffect(animate ? 2.2 : 1)
                        .opacity(animate ? 0 : 0.5)
                }
            }
            .onAppear {
                guard live, !reduceMotion else { return }
                withAnimation(.easeOut(duration: 1.7).repeatForever(autoreverses: false)) { animate = true }
            }
    }
}

// MARK: - Tree

struct ScoutAgentsTree: View {
    @ObservedObject var model: ScoutAgentsTreeModel
    let groups: [ScoutAgentsTreeModel.ProjectGroup]
    /// Push the model's current selection into the store (inspector follows).
    let onSelect: () -> Void
    /// Open the selected row (agent DM / session conversation).
    let onActivate: () -> Void
    let onObserve: (ScoutAgent) -> Void
    let onOpenDM: (ScoutAgent) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hoveredID: String?
    @Namespace private var selectionNamespace

    /// Fast spring so the highlight reads as one quick glide between rows, not a
    /// teleport — short enough to stay "blazing fast" under a held j/k.
    private var moveAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.15, dampingFraction: 0.85)
    }

    private static let selectionMatchID = "agentsTreeSelection"

    private var rows: [ScoutAgentsTreeModel.Row] { model.rows(groups) }

    private var agentsByID: [String: ScoutAgent] {
        Dictionary(groups.flatMap { $0.agents }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private var channelsByCId: [String: ScoutChannel] {
        Dictionary(groups.flatMap { $0.sessions.values.flatMap { $0 } }.map { ($0.cId, $0) }, uniquingKeysWith: { a, _ in a })
    }

    private var groupsByKey: [String: ScoutAgentsTreeModel.ProjectGroup] {
        Dictionary(groups.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
    }

    var body: some View {
        // A plain VStack (the tree is only a few dozen rows) so every row is
        // always realized — `matchedGeometryEffect` can then slide the
        // selection band reliably, and scrollTo never has to wait on lazy
        // realization.
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
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
        let selected = row.id == model.selectedID
        let hovered = row.id == hoveredID

        HStack(spacing: HudSpacing.sm) {
            content(for: row)
        }
        .padding(.vertical, 5)
        .padding(.trailing, HudSpacing.lg)
        .padding(.leading, CGFloat(10 + row.depth * 16))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(alignment: .leading) {
            if selected {
                ZStack(alignment: .leading) {
                    ScoutPalette.accent.opacity(0.10)
                    Rectangle().fill(ScoutPalette.accent).frame(width: 2)
                }
                .matchedGeometryEffect(id: Self.selectionMatchID, in: selectionNamespace)
            } else if hovered {
                ScoutPalette.surface
            }
        }
        .contentShape(Rectangle())
        .onHover { inside in hoveredID = inside ? row.id : (hoveredID == row.id ? nil : hoveredID) }
        .onTapGesture(count: 2) { activate(row) }
        .onTapGesture { select(row) }
        .contextMenu { contextMenu(for: row) }
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
            chevron(for: .init(kind: .project(group.key), depth: 0))
            Text(group.label)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
            Text(group.path)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: HudSpacing.sm)
            Text("\(group.agents.count) agent\(group.agents.count == 1 ? "" : "s")")
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
            let hasSessions = groupsByKey.values.contains { !($0.sessions[agent.id]?.isEmpty ?? true) }
            if hasSessions {
                chevron(for: row)
            } else {
                Color.clear.frame(width: 12, height: 12)
            }
            ScoutTreeStateDot(state: agent.state)
            Text(agent.displayName)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
            if !agent.detail.isEmpty {
                Text(agent.detail)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
            }
            Spacer(minLength: HudSpacing.sm)
            Text(agent.state.label.uppercased())
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .tracking(0.6)
                .foregroundStyle(stateLabelColor(agent.state))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: ScoutDesign.agentsStateColumnWidth, alignment: .trailing)
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
            Circle().fill(ScoutPalette.dim).frame(width: 4, height: 4)
            Text(channel.rowTitle)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
            Spacer(minLength: HudSpacing.sm)
            Text(channel.cIdShort)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
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

    private func stateLabelColor(_ state: ScoutAgentState) -> Color {
        switch state {
        case .working: return ScoutPalette.accent
        case .needsAttention: return ScoutPalette.statusWarn
        case .available: return ScoutPalette.muted
        case .done, .offline: return ScoutPalette.dim
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
