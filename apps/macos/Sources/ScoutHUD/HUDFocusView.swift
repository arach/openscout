import AppKit
import ScoutAppCore
import SwiftUI

// Focus tab — attention-first work screen (hud-redesign).
//
// Merges the old agents roster + activity ledger into one surface:
//   ON YOU  — work that needs the operator (attention layer)
//   RECENT  — recent work / activity
//
// Two-line flat rows: title + attribution. Agent and project are facets.
// Single accent; no categorical status colors. The row is the steer target.

private enum FocusLane: Sendable {
    case onYou
    case recent
}

private struct FocusWorkRow: Identifiable, Equatable {
    let id: String
    let title: String
    let agent: String
    let handle: String?
    let project: String
    let ago: String
    let live: Bool
    let awaiting: String?
    let muted: Bool
    let lane: FocusLane
}

struct HUDFocusView: View {
    let agents: [HudAgent]
    let activity: [HudActivityItem]?
    let isLoading: Bool
    var canLoadMore = false
    var isLoadingMore = false
    var loadMoreCount: Int?
    var onLoadMore: () -> Void = {}

    @ObservedObject private var state = HUDState.shared
    @StateObject private var engage = HUDEngageState()

    private var onYouRows: [FocusWorkRow] {
        rows.filter { $0.lane == .onYou }
    }

    private var recentRows: [FocusWorkRow] {
        rows.filter { $0.lane == .recent }
    }

    private var allRows: [FocusWorkRow] { rows }

    var body: some View {
        Group {
            if isLoading && agents.isEmpty && activity == nil {
                FocusLoadingView()
            } else if onYouRows.isEmpty && recentRows.isEmpty {
                FocusEmptyView()
            } else {
                rowsBody
            }
        }
        .onAppear {
            reconcileCursor()
            wireNavBus()
        }
        .onChange(of: rowIds()) { _, _ in
            reconcileCursor()
            wireNavBus()
        }
        .onDisappear { HUDNavBus.shared.clear() }
    }

    private var rowsBody: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if !onYouRows.isEmpty {
                        FocusSectionHead(
                            label: "ON YOU · \(onYouRows.count)",
                            accent: true
                        )
                        ForEach(onYouRows) { row in
                            FocusWorkRowView(
                                row: row,
                                emphasize: true,
                                cursored: engage.isCursored(row.id),
                                engaged: engage.isEngaged(row.id),
                                onTap: { engageRow(row) }
                            )
                            .id(row.id)
                        }
                    }

                    FocusSectionHead(label: "RECENT", dim: onYouRows.isEmpty)
                    if recentRows.isEmpty {
                        FocusQuietNote(text: "No recent work filed yet.")
                    } else {
                        ForEach(recentRows) { row in
                            FocusWorkRowView(
                                row: row,
                                emphasize: false,
                                cursored: engage.isCursored(row.id),
                                engaged: engage.isEngaged(row.id),
                                onTap: { engageRow(row) }
                            )
                            .id(row.id)
                        }
                    }

                    if canLoadMore || isLoadingMore {
                        FocusLoadMoreRow(
                            count: loadMoreCount,
                            isLoading: isLoadingMore,
                            action: onLoadMore
                        )
                    }
                }
                .padding(.bottom, 8)
            }
            .onChange(of: engage.cursoredId) { _, id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.16)) {
                    proxy.scrollTo(id)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: - Model

    private var rows: [FocusWorkRow] {
        let attentionAgents = agents.filter { $0.state == .needsAttention }
        let onYou: [FocusWorkRow] = attentionAgents.map { Self.row(from: $0, lane: .onYou) }

        // RECENT is work-grained: one row per recent agent/session (the broker
        // already ranks the roster by recency), titled by the work itself.
        // We deliberately do NOT expand the message-level activity ledger here —
        // that rendered per-message chatter ("… replied", raw message bodies) as
        // if each line were a unit of work. The agent/session is the work unit;
        // the message is not.
        var recent: [FocusWorkRow] = []
        var seen = Set(onYou.map { $0.id })
        for agent in agents where agent.state != .needsAttention {
            let row = Self.row(from: agent, lane: .recent)
            guard !seen.contains(row.id) else { continue }
            seen.insert(row.id)
            recent.append(row)
        }

        return onYou + recent
    }

    private static func row(from agent: HudAgent, lane: FocusLane) -> FocusWorkRow {
        let title: String = {
            if agent.state == .needsAttention, let ask = agent.pendingAsk, !ask.isEmpty {
                return ask
            }
            let turn = agent.lastTurn.trimmingCharacters(in: .whitespacesAndNewlines)
            if !turn.isEmpty { return turn }
            return agent.displayName
        }()
        let project = projectLabel(for: agent)
        let handle = agent.handle
        let agentLabel: String = {
            if let handle, !handle.isEmpty {
                return handle.hasPrefix("@") ? handle : "@\(handle)"
            }
            return agent.name.hasPrefix("@") ? agent.name : "@\(agent.name)"
        }()
        return FocusWorkRow(
            id: "agent:\(agent.id)",
            title: title,
            agent: agentLabel,
            handle: handle ?? agent.name,
            project: project,
            ago: agent.ago,
            live: agent.state == .working,
            awaiting: nil,
            muted: agent.state == .offline || agent.state == .done || agent.state == .available,
            lane: lane
        )
    }

    private static func projectLabel(for agent: HudAgent) -> String {
        if let project = agent.project?.trimmingCharacters(in: .whitespacesAndNewlines), !project.isEmpty {
            return project
        }
        if let root = agent.projectRoot?.trimmingCharacters(in: .whitespacesAndNewlines), !root.isEmpty {
            return (root as NSString).lastPathComponent
        }
        if let cwd = agent.cwd?.trimmingCharacters(in: .whitespacesAndNewlines), !cwd.isEmpty {
            return (cwd as NSString).lastPathComponent
        }
        return "—"
    }

    // MARK: - Nav

    private func rowIds() -> [String] {
        allRows.map(\.id)
    }

    private func wireNavBus() {
        HUDNavBus.shared.cycleNext = {
            let ids = rowIds()
            guard !ids.isEmpty else { return }
            if let cur = engage.cursoredId, let i = ids.firstIndex(of: cur), i + 1 < ids.count {
                engage.cursor(ids[i + 1])
            } else {
                engage.cursor(ids.first)
            }
        }
        HUDNavBus.shared.cyclePrev = {
            let ids = rowIds()
            guard !ids.isEmpty else { return }
            if let cur = engage.cursoredId, let i = ids.firstIndex(of: cur), i > 0 {
                engage.cursor(ids[i - 1])
            } else {
                engage.cursor(ids.last)
            }
        }
        HUDNavBus.shared.jumpTop = {
            engage.cursor(rowIds().first)
        }
        HUDNavBus.shared.jumpBottom = {
            engage.cursor(rowIds().last)
        }
        HUDNavBus.shared.engageSelected = {
            guard let cursoredId = engage.cursoredId,
                  let row = allRows.first(where: { $0.id == cursoredId }) else { return }
            if engage.engagedId != cursoredId {
                engage.toggle(cursoredId)
            } else {
                stageTarget(row)
            }
        }
        HUDNavBus.shared.unengageSelected = {
            if engage.engagedId != nil {
                engage.unengage()
                return true
            }
            return false
        }
        HUDNavBus.shared.createNew = {
            HUDRunnerState.shared.open()
        }
        HUDNavBus.shared.toggleFollow = nil
    }

    private func reconcileCursor() {
        let ids = rowIds()
        guard !ids.isEmpty else {
            engage.clear()
            return
        }
        if let cursored = engage.cursoredId, ids.contains(cursored) {
            return
        }
        if let engaged = engage.engagedId, ids.contains(engaged) {
            engage.cursor(engaged)
            return
        }
        engage.cursor(ids.first)
    }

    private func engageRow(_ row: FocusWorkRow) {
        withAnimation(.easeOut(duration: 0.12)) {
            engage.toggle(row.id)
        }
        if engage.isEngaged(row.id) {
            stageTarget(row)
        }
    }

    private func stageTarget(_ row: FocusWorkRow) {
        let handle = row.handle ?? row.agent
        HUDDockState.shared.setTarget(handle: handle, label: row.agent)
        HUDDockState.shared.focus()
    }
}

// MARK: - Section head

private struct FocusSectionHead: View {
    let label: String
    var accent: Bool = false
    var dim: Bool = false

    var body: some View {
        HStack(spacing: 6) {
            if accent {
                Circle()
                    .fill(HUDChrome.accent)
                    .frame(width: 5, height: 5)
            }
            Text(label.uppercased())
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(
                    accent ? HUDChrome.accent :
                    dim ? HUDChrome.inkFaint : HUDChrome.inkMuted
                )
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvas)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.border)
                .frame(height: 0.5)
        }
    }
}

// MARK: - Work row (two-line, flat)

// Studio WorkRow (hud-redesign): two lines — title + right-aligned time,
// then `@handle · #project · [awaiting @x]`. Attention rows get a 1.5px
// leading accent bar; live rows get a 5px accent dot before the title.
private struct FocusWorkRowView: View {
    let row: FocusWorkRow
    let emphasize: Bool
    var cursored: Bool = false
    var engaged: Bool = false
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var rowFill: Color {
        if engaged { return HUDChrome.canvasAlt }
        if cursored || hovered { return HUDChrome.canvasAlt.opacity(0.72) }
        return Color.clear
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if row.live {
                        Circle()
                            .fill(HUDChrome.accent)
                            .frame(width: 5, height: 5)
                            .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 3 }
                    }
                    Text(row.title)
                        .font(HUDType.body(13, weight: .medium))
                        .foregroundStyle(HUDChrome.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(row.ago)
                        .font(HUDType.mono(10))
                        .monospacedDigit()
                        .foregroundStyle(HUDChrome.inkFaint)
                        .padding(.leading, 8)
                        .fixedSize()
                }
                // Attribution: @handle · #project · [awaiting @x]
                // Time stays on the title line (right-aligned) per studio.
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(row.agent)
                        .font(HUDType.mono(10))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .lineLimit(1)
                    Text("·")
                        .font(HUDType.mono(10))
                        .foregroundStyle(HUDChrome.inkFaint)
                    Text("#\(row.project)")
                        .font(HUDType.mono(10))
                        .foregroundStyle(HUDChrome.inkFaint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let awaiting = row.awaiting {
                        Text("·")
                            .font(HUDType.mono(10))
                            .foregroundStyle(HUDChrome.inkFaint)
                        Text("awaiting \(awaiting)")
                            .font(HUDType.mono(10))
                            .foregroundStyle(HUDChrome.inkFaint)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(rowFill)
        .opacity(row.muted && !emphasize ? 0.70 : 1)
        .overlay(alignment: .leading) {
            if emphasize {
                Rectangle()
                    .fill(HUDChrome.accent)
                    .frame(width: 1.5)
            } else if engaged || cursored {
                Rectangle()
                    .fill(HUDChrome.accent.opacity(engaged ? 1 : 0.55))
                    .frame(width: engaged ? 1.5 : 1)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.border)
                .frame(height: 0.5)
        }
        .onHover { hovered = $0 }
    }
}

// MARK: - Empty / loading / load more

private struct FocusQuietNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(HUDType.body(12))
            .foregroundStyle(HUDChrome.inkFaint)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FocusEmptyView: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)
            HUDEyebrow(text: "FOCUS  ·  EMPTY", color: HUDChrome.inkFaint)
                .padding(.top, 18)
            Text("Nothing needs you.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)
            Text("Attention and recent work will land here as agents file.")
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 6)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct FocusLoadingView: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<5, id: \.self) { _ in
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 5) {
                        skeleton(width: 220, height: 11)
                        skeleton(width: 140, height: 9)
                    }
                    Spacer(minLength: 0)
                    skeleton(width: 28, height: 9)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(HUDChrome.borderSoft)
                        .frame(height: 0.5)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 12)
    }

    private func skeleton(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(HUDChrome.canvasLift)
            .frame(width: width, height: height)
    }
}

private struct FocusLoadMoreRow: View {
    let count: Int?
    let isLoading: Bool
    let action: () -> Void

    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .scaleEffect(0.72)
                        .frame(width: 10, height: 10)
                } else {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .bold))
                }
                Text(label)
                    .font(HUDType.mono(9, weight: .semibold))
                    .tracking(HUDType.eyebrowMicro)
            }
            .foregroundStyle(hovered ? HUDChrome.ink : HUDChrome.inkMuted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .onHover { hovered = $0 }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
                .padding(.horizontal, 16)
        }
    }

    private var label: String {
        if isLoading { return "LOADING" }
        if let count { return "LOAD \(count) MORE" }
        return "LOAD MORE"
    }
}

// MARK: - Drill link (shared by sessions / tail inline details)

/// Underlined "→ LABEL" row that opens a web surface URL in the default
/// browser. Used by inline HUD details to jump to a deeper web surface.
struct HUDDrillLink: View {
    let label: String
    let url: URL
    var compact: Bool = false

    @State private var hovered = false

    private var arrowSize: CGFloat { compact ? 9 : 11 }
    private var labelSize: CGFloat { compact ? 8.5 : 10 }
    private var horizontalPadding: CGFloat { compact ? 4 : 6 }
    private var verticalPadding: CGFloat { compact ? 2 : 4 }

    var body: some View {
        Button {
            NSWorkspace.shared.open(url)
        } label: {
            HStack(spacing: compact ? 5 : 8) {
                Text("→")
                    .font(HUDType.mono(arrowSize))
                    .foregroundStyle(hovered ? HUDChrome.accent : HUDChrome.inkFaint)
                Text(label)
                    .font(HUDType.mono(labelSize, weight: .semibold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(hovered ? HUDChrome.ink : HUDChrome.inkMuted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .help(url.absoluteString)
    }
}
