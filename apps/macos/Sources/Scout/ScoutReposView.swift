import Foundation
import HudsonUI
import ScoutAppCore
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

    // Table columns — fixed widths so CHURN · FILES · DRIFT · AGENTS align down
    // the list (the name column flexes), mirroring the web grid.
    static let gaugeWidth: CGFloat = 56
    static let positionCellWidth: CGFloat = 104
    static let secondLineInset: CGFloat = 34

    static let rowHeight: CGFloat = 30
    static let churnColWidth: CGFloat = 104
    static let churnNumWidth: CGFloat = 36   // +adds / −dels each right-align in a fixed slot
    static let churnBarWidth: CGFloat = 24   // proportional split bar, fixed trailing slot
    static let filesColWidth: CGFloat = 44
    static let driftColWidth: CGFloat = 104
    static let agentsColWidth: CGFloat = 132
    static let touchedColWidth: CGFloat = 56
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

// MARK: - Sort (mirrors the web table)

enum ReposSortKey: String, CaseIterable, Sendable {
    case attention, name, churn, files, drift, agents, touched

    var defaultDir: ReposSortDir { self == .name ? .asc : .desc }

    /// Column header label (the `name` column carries the repo/branch spine).
    var label: String {
        switch self {
        case .attention: return "ATTN"
        case .name: return "REPO / BRANCH · WORKTREE"
        case .churn: return "CHURN"
        case .files: return "FILES"
        case .drift: return "DRIFT"
        case .agents: return "AGENTS"
        case .touched: return "TOUCHED"
        }
    }
}

enum ReposSortDir: Sendable { case asc, desc }

// MARK: - Tree model (repo → worktree)

@MainActor
final class ScoutReposTreeModel: ObservableObject {
    /// Projects default to expanded (empty = none collapsed) so the tree opens
    /// at repo→worktree.
    @Published var collapsedProjects: Set<String> = []

    @Published private(set) var selectedID: String?
    @Published private(set) var selectedProjectID: String?
    @Published private(set) var selectedWorktreeID: String?

    /// Sort key + direction, default attention/desc (worst-first). Clicking a
    /// column header toggles direction or switches key — mirrors the web table.
    @Published private(set) var sortKey: ReposSortKey = .attention
    @Published private(set) var sortDir: ReposSortDir = .desc

    func toggleSort(_ key: ReposSortKey) {
        if key == sortKey {
            sortDir = sortDir == .asc ? .desc : .asc
        } else {
            sortKey = key
            sortDir = key.defaultDir
        }
    }

    // MARK: Sort scoring (the web `sortRows` twin)

    private var sortSign: Double { sortDir == .asc ? 1 : -1 }

    /// Per-worktree score for the active key (higher = more significant); the
    /// sign of `sortDir` flips it. `name` is handled by a string compare.
    private func score(_ wt: RepoWorktree) -> Double {
        switch sortKey {
        case .attention: return Double(-wt.attention.rank)
        case .churn: return Double(wt.churn.total)
        case .files: return Double(wt.status.changedFiles)
        case .drift: return Double(wt.branch.ahead + wt.branch.behind)
        case .agents:
            let live = wt.uniqueAgents.contains { $0.live } ? 1.0 : 0.0
            return live * 1_000_000 + Double(wt.uniqueAgents.count)
        case .touched: return wt.lastTouchedAt ?? 0
        case .name: return 0
        }
    }

    private func projectScore(_ project: RepoProject) -> Double {
        project.worktrees.map { score($0) }.max() ?? -.greatestFiniteMagnitude
    }

    private func compareNames(_ a: String, _ b: String) -> Double {
        switch a.localizedCaseInsensitiveCompare(b) {
        case .orderedAscending: return -1
        case .orderedDescending: return 1
        default: return 0
        }
    }

    private func cmpWorktree(_ a: RepoWorktree, _ b: RepoWorktree) -> Double {
        if sortKey == .name {
            return compareNames(a.branchParts.leaf, b.branchParts.leaf) * sortSign
        }
        let d = (score(a) - score(b)) * sortSign
        if d != 0 { return d }
        let ar = Double(a.attention.rank - b.attention.rank)
        if ar != 0 { return ar }
        return compareNames(a.name, b.name)
    }

    private func cmpProject(_ a: RepoProject, _ b: RepoProject) -> Double {
        if sortKey == .name {
            return compareNames(a.name, b.name) * sortSign
        }
        let d = (projectScore(a) - projectScore(b)) * sortSign
        if d != 0 { return d }
        return compareNames(a.name, b.name)
    }

    /// Projects ordered by the active sort (project score = its worst worktree),
    /// keeping each repo's worktrees adjacent — the web grouping rule.
    func sortedProjects(_ projects: [RepoProject]) -> [RepoProject] {
        projects.sorted { cmpProject($0, $1) < 0 }
    }

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

    /// Worktrees ordered by the active sort, with clean-&-idle folded out unless
    /// `showClean`.
    func visibleWorktrees(_ project: RepoProject, showClean: Bool) -> [RepoWorktree] {
        let sorted = project.worktrees.sorted { cmpWorktree($0, $1) < 0 }
        return showClean ? sorted : sorted.filter { $0.hasActivity }
    }

    func rows(_ projects: [RepoProject], showClean: Bool) -> [Row] {
        var out: [Row] = []
        for project in sortedProjects(projects) {
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
    /// SCO-065 — open the repo-diff for a specific worktree (the row's visible
    /// "diff" affordance). The diff now fills the **embedded bottom panel** in
    /// place (`ScoutReposDiffPanel`) rather than a slide-up sheet, so this just
    /// records which worktree the docked panel should show. Web parity: the web
    /// Repo Watch row exposes the same affordance.
    let onOpenDiff: (RepoWorktree) -> Void

    // MARK: Embedded diff panel state

    /// Persisted height of the docked diff panel as a fraction of the Repos
    /// content height (default ~40%, clamped to a calm band). Resolution-
    /// independent so the split survives window resizes.
    @AppStorage(ScoutReposDiffResize.heightKey)
    private var storedDiffFraction = Double(ScoutReposDiffResize.defaultHeightFraction)
    /// Non-nil only while dragging the divider; the split prefers it over the
    /// stored fraction so a drag doesn't write UserDefaults per frame.
    @State private var diffDragPreview: CGFloat?
    /// The worktree id the user explicitly folded the diff away for. The panel
    /// stays collapsed for that selection until they pick another worktree or
    /// re-click the same one — so "close" sticks but never traps the panel shut.
    @State private var dismissedDiffWorktreeID: String?

    /// The worktree whose diff the docked panel should render: the cursor's
    /// selected worktree, unless the user has folded the panel away for it.
    private var diffWorktree: RepoWorktree? {
        guard let id = tree.selectedWorktreeID, id != dismissedDiffWorktreeID else { return nil }
        guard let wt = repos.worktree(id: id), !wt.path.isEmpty else { return nil }
        return wt
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let error = repos.lastError {
                errorBanner(error)
            }
            columnHeader
            splitBody
        }
        .background(ScoutDesign.bg)
        // Re-clicking a worktree row (`onOpenDiff`) re-opens the panel even if it
        // was folded away for that same selection.
        .onChange(of: tree.selectedWorktreeID) { _, id in
            if id != dismissedDiffWorktreeID { dismissedDiffWorktreeID = nil }
        }
    }

    /// The Repos view as a vertical split — the Studio `ReposPage` construction
    /// ported to native: the repo/worktree **table on top** (`reposMain`,
    /// border-bottom) and the **diff panel docked below** (`diff`). A draggable
    /// horizontal divider sets the split; selecting a worktree fills the bottom
    /// panel in place (no sheet), and folding it away returns the table to full
    /// height. "Drifts in the table, diffs below."
    private var splitBody: some View {
        GeometryReader { geo in
            let panelHeight = diffPanelHeight(in: geo.size.height)
            VStack(spacing: 0) {
                treeScroll
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if let worktree = diffWorktree {
                    ScoutReposDiffDividerHandle(
                        fraction: $storedDiffFraction,
                        previewFraction: $diffDragPreview,
                        range: ScoutReposDiffResize.heightRange,
                        hostHeight: geo.size.height
                    )
                    ScoutReposDiffPanel(
                        worktreePath: worktree.path,
                        branchParts: worktree.branchParts,
                        onClose: { dismissedDiffWorktreeID = worktree.id }
                    )
                    .frame(height: panelHeight)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .animation(.easeOut(duration: 0.16), value: diffWorktree?.id)
        }
    }

    /// Docked panel height in points for the current Repos content height —
    /// the live drag preview while dragging, else the persisted fraction, always
    /// clamped to the calm band so neither the table nor the diff is squeezed out.
    private func diffPanelHeight(in hostHeight: CGFloat) -> CGFloat {
        let fraction = diffDragPreview ?? CGFloat(storedDiffFraction)
        let clamped = min(ScoutReposDiffResize.heightRange.upperBound,
                          max(ScoutReposDiffResize.heightRange.lowerBound, fraction))
        return hostHeight * clamped
    }

    // MARK: Sortable column header

    private var columnHeader: some View {
        HStack(spacing: 0) {
            sortButton(.name, edge: .leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            sortButton(.churn, edge: .trailing)
                .frame(width: ScoutReposMetrics.churnColWidth, alignment: .trailing)
            sortButton(.files, edge: .trailing)
                .frame(width: ScoutReposMetrics.filesColWidth, alignment: .trailing)
            sortButton(.drift, edge: .center)
                .frame(width: ScoutReposMetrics.driftColWidth, alignment: .center)
            sortButton(.agents, edge: .leading)
                .frame(width: ScoutReposMetrics.agentsColWidth, alignment: .leading)
            sortButton(.touched, edge: .trailing)
                .frame(width: ScoutReposMetrics.touchedColWidth, alignment: .trailing)
        }
        .padding(.horizontal, ScoutReposMetrics.pageGutter)
        .frame(height: 26)
        .background(ScoutDesign.bg)
        .overlay(alignment: .top) { HudDivider(color: ScoutDesign.hairline) }
        .overlay(alignment: .bottom) { HudDivider(color: ScoutDesign.hairlineStrong) }
    }

    private enum SortEdge { case leading, center, trailing }

    private func sortButton(_ key: ReposSortKey, edge: SortEdge) -> some View {
        let on = tree.sortKey == key
        return Button {
            withAnimation(.easeOut(duration: 0.14)) { tree.toggleSort(key) }
        } label: {
            HStack(spacing: 4) {
                if edge == .trailing { caret(on: on) }
                Text(key.label)
                    .font(HudFont.mono(HudTextSize.micro, weight: on ? .bold : .medium))
                    .tracking(0.7)
                    .foregroundStyle(on ? ScoutPalette.ink : ScoutPalette.dim)
                if edge != .trailing { caret(on: on) }
            }
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
    }

    @ViewBuilder
    private func caret(on: Bool) -> some View {
        Image(systemName: tree.sortDir == .asc ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
            .font(.system(size: 6))
            .foregroundStyle(ScoutPalette.muted)
            .opacity(on ? 1 : 0)
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
    }

    private var titleCluster: some View {
        let totals = repos.totals
        return HStack(spacing: HudSpacing.sm) {
            Text("Repos")
                .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)

            statusPill
            refreshReceiptPill

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
        } else if repos.isRefreshing {
            HudBadge("Refreshing", tint: ScoutPalette.statusWarn, dot: true)
        } else {
            HudBadge("Live", tint: ScoutPalette.statusOk, dot: true)
        }
    }

    @ViewBuilder private var refreshReceiptPill: some View {
        if repos.lastRefreshWasForced, let fetchedAt = repos.lastFetchedAt {
            HudBadge("Fresh \(Self.refreshClock.string(from: fetchedAt))", tint: ScoutPalette.statusOk)
        }
    }

    private static let refreshClock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

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
                repos.refresh(force: true)
            } label: {
                HStack(spacing: HudSpacing.xxs) {
                    Image(systemName: "arrow.clockwise")
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    Text(repos.isRefreshing ? "Refreshing" : "Refresh")
                        .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                }
                .foregroundStyle(repos.isRefreshing ? ScoutPalette.statusWarn : ScoutPalette.dim)
            }
            .buttonStyle(.plain)
            .disabled(repos.isRefreshing)
            .scoutPointerCursor()
            .help("Force a fresh repository scan")
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
                        onActivate: onActivate,
                        // Clicking a worktree row fills the embedded diff panel in
                        // place — no sheet. Clearing the dismissed id here re-opens
                        // the panel even when the row is already selected (re-click
                        // after a fold); `onChange(selectedWorktreeID)` only covers
                        // the *changed*-selection case. The parent's `onOpenDiff`
                        // (the legacy slide-up `ScoutBranchDiffSheet`) is left
                        // wired but intentionally not driven from here, so the
                        // primary Repos flow is the docked panel, never the sheet.
                        onOpenDiff: { _ in
                            withAnimation(.easeOut(duration: 0.16)) {
                                dismissedDiffWorktreeID = nil
                            }
                        }
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
    let onOpenDiff: (RepoWorktree) -> Void

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
        .animation(moveAnimation, value: model.selectedID)
    }

    @ViewBuilder
    private func rowView(_ row: ScoutReposTreeModel.Row) -> some View {
        let selected = row.id == model.selectedID
        let hovered = row.id == hoveredID
        let isProject = row.worktreeID == nil

        HStack(spacing: 0) {
            content(for: row)
        }
        .padding(.horizontal, ScoutReposMetrics.pageGutter)
        .frame(height: ScoutReposMetrics.rowHeight)
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
            } else if isProject {
                ScoutPalette.chrome.opacity(0.4)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(ScoutPalette.hairline).frame(height: 1)
        }
        .contentShape(Rectangle())
        .onHover { inside in hoveredID = inside ? row.id : (hoveredID == row.id ? nil : hoveredID) }
        .onTapGesture(count: 2) { activate(row) }
        .onTapGesture {
            select(row)
            // Clicking a worktree row raises its diff sheet directly (project
            // rows just select / toggle). Keyboard nav goes through select()
            // only, so it never triggers this.
            if let wt = worktree(for: row), !wt.path.isEmpty { onOpenDiff(wt) }
        }
    }

    /// Resolve the `RepoWorktree` backing a worktree row (nil for project rows).
    private func worktree(for row: ScoutReposTreeModel.Row) -> RepoWorktree? {
        guard case .worktree(let projectID, let worktreeID) = row.kind else { return nil }
        return projectsByID[projectID]?.worktrees.first { $0.id == worktreeID }
    }

    /// One grid row: a flexible name cell + the four fixed columns (CHURN ·
    /// FILES · DRIFT · AGENTS), so they align down the list and under the
    /// sortable header. Project rows aggregate; worktree rows are per-tree.
    @ViewBuilder
    private func content(for row: ScoutReposTreeModel.Row) -> some View {
        switch row.kind {
        case .project(let id):
            if let project = projectsByID[id] {
                projectNameCell(project)
                    .frame(maxWidth: .infinity, alignment: .leading)
                projectChurnCol(project)
                Color.clear.frame(width: ScoutReposMetrics.filesColWidth)
                Color.clear.frame(width: ScoutReposMetrics.driftColWidth)
                projectAgentsCol(project)
                projectTouchedCol(project)
            }
        case .worktree(let projectID, let worktreeID):
            if let project = projectsByID[projectID],
               let wt = project.worktrees.first(where: { $0.id == worktreeID }) {
                worktreeNameCell(wt, isLast: isLastWorktree(wt, in: project))
                    .frame(maxWidth: .infinity, alignment: .leading)
                churnCol(wt)
                filesCol(wt)
                positionCell(wt)
                agentsCol(wt)
                touchedCol(wt)
            }
        }
    }

    /// TOUCHED column — relative time since the worktree was last edited
    /// (working-tree mtime), so you can sort the fleet by recency of work.
    private func touchedCol(_ wt: RepoWorktree) -> some View {
        Text(wt.lastTouchedAgo(generatedAt: generatedAt) ?? "—")
            .font(HudFont.mono(HudTextSize.xxs))
            .foregroundStyle(ScoutPalette.dim)
            .contentTransition(.numericText())
            .frame(width: ScoutReposMetrics.touchedColWidth, alignment: .trailing)
    }

    private func projectTouchedCol(_ project: RepoProject) -> some View {
        let newest = project.worktrees.compactMap { $0.lastTouchedAt }.max()
        return Text(newest.map { RepoRelativeTime.ago(fromMillis: $0, now: generatedAt) } ?? "—")
            .font(HudFont.mono(HudTextSize.xxs))
            .foregroundStyle(ScoutPalette.dim)
            .frame(width: ScoutReposMetrics.touchedColWidth, alignment: .trailing)
    }

    private func isLastWorktree(_ wt: RepoWorktree, in project: RepoProject) -> Bool {
        model.visibleWorktrees(project, showClean: showClean).last?.id == wt.id
    }

    @ViewBuilder
    private func projectNameCell(_ project: RepoProject) -> some View {
        HStack(spacing: HudSpacing.sm) {
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
            Text(repoShortPath(project.root, segments: 3))
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: HudSpacing.sm)
        }
    }

    private func projectChurnCol(_ project: RepoProject) -> some View {
        let add = project.worktrees.reduce(0) { $0 + $1.churn.add }
        let del = project.worktrees.reduce(0) { $0 + $1.churn.del }
        return churnCell(add: add, del: del, dim: true)
    }

    @ViewBuilder
    private func projectAgentsCol(_ project: RepoProject) -> some View {
        let live = project.worktrees.reduce(0) { $0 + $1.uniqueAgents.filter { $0.live }.count }
        Group {
            if live > 0 {
                Text("\(live) live").foregroundStyle(ScoutPalette.accent)
            } else if project.stats.attachedAgents > 0 {
                Text("\(project.stats.attachedAgents) idle").foregroundStyle(ScoutPalette.dim)
            } else {
                Text("")
            }
        }
        .font(HudFont.mono(HudTextSize.micro))
        .frame(width: ScoutReposMetrics.agentsColWidth, alignment: .leading)
    }

    /// Driftline worktree row — identity (state dot + branch) on the left, then
    /// three fixed-width columns (POSITION gauge · WORK · LAST) so they align
    /// down the list. Active worktrees gain a quiet second line: upstream, a
    /// descriptive position phrase, and any agents — never a harsh verdict pill.
    /// Worktree name cell — tree guide, state dot, branch label, and any quiet
    /// tags (SCAN ERR / DETACHED / LOCAL). The four columns to its right carry
    /// churn, files, the drift gauge, and agents.
    @ViewBuilder
    private func worktreeNameCell(_ wt: RepoWorktree, isLast: Bool) -> some View {
        HStack(spacing: HudSpacing.sm) {
            RepoTreeGuide(isLast: isLast)
            ScoutRepoStateDot(color: reposStateColor(wt.state), live: wt.state == .live, size: 7)
            branchLabel(wt.branchParts)
            tags(wt)
            Spacer(minLength: HudSpacing.sm)
        }
    }

    @ViewBuilder
    private func tags(_ wt: RepoWorktree) -> some View {
        if wt.error != nil {
            repoTag("SCAN ERR", tint: ScoutPalette.statusError)
        }
        if wt.branch.detached {
            repoTag("DETACHED", tint: ScoutPalette.muted)
        } else if wt.branch.upstream == nil && !wt.branch.isMain {
            repoTag("LOCAL", tint: ScoutPalette.dim)
        }
    }

    private func repoTag(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(HudFont.mono(HudTextSize.micro, weight: .bold))
            .tracking(0.4)
            .foregroundStyle(tint)
            .padding(.horizontal, 4)
            .padding(.vertical, 1)
            .background(RoundedRectangle(cornerRadius: HudRadius.tight).fill(tint.opacity(0.12)))
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

    /// CHURN column — +adds/−dels with a proportional split bar (web `Churn`).
    private func churnCol(_ wt: RepoWorktree) -> some View {
        churnCell(add: wt.churn.add, del: wt.churn.del)
    }

    /// Shared churn cell for both project (aggregate) and worktree rows: the add
    /// and del counts each right-align in a fixed slot and the split bar sits in
    /// a fixed trailing slot, so every churn value lines up down the list and
    /// the cell never wraps no matter how large the diff. `dim` quiets the
    /// aggregate row so it reads as a rollup.
    @ViewBuilder
    private func churnCell(add: Int, del: Int, dim: Bool = false) -> some View {
        let alpha = dim ? 0.85 : 1
        HStack(spacing: 0) {
            if add > 0 || del > 0 {
                Text("+\(add)")
                    .foregroundStyle(ScoutPalette.statusOk.opacity(alpha))
                    .frame(width: ScoutReposMetrics.churnNumWidth, alignment: .trailing)
                Text("−\(del)")
                    .foregroundStyle(ScoutPalette.statusError.opacity(alpha))
                    .frame(width: ScoutReposMetrics.churnNumWidth, alignment: .trailing)
                RepoChurnBar(add: add, del: del, width: ScoutReposMetrics.churnBarWidth)
                    .padding(.leading, HudSpacing.sm)
            } else {
                Text("—")
                    .foregroundStyle(ScoutPalette.dim)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .font(HudFont.mono(HudTextSize.micro))
        .monospacedDigit()
        .frame(width: ScoutReposMetrics.churnColWidth, alignment: .trailing)
    }

    /// FILES column — changed-file count with a conflict warning when present.
    @ViewBuilder
    private func filesCol(_ wt: RepoWorktree) -> some View {
        Group {
            if wt.status.changedFiles > 0 {
                HStack(spacing: 2) {
                    Text("\(wt.status.changedFiles)").foregroundStyle(ScoutPalette.muted)
                    if wt.status.conflicts > 0 {
                        Text("⚠\(wt.status.conflicts)").foregroundStyle(ScoutPalette.statusWarn)
                    }
                }
                .monospacedDigit()
            } else {
                Text("—").foregroundStyle(ScoutPalette.dim)
            }
        }
        .font(HudFont.mono(HudTextSize.xxs))
        .frame(width: ScoutReposMetrics.filesColWidth, alignment: .trailing)
    }

    /// AGENTS column — a live badge + up to two handles + overflow (web `Agents`).
    @ViewBuilder
    private func agentsCol(_ wt: RepoWorktree) -> some View {
        Group {
            if wt.uniqueAgents.isEmpty {
                Text("—").foregroundStyle(ScoutPalette.dim)
            } else {
                let liveCount = wt.uniqueAgents.filter { $0.live }.count
                HStack(spacing: HudSpacing.xs) {
                    if liveCount > 0 {
                        HStack(spacing: 2) {
                            Circle().fill(ScoutPalette.accent).frame(width: 5, height: 5)
                            Text("\(liveCount)").foregroundStyle(ScoutPalette.accent)
                        }
                    }
                    Text(wt.uniqueAgents.prefix(2).map { $0.handle }.joined(separator: " "))
                        .foregroundStyle(ScoutPalette.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    if wt.uniqueAgents.count > 2 {
                        Text("+\(wt.uniqueAgents.count - 2)").foregroundStyle(ScoutPalette.dim)
                    }
                }
            }
        }
        .font(HudFont.mono(HudTextSize.micro))
        .frame(width: ScoutReposMetrics.agentsColWidth, alignment: .leading)
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

/// Tree connector for an indented worktree — a faint vertical spine + an L-stub
/// into the row. The spine stops at the row's middle for the last worktree.
struct RepoTreeGuide: View {
    var isLast: Bool = false
    private let guideWidth: CGFloat = 16

    var body: some View {
        let h = ScoutReposMetrics.rowHeight
        ZStack(alignment: .topLeading) {
            Rectangle()
                .fill(ScoutPalette.hairlineStrong)
                .frame(width: 1, height: isLast ? h / 2 : h)
                .offset(x: 6)
            Rectangle()
                .fill(ScoutPalette.hairlineStrong)
                .frame(width: 7, height: 1)
                .offset(x: 6, y: h / 2)
        }
        .frame(width: guideWidth, height: h)
    }
}

/// Proportional churn split bar — accent adds / error dels (web `.cbar`).
struct RepoChurnBar: View {
    let add: Int
    let del: Int
    var width: CGFloat = 38

    var body: some View {
        let tot = CGFloat(max(add + del, 1))
        HStack(spacing: 0) {
            Rectangle().fill(ScoutPalette.statusOk).frame(width: width * CGFloat(add) / tot)
            Rectangle().fill(ScoutPalette.statusError).frame(width: width * CGFloat(del) / tot)
        }
        .frame(width: width, height: 3)
        .clipShape(Capsule())
        .background(Capsule().fill(ScoutPalette.hairlineStrong))
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

private enum ScoutRepoAskService {
    @MainActor
    static func sendToAssistant(body: String) async throws {
        await ScoutComposeService.shared.send(body: body, targetHandle: nil)
        if let error = ScoutComposeService.shared.lastError {
            throw ScoutRepoAskError(message: error)
        }
    }

    static func askAgent(agentId: String, targetLabel: String?, body: String) async throws {
        var payload: [String: Any] = [
            "body": body,
            "targetAgentId": agentId,
            "metadata": [
                "source": "repo-watch",
                "originSurface": "repo-watch",
                "handoffKind": "repo-watch-agent-ask",
                "targetAgentId": agentId,
            ],
        ]
        if let targetLabel, !targetLabel.isEmpty {
            payload["targetLabel"] = targetLabel
        }
        try await post(path: "api/ask", payload: payload)
    }

    private static func post(path: String, payload: [String: Any]) async throws {
        let url = ScoutWeb.baseURL().appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        try await ScoutHTTP.send(request)
    }
}

private struct ScoutRepoAskError: LocalizedError {
    let message: String

    var errorDescription: String? { message }
}

// MARK: - Inspector (Context pane — follows the cursor)

struct ScoutReposInspector: View {
    @ObservedObject var repos: ScoutRepoStore
    @ObservedObject var tree: ScoutReposTreeModel
    @Binding var inputFocused: Bool
    @State private var askDraft = ""
    @State private var askTarget = "assistant"
    @State private var isAsking = false
    @State private var askError: String?
    @State private var askConfirmation: String?
    @FocusState private var askFocused: Bool

    var body: some View {
        let worktree = repos.worktree(id: tree.selectedWorktreeID)
        let project = worktree.flatMap { repos.project(forWorktree: $0.id) }
            ?? repos.project(id: tree.selectedProjectID)

        VStack(spacing: 0) {
            if let worktree {
                worktreeContext(worktree)
            } else if let project {
                projectContext(project)
            } else {
                HudEmptyState(
                    title: "Nothing selected",
                    subtitle: "Select a repo or worktree to inspect.",
                    icon: "sidebar.right"
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            if worktree != nil || project != nil {
                HudDivider(color: ScoutDesign.hairlineStrong)
                askBox(worktree: worktree, project: project)
            }
        }
        .onChange(of: tree.selectedID) { _, _ in
            reconcileAskTarget(worktree: repos.worktree(id: tree.selectedWorktreeID),
                               project: repos.project(id: tree.selectedProjectID))
        }
        .onChange(of: askFocused) { _, focused in
            inputFocused = focused
        }
        .onDisappear {
            inputFocused = false
        }
    }

    private var activeTargetLabel: String {
        if let agent = agentTargets(worktree: repos.worktree(id: tree.selectedWorktreeID),
                                    project: repos.project(id: tree.selectedProjectID))
            .first(where: { targetKey(for: $0) == askTarget }) {
            return agent.name?.nilIfEmpty ?? agent.handle
        }
        return "Scout"
    }

    private func askBox(worktree: RepoWorktree?, project: RepoProject?) -> some View {
        let agents = agentTargets(worktree: worktree, project: project)
        return VStack(alignment: .leading, spacing: HudSpacing.sm) {
            VStack(spacing: 0) {
                askFieldRow(worktree: worktree, project: project)
                askToolbar(agents: agents, worktree: worktree, project: project)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .fill(askFocused ? ScoutSurface.controlFocused : ScoutSurface.control)
            )
            .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(askFocused ? ScoutPalette.accent.opacity(0.62) : ScoutDesign.hairlineStrong,
                            lineWidth: HudStrokeWidth.thin)
            )
            .shadow(
                color: askFocused ? ScoutPalette.accent.opacity(0.10) : ScoutSurface.shadow(0.12),
                radius: askFocused ? 6 : 3,
                x: 0,
                y: 1
            )
        }
        .padding(.horizontal, ScoutReposMetrics.pageGutter)
        .padding(.vertical, HudSpacing.md)
        .background(ScoutDesign.bg)
    }

    private func askFieldRow(worktree: RepoWorktree?, project: RepoProject?) -> some View {
        HStack(alignment: .top, spacing: HudSpacing.sm) {
            ZStack(alignment: .topLeading) {
                TextField(askPlaceholder(worktree: worktree, project: project), text: $askDraft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.ink)
                    .tint(ScoutPalette.accent)
                    .lineLimit(1...5)
                    .focused($askFocused)
                    .disabled(isAsking)
                    .onKeyPress(phases: .down) { press in
                        if press.key == .return {
                            if press.modifiers.contains(.shift) {
                                askDraft.append("\n")
                                return .handled
                            }
                            Task { await submitAsk(worktree: worktree, project: project) }
                            return .handled
                        }
                        if press.key == .escape {
                            askFocused = false
                            return .handled
                        }
                        return .ignored
                    }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, HudSpacing.xl)
        .padding(.trailing, HudSpacing.xl)
        .padding(.top, HudSpacing.lg)
        .padding(.bottom, HudSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .topLeading)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(ScoutPalette.accent)
                .frame(width: 2)
                .opacity(askFocused ? 1 : 0.45)
        }
    }

    private func askToolbar(agents: [RepoAgentRef], worktree: RepoWorktree?, project: RepoProject?) -> some View {
        HStack(spacing: HudSpacing.sm) {
            askTargetMenu(agents: agents)

            if isAsking {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.82)
            }

            if let askError {
                Text(askError)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.statusError)
                    .lineLimit(1)
                    .truncationMode(.tail)
            } else if let askConfirmation {
                Text(askConfirmation)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.statusOk)
                    .lineLimit(1)
            } else {
                Text("Repo Watch context is included")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
            }

            Spacer(minLength: HudSpacing.sm)

            Button {
                Task { await submitAsk(worktree: worktree, project: project) }
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .frame(width: 26, height: 22)
            }
            .buttonStyle(.plain)
            .foregroundStyle(canSubmitAsk ? ScoutPalette.bg : ScoutPalette.dim)
            .background(canSubmitAsk ? ScoutPalette.accent : ScoutPalette.surface)
            .clipShape(RoundedRectangle(cornerRadius: HudRadius.tight))
            .disabled(!canSubmitAsk)
            .scoutPointerCursor()
        }
        .padding(.leading, HudSpacing.xl)
        .padding(.trailing, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity)
        .background(ScoutDesign.bg)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(askFocused ? ScoutPalette.accent.opacity(0.32) : ScoutDesign.hairlineStrong)
                .frame(height: HudStrokeWidth.thin)
        }
    }

    private func askTargetMenu(agents: [RepoAgentRef]) -> some View {
        Menu {
            Button {
                askTarget = "assistant"
            } label: {
                Label("Scout", systemImage: askTarget == "assistant" ? "checkmark" : "circle")
            }

            if !agents.isEmpty {
                Divider()
                ForEach(agents) { agent in
                    Button {
                        askTarget = targetKey(for: agent)
                    } label: {
                        Label(agent.name?.nilIfEmpty ?? agent.handle,
                              systemImage: askTarget == targetKey(for: agent) ? "checkmark" : "circle")
                    }
                }
            }
        } label: {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: askTarget == "assistant" ? "sparkles" : "arrowshape.turn.up.right")
                    .font(.system(size: 10, weight: .semibold))
                Text(activeTargetLabel)
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.down")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
            }
            .foregroundStyle(ScoutPalette.ink)
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, 4)
            .background(ScoutPalette.surface)
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight)
                    .stroke(ScoutPalette.hairlineStrong, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
    }

    private func askPlaceholder(worktree: RepoWorktree?, project: RepoProject?) -> String {
        if worktree != nil {
            return askTarget == "assistant"
                ? "ask Scout about this worktree"
                : "ask this agent about the worktree"
        }
        if project != nil {
            return askTarget == "assistant"
                ? "ask Scout about this repo"
                : "ask this agent about the repo"
        }
        return "ask Scout"
    }

    private var canSubmitAsk: Bool {
        !isAsking && !askDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func targetKey(for agent: RepoAgentRef) -> String {
        "agent:\(agent.id)"
    }

    private func agentId(from target: String) -> String? {
        guard target.hasPrefix("agent:") else { return nil }
        return String(target.dropFirst("agent:".count)).nilIfEmpty
    }

    private func reconcileAskTarget(worktree: RepoWorktree?, project: RepoProject?) {
        guard agentId(from: askTarget) != nil else { return }
        let keys = Set(agentTargets(worktree: worktree, project: project).map(targetKey(for:)))
        if !keys.contains(askTarget) {
            askTarget = "assistant"
        }
    }

    private func agentTargets(worktree: RepoWorktree?, project: RepoProject?) -> [RepoAgentRef] {
        let source: [RepoAgentRef]
        if let worktree {
            source = worktree.uniqueAgents
        } else {
            source = project?.worktrees.flatMap(\.uniqueAgents) ?? []
        }

        var seen = Set<String>()
        return source.filter { agent in
            seen.insert(agent.id).inserted
        }
        .prefix(8)
        .map { $0 }
    }

    @MainActor
    private func submitAsk(worktree: RepoWorktree?, project: RepoProject?) async {
        let trimmed = askDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isAsking else { return }

        isAsking = true
        askError = nil
        askConfirmation = nil
        defer { isAsking = false }

        let body = repoAskBody(request: trimmed, worktree: worktree, project: project)
        do {
            if let agentId = agentId(from: askTarget) {
                let agent = agentTargets(worktree: worktree, project: project)
                    .first(where: { $0.id == agentId })
                try await ScoutRepoAskService.askAgent(
                    agentId: agentId,
                    targetLabel: agent?.id,
                    body: body
                )
                askConfirmation = "Asked \(agent?.name?.nilIfEmpty ?? agent?.handle ?? agentId)"
            } else {
                try await ScoutRepoAskService.sendToAssistant(body: body)
                askConfirmation = "Asked Scout"
            }
            askDraft = ""
        } catch {
            askError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func repoAskBody(request: String, worktree: RepoWorktree?, project: RepoProject?) -> String {
        var lines: [String] = ["Operator request:", request, "", "Repo Watch context:"]
        if let project {
            lines.append("- Project: \(project.name)")
            if !project.root.isEmpty { lines.append("- Project root: \(project.root)") }
            lines.append("- Project attention: \(project.attention.rawValue)")
        }
        if let worktree {
            lines.append("- Worktree: \(worktree.path)")
            lines.append("- Branch: \(worktree.branch.name ?? worktree.branch.head ?? "detached")")
            if let upstream = worktree.branch.upstream {
                lines.append("- Upstream: \(upstream)")
            }
            lines.append("- Drift: ahead \(worktree.branch.ahead), behind \(worktree.branch.behind)")
            lines.append("- Status: \(statusSummary(worktree.status))")
            if worktree.churn.has {
                lines.append("- Churn: +\(worktree.churn.add) -\(worktree.churn.del)")
            }
            if !worktree.attentionReasons.isEmpty {
                lines.append("- Attention reasons: \(worktree.attentionReasons.joined(separator: "; "))")
            }
            if !worktree.status.files.isEmpty {
                let files = worktree.status.files.prefix(8).map { "\($0.status): \($0.path)" }
                lines.append("- Changed files: \(files.joined(separator: ", "))")
            }
        } else if let project {
            lines.append("- Worktrees: \(project.stats.worktrees), dirty \(project.stats.dirtyWorktrees), conflicts \(project.stats.conflicts)")
            lines.append("- Changes: staged \(project.stats.staged), unstaged \(project.stats.unstaged), untracked \(project.stats.untracked)")
            if !project.attentionReasons.isEmpty {
                lines.append("- Attention reasons: \(project.attentionReasons.joined(separator: "; "))")
            }
        }
        return lines.joined(separator: "\n")
    }

    private func statusSummary(_ status: RepoStatus) -> String {
        if status.clean {
            return "clean"
        }
        return "staged \(status.staged), unstaged \(status.unstaged), untracked \(status.untracked), conflicts \(status.conflicts), changed files \(status.changedFiles)"
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

                section("Activity") {
                    keyValue("Last touched", worktree.lastTouchedAgo(generatedAt: repos.generatedAt).map { "\($0) ago" } ?? "—")
                    keyValue("Last commit", worktree.lastCommitAgo(generatedAt: repos.generatedAt).map { "\($0) ago" } ?? "—")
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
