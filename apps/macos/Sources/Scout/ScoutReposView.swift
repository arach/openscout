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

    // Driftline columns — fixed widths so POSITION · WORK · LAST align across
    // rows regardless of branch-name length (the branch column flexes).
    static let gaugeWidth: CGFloat = 56
    static let positionCellWidth: CGFloat = 104
    static let workCellWidth: CGFloat = 92
    static let lastCellWidth: CGFloat = 44
    static let secondLineInset: CGFloat = 34
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

        HStack(spacing: HudSpacing.md) {
            content(for: row)
        }
        .padding(.vertical, 8)
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

            // The attention dot already encodes severity — keep the header to a
            // worktree count and a single live indicator; per-state counts live
            // in the project's Context pane.
            Text("\(project.worktrees.count) wt")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
            if project.stats.attachedAgents > 0 {
                ScoutRepoStateDot(color: ScoutPalette.accent, live: true, size: 6)
            }
        }
    }

    /// Driftline worktree row — identity (state dot + branch) on the left, then
    /// three fixed-width columns (POSITION gauge · WORK · LAST) so they align
    /// down the list. Active worktrees gain a quiet second line: upstream, a
    /// descriptive position phrase, and any agents — never a harsh verdict pill.
    @ViewBuilder
    private func worktreeRow(_ row: ScoutReposTreeModel.Row, worktree: RepoWorktree?) -> some View {
        if let wt = worktree {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: HudSpacing.md) {
                    Color.clear.frame(width: ScoutReposMetrics.chevronSlot, height: ScoutReposMetrics.chevronSlot)
                    ScoutRepoStateDot(color: reposStateColor(wt.state), live: wt.state == .live, size: 7)
                    branchLabel(wt.branchParts)
                    Spacer(minLength: HudSpacing.sm)
                    positionCell(wt)
                    workCell(wt)
                    lastCell(wt)
                }
                .frame(maxWidth: .infinity)
                if wt.hasActivity || lens == .drift {
                    secondLine(wt)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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

    /// POSITION column — the hero. A calm behind◀upstream▶ahead gauge flanked by
    /// the exact counts. Degrades to a quiet token for scan errors / detached /
    /// upstream-less branches instead of an alarm.
    @ViewBuilder
    private func positionCell(_ wt: RepoWorktree) -> some View {
        Group {
            if wt.error != nil {
                Text("scan failed")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            } else if wt.branch.detached {
                Text("@" + String((wt.branch.head ?? "").prefix(7)))
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.muted)
            } else if wt.branch.upstream == nil && !wt.branch.isMain {
                Text("local")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            } else {
                HStack(spacing: 3) {
                    Text(wt.branch.behind > 0 ? "↓\(wt.branch.behind)" : "")
                        .foregroundStyle(ScoutPalette.muted)
                        .frame(width: 20, alignment: .trailing)
                    RepoDriftGauge(ahead: wt.branch.ahead, behind: wt.branch.behind, width: ScoutReposMetrics.gaugeWidth)
                    Text(wt.branch.ahead > 0 ? "↑\(wt.branch.ahead)" : "")
                        .foregroundStyle(ScoutPalette.accent)
                        .frame(width: 20, alignment: .leading)
                }
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .monospacedDigit()
            }
        }
        .frame(width: ScoutReposMetrics.positionCellWidth, alignment: .center)
    }

    /// WORK column — churn when there is any, else a quiet file summary, else
    /// "clean". Muted throughout; the full breakdown lives in the inspector.
    @ViewBuilder
    private func workCell(_ wt: RepoWorktree) -> some View {
        Group {
            if wt.error != nil {
                Text("—").foregroundStyle(ScoutPalette.dim)
            } else if wt.churn.has {
                HStack(spacing: 4) {
                    Text("+\(wt.churn.add)").foregroundStyle(ScoutPalette.statusOk)
                    Text("−\(wt.churn.del)").foregroundStyle(ScoutPalette.statusError)
                }
                .monospacedDigit()
            } else if !wt.status.clean {
                Text(workSummary(wt)).foregroundStyle(ScoutPalette.muted)
            } else {
                Text("clean").foregroundStyle(ScoutPalette.dim)
            }
        }
        .font(HudFont.mono(HudTextSize.xxs))
        .frame(width: ScoutReposMetrics.workCellWidth, alignment: .trailing)
    }

    private func workSummary(_ wt: RepoWorktree) -> String {
        let s = wt.status
        if s.conflicts > 0 { return "\(s.conflicts) conflict\(s.conflicts == 1 ? "" : "s")" }
        if s.staged == 0 && s.unstaged == 0 && s.untracked > 0 { return "\(s.untracked) untracked" }
        let n = s.changedFiles > 0 ? s.changedFiles : (s.staged + s.unstaged + s.untracked)
        return "\(n) changed"
    }

    private func lastCell(_ wt: RepoWorktree) -> some View {
        Text(wt.lastCommitAgo(generatedAt: generatedAt) ?? "—")
            .font(HudFont.mono(HudTextSize.xxs))
            .foregroundStyle(ScoutPalette.dim)
            .contentTransition(.numericText())
            .frame(width: ScoutReposMetrics.lastCellWidth, alignment: .trailing)
    }

    /// Quiet second line for active worktrees — upstream, a descriptive position
    /// phrase, and live agents. Calm by construction: dim/muted ink, no pills.
    @ViewBuilder
    private func secondLine(_ wt: RepoWorktree) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Text("↳").foregroundStyle(ScoutPalette.dim)
            if wt.error != nil {
                Text("couldn't read this worktree — moved, deleted, or not a git repo")
                    .foregroundStyle(ScoutPalette.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            } else {
                if let upstream = wt.branch.upstream {
                    Text(upstream).foregroundStyle(ScoutPalette.dim).lineLimit(1).truncationMode(.middle)
                    Text("·").foregroundStyle(ScoutPalette.dim)
                } else if wt.branch.detached {
                    Text("detached").foregroundStyle(ScoutPalette.dim)
                    Text("·").foregroundStyle(ScoutPalette.dim)
                } else {
                    Text("local only").foregroundStyle(ScoutPalette.dim)
                    Text("·").foregroundStyle(ScoutPalette.dim)
                }
                Text(repoPositionPhrase(wt)).foregroundStyle(ScoutPalette.muted)
                ForEach(Array(wt.uniqueAgents.prefix(2))) { agent in
                    Text("·").foregroundStyle(ScoutPalette.dim)
                    HStack(spacing: 3) {
                        ScoutRepoStateDot(color: agent.live ? ScoutPalette.accent : ScoutPalette.dim, live: agent.live, size: 5)
                        Text("\(agent.handle) \(agent.live ? "working" : agent.stateWord.lowercased())")
                            .foregroundStyle(agent.live ? ScoutPalette.muted : ScoutPalette.dim)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .font(HudFont.mono(HudTextSize.micro))
        .padding(.leading, ScoutReposMetrics.secondLineInset)
        .frame(maxWidth: .infinity, alignment: .leading)
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

/// A calm, descriptive position phrase — a fact, never a verdict ("behind 2 ·
/// ahead 5" instead of "DIVERGED"). Upstream / detached / error are surfaced by
/// the row separately.
func repoPositionPhrase(_ wt: RepoWorktree) -> String {
    let b = wt.branch
    if b.ahead > 0 && b.behind > 0 { return "behind \(b.behind) · ahead \(b.ahead)" }
    if b.behind > 0 { return "behind \(b.behind)" }
    if b.ahead > 0 { return "ahead \(b.ahead)" }
    return "in sync"
}

/// The behind◀upstream▶ahead position gauge — the redesign's hero. A base line
/// with a center tick at the fork point; a muted fill extends left for `behind`
/// commits and an accent fill extends right to a head marker for `ahead`. In
/// sync reads as a head dot sitting on the center line. Magnitudes are clamped
/// to `cap` commits; the exact counts live in the flanking labels.
struct RepoDriftGauge: View {
    let ahead: Int
    let behind: Int
    var width: CGFloat = 56

    private let cap = 10
    private let barHeight: CGFloat = 5

    var body: some View {
        let center = width / 2
        let half = width / 2
        let aheadLen = half * min(CGFloat(max(ahead, 0)), CGFloat(cap)) / CGFloat(cap)
        let behindLen = half * min(CGFloat(max(behind, 0)), CGFloat(cap)) / CGFloat(cap)
        ZStack(alignment: .leading) {
            Capsule()
                .fill(ScoutPalette.hairlineStrong)
                .frame(width: width, height: 1.5)
            if behind > 0 {
                Capsule()
                    .fill(ScoutPalette.muted)
                    .frame(width: behindLen, height: barHeight)
                    .offset(x: center - behindLen)
            }
            if ahead > 0 {
                Capsule()
                    .fill(ScoutPalette.accent)
                    .frame(width: aheadLen, height: barHeight)
                    .offset(x: center)
            }
            Rectangle()
                .fill(ScoutPalette.dim)
                .frame(width: 1, height: barHeight + 3)
                .offset(x: center - 0.5)
            Circle()
                .fill(ahead > 0 ? ScoutPalette.accent : ScoutPalette.muted)
                .frame(width: 5, height: 5)
                .offset(x: center + aheadLen - 2.5)
        }
        .frame(width: width, height: barHeight + 4)
    }
}

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
                        Spacer(minLength: 0)
                    }
                    Text(repoShortPath(worktree.path, segments: 4))
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutPalette.dim)
                        .textSelection(.enabled)
                }

                HudDivider(color: ScoutDesign.hairline)

                section("Position") {
                    positionBlock(worktree)
                }

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
                        VStack(alignment: .leading, spacing: HudSpacing.xs) {
                            Text("Scout ran git here and it failed — usually the folder was moved or deleted, or it isn't a git worktree anymore. The raw git output:")
                                .font(HudFont.ui(HudTextSize.xs))
                                .foregroundStyle(ScoutPalette.muted)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(error)
                                .font(HudFont.mono(HudTextSize.xxs))
                                .foregroundStyle(ScoutPalette.statusError)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        }
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

    /// The Position block — the gauge + a descriptive phrase + the branch facts,
    /// leading the inspector the same way the row's POSITION column leads the list.
    @ViewBuilder
    private func positionBlock(_ wt: RepoWorktree) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            if wt.error != nil {
                Text("Scan failed — position unavailable")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.muted)
            } else {
                HStack(spacing: HudSpacing.sm) {
                    Text(wt.branch.behind > 0 ? "↓\(wt.branch.behind)" : "")
                        .foregroundStyle(ScoutPalette.muted)
                        .frame(width: 24, alignment: .trailing)
                    RepoDriftGauge(ahead: wt.branch.ahead, behind: wt.branch.behind, width: 104)
                    Text(wt.branch.ahead > 0 ? "↑\(wt.branch.ahead)" : "")
                        .foregroundStyle(ScoutPalette.accent)
                        .frame(width: 24, alignment: .leading)
                }
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .monospacedDigit()
                Text(repoPositionPhrase(wt))
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(ScoutPalette.ink)
            }
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                if let name = wt.branch.name {
                    keyValue(wt.branch.isMain ? "Branch · default" : "Branch", name)
                }
                if wt.branch.detached {
                    keyValue("Detached", String((wt.branch.head ?? "").prefix(7)))
                } else if let upstream = wt.branch.upstream {
                    keyValue("Upstream", upstream)
                } else {
                    keyValue("Upstream", "—  local only")
                }
                if let head = wt.branch.head, !wt.branch.detached {
                    keyValue("HEAD", String(head.prefix(10)))
                }
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
