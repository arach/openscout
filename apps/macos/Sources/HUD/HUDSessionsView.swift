import AppKit
import SwiftUI

// Sessions tab — native port of design/studio/components/hud/HudSessions.tsx.
//
// Compact: single-col ledger, inline reveal on engage.
// Medium:  same ledger, wider meta strip (project + duration + msg), inline reveal.
// Large:   two panes — list left (~480), lifecycle detail right (REF/HARNESS/MODEL/BRANCH/DURATION).

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
    let id: String
    let refId: String
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
                case .compact: compactBody
                case .medium:  mediumBody
                case .large:   largeBody
                }
            }
        }
    }

    // MARK: - Compact

    private var compactBody: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 0) {
                SessionsHeader(sessions: sessions)
                ForEach(Array(sessions.enumerated()), id: \.element.id) { idx, s in
                    SessionRow(
                        session: s,
                        isFirst: idx == 0,
                        size: .compact,
                        engaged: engage.isSelected(s.id),
                        onTap: {
                            withAnimation(.easeOut(duration: 0.14)) {
                                engage.toggle(s.id)
                            }
                        }
                    )
                    if engage.isSelected(s.id) {
                        SessionDetailInline(session: s)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
            }
            .padding(.bottom, 10)
        }
    }

    // MARK: - Medium

    private var mediumBody: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 0) {
                SessionsHeader(sessions: sessions)
                ForEach(Array(sessions.enumerated()), id: \.element.id) { idx, s in
                    SessionRow(
                        session: s,
                        isFirst: idx == 0,
                        size: .medium,
                        engaged: engage.isSelected(s.id),
                        onTap: {
                            withAnimation(.easeOut(duration: 0.14)) {
                                engage.toggle(s.id)
                            }
                        }
                    )
                    if engage.isSelected(s.id) {
                        SessionDetailInline(session: s)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
            }
            .padding(.bottom, 10)
        }
    }

    // MARK: - Large

    private var selectedSession: SynthesizedSession {
        if let id = engage.selectedId, let match = sessions.first(where: { $0.id == id }) {
            return match
        }
        return sessions[0]
    }

    private var largeBody: some View {
        VStack(spacing: 0) {
            SessionsHeader(sessions: sessions)
            HStack(spacing: 0) {
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(sessions.enumerated()), id: \.element.id) { idx, s in
                            SessionRow(
                                session: s,
                                isFirst: idx == 0,
                                size: .large,
                                engaged: s.id == selectedSession.id,
                                onTap: {
                                    withAnimation(.easeOut(duration: 0.14)) {
                                        engage.select(s.id)
                                    }
                                }
                            )
                        }
                    }
                    .padding(.bottom, 10)
                }
                .frame(width: 480)

                Rectangle().fill(HUDChrome.border).frame(width: 0.5)

                SessionDetailLarge(session: selectedSession)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxHeight: .infinity)
        }
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
        VStack(alignment: .leading, spacing: 2) {
            HUDEyebrow(
                text: "LEDGER  ·  \(sessions.count) SESSION\(sessions.count == 1 ? "" : "S")  ·  \(running) RUNNING",
                color: HUDChrome.inkDeep
            )
            Text("Sessions")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 6)
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
    let engaged: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var rowFill: Color {
        if engaged { return HUDChrome.canvasLift.opacity(0.55) }
        if hovered { return HUDChrome.canvasLift.opacity(0.30) }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HUDEyebrow(text: "LAST TURN", color: HUDChrome.inkDeep)
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
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 11)
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
}

// MARK: - Large right-pane detail

private struct SessionDetailLarge: View {
    let session: SynthesizedSession

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                header

                metaStrip

                section(label: "LAST TURN") {
                    Text(session.lastTurn)
                        .font(HUDType.body(12))
                        .foregroundStyle(HUDChrome.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                        .lineSpacing(3)
                }

                section(label: "LIFECYCLE") {
                    VStack(alignment: .leading, spacing: 4) {
                        kv(label: "REF", value: session.refId)
                        kv(label: "HARNESS", value: session.harness)
                        kv(label: "MODEL", value: session.model)
                        kv(label: "BRANCH", value: session.branch)
                        kv(label: "DURATION", value: session.duration)
                        kv(label: "MESSAGES", value: "\(session.messageCount)")
                    }
                }

                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 3) {
                    drillLink(label: "OPEN TRANSCRIPT")
                    drillLink(label: "FOLLOW LIVE")
                    drillLink(label: "AGENT PROFILE")
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            StatusDot(status: session.status)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
            Text(session.agentName)
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize()
            if let handle = session.agentHandle {
                Text(handle.hasPrefix("@") ? handle : "@" + handle)
                    .font(HUDType.mono(11))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .fixedSize()
            }
            Spacer(minLength: 4)
            Text(session.status.label)
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(session.status.color)
        }
    }

    private var metaStrip: some View {
        HStack(spacing: 6) {
            HarnessChip(harness: session.harness)
            Text(session.refId)
                .font(HUDType.mono(10))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkMuted)
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(HUDChrome.border, lineWidth: 0.5)
                )
            Text(session.project.uppercased())
                .font(HUDType.mono(10))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkMuted)
            Text(session.branch)
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    private func section<Content: View>(label: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HUDEyebrow(text: label, color: HUDChrome.inkFaint)
            content()
        }
    }

    private func kv(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkDeep)
                .frame(width: 80, alignment: .leading)
            Text(value.isEmpty ? "—" : value)
                .font(HUDType.mono(11))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    private func drillLink(label: String) -> some View {
        HStack(spacing: 8) {
            Text("→")
                .font(HUDType.mono(11))
                .foregroundStyle(HUDChrome.inkFaint)
            Text(label)
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkMuted)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
    }
}

// MARK: - Empty

private struct EmptySessions: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDEyebrow(text: "LEDGER  ·  NO SESSIONS", color: HUDChrome.inkDeep)
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
