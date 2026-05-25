import AppKit
import SwiftUI

// Agents tab — native port of design/studio/components/hud/HudAgents.tsx.
//
// At compact (the shipped 420×520 size) the layout is a single-column
// roster. Each row carries:
//   identity line — state dot · name · @handle · STATE eyebrow · pulse · ago
//   work line     — "work" eyebrow · summary sentence
//   last action   — ↪ glyph · last turn excerpt · relative time
//
// Engaging a row reveals an inline detail panel below it (last turn,
// recent actions, branch/cwd/model). Engage state is owned by an
// @StateObject HUDEngageState so it stays per-tab.

struct HUDAgentsView: View {
    let agents: [HudAgent]
    let activeAgentId: String?

    @StateObject private var engage = HUDEngageState()

    var body: some View {
        if agents.isEmpty {
            FleetEmptyState()
        } else {
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    HUDAgentsHeader(count: agents.count)
                    ForEach(Array(agents.enumerated()), id: \.element.id) { idx, agent in
                        AgentRowCompact(
                            agent: agent,
                            isFirst: idx == 0,
                            isActive: agent.id == activeAgentId,
                            isEngaged: engage.isSelected(agent.id),
                            onTap: {
                                withAnimation(.easeOut(duration: 0.14)) {
                                    engage.toggle(agent.id)
                                }
                            }
                        )
                        if engage.isSelected(agent.id) {
                            AgentDetailInline(agent: agent)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                    }
                }
                .padding(.bottom, 8)
            }
        }
    }
}

// MARK: - Section header

private struct HUDAgentsHeader: View {
    let count: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HUDEyebrow(text: "ROSTER  ·  \(count) AGENT\(count == 1 ? "" : "S")", color: HUDChrome.inkDeep)
            Text("Agents")
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

// MARK: - Compact row

private struct AgentRowCompact: View {
    let agent: HudAgent
    let isFirst: Bool
    let isActive: Bool
    let isEngaged: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var isAttention: Bool { agent.state == .needsAttention }
    private var isWorking: Bool { agent.state == .working }

    // Two-tone state palette: lime for things that need eyes, ink scales
    // for everything else. Mirrors stateColor() in HudAgents.tsx.
    private var stateColor: Color {
        switch agent.state {
        case .working, .needsAttention: return HUDChrome.accent
        case .available, .waiting:      return HUDChrome.inkMuted
        case .done:                     return HUDChrome.inkMuted
        case .offline:                  return HUDChrome.inkFaint
        }
    }

    private var stateLabel: String {
        switch agent.state {
        case .working:        return "WORKING"
        case .needsAttention: return "NEEDS ATTENTION"
        case .available:      return "AVAILABLE"
        case .waiting:        return "WAITING"
        case .done:           return "DONE"
        case .offline:        return "OFFLINE"
        }
    }

    private var rowFill: Color {
        if isEngaged { return HUDChrome.canvasLift.opacity(0.55) }
        if hovered   { return HUDChrome.canvasLift.opacity(0.30) }
        return Color.clear
    }

    private var workSummary: String {
        if isAttention, let ask = agent.pendingAsk { return ask }
        return agent.lastTurn
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            identityLine
            workLine
            lastActionLine
        }
        .padding(.leading, 16)
        .padding(.trailing, 14)
        .padding(.top, isFirst ? 11 : 10)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowFill)
        .overlay(alignment: .leading) {
            if isEngaged || isActive {
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
            Button("Copy agent ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(agent.id, forType: .string)
            }
            if let selector = agent.selector {
                Button("Copy selector") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(selector, forType: .string)
                }
            }
            if let projectRoot = agent.projectRoot {
                Button("Reveal project root in Finder") {
                    NSWorkspace.shared.activateFileViewerSelecting(
                        [URL(fileURLWithPath: (projectRoot as NSString).expandingTildeInPath)]
                    )
                }
            }
        }
    }

    private var identityLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            AgentStateDot(color: stateColor, working: isWorking)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

            Text(agent.name)
                .font(HUDType.body(13, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .fixedSize()

            if let handle = agent.handle {
                Text(handle.hasPrefix("@") ? handle : "@" + handle)
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
                    .fixedSize()
            }

            Text(stateLabel)
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(stateColor)
                .lineLimit(1)
                .fixedSize()

            Spacer(minLength: 6)

            Text(agent.ago)
                .font(HUDType.mono(10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkFaint)
                .fixedSize()
        }
    }

    private var workLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("WORK")
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkFaint)
            Text(workSummary)
                .font(HUDType.body(12))
                .foregroundStyle(isAttention ? HUDChrome.ink : HUDChrome.inkMuted)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(1.5)
        }
        .padding(.leading, 14)
    }

    @ViewBuilder
    private var lastActionLine: some View {
        if let last = agent.lastMessage?.text, !last.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("↪")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                Text(last)
                    .font(HUDType.body(11))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 6)
                Text(agent.ago)
                    .font(HUDType.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            .padding(.leading, 14)
        }
    }
}

// MARK: - State dot

private struct AgentStateDot: View {
    let color: Color
    let working: Bool

    var body: some View {
        ZStack {
            if working {
                Circle()
                    .fill(color.opacity(0.32))
                    .frame(width: 12, height: 12)
            }
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
        }
        .frame(width: 12, height: 12)
    }
}

// MARK: - Engaged detail (compact inline)

private struct AgentDetailInline: View {
    let agent: HudAgent

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let ask = agent.pendingAsk {
                detailBlock(label: "PENDING ASK", body: ask, accent: true)
            }
            detailBlock(label: "LAST TURN", body: agent.lastTurn, accent: false)

            if !agent.capabilities.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    HUDEyebrow(text: "CAPS", color: HUDChrome.inkDeep)
                    HStack(spacing: 4) {
                        ForEach(agent.capabilities.prefix(6), id: \.self) { cap in
                            Text(cap)
                                .font(HUDType.mono(10, weight: .medium))
                                .foregroundStyle(HUDChrome.inkMuted)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1.5)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 2.5)
                                        .stroke(HUDChrome.border, lineWidth: 0.5)
                                )
                        }
                    }
                }
            }

            // Stat KVs — BRANCH · CWD · MODEL. Tolerates nil for any
            // of these because the broker contract is still evolving.
            VStack(alignment: .leading, spacing: 3) {
                statKV(label: "BRANCH", value: agent.branch)
                if let cwd = agent.projectRoot {
                    statKV(label: "CWD", value: cwd)
                }
                statKV(label: "MODEL", value: agent.tokens)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.55))
    }

    private func detailBlock(label: String, body: String, accent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HUDEyebrow(text: label, color: accent ? HUDChrome.accent : HUDChrome.inkDeep)
            Text(body)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                .lineSpacing(2)
        }
    }

    private func statKV(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkFaint)
                .frame(width: 56, alignment: .leading)
            Text(value.isEmpty ? "—" : value)
                .font(HUDType.mono(11))
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Empty state

private struct FleetEmptyState: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDMastheadMark(size: 44)
                .opacity(0.85)

            HUDEyebrow(text: "ROSTER  ·  EMPTY", color: HUDChrome.inkDeep)
                .padding(.top, 18)

            Text("No agents are filing.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text("Spin up an agent and it will print here.")
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
                .padding(.top, 6)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
