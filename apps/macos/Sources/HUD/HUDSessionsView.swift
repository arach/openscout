import AppKit
import SwiftUI

// Sessions tab — native port of design/studio/components/hud/HudSessions.tsx.
//
// Compact: single-col ledger, inline reveal on engage.
// Medium:  same ledger, wider meta strip (project + duration + msg), inline reveal.
// Large:   full-width ledger; lifecycle detail reveals inline on interaction.

private enum SessionStatus: Sendable {
    case running, idle, ended

    var label: String {
        switch self {
        case .running: return "RUNNING"
        case .idle: return "IDLE"
        case .ended: return "ENDED"
        }
    }

    var color: Color {
        switch self {
        case .running: return HUDChrome.accent
        case .idle: return HUDChrome.inkMuted
        case .ended: return HUDChrome.inkFaint
        }
    }
}

private struct SynthesizedSession: Identifiable {
    let id: String           // Broker agent ID
    let refId: String        // Display-truncated agent ID
    let harnessSessionId: String?  // Real ref resolvable via /api/session-ref
    let conversationId: String?    // Canonical operator DM thread
    let agentName: String
    let agentHandle: String?
    let harness: String
    let status: SessionStatus
    let project: String
    let branch: String
    let duration: String
    let messageCount: Int
    let lastTurn: String
    let ago: String
    let model: String
    let startedAt: String?
}

struct HUDSessionsView: View {
    @ObservedObject private var fleet = HudFleetService.shared
    @ObservedObject private var state = HUDState.shared
    @StateObject private var engage = HUDEngageState()

    private var sessions: [SynthesizedSession] {
        Self.synthesize(from: fleet.agents ?? [])
    }

    var body: some View {
        Group {
            if (fleet.agents ?? []).isEmpty {
                EmptySessions()
            } else {
                switch state.size {
                case .compact: rowsBody(size: .compact)
                case .medium:  rowsBody(size: .medium)
                case .large:   rowsBody(size: .large)
                }
            }
        }
        .onAppear { wireNavBus() }
        .onDisappear { HUDNavBus.shared.clear() }
    }

    // Register cycle/engage closures with the global key bus. Mirrors the
    // wiring HUDTailView already does — cursor tracks j/k (no expansion),
    // engaged tracks Enter (inline detail opens). A second Enter on an
    // already-engaged row stages the agent on the dock and focuses it.
    private func wireNavBus() {
        HUDNavBus.shared.cycleNext = {
            let ids = sessions.map { $0.id }
            guard !ids.isEmpty else { return }
            if let cur = engage.cursoredId, let i = ids.firstIndex(of: cur), i + 1 < ids.count {
                engage.cursor(ids[i + 1])
            } else {
                engage.cursor(ids.first)
            }
        }
        HUDNavBus.shared.cyclePrev = {
            let ids = sessions.map { $0.id }
            guard !ids.isEmpty else { return }
            if let cur = engage.cursoredId, let i = ids.firstIndex(of: cur), i > 0 {
                engage.cursor(ids[i - 1])
            } else {
                engage.cursor(ids.last)
            }
        }
        HUDNavBus.shared.jumpTop = {
            engage.cursor(sessions.first?.id)
        }
        HUDNavBus.shared.jumpBottom = {
            engage.cursor(sessions.last?.id)
        }
        HUDNavBus.shared.engageSelected = {
            // Three-level progressive disclosure on Enter:
            //   1. cursored row not yet engaged → engage it (inline detail expands)
            //   2. cursored row already engaged → stage @target on the dock + focus
            guard let cursoredId = engage.cursoredId,
                  let session = sessions.first(where: { $0.id == cursoredId }) else { return }
            if engage.engagedId != cursoredId {
                engage.toggle(cursoredId)
            } else {
                let handle = session.agentHandle ?? session.agentName
                HUDDockState.shared.setTarget(handle: handle, label: session.agentName)
                HUDDockState.shared.focus()
            }
        }
        HUDNavBus.shared.unengageSelected = {
            if engage.engagedId != nil {
                engage.unengage()
                return true
            }
            return false
        }
        // Sessions has no live-follow concept; clear the slot so a previous
        // tab's binding doesn't leak.
        HUDNavBus.shared.toggleFollow = nil
    }

    // MARK: - Rows

    private func rowsBody(size: HUDSize) -> some View {
        ScrollViewReader { proxy in
            GeometryReader { viewport in
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        LazyVStack(spacing: 0) {
                            SessionsHeader(sessions: sessions)
                            ForEach(Array(sessions.enumerated()), id: \.element.id) { idx, s in
                                SessionRow(
                                    session: s,
                                    isFirst: idx == 0,
                                    size: size,
                                    cursored: engage.isCursored(s.id),
                                    engaged: engage.isEngaged(s.id),
                                    onTap: {
                                        withAnimation(.easeOut(duration: 0.14)) {
                                            engage.toggle(s.id)
                                        }
                                    }
                                )
                                .id(s.id)
                                if engage.isEngaged(s.id) {
                                    SessionDetailInline(session: s, size: size)
                                        .transition(.move(edge: .top).combined(with: .opacity))
                                }
                            }
                        }

                        Spacer(minLength: 0)
                        SessionsFeedEndMarker()
                    }
                    .frame(minHeight: viewport.size.height, alignment: .top)
                }
                .onChange(of: engage.cursoredId) { _, id in
                    guard let id else { return }
                    withAnimation(.easeOut(duration: 0.16)) {
                        if size == .compact {
                            proxy.scrollTo(id)
                        } else {
                            proxy.scrollTo(id, anchor: .center)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private static func synthesize(from agents: [HudAgent]) -> [SynthesizedSession] {
        agents.map { agent in
            let status: SessionStatus = {
                switch agent.state {
                case .working, .needsAttention, .waiting: return .running
                case .available, .done: return .idle
                case .offline: return .ended
                }
            }()
            let project = (agent.projectRoot as NSString?)?.lastPathComponent
                ?? agent.role.split(separator: "·").first.map { String($0).trimmingCharacters(in: .whitespaces) }
                ?? "—"
            let refId = String(agent.id.prefix(8))
            return SynthesizedSession(
                id: agent.id,
                refId: refId,
                harnessSessionId: agent.harnessSessionId,
                conversationId: agent.conversationId,
                agentName: agent.name,
                agentHandle: agent.handle,
                harness: agent.harness ?? "raw",
                status: status,
                project: project,
                branch: agent.branch,
                duration: agent.runtime,
                messageCount: agent.capabilities.count,
                lastTurn: agent.lastTurn,
                ago: agent.ago,
                model: agent.tokens,
                startedAt: nil
            )
        }
    }
}

// MARK: - Section header

private struct SessionsHeader: View {
    let sessions: [SynthesizedSession]

    private var running: Int { sessions.filter { $0.status == .running }.count }

    var body: some View {
        // Tab name is in the masthead. Eyebrow carries count + running.
        HUDEyebrow(
            text: "\(sessions.count) SESSION\(sessions.count == 1 ? "" : "S")  ·  \(running) RUNNING",
            color: HUDChrome.inkFaint
        )
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderStrong)
                .frame(height: 0.5)
                .padding(.horizontal, 16)
        }
    }
}

// MARK: - Row

private struct SessionRow: View {
    let session: SynthesizedSession
    let isFirst: Bool
    let size: HUDSize
    var cursored: Bool = false
    let engaged: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false

    // Mirrors tail's three-tier fill: cursored (j/k landing) → engaged
    // (Enter expansion) → hovered (mouse). Background carries the state;
    // no left edge bar (operator's call).
    private var rowFill: Color {
        if engaged  { return HUDChrome.canvasLift.opacity(0.70) }
        if cursored { return HUDChrome.canvasLift.opacity(0.42) }
        if hovered  { return HUDChrome.canvasLift.opacity(0.18) }
        return Color.clear
    }

    private var verticalPad: CGFloat { size == .compact ? 10 : 12 }

    var body: some View {
        VStack(alignment: .leading, spacing: size == .compact ? 5 : 7) {
            identityLine
            metaLine
            lastTurnLine
        }
        .padding(.leading, 16)
        .padding(.trailing, 14)
        .padding(.top, isFirst ? verticalPad + 1 : verticalPad)
        .padding(.bottom, verticalPad)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowFill)
        .overlay(alignment: .leading) {
            if session.status == .running || engaged {
                Rectangle()
                    .fill(HUDChrome.accent)
                    .frame(width: 1.5)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
                .padding(.horizontal, 16)
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onTap)
        .contextMenu {
            Button("Copy session ref") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(session.refId, forType: .string)
            }
            Button("Copy agent ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(session.id, forType: .string)
            }
        }
    }

    private var identityLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            StatusDot(status: session.status)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

            Text(session.agentName)
                .font(HUDType.body(13, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .fixedSize()

            if let handle = session.agentHandle {
                Text(handle.hasPrefix("@") ? handle : "@" + handle)
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .fixedSize()
            }

            Text(session.status.label)
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(session.status.color)
                .fixedSize()

            Spacer(minLength: 6)

            Text(session.ago)
                .font(HUDType.mono(10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkFaint)
                .fixedSize()
        }
    }

    private var metaLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            HarnessChip(harness: session.harness)
            metaDot
            Text(session.project.uppercased())
                .font(HUDType.mono(10))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(1)
            metaDot
            Text(session.branch)
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
                .lineLimit(1)
                .truncationMode(.middle)

            // WHY: medium/large surfaces duration + message count on the meta strip.
            if size != .compact {
                metaDot
                Text(session.duration)
                    .font(HUDType.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
                metaDot
                Text("\(session.messageCount) msg")
                    .font(HUDType.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
            }

            Spacer(minLength: 0)
        }
        .padding(.leading, 14)
    }

    private var lastTurnLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("↪")
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
            Text(session.lastTurn)
                .font(HUDType.body(size == .compact ? 11 : 12))
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(size == .compact ? 1 : 2)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(1.5)
            Spacer(minLength: 0)
        }
        .padding(.leading, 14)
    }

    private var metaDot: some View {
        Circle()
            .fill(HUDChrome.inkFaint)
            .frame(width: 1.8, height: 1.8)
    }
}

// MARK: - Status dot

private struct StatusDot: View {
    let status: SessionStatus

    var body: some View {
        ZStack {
            switch status {
            case .running:
                Circle()
                    .fill(HUDChrome.accent.opacity(0.32))
                    .frame(width: 12, height: 12)
                Circle()
                    .fill(HUDChrome.accent)
                    .frame(width: 6, height: 6)
            case .idle:
                Circle()
                    .fill(HUDChrome.inkMuted.opacity(0.65))
                    .frame(width: 6, height: 6)
            case .ended:
                Circle()
                    .stroke(HUDChrome.inkFaint, lineWidth: 1)
                    .frame(width: 6, height: 6)
            }
        }
        .frame(width: 12, height: 12)
    }
}

// MARK: - Harness chip

private struct HarnessChip: View {
    let harness: String

    var body: some View {
        Text(harness.uppercased())
            .font(HUDType.mono(10, weight: .semibold))
            .tracking(HUDType.eyebrowTracking)
            .foregroundStyle(HUDChrome.inkMuted)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(HUDChrome.canvas)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .stroke(HUDChrome.border, lineWidth: 0.5)
            )
    }
}

// MARK: - Engaged inline detail (compact + medium)

private struct SessionDetailInline: View {
    let session: SynthesizedSession
    var size: HUDSize = .compact

    private var padX: CGFloat {
        size == .large ? 20 : 18
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HUDEyebrow(text: "LAST TURN", color: HUDChrome.inkFaint)
            Text(session.lastTurn)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                .lineSpacing(2)

            VStack(alignment: .leading, spacing: 3) {
                meta(label: "REF", value: session.refId)
                meta(label: "HARNESS", value: session.harness)
                meta(label: "MODEL", value: session.model)
                meta(label: "BRANCH", value: session.branch)
                meta(label: "DURATION", value: session.duration)
                meta(label: "MESSAGES", value: "\(session.messageCount)")
            }

            VStack(alignment: .leading, spacing: 3) {
                HUDDrillLink(label: "OPEN TRANSCRIPT", url: transcriptURL)
                HUDDrillLink(label: "FOLLOW LIVE", url: followURL)
                HUDDrillLink(label: "AGENT PROFILE", url: agentURL)
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, padX)
        .padding(.vertical, size == .compact ? 11 : 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.55))
    }

    private func meta(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkDeep)
                .frame(width: 64, alignment: .leading)
            Text(value.isEmpty ? "—" : value)
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    // WHY: every session row exposes all three drills. The web's
    // /api/session-ref only resolves real harness session IDs (e.g.
    // "relay-hudson-claude"), session row PKs, or history file leaves —
    // NOT broker agent IDs. So OPEN TRANSCRIPT must prefer
    // harnessSessionId; if that's absent we route to the operator DM
    // thread for this agent (which carries the same message history) or
    // /messages scoped to that conversation. Live tail falls back to a
    // scoped /ops/tail query, never an empty index.

    private var transcriptURL: URL {
        let base = HudFleetService.webBaseURL()
        if let ref = session.harnessSessionId, !ref.isEmpty {
            return relativeURL("/sessions/\(percent(ref))", base: base)
        }
        if let cid = session.conversationId, !cid.isEmpty {
            return relativeURL("/c/\(percent(cid))", base: base)
        }
        let aid = session.id
        if !aid.isEmpty {
            // Synthesize the operator DM url. Matches the broker's
            // `dm.operator.<agentId>` convention.
            return relativeURL("/c/\(percent("dm.operator.\(aid)"))", base: base)
        }
        return relativeURL("/sessions", base: base)
    }

    private var followURL: URL {
        let base = HudFleetService.webBaseURL()
        if let ref = session.harnessSessionId, !ref.isEmpty {
            return relativeURL("/follow/session/\(percent(ref))", base: base)
        }
        let aid = session.id
        if !aid.isEmpty {
            return relativeURL("/follow/agent/\(percent(aid))", base: base)
        }
        if let q = tailQuery() {
            return relativeURL("/ops/tail?q=\(percentQuery(q))", base: base)
        }
        return relativeURL("/ops/tail", base: base)
    }

    private var agentURL: URL {
        let base = HudFleetService.webBaseURL()
        let aid = session.id
        if aid.isEmpty { return relativeURL("/agents", base: base) }
        return relativeURL("/agents/\(percent(aid))", base: base)
    }

    private func tailQuery() -> String? {
        if let h = session.agentHandle, !h.isEmpty {
            return h.hasPrefix("@") ? h : "@" + h
        }
        if !session.agentName.isEmpty { return session.agentName }
        return nil
    }

    private func percent(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }

    private func percentQuery(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }

    private func relativeURL(_ path: String, base: URL) -> URL {
        URL(string: path, relativeTo: base)?.absoluteURL ?? base
    }

}

private struct SessionsFeedEndMarker: View {
    var body: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
            Text("END OF SESSIONS")
                .font(HUDType.mono(9, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkFaint)
                .fixedSize()
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 16)
    }
}

// MARK: - Empty

private struct EmptySessions: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDEyebrow(text: "LEDGER  ·  NO SESSIONS", color: HUDChrome.inkFaint)
                .padding(.top, 18)

            Text("No sessions running.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text("Agent run sessions will print here as the broker reports them.")
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
