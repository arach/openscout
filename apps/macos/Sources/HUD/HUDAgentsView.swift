import AppKit
import SwiftUI

// Agents tab — native port of design/studio/components/hud/HudAgents.tsx.
//
// Compact: single-column roster, inline reveal on engage.
// Medium:  2-up tile grid, pulse on its own labeled row, inline reveal.
// Large:   three vertical panes — roster (~280) · context (~300) · last-turn body.

struct HUDAgentsView: View {
    let agents: [HudAgent]
    let activeAgentId: String?

    @ObservedObject private var state = HUDState.shared
    @StateObject private var engage = HUDEngageState()

    var body: some View {
        if agents.isEmpty {
            FleetEmptyState()
        } else {
            switch state.size {
            case .compact: compactBody
            case .medium:  mediumBody
            case .large:   largeBody
            }
        }
    }

    // MARK: - Compact (shipped)

    private var compactBody: some View {
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

    // MARK: - Medium (2-up tile grid)

    private var mediumBody: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 0) {
                HUDAgentsHeader(count: agents.count)
                tileGrid
            }
            .padding(.bottom, 10)
        }
    }

    // WHY: SwiftUI's LazyVGrid can't host a row-spanning expanded panel cleanly,
    // so pair tiles two-at-a-time and inline the detail under the engaged pair.
    private var tilePairs: [(Int, HudAgent, HudAgent?)] {
        var result: [(Int, HudAgent, HudAgent?)] = []
        var i = 0
        while i < agents.count {
            let a = agents[i]
            let b = i + 1 < agents.count ? agents[i + 1] : nil
            result.append((i, a, b))
            i += 2
        }
        return result
    }

    @ViewBuilder
    private var tileGrid: some View {
        ForEach(tilePairs, id: \.0) { _, a, b in
            tilePairRow(a: a, b: b)
            if engage.isSelected(a.id) {
                AgentDetailInline(agent: a)
                    .transition(.move(edge: .top).combined(with: .opacity))
            } else if let b, engage.isSelected(b.id) {
                AgentDetailInline(agent: b)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    private func tilePairRow(a: HudAgent, b: HudAgent?) -> some View {
        HStack(alignment: .top, spacing: 0) {
            AgentTileMedium(
                agent: a,
                isActive: a.id == activeAgentId,
                engaged: engage.isSelected(a.id),
                onTap: {
                    withAnimation(.easeOut(duration: 0.14)) { engage.toggle(a.id) }
                }
            )
            Rectangle().fill(HUDChrome.border).frame(width: 0.5)
            if let b {
                AgentTileMedium(
                    agent: b,
                    isActive: b.id == activeAgentId,
                    engaged: engage.isSelected(b.id),
                    onTap: {
                        withAnimation(.easeOut(duration: 0.14)) { engage.toggle(b.id) }
                    }
                )
            } else {
                Color.clear.frame(maxWidth: .infinity)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(HUDChrome.borderSoft).frame(height: 0.5)
        }
    }

    // MARK: - Large (three panes)

    private var selectedAgent: HudAgent {
        if let id = engage.selectedId, let match = agents.first(where: { $0.id == id }) {
            return match
        }
        if let active = agents.first(where: { $0.id == activeAgentId }) {
            return active
        }
        return agents[0]
    }

    private var largeBody: some View {
        VStack(spacing: 0) {
            HUDAgentsHeader(count: agents.count)
            HStack(spacing: 0) {
                AgentColumnA(
                    agents: agents,
                    selectedId: selectedAgent.id,
                    onSelect: { id in engage.select(id) }
                )
                .frame(width: 280)
                Rectangle().fill(HUDChrome.border).frame(width: 0.5)
                AgentColumnB(agent: selectedAgent)
                    .frame(width: 300)
                Rectangle().fill(HUDChrome.border).frame(width: 0.5)
                AgentColumnC(agent: selectedAgent)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxHeight: .infinity)
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

// MARK: - Shared bits

private func stateColor(for state: HudAgentState) -> Color {
    switch state {
    case .working, .needsAttention: return HUDChrome.accent
    case .available, .waiting, .done: return HUDChrome.inkMuted
    case .offline: return HUDChrome.inkFaint
    }
}

private func stateLabel(for state: HudAgentState) -> String {
    switch state {
    case .working:        return "WORKING"
    case .needsAttention: return "NEEDS ATTENTION"
    case .available:      return "AVAILABLE"
    case .waiting:        return "WAITING"
    case .done:           return "DONE"
    case .offline:        return "OFFLINE"
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
            AgentStateDot(color: stateColor(for: agent.state), working: isWorking)
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

            Text(stateLabel(for: agent.state))
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(stateColor(for: agent.state))
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

// MARK: - Medium tile

private struct AgentTileMedium: View {
    let agent: HudAgent
    let isActive: Bool
    let engaged: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var isAttention: Bool { agent.state == .needsAttention }
    private var isWorking: Bool { agent.state == .working }

    private var fill: Color {
        if engaged { return HUDChrome.canvasLift.opacity(0.55) }
        if hovered { return HUDChrome.canvasLift.opacity(0.30) }
        return Color.clear
    }

    private var workSummary: String {
        if isAttention, let ask = agent.pendingAsk { return ask }
        return agent.lastTurn
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            identity
            pulseRow
            workRow
            lastActionRow
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(fill)
        .overlay(alignment: .leading) {
            if engaged || isActive {
                Rectangle().fill(HUDChrome.accent).frame(width: 1.5)
            }
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onTap)
    }

    private var identity: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            AgentStateDot(color: stateColor(for: agent.state), working: isWorking)
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
                    .fixedSize()
            }

            Text(stateLabel(for: agent.state))
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(stateColor(for: agent.state))
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

    private var pulseRow: some View {
        HStack(spacing: 8) {
            Text("PULSE")
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkFaint)
            HUDPulseSparkline(
                values: HUDMockPulse.pulse(for: (agent.handle ?? agent.name).lowercased()),
                color: HUDChrome.agentHue(agent.hue),
                size: CGSize(width: 56, height: 9)
            )
            Spacer(minLength: 0)
        }
        .padding(.leading, 14)
        .padding(.top, 8)
    }

    private var workRow: some View {
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
        .padding(.top, 8)
    }

    @ViewBuilder
    private var lastActionRow: some View {
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
                Spacer(minLength: 0)
            }
            .padding(.leading, 14)
            .padding(.top, 6)
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

// MARK: - Inline detail (compact + medium)

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

// MARK: - Large pane: Column A (roster list)

private struct AgentColumnA: View {
    let agents: [HudAgent]
    let selectedId: String
    var onSelect: (String) -> Void

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 0) {
                ForEach(agents) { a in
                    AgentColARow(
                        agent: a,
                        selected: a.id == selectedId,
                        onSelect: { onSelect(a.id) }
                    )
                }
            }
        }
    }
}

private struct AgentColARow: View {
    let agent: HudAgent
    let selected: Bool
    var onSelect: () -> Void

    @State private var hovered = false

    private var fill: Color {
        if selected { return HUDChrome.canvasLift.opacity(0.55) }
        if hovered  { return HUDChrome.canvasLift.opacity(0.30) }
        return Color.clear
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                AgentStateDot(color: stateColor(for: agent.state), working: agent.state == .working)
                    .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

                Text(agent.name)
                    .font(HUDType.body(12, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                    .fixedSize()

                if let handle = agent.handle {
                    Text(handle.hasPrefix("@") ? handle : "@" + handle)
                        .font(HUDType.mono(10))
                        .foregroundStyle(HUDChrome.inkFaint)
                        .fixedSize()
                }

                Text(stateLabel(for: agent.state))
                    .font(HUDType.mono(10, weight: .semibold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(stateColor(for: agent.state))
                    .lineLimit(1)
                    .fixedSize()

                Spacer(minLength: 4)

                Text(agent.ago)
                    .font(HUDType.mono(10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
                    .fixedSize()
            }

            Text(agent.lastTurn)
                .font(HUDType.body(11))
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(1.5)
                .padding(.leading, 14)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(fill)
        .overlay(alignment: .leading) {
            if selected {
                Rectangle().fill(HUDChrome.accent).frame(width: 1.5)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(HUDChrome.borderSoft).frame(height: 0.5).padding(.horizontal, 14)
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onSelect)
    }
}

// MARK: - Large pane: Column B (context)

private struct AgentColumnB: View {
    let agent: HudAgent

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 12) {
                header

                section(label: "WORK") {
                    Text(agent.lastTurn)
                        .font(HUDType.body(13))
                        .foregroundStyle(HUDChrome.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                        .lineSpacing(2)
                }

                if !agent.capabilities.isEmpty {
                    section(label: "CAPS") {
                        capsRow
                    }
                }

                statBlock

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            AgentStateDot(color: stateColor(for: agent.state), working: agent.state == .working)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
            Text(agent.name)
                .font(HUDType.body(13, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize()
            if let handle = agent.handle {
                Text(handle.hasPrefix("@") ? handle : "@" + handle)
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .fixedSize()
            }
            Spacer(minLength: 4)
            Text(stateLabel(for: agent.state))
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(stateColor(for: agent.state))
        }
    }

    private var capsRow: some View {
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
            Spacer(minLength: 0)
        }
    }

    private var statBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            kv(label: "BRANCH", value: agent.branch)
            kv(label: "CWD", value: agent.projectRoot ?? "—")
            kv(label: "MODEL", value: agent.tokens)
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
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkFaint)
                .frame(width: 56, alignment: .leading)
            Text(value.isEmpty ? "—" : value)
                .font(HUDType.mono(11))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Large pane: Column C (last turn body)

private struct AgentColumnC: View {
    let agent: HudAgent

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 10) {
                HUDEyebrow(
                    text: "LAST TURN  ·  \((agent.handle ?? "@" + agent.name))",
                    color: HUDChrome.inkFaint
                )

                Text(agent.lastTurn)
                    .font(HUDType.body(12))
                    .foregroundStyle(HUDChrome.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                    .lineSpacing(3)

                Spacer(minLength: 0)

                bufferStrip
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var bufferStrip: some View {
        HStack(spacing: 6) {
            Text("· TURN BUFFER ·")
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkFaint)
            Text("5/5")
                .font(HUDType.mono(10))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkMuted)
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                ForEach(0..<5, id: \.self) { i in
                    Circle()
                        .fill(i == 4 ? HUDChrome.accent : HUDChrome.border)
                        .frame(width: 4, height: 4)
                }
            }
        }
        .padding(.top, 6)
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
