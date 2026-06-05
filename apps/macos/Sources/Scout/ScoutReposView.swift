import HudsonUI
import SwiftUI

/// The **Repos** section — a keyboard-first repo→worktree tree fed by the
/// broker's Repo Watch snapshot.
///
/// The spine is `repo → worktree`; agents and sessions are *attributes* on a
/// worktree, never the organizing axis. Ordering is attention-first everywhere
/// (`ScoutRepoStore.projects` is already sorted worst-first; worktrees re-sort
/// the same way inside the tree), and clean-&-idle worktrees fold away behind
/// the header's "quiet" toggle so unfinished work floats to the top.
///
/// Interaction mirrors `ScoutAgentsTree` exactly — j/k step, h/l fold-or-parent
/// / expand-or-descend, g/⇧G to the edges, and the inspector follows the
/// cursor — so the two trees read as one system. Two lenses (Table, Drift) read
/// the *same* model: Table leads with churn/files/agents, Drift swaps the
/// trailing cluster for ahead/behind/upstream.

// MARK: - Metrics

private enum ScoutReposMetrics {
    static let pageGutter: CGFloat = 20
    static let rowLeadingBase: CGFloat = 10
    static let indentStep: CGFloat = 16
    static let chevronSlot: CGFloat = 12
}

// MARK: - Severity → tone (one vocabulary, shared by tree + inspector)

func reposAttentionColor(_ attention: RepoAttention) -> Color {
    switch attention {
    case .critical: return ScoutPalette.statusError
    case .attention: return ScoutPalette.statusWarn
    case .active: return ScoutPalette.accent
    case .quiet: return ScoutPalette.dim
    case .unknown: return ScoutPalette.muted
    }
}

func reposAttentionLive(_ attention: RepoAttention) -> Bool {
    attention == .critical || attention == .attention || attention == .active
}

func reposStateColor(_ state: RepoWorktreeState) -> Color {
    switch state {
    case .error: return ScoutPalette.statusError
    case .live: return ScoutPalette.accent
    case .dirty: return ScoutPalette.statusWarn
    case .clean: return ScoutPalette.dim
    }
}

/// Tint for a `RepoWorktree.driftFlag` pill (`SCAN ERR`, `DIVERGED`, `REBASE`,
/// `AHEAD N`, `IN SYNC`).
func reposDriftTint(_ flag: String) -> Color {
    if flag.hasPrefix("SCAN") { return ScoutPalette.statusError }
    if flag == "DIVERGED" { return ScoutPalette.statusError }
    if flag == "REBASE" { return ScoutPalette.statusWarn }
    if flag.hasPrefix("AHEAD") { return ScoutPalette.statusInfo }
    return ScoutPalette.muted
}

// MARK: - Tree model (repo → worktree)

@MainActor
final class ScoutReposTreeModel: ObservableObject {
    /// Projects default to expanded (empty = none collapsed) so the tree opens
    /// at repo→worktree.
    @Published var collapsedProjects: Set<String> = []

    @Published private(set) var selectedID: String?
    @Published private(set) var selectedProjectID: String?
    @Published private(set) var selectedWorktreeID: String?

    struct Row: Identifiable, Equatable {
        enum Kind: Equatable {
            case project(String)
            case worktree(project: String, id: String)
        }

        let kind: Kind
        let depth: Int

        var id: String {
            switch kind {
            case .project(let p): return "p:\(p)"
            case .worktree(_, let w): return "w:\(w)"
            }
        }

        var collapsible: Bool {
            if case .worktree = kind { return false }
            return true
        }

        var worktreeID: String? {
            if case .worktree(_, let w) = kind { return w }
            return nil
        }

        var projectID: String? {
            switch kind {
            case .project(let p): return p
            case .worktree(let p, _): return p
            }
        }
    }

    /// Worktrees worst-first then alphabetical, with clean-&-idle folded out
    /// unless `showClean`.
    func visibleWorktrees(_ project: RepoProject, showClean: Bool) -> [RepoWorktree] {
        let sorted = project.worktrees.sorted { lhs, rhs in
            if lhs.attention.rank != rhs.attention.rank {
                return lhs.attention.rank < rhs.attention.rank
            }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
        return showClean ? sorted : sorted.filter { $0.hasActivity }
    }

    func rows(_ projects: [RepoProject], showClean: Bool) -> [Row] {
        var out: [Row] = []
        for project in projects {
            out.append(Row(kind: .project(project.id), depth: 0))
            if collapsedProjects.contains(project.id) { continue }
            for worktree in visibleWorktrees(project, showClean: showClean) {
                out.append(Row(kind: .worktree(project: project.id, id: worktree.id), depth: 1))
            }
        }
        return out
    }

    func selectRow(_ row: Row, projects: [RepoProject]) {
        selectedID = row.id
        selectedWorktreeID = row.worktreeID
        selectedProjectID = row.projectID
    }

    private func currentRow(_ projects: [RepoProject], _ showClean: Bool) -> Row? {
        let rows = rows(projects, showClean: showClean)
        return rows.first { $0.id == selectedID } ?? rows.first
    }

    func move(_ delta: Int, projects: [RepoProject], showClean: Bool) {
        let rows = rows(projects, showClean: showClean)
        guard !rows.isEmpty else { return }
        let current = rows.firstIndex { $0.id == selectedID } ?? 0
        let next = min(max(current + delta, 0), rows.count - 1)
        selectRow(rows[next], projects: projects)
    }

    func moveToEdge(last: Bool, projects: [RepoProject], showClean: Bool) {
        let rows = rows(projects, showClean: showClean)
        guard let target = last ? rows.last : rows.first else { return }
        selectRow(target, projects: projects)
    }

    func expandOrDescend(projects: [RepoProject], showClean: Bool) {
        guard let row = currentRow(projects, showClean) else { return }
        switch row.kind {
        case .project(let id):
            if collapsedProjects.contains(id) {
                collapsedProjects.remove(id)
            } else {
                move(1, projects: projects, showClean: showClean)
            }
        case .worktree:
            move(1, projects: projects, showClean: showClean)
        }
    }

    func collapseOrParent(projects: [RepoProject], showClean: Bool) {
        let rows = rows(projects, showClean: showClean)
        guard let row = rows.first(where: { $0.id == selectedID }) ?? rows.first else { return }
        switch row.kind {
        case .project(let id):
            collapsedProjects.insert(id)
        case .worktree(let projectID, _):
            if let parent = rows.first(where: { $0.id == "p:\(projectID)" }) {
                selectRow(parent, projects: projects)
            }
        }
    }

    func toggle(_ row: Row) {
        if case .project(let id) = row.kind {
            if collapsedProjects.contains(id) {
                collapsedProjects.remove(id)
            } else {
                collapsedProjects.insert(id)
            }
        }
    }

    func isExpanded(_ row: Row) -> Bool {
        if case .project(let id) = row.kind { return !collapsedProjects.contains(id) }
        return false
    }

    /// Seed (or repair) the selection when the snapshot first lands or the
    /// visible set shifts under the cursor.
    func ensureSelection(projects: [RepoProject], showClean: Bool) {
        let rows = rows(projects, showClean: showClean)
        if let selectedID, rows.contains(where: { $0.id == selectedID }) { return }
        if let first = rows.first { selectRow(first, projects: projects) }
    }
}

// MARK: - Section content (header + tree)

struct ScoutReposContent: View {
    @ObservedObject var repos: ScoutRepoStore
    @ObservedObject var tree: ScoutReposTreeModel
    /// Enter / double-click on the focused row (reveal the path in Finder).
    let onActivate: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            if let error = repos.lastError {
                errorBanner(error)
            }
            treeScroll
        }
        .background(ScoutDesign.bg)
    }

    // MARK: Header

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutReposMetrics.pageGutter) {
            titleCluster
        } secondary: {
            lensStrip
        } trailing: {
            commandStrip
        }
        .background(ScoutDesign.bg)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairlineStrong)
        }
    }

    private var titleCluster: some View {
        let totals = repos.totals
        return HStack(spacing: HudSpacing.sm) {
            Text("Repos")
                .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)

            statusPill

            countCluster(totals.projects, "repos")
            countCluster(totals.worktrees, "trees")
            if totals.dirtyWorktrees > 0 {
                countCluster(totals.dirtyWorktrees, "dirty", tint: ScoutPalette.statusWarn)
            }
            if totals.attentionWorktrees > 0 {
                countCluster(totals.attentionWorktrees, "attn", tint: ScoutPalette.statusError)
            }

            if repos.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.86)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    @ViewBuilder private var statusPill: some View {
        if repos.lastError != nil {
            HudBadge("Error", tint: ScoutPalette.statusError, dot: true)
        } else if !repos.hasLoaded {
            HudBadge("Scanning", tint: ScoutPalette.statusWarn, dot: true)
        } else {
            HudBadge("Live", tint: ScoutPalette.statusOk, dot: true)
        }
    }

    private func countCluster(_ value: Int, _ label: String, tint: Color? = nil) -> some View {
        HStack(spacing: HudSpacing.xxs) {
            Text("\(value)")
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(tint ?? ScoutPalette.ink)
                .monospacedDigit()
            Text(label)
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
        }
    }

    private var lensStrip: some View {
        HStack(spacing: HudSpacing.xs) {
            ForEach(ReposLens.allCases, id: \.self) { lens in
                Button {
                    repos.lens = lens
                } label: {
                    Text(lens.label.uppercased())
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(0.6)
                        .foregroundStyle(repos.lens == lens ? ScoutPalette.ink : ScoutPalette.dim)
                        .padding(.horizontal, HudSpacing.sm)
                        .padding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.tight)
                                .fill(repos.lens == lens ? ScoutPalette.accentSoft : Color.clear)
                        )
                }
                .buttonStyle(.plain)
                .scoutPointerCursor()
            }
        }
    }

    private var commandStrip: some View {
        HStack(spacing: HudSpacing.md) {
            if repos.quietWorktreeCount > 0 || repos.showCleanIdle {
                Button {
                    withAnimation(.easeOut(duration: 0.16)) { repos.showCleanIdle.toggle() }
                } label: {
                    HStack(spacing: HudSpacing.xxs) {
                        Image(systemName: repos.showCleanIdle ? "eye.fill" : "eye.slash")
                            .font(.system(size: 9, weight: .semibold))
                        Text(repos.showCleanIdle ? "Quiet shown" : "Quiet \(repos.quietWorktreeCount)")
                    }
                    .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                    .foregroundStyle(repos.showCleanIdle ? ScoutPalette.ink : ScoutPalette.dim)
                }
                .buttonStyle(.plain)
                .scoutPointerCursor()
            }

            Button {
                repos.refresh()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.dim)
            }
            .buttonStyle(.plain)
            .scoutPointerCursor()
            .help("Rescan repositories")
        }
    }

    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
            Text(error)
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .foregroundStyle(ScoutPalette.statusError)
        .padding(.horizontal, ScoutReposMetrics.pageGutter)
        .frame(height: 26)
        .background(ScoutDesign.chrome)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }

    // MARK: Tree

    private var treeScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if repos.projects.isEmpty {
                    emptyState
                        .frame(maxWidth: .infinity, minHeight: 320)
                } else {
                    ScoutReposTree(
                        model: tree,
                        projects: repos.projects,
                        generatedAt: repos.generatedAt,
                        showClean: repos.showCleanIdle,
                        lens: repos.lens,
                        onActivate: onActivate
                    )
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            .onChange(of: tree.selectedID) { _, id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.1)) { proxy.scrollTo(id) }
            }
            .onAppear {
                tree.ensureSelection(projects: repos.projects, showClean: repos.showCleanIdle)
            }
            .onChange(of: repos.projects.count) { _, _ in
                tree.ensureSelection(projects: repos.projects, showClean: repos.showCleanIdle)
            }
            .onChange(of: repos.showCleanIdle) { _, _ in
                tree.ensureSelection(projects: repos.projects, showClean: repos.showCleanIdle)
            }
        }
    }

    @ViewBuilder private var emptyState: some View {
        if !repos.hasLoaded {
            VStack(spacing: HudSpacing.md) {
                ProgressView().controlSize(.small)
                Text("Scanning repositories…")
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(ScoutPalette.muted)
            }
        } else {
            HudEmptyState(
                title: "No repositories",
                subtitle: "Repo Watch found no git repositories in your tracked roots.",
                icon: "arrow.triangle.branch"
            )
        }
    }
}

// MARK: - Tree rows

struct ScoutReposTree: View {
    @ObservedObject var model: ScoutReposTreeModel
    let projects: [RepoProject]
    let generatedAt: Double
    let showClean: Bool
    let lens: ReposLens
    let onActivate: () -> Void

    @Namespace private var selectionNamespace
    private static let selectionMatchID = "repos.selection"
    @State private var hoveredID: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var rows: [ScoutReposTreeModel.Row] { model.rows(projects, showClean: showClean) }
    private var projectsByID: [String: RepoProject] {
        Dictionary(projects.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    }
    private var moveAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.86)
    }

    var body: some View {
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
    private func rowView(_ row: ScoutReposTreeModel.Row) -> some View {
        let selected = row.id == model.selectedID
        let hovered = row.id == hoveredID

        HStack(spacing: HudSpacing.sm) {
            content(for: row)
        }
        .padding(.vertical, 5)
        .padding(.trailing, HudSpacing.lg)
        .padding(.leading, ScoutReposMetrics.rowLeadingBase + CGFloat(row.depth) * ScoutReposMetrics.indentStep)
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
    }

    @ViewBuilder
    private func content(for row: ScoutReposTreeModel.Row) -> some View {
        switch row.kind {
        case .project(let id):
            projectRow(projectsByID[id])
        case .worktree(let projectID, let worktreeID):
            worktreeRow(row, worktree: projectsByID[projectID]?.worktrees.first(where: { $0.id == worktreeID }))
        }
    }

    @ViewBuilder
    private func projectRow(_ project: RepoProject?) -> some View {
        if let project {
            chevron(for: ScoutReposTreeModel.Row(kind: .project(project.id), depth: 0))
            ScoutRepoStateDot(
                color: reposAttentionColor(project.attention),
                live: reposAttentionLive(project.attention),
                size: 7
            )
            Text(project.name)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
            Text(repoShortPath(project.root))
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: HudSpacing.sm)

            let stats = project.stats
            if stats.conflictedWorktrees > 0 {
                Text("\(stats.conflictedWorktrees) conflict")
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .tracking(0.4)
                    .foregroundStyle(ScoutPalette.statusError)
            } else if stats.dirtyWorktrees > 0 {
                Text("\(stats.dirtyWorktrees) dirty")
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .tracking(0.4)
                    .foregroundStyle(ScoutPalette.statusWarn)
            }
            Text("\(project.worktrees.count) wt")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
            if stats.attachedAgents > 0 {
                ScoutRepoStateDot(color: ScoutPalette.accent, live: true, size: 6)
            }
        }
    }

    @ViewBuilder
    private func worktreeRow(_ row: ScoutReposTreeModel.Row, worktree: RepoWorktree?) -> some View {
        if let worktree {
            Color.clear.frame(width: ScoutReposMetrics.chevronSlot, height: ScoutReposMetrics.chevronSlot)
            ScoutRepoStateDot(
                color: reposStateColor(worktree.state),
                live: worktree.state == .live,
                size: 7
            )
            branchLabel(worktree.branchParts)

            let flag = worktree.driftFlag
            if flag == "SCAN ERR" || (lens == .table && flag != "IN SYNC") {
                HudBadge(flag, tint: reposDriftTint(flag))
            }

            Spacer(minLength: HudSpacing.sm)

            if lens == .drift {
                driftTrailing(worktree)
            } else {
                tableTrailing(worktree)
            }
        }
    }

    @ViewBuilder
    private func branchLabel(_ parts: RepoBranchParts) -> some View {
        HStack(spacing: 0) {
            if !parts.prefix.isEmpty {
                Text(parts.prefix).foregroundStyle(ScoutPalette.dim)
            }
            Text(parts.leaf).foregroundStyle(ScoutPalette.ink)
        }
        .font(HudFont.mono(HudTextSize.sm, weight: parts.detached ? .regular : .medium))
        .lineLimit(1)
        .truncationMode(.middle)
    }

    @ViewBuilder
    private func tableTrailing(_ worktree: RepoWorktree) -> some View {
        if worktree.churn.has {
            ScoutRepoChurnLabel(churn: worktree.churn)
        }
        if worktree.status.changedFiles > 0 {
            HStack(spacing: 2) {
                Image(systemName: "doc.text").font(.system(size: 8))
                Text("\(worktree.status.changedFiles)").monospacedDigit()
            }
            .font(HudFont.mono(HudTextSize.xxs))
            .foregroundStyle(ScoutPalette.dim)
        }
        if !worktree.uniqueAgents.isEmpty {
            HStack(spacing: 2) {
                ForEach(Array(worktree.uniqueAgents.prefix(3))) { agent in
                    ScoutRepoAgentChip(agent: agent)
                }
                if worktree.uniqueAgents.count > 3 {
                    Text("+\(worktree.uniqueAgents.count - 3)")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                }
            }
        }
        Text(worktree.lastCommitAgo(generatedAt: generatedAt) ?? "—")
            .font(HudFont.mono(HudTextSize.xxs))
            .foregroundStyle(ScoutPalette.dim)
            .contentTransition(.numericText())
            .frame(width: 40, alignment: .trailing)
    }

    @ViewBuilder
    private func driftTrailing(_ worktree: RepoWorktree) -> some View {
        if worktree.branch.ahead > 0 {
            Text("↑\(worktree.branch.ahead)")
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(ScoutPalette.statusInfo)
                .monospacedDigit()
        }
        if worktree.branch.behind > 0 {
            Text("↓\(worktree.branch.behind)")
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(ScoutPalette.statusWarn)
                .monospacedDigit()
        }
        if let upstream = worktree.branch.upstream {
            Text(upstream)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: 120, alignment: .trailing)
        }
        Text(worktree.lastCommitAgo(generatedAt: generatedAt) ?? "—")
            .font(HudFont.mono(HudTextSize.xxs))
            .foregroundStyle(ScoutPalette.dim)
            .frame(width: 40, alignment: .trailing)
    }

    private func chevron(for row: ScoutReposTreeModel.Row) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.82)) {
                model.toggle(row)
            }
        } label: {
            Image(systemName: "chevron.right")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)
                .rotationEffect(.degrees(model.isExpanded(row) ? 90 : 0))
                .frame(width: ScoutReposMetrics.chevronSlot, height: ScoutReposMetrics.chevronSlot)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
    }

    private func select(_ row: ScoutReposTreeModel.Row) {
        model.selectRow(row, projects: projects)
    }

    private func activate(_ row: ScoutReposTreeModel.Row) {
        model.selectRow(row, projects: projects)
        onActivate()
    }
}

// MARK: - Small primitives

/// State dot with the shared sonar-ping for live nodes (matches the Agents
/// tree's `ScoutTreeStateDot`, but keyed on a resolved color so both attention
/// and worktree-state rows reuse it).
struct ScoutRepoStateDot: View {
    let color: Color
    var live: Bool = false
    var size: CGFloat = 7

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animate = false

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

struct ScoutRepoChurnLabel: View {
    let churn: RepoChurn

    var body: some View {
        HStack(spacing: 3) {
            if churn.add > 0 {
                Text("+\(churn.add)").foregroundStyle(ScoutPalette.statusOk)
            }
            if churn.del > 0 {
                Text("−\(churn.del)").foregroundStyle(ScoutPalette.statusError)
            }
        }
        .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
        .monospacedDigit()
    }
}

struct ScoutRepoAgentChip: View {
    let agent: RepoAgentRef

    var body: some View {
        Text(agent.initials)
            .font(HudFont.mono(HudTextSize.micro, weight: .bold))
            .foregroundStyle(agent.live ? ScoutPalette.accent : ScoutPalette.muted)
            .frame(minWidth: 16)
            .padding(.horizontal, HudSpacing.xs)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight)
                    .fill(agent.live ? ScoutPalette.accentSoft : ScoutPalette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight)
                    .stroke(ScoutPalette.hairlineStrong, lineWidth: 0.5)
            )
    }
}

// MARK: - Inspector (Context pane — follows the cursor)

struct ScoutReposInspector: View {
    @ObservedObject var repos: ScoutRepoStore
    @ObservedObject var tree: ScoutReposTreeModel

    var body: some View {
        if let worktree = repos.worktree(id: tree.selectedWorktreeID) {
            worktreeContext(worktree)
        } else if let project = repos.project(id: tree.selectedProjectID) {
            projectContext(project)
        } else {
            HudEmptyState(
                title: "Nothing selected",
                subtitle: "Select a repo or worktree to inspect.",
                icon: "sidebar.right"
            )
        }
    }

    // MARK: Worktree context

    private func worktreeContext(_ worktree: RepoWorktree) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xl) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: HudSpacing.sm) {
                        ScoutRepoStateDot(color: reposStateColor(worktree.state), live: worktree.state == .live)
                        Text(worktree.branchParts.leaf)
                            .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                            .foregroundStyle(ScoutPalette.ink)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: HudSpacing.sm)
                        HudBadge(worktree.driftFlag, tint: reposDriftTint(worktree.driftFlag))
                    }
                    Text(repoShortPath(worktree.path, segments: 4))
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutPalette.dim)
                        .textSelection(.enabled)
                }

                HudDivider(color: ScoutDesign.hairline)

                section("Status") {
                    if worktree.status.clean && worktree.error == nil {
                        Text("Clean working tree")
                            .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                            .foregroundStyle(ScoutPalette.muted)
                    } else {
                        statusRows(worktree.status)
                    }
                }

                if worktree.churn.has {
                    section("Churn") {
                        HStack(spacing: HudSpacing.md) {
                            Text("+\(worktree.churn.add)")
                                .foregroundStyle(ScoutPalette.statusOk)
                            Text("−\(worktree.churn.del)")
                                .foregroundStyle(ScoutPalette.statusError)
                            Text("\(worktree.churn.total) total")
                                .foregroundStyle(ScoutPalette.dim)
                        }
                        .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                        .monospacedDigit()
                    }
                }

                section("Branch") {
                    branchRows(worktree.branch)
                }

                if !worktree.status.files.isEmpty {
                    section("Changed files (\(worktree.status.files.count))") {
                        changedFiles(worktree.status.files)
                    }
                }

                section("Last commit") {
                    keyValue("Committed", worktree.lastCommitAgo(generatedAt: repos.generatedAt).map { "\($0) ago" } ?? "—")
                }

                if !worktree.uniqueAgents.isEmpty {
                    section("Agents (\(worktree.uniqueAgents.count))") {
                        agentRows(worktree.uniqueAgents)
                    }
                }

                if !worktree.sessions.isEmpty {
                    section("Sessions (\(worktree.sessions.count))") {
                        sessionRows(worktree.sessions)
                    }
                }

                if let error = worktree.error {
                    section("Scan error") {
                        Text(error)
                            .font(HudFont.mono(HudTextSize.xxs))
                            .foregroundStyle(ScoutPalette.statusError)
                            .textSelection(.enabled)
                    }
                }
            }
            .padding(.horizontal, ScoutReposMetrics.pageGutter)
            .padding(.vertical, HudSpacing.lg)
        }
    }

    // MARK: Project context

    private func projectContext(_ project: RepoProject) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xl) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: HudSpacing.sm) {
                        ScoutRepoStateDot(
                            color: reposAttentionColor(project.attention),
                            live: reposAttentionLive(project.attention)
                        )
                        Text(project.name)
                            .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                            .foregroundStyle(ScoutPalette.ink)
                            .lineLimit(1)
                        Spacer(minLength: HudSpacing.sm)
                        HudBadge(project.attention.rawValue, tint: reposAttentionColor(project.attention))
                    }
                    Text(repoShortPath(project.root, segments: 4))
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutPalette.dim)
                        .textSelection(.enabled)
                }

                HudDivider(color: ScoutDesign.hairline)

                if !project.attentionReasons.isEmpty {
                    section("Why") {
                        VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                            ForEach(project.attentionReasons, id: \.self) { reason in
                                Text("• \(reason)")
                                    .font(HudFont.ui(HudTextSize.xs))
                                    .foregroundStyle(ScoutPalette.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                section("Worktrees") {
                    VStack(alignment: .leading, spacing: HudSpacing.xs) {
                        keyValue("Total", "\(project.stats.worktrees)")
                        if project.stats.dirtyWorktrees > 0 {
                            keyValue("Dirty", "\(project.stats.dirtyWorktrees)", tint: ScoutPalette.statusWarn)
                        }
                        if project.stats.conflictedWorktrees > 0 {
                            keyValue("Conflicted", "\(project.stats.conflictedWorktrees)", tint: ScoutPalette.statusError)
                        }
                    }
                }

                section("Changes") {
                    VStack(alignment: .leading, spacing: HudSpacing.xs) {
                        keyValue("Staged", "\(project.stats.staged)", tint: project.stats.staged > 0 ? ScoutPalette.statusOk : nil)
                        keyValue("Unstaged", "\(project.stats.unstaged)", tint: project.stats.unstaged > 0 ? ScoutPalette.statusWarn : nil)
                        keyValue("Untracked", "\(project.stats.untracked)")
                        if project.stats.conflicts > 0 {
                            keyValue("Conflicts", "\(project.stats.conflicts)", tint: ScoutPalette.statusError)
                        }
                    }
                }

                section("Attached") {
                    VStack(alignment: .leading, spacing: HudSpacing.xs) {
                        keyValue("Agents", "\(project.stats.attachedAgents)")
                        keyValue("Sessions", "\(project.stats.attachedSessions)")
                    }
                }
            }
            .padding(.horizontal, ScoutReposMetrics.pageGutter)
            .padding(.vertical, HudSpacing.lg)
        }
    }

    // MARK: Inspector building blocks

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HudSectionLabel(title)
            content()
        }
    }

    private func keyValue(_ key: String, _ value: String, tint: Color? = nil) -> some View {
        HStack(spacing: HudSpacing.md) {
            Text(key)
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
            Spacer(minLength: HudSpacing.md)
            Text(value)
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(tint ?? ScoutPalette.ink)
                .monospacedDigit()
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }

    @ViewBuilder
    private func statusRows(_ status: RepoStatus) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            if status.staged > 0 {
                keyValue("Staged", "\(status.staged)", tint: ScoutPalette.statusOk)
            }
            if status.unstaged > 0 {
                keyValue("Unstaged", "\(status.unstaged)", tint: ScoutPalette.statusWarn)
            }
            if status.untracked > 0 {
                keyValue("Untracked", "\(status.untracked)", tint: ScoutPalette.muted)
            }
            if status.conflicts > 0 {
                keyValue("Conflicts", "\(status.conflicts)", tint: ScoutPalette.statusError)
            }
            keyValue("Changed files", "\(status.changedFiles)")
        }
    }

    @ViewBuilder
    private func branchRows(_ branch: RepoBranch) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            if let name = branch.name {
                keyValue("Branch", name)
            }
            if branch.detached {
                keyValue("Detached", String((branch.head ?? "").prefix(7)))
            }
            if let upstream = branch.upstream {
                keyValue("Upstream", upstream)
            }
            if branch.ahead > 0 {
                keyValue("Ahead", "\(branch.ahead)", tint: ScoutPalette.statusInfo)
            }
            if branch.behind > 0 {
                keyValue("Behind", "\(branch.behind)", tint: ScoutPalette.statusWarn)
            }
            if branch.isMain {
                keyValue("Default branch", "yes")
            }
            if let head = branch.head, !branch.detached {
                keyValue("HEAD", String(head.prefix(10)))
            }
        }
    }

    @ViewBuilder
    private func changedFiles(_ files: [RepoChangedFile]) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxs) {
            ForEach(Array(files.prefix(14))) { file in
                HStack(spacing: HudSpacing.sm) {
                    Text(fileStatusTag(file.status))
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(0.4)
                        .foregroundStyle(fileStatusTint(file.status))
                        .frame(width: 26, alignment: .leading)
                    Text(repoShortPath(file.path, segments: 3))
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutPalette.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 0)
                }
            }
            if files.count > 14 {
                Text("+\(files.count - 14) more")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
    }

    @ViewBuilder
    private func agentRows(_ agents: [RepoAgentRef]) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            ForEach(agents) { agent in
                HStack(spacing: HudSpacing.sm) {
                    ScoutRepoAgentChip(agent: agent)
                    Text(agent.handle)
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutPalette.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: HudSpacing.sm)
                    Text(agent.stateWord)
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(agent.live ? ScoutPalette.accent : ScoutPalette.dim)
                }
            }
        }
    }

    @ViewBuilder
    private func sessionRows(_ sessions: [RepoSessionRef]) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            ForEach(sessions) { session in
                HStack(spacing: HudSpacing.sm) {
                    Text(session.source ?? session.harness ?? "session")
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutPalette.muted)
                        .lineLimit(1)
                    Spacer(minLength: HudSpacing.sm)
                    Text(String(session.id.prefix(8)))
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                }
            }
        }
    }

    private func fileStatusTag(_ status: String) -> String {
        switch status {
        case "untracked": return "??"
        case "conflict": return "!!"
        case "staged": return "S"
        case "unstaged": return "M"
        case "staged+unstaged": return "SM"
        default: return "•"
        }
    }

    private func fileStatusTint(_ status: String) -> Color {
        switch status {
        case "conflict": return ScoutPalette.statusError
        case "staged": return ScoutPalette.statusOk
        case "unstaged": return ScoutPalette.statusWarn
        case "staged+unstaged": return ScoutPalette.statusInfo
        case "untracked": return ScoutPalette.muted
        default: return ScoutPalette.dim
        }
    }
}
