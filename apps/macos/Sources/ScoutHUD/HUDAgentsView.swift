import AppKit
import ScoutAppCore
import SwiftUI

// Agents tab — native port of design/studio/components/hud/HudAgents.tsx.
//
// Compact: single-column roster, inline reveal on engage.
// Medium:  2-up tile grid, pulse on its own labeled row, inline reveal.
// Large:   three vertical panes — roster (~280) · context (~300) · last-turn body.

struct HUDAgentsView: View {
    let agents: [HudAgent]
    let activeAgentId: String?
    var canLoadMore = false
    var isLoadingMore = false
    var loadMoreCount: Int?
    var onLoadMore: () -> Void = {}

    @ObservedObject private var state = HUDState.shared
    @StateObject private var engage = HUDEngageState()

    var body: some View {
        Group {
            if agents.isEmpty {
                FleetEmptyState()
            } else {
                switch state.size {
                case .compact:           compactBody
                case .medium, .large:    largeBody
                }
            }
        }
        .onAppear {
            reconcileCursorWithAgents()
            wireNavBus()
        }
        .onChange(of: rowIds()) { _, _ in
            reconcileCursorWithAgents()
            wireNavBus()
        }
        .onChange(of: activeAgentId) { _, _ in
            reconcileCursorWithAgents()
        }
        .onDisappear { HUDNavBus.shared.clear() }
    }

    // MARK: - Compact (shipped)

    private var compactBody: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    HUDAgentsHeader(count: agents.count, onCreate: openRunnerForSelectedProject)
                    ForEach(Array(agents.enumerated()), id: \.element.id) { idx, agent in
                        AgentRowCompact(
                            agent: agent,
                            isFirst: idx == 0,
                            isActive: agent.id == activeAgentId,
                            isCursored: engage.isCursored(agent.id),
                            isEngaged: engage.isSelected(agent.id),
                            onTap: {
                                withAnimation(.easeOut(duration: 0.14)) {
                                    engage.toggle(agent.id)
                                }
                            }
                        )
                        .id(agent.id)
                        if engage.isSelected(agent.id) {
                            AgentDetailInline(agent: agent)
                                .transition(.move(edge: .top).combined(with: .opacity))
                        }
                    }
                    if canLoadMore || isLoadingMore {
                        AgentLoadMoreRow(
                            count: loadMoreCount,
                            isLoading: isLoadingMore,
                            action: onLoadMore
                        )
                    }
                }
                .padding(.bottom, 8)
            }
            .onChange(of: engage.cursoredId) { _, id in
                scrollAgentList(to: id, proxy: proxy)
            }
            .onAppear {
                scrollAgentList(to: selectedAgent.id, proxy: proxy, animated: false)
            }
        }
    }

    // MARK: - Large (three panes — also serves Medium; the wide layout is
    // what makes the S→M jump feel like a tier change rather than a font
    // bump.)

    private var selectedAgent: HudAgent {
        if let id = engage.cursoredId, let match = agents.first(where: { $0.id == id }) {
            return match
        }
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
            HUDAgentsHeader(count: agents.count, onCreate: openRunnerForSelectedProject)
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
            if canLoadMore || isLoadingMore {
                AgentLoadMoreRow(
                    count: loadMoreCount,
                    isLoading: isLoadingMore,
                    action: onLoadMore
                )
            }
        }
    }

    private func wireNavBus() {
        HUDNavBus.shared.cycleNext = {
            let ids = rowIds()
            guard !ids.isEmpty else { return }
            let current = engage.cursoredId ?? engage.engagedId ?? activeAgentId
            if let current, let index = ids.firstIndex(of: current), index + 1 < ids.count {
                engage.cursor(ids[index + 1])
            } else {
                engage.cursor(ids.first)
            }
        }
        HUDNavBus.shared.cyclePrev = {
            let ids = rowIds()
            guard !ids.isEmpty else { return }
            let current = engage.cursoredId ?? engage.engagedId ?? activeAgentId
            if let current, let index = ids.firstIndex(of: current), index > 0 {
                engage.cursor(ids[index - 1])
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
            guard let id = engage.cursoredId ?? engage.engagedId ?? activeAgentId ?? agents.first?.id,
                  let agent = agents.first(where: { $0.id == id }) else { return }
            if engage.engagedId != id {
                engage.toggle(id)
            } else {
                stageTarget(agent)
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
            openRunnerForSelectedProject()
        }
    }

    private func rowIds() -> [String] {
        agents.map { $0.id }
    }

    private func reconcileCursorWithAgents() {
        guard !agents.isEmpty else {
            engage.clear()
            return
        }
        if let cursored = engage.cursoredId,
           agents.contains(where: { $0.id == cursored }) {
            return
        }
        if let engaged = engage.engagedId,
           agents.contains(where: { $0.id == engaged }) {
            engage.cursor(engaged)
            return
        }
        if let activeAgentId, agents.contains(where: { $0.id == activeAgentId }) {
            engage.cursor(activeAgentId)
        } else {
            engage.cursor(agents.first?.id)
        }
    }

    private func scrollAgentList(
        to id: String?,
        proxy: ScrollViewProxy,
        animated: Bool = true
    ) {
        guard let id else { return }
        DispatchQueue.main.async {
            if animated {
                withAnimation(.easeOut(duration: 0.16)) {
                    proxy.scrollTo(id)
                }
            } else {
                proxy.scrollTo(id)
            }
        }
    }

    private func stageTarget(_ agent: HudAgent) {
        let handle = agent.handle ?? agent.name
        HUDDockState.shared.setTarget(handle: handle, label: agent.name)
        HUDDockState.shared.focus()
    }

    private func openRunnerForSelectedProject() {
        let preferredId = engage.cursoredId ?? engage.selectedId ?? activeAgentId
        let projectRoot = preferredId
            .flatMap { id in agents.first(where: { $0.id == id }) }
            .flatMap(\.projectRoot)
            ?? agents.first?.projectRoot
        HUDRunnerState.shared.open(projectRoot: projectRoot)
    }
}

private struct AgentLoadMoreRow: View {
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
        if isLoading { return "LOADING RECENT AGENTS" }
        if let count { return "LOAD \(count) MORE" }
        return "LOAD MORE"
    }
}

private struct AgentLoadMoreRow: View {
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
        if isLoading { return "LOADING RECENT AGENTS" }
        if let count { return "LOAD \(count) MORE" }
        return "LOAD MORE"
    }
}

// MARK: - Section header

private struct HUDAgentsHeader: View {
    let count: Int
    var onCreate: () -> Void = {}

    // Tab name lives in the masthead (`1 agents`). No redundant
    // big title under the eyebrow — eyebrow + count is enough.
    var body: some View {
        HStack(spacing: 10) {
            HUDEyebrow(text: "ROSTER  ·  \(count) AGENT\(count == 1 ? "" : "S")", color: HUDChrome.inkFaint)
            Spacer()
            Button(action: onCreate) {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .bold))
                    .frame(width: 22, height: 22)
            }
            .buttonStyle(.plain)
            .foregroundStyle(HUDChrome.inkMuted)
            .background(HUDChrome.canvasLift.opacity(0.34))
            .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 1))
            .help("New agent")
        }
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

// MARK: - Shared bits

private func stateColor(for state: HudAgentState) -> Color {
    switch state {
    case .working, .needsAttention: return HUDChrome.accent
    case .available, .done: return HUDChrome.inkMuted
    case .offline: return HUDChrome.inkFaint
    }
}

private func stateLabel(for state: HudAgentState) -> String {
    switch state {
    case .working:        return "WORKING"
    case .needsAttention: return "NEEDS ATTENTION"
    case .available:      return "AVAILABLE"
    case .done:           return "DONE"
    case .offline:        return "OFFLINE"
    }
}

// MARK: - Compact row

private struct AgentRowCompact: View {
    let agent: HudAgent
    let isFirst: Bool
    let isActive: Bool
    let isCursored: Bool
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
            if isEngaged || isCursored || isActive {
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
        // Compact panel is ~560px. Name carries layout priority and
        // truncates tail; handle drops to keep dot + name + state + ago
        // fitting within the row without overflow that drops the dot
        // or clips state text.
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            AgentStateDot(color: stateColor(for: agent.state), working: isWorking)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

            Text(agent.name)
                .font(HUDType.body(13, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                .layoutPriority(1)

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
                    HUDEyebrow(text: "CAPS", color: HUDChrome.inkFaint)
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
                statKV(label: "BRANCH", value: agent.branchLabel)
                if let cwd = agent.projectRoot {
                    statKV(label: "CWD", value: cwd)
                }
                statKV(label: "MODEL", value: agent.tokens)
            }

            HStack(spacing: 8) {
                compactAction(label: "MESSAGES") {
                    openAgentMessages(agent)
                }
                if agent.projectRoot != nil {
                    compactAction(label: "OPEN") {
                        openAgentProjectRoot(agent)
                    }
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.55))
    }

    private func detailBlock(label: String, body: String, accent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HUDEyebrow(text: label, color: accent ? HUDChrome.accent : HUDChrome.inkFaint)
            Text(body)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                .lineSpacing(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func compactAction(label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(HUDType.mono(9, weight: .bold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(HUDChrome.accent)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .overlay(Rectangle().stroke(HUDChrome.accent.opacity(0.55), lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Large pane: Column A (roster list)

private struct AgentColumnA: View {
    let agents: [HudAgent]
    let selectedId: String
    var onSelect: (String) -> Void

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(agents) { a in
                        AgentColARow(
                            agent: a,
                            selected: a.id == selectedId,
                            onSelect: { onSelect(a.id) }
                        )
                        .id(a.id)
                    }
                }
            }
            .onChange(of: selectedId) { _, id in
                scrollToSelected(id, proxy: proxy)
            }
            .onChange(of: agents.map(\.id)) { _, _ in
                scrollToSelected(selectedId, proxy: proxy, animated: false)
            }
            .onAppear {
                scrollToSelected(selectedId, proxy: proxy, animated: false)
            }
        }
    }

    private func scrollToSelected(
        _ id: String,
        proxy: ScrollViewProxy,
        animated: Bool = true
    ) {
        DispatchQueue.main.async {
            if animated {
                withAnimation(.easeOut(duration: 0.16)) {
                    proxy.scrollTo(id)
                }
            } else {
                proxy.scrollTo(id)
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
            // Col A is a narrow roster (280px). Keep the identity line
            // tight: dot · name (truncates) · ago. Handle + state live
            // in col B's header where they have room to breathe.
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                AgentStateDot(color: stateColor(for: agent.state), working: agent.state == .working)
                    .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

                Text(agent.name)
                    .font(HUDType.body(12, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)

                Spacer(minLength: 6)

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

    @State private var pulse: [Double]? = nil

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
        .task(id: agent.id) {
            pulse = nil
            do {
                let fetched = try await ScoutObservePulseClient().fetchPulse(agentId: agent.id)
                if let counts = fetched?.counts {
                    let peak = max(counts.max() ?? 0, 1)
                    pulse = counts.map { Double($0) / Double(peak) }
                }
            } catch {
                pulse = nil
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                AgentStateDot(color: stateColor(for: agent.state), working: agent.state == .working)
                    .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
                Text(agent.name)
                    .font(HUDType.body(13, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)
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
                    .fixedSize()
            }
            // Pulse sparkline — real per-agent event-density data from
            // /api/observe/agents. Frame is always reserved (72×10) so
            // the header doesn't jump when data arrives or is absent.
            if let pulse {
                HUDPulseSparkline(
                    values: pulse,
                    color: HUDChrome.agentHue(agent.hue),
                    size: CGSize(width: 72, height: 10)
                )
                .padding(.leading, 14)
            } else {
                Color.clear
                    .frame(width: 72, height: 10)
                    .padding(.leading, 14)
            }
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
            kv(label: "BRANCH", value: agent.branchLabel)
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
        VStack(alignment: .leading, spacing: 0) {
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
                }
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: .infinity, alignment: .top)

            // Engage stack — live actions pinned to the bottom of the
            // column so the operator surface sits below LAST TURN.
            engageStack
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(HUDChrome.borderSoft)
                        .frame(height: 0.5)
                }
        }
    }

    private var engageStack: some View {
        VStack(alignment: .leading, spacing: 6) {
            HUDEyebrow(text: "ENGAGE", color: HUDChrome.inkFaint)
                .padding(.bottom, 2)
            engageRow(verb: "SEND",     hint: "↵ deliver a directive", enabled: true,  action: sendAction)
            engageRow(verb: "MESSAGES", hint: "jump to message thread", enabled: true, action: messagesAction)
            engageRow(verb: "TAIL",     hint: "open this agent's tail", enabled: true, action: tailAction)
            engageRow(verb: "OPEN",     hint: "reveal project root",    enabled: agent.projectRoot != nil, action: openAction)
        }
    }

    private func engageRow(verb: String, hint: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verb)
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(enabled ? HUDChrome.ink : HUDChrome.inkFaint)
                    .frame(width: 68, alignment: .leading)
                Text(hint)
                    .font(HUDType.body(11))
                    .foregroundStyle(enabled ? HUDChrome.inkMuted : HUDChrome.inkFaint)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // Stage the selected agent as the dock's routing target, then take
    // keyboard focus. The dock's TextField becomes firstResponder via
    // the focusRequested bump in HUDDockState.
    private func sendAction() {
        let handle = agent.handle ?? agent.name
        HUDDockState.shared.setTarget(handle: handle, label: agent.name)
        HUDDockState.shared.focus()
    }

    private func messagesAction() {
        openAgentMessages(agent)
    }

    private func tailAction() {
        NSWorkspace.shared.open(agentTailURL(agent))
    }

    private func openAction() {
        openAgentProjectRoot(agent)
    }

}

private func openAgentMessages(_ agent: HudAgent) {
    NSWorkspace.shared.open(agentMessagesURL(agent))
}

private func openAgentProjectRoot(_ agent: HudAgent) {
    guard let root = agent.projectRoot else { return }
    let expanded = (root as NSString).expandingTildeInPath
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: expanded)])
}

private func agentMessagesURL(_ agent: HudAgent) -> URL {
    let base = ScoutWeb.baseURL()
    if let cid = agent.conversationId, !cid.isEmpty {
        return agentRelativeURL("/c/\(agentPercent(cid))", base: base)
    }
    if !agent.id.isEmpty {
        return agentRelativeURL("/agents/\(agentPercent(agent.id))?tab=message", base: base)
    }
    return agentRelativeURL("/agents", base: base)
}

private func agentTailURL(_ agent: HudAgent) -> URL {
    var components = URLComponents(
        url: ScoutWeb.baseURL().appending(path: "ops/tail"),
        resolvingAgainstBaseURL: false
    )
    components?.queryItems = [
        URLQueryItem(name: "q", value: agentTailQuery(agent))
    ]
    return components?.url ?? agentRelativeURL("/ops/tail", base: ScoutWeb.baseURL())
}

private func agentTailQuery(_ agent: HudAgent) -> String {
    if let sessionId = agent.harnessSessionId?.trimmingCharacters(in: .whitespacesAndNewlines),
       !sessionId.isEmpty {
        return sessionId
    }
    if let handle = agent.handle?.trimmingCharacters(in: .whitespacesAndNewlines),
       !handle.isEmpty {
        return handle.hasPrefix("@") ? handle : "@" + handle
    }
    return agent.id
}

private func agentRelativeURL(_ path: String, base: URL) -> URL {
    URL(string: path, relativeTo: base)?.absoluteURL ?? base
}

private func agentPercent(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
}

// MARK: - Empty state

private struct FleetEmptyState: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDMastheadMark(size: 44)
                .opacity(0.85)

            HUDEyebrow(text: "ROSTER  ·  EMPTY", color: HUDChrome.inkFaint)
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
