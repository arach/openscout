import AppKit
import SwiftUI

// Sessions tab — native port of design/studio/components/hud/HudSessions.tsx.
//
// Agent RUN sessions, not local tmux/iTerm sessions. The broker doesn't
// yet expose /api/sessions; we synthesize one session per visible agent
// from its existing identity + last turn + harness + branch.
//
// TEMP: synthesized from agents; replace with /api/sessions once broker
// exposes session entities. SessionScanner remains the source of truth
// for local-terminal probing — it just no longer renders in this tab.

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

    @StateObject private var engage = HUDEngageState()

    private var sessions: [SynthesizedSession] {
        Self.synthesize(from: fleet.agents ?? [])
    }

    var body: some View {
        Group {
            if (fleet.agents ?? []).isEmpty {
                EmptySessions()
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        SessionsHeader(sessions: sessions)
                        ForEach(Array(sessions.enumerated()), id: \.element.id) { idx, s in
                            SessionRowCompact(
                                session: s,
                                isFirst: idx == 0,
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

private struct SessionRowCompact: View {
    let session: SynthesizedSession
    let isFirst: Bool
    let engaged: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var rowFill: Color {
        if engaged { return HUDChrome.canvasLift.opacity(0.55) }
        if hovered { return HUDChrome.canvasLift.opacity(0.30) }
        return Color.clear
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            identityLine
            metaLine
            lastTurnLine
        }
        .padding(.leading, 16)
        .padding(.trailing, 14)
        .padding(.top, isFirst ? 11 : 10)
        .padding(.bottom, 10)
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
                .font(HUDType.body(11))
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(1)
                .truncationMode(.tail)
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

// MARK: - Engaged detail

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
