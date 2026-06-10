import ScoutAppCore
import SwiftUI

// HUD shell — broadsheet edition.
//
// The thesis: this is a printed brief, filed by the broker every time
// you summon it. The masthead carries identity, date, volume number,
// and — folded into the dateline — the three views as a single linked
// header (no bottom tab strip). Below it: a content well that breathes,
// with display-serif headlines, italicized voice quotes, and mono ONLY
// for facts. Hue carries identity per row as a footer hue-rule, not a
// stripe parade.
//
// Layers (bottom → top):
//   0. NSVisualEffectView (hud window — desktop tints through)
//   1. Warm-dark glass gradient
//   2. Diagonal lime whisper (135°)
//   3. Top-half luminance wash
//   4. Off-center specular hot-spot
//   5. Paper grain (soft-light, very low contrast)
//   6. Content (masthead + content well + footer dateline)
//   7. Rim (top-edge lime kicker + corner halos)
//   8. Border stroke + corner radius clip

struct HUDStatusView: View {
    @ObservedObject var controller: OpenScoutAppController
    var onDismiss: () -> Void

    @ObservedObject private var state = HUDState.shared
    @ObservedObject private var fleet = HudFleetService.shared
    @StateObject private var agentsStore = ScoutAgentsStore()
    @StateObject private var tail = ScoutTailStore()

    private let minPanelW: CGFloat = 360
    private let minPanelH: CGFloat = 380
    private let cornerRadius: CGFloat = 12

    private var agents: [HudAgent] {
        agentsStore.agents ?? []
    }

    private var activeAgentId: String? {
        agents.first(where: { $0.state == .working })?.id
    }

    private var brokerOffline: Bool {
        agentsStore.lastError != nil && (agentsStore.agents?.isEmpty ?? true)
    }

    private var attentionCount: Int {
        agents.filter { $0.state == .needsAttention }.count
    }

    private var workingCount: Int {
        agents.filter { $0.state == .working }.count
    }

    var body: some View {
        ZStack {
            // ── Substrate: one solid warm-dark fill (no live blur) ──
            // Text sitting over a partially-transparent fill above
            // NSVisualEffectView reads as soft because every glyph
            // composites through the live-blurred desktop. A fully
            // opaque canvas removes the leakage — the panel reads as
            // printed ink on paper, not glass.
            HUDChrome.canvas

            // ── Content stack ───────────────────────────────────────
            // No .drawingGroup / .compositingGroup — both pre-rasterize
            // glyphs at layer scale and lose the subpixel positioning
            // SwiftUI's text renderer normally hands to the display.
            VStack(spacing: 0) {
                masthead
                // Force the content area to fill remaining height with
                // child aligned to top. This pins the flash row + dock
                // to the bottom of the panel regardless of whether the
                // active tab's content is intrinsic-short (agents list)
                // or has its own greedy Spacers (assistant empty state).
                // A naked Spacer here would compete with the latter and
                // land the flash row in the middle of the panel.
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .layoutPriority(1)
                HUDFlashRow()
                HudMessageDock(agents: agents)
            }

            // `?` cheatsheet — drawn on top of the panel body, masthead
            // and dock stay visible underneath. Toggled from HUDController.
            HUDCheatsheetOverlay()

            // Runner draft — a HUD-local composer for broker-owned project
            // asks. Swift gathers helpful inputs; TS owns routing.
            HUDRunnerOverlay()
        }
        .frame(
            minWidth: minPanelW, maxWidth: .infinity,
            minHeight: minPanelH, maxHeight: .infinity
        )
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        // Crisp warm-cream hairline at the panel edge. One restrained
        // thin line cuts the rectangle out of the desktop the way
        // Lattices' voice panel does — no brackets, no glow on the
        // border itself. Shadow is the NSPanel's native one (configured
        // in HUDController), which samples the alpha mask of the
        // rounded content and casts a proper rounded halo; SwiftUI
        // `.shadow` modifiers here would get clipped to the hosting
        // view's rectangle and read as a faint rectangle behind us.
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(HUDChrome.borderRim, lineWidth: 1)
        )
        .onAppear {
            agentsStore.start()
            fleet.start()
            HUDDockState.shared.setSuggestionAgents(agents)
        }
        .onChange(of: agents) { _, next in
            HUDDockState.shared.setSuggestionAgents(next)
        }
        .onDisappear {
            agentsStore.stop()
            fleet.stop()
        }
    }

    // MARK: - Masthead
    //
    // One row: tiny mark + nav tabs. No wordmark, no live meter, no
    // hotkey chip. Attention surfaces as a single lime pip at the right
    // *only* when there's actually attention. Hotkey moves to footer.

    private var masthead: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            HUDMastheadMark(size: 12)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

            ForEach(HUDView.allCases) { view in
                NavigatorLink(view: view, isActive: state.view == view)
                if view != HUDView.allCases.last {
                    Text("·")
                        .font(HUDType.mono(10))
                        .foregroundStyle(HUDChrome.inkDeep)
                }
            }

            Spacer(minLength: 6)

            // Right cluster: attention pip (when something needs eyes) ·
            // dismissed-flash pip (when an alert was dismissed but the
            // condition lingers) · 3-pill size toggle · `?` cheatsheet hint.
            HStack(spacing: 8) {
                if attentionCount > 0 {
                    AttentionPip()
                        .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 3 }
                } else if brokerOffline {
                    BrokerOfflinePip()
                }
                DismissedFlashPip()
                HUDSizeToggle()
                    .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
                CheatsheetChip()
                    .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 9)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.border)
                .frame(height: 0.5)
        }
    }

    // MARK: - Content router

    @ViewBuilder
    private var content: some View {
        ZStack(alignment: .top) {
            switch state.view {
            case .agents:
                agentsContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .transition(.opacity)
            case .activity:
                HUDActivityView(
                    agents: agents,
                    activity: fleet.activity,
                    isLoading: fleet.isLoading && fleet.activity == nil
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .transition(.opacity)
            case .tail:
                HUDTailView(tail: tail)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .transition(.opacity)
            case .sessions:
                HUDSessionsView(agents: agents)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .transition(.opacity)
            case .assistant:
                HUDAssistantView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    @ViewBuilder
    private var agentsContent: some View {
        if agentsStore.agents == nil && agentsStore.lastError == nil {
            FleetLoadingView()
        } else {
            HUDAgentsView(agents: agents, activeAgentId: activeAgentId)
        }
    }

    // MARK: - Footer (dateline + hotkey credit)
    //
    // Tiny printed credit at the bottom of the panel:
    // `filed by @scout · YYYY-MM-DD HH:MM · ESC dismiss`
    // Replaces the bottom tab strip — navigation moved to the masthead.

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(HUDChrome.border)
                .frame(height: 0.5)
            HStack(spacing: 6) {
                Text("filed by")
                    .font(HUDType.mono(10))
                    .tracking(HUDType.eyebrowMicro)
                    .foregroundStyle(HUDChrome.inkDeep)
                Text("@scout")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowMicro)
                    .foregroundStyle(HUDChrome.inkMuted)
                Text("·")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkDeep)
                Text(currentDateline)
                    .font(HUDType.mono(10))
                    .tracking(HUDType.eyebrowMicro)
                    .foregroundStyle(HUDChrome.inkDeep)
                Spacer()
                HyperKeyChip()
                EscChip()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(HUDChrome.canvasAlt.opacity(0.35))
        }
    }

    private var currentDateline: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd  HH:mm"
        return f.string(from: Date()).uppercased()
    }
}

// MARK: - Navigator link (masthead-embedded)
//
// A typographic tab — number key + serif word lower-case. Active label
// gets a lime baseline rule and ink color. Hover lifts inkDeep → inkMuted.

private struct NavigatorLink: View {
    let view: HUDView
    let isActive: Bool
    @State private var hovered = false

    private var sigilColor: Color {
        isActive ? HUDChrome.accent : HUDChrome.inkDeep
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 3) {
                // Assistant tab carries the robot-head identity per
                // feedback_meta_agent_naming_neutral — the label text
                // stays neutral, the sigil does the brand work.
                if view == .assistant {
                    RobotGlyphShape()
                        .stroke(sigilColor, style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
                        .frame(width: 11, height: 11)
                        .padding(.trailing, 1)
                }
                Text(view.keyLabel)
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(isActive ? HUDChrome.accent : HUDChrome.inkDeep)
                Text(view.label.lowercased())
                    .font(HUDType.body(13, weight: isActive ? .semibold : .regular))
                    .foregroundStyle(
                        isActive ? HUDChrome.ink :
                        hovered ? HUDChrome.inkMuted : HUDChrome.inkDeep
                    )
                    .kerning(-0.1)
            }
            // Lime baseline rule — only on the active label
            Rectangle()
                .fill(isActive ? HUDChrome.accent : Color.clear)
                .frame(height: 1.25)
                .frame(maxWidth: .infinity)
        }
        .fixedSize()
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture {
            HUDState.shared.select(view)
        }
    }
}

// MARK: - Hyper key chip (compact)

private struct HyperKeyChip: View {
    var body: some View {
        HStack(spacing: 1.5) {
            ForEach(["⌃", "⌥", "⇧", "⌘"], id: \.self) { glyph in
                Text(glyph)
                    .font(HUDType.mono(10, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkDeep)
            }
            Text("H")
                .font(HUDType.mono(10, weight: .bold))
                .foregroundStyle(HUDChrome.accent)
                .padding(.leading, 1)
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 1.5)
        .background(
            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                .fill(HUDChrome.canvas.opacity(0.55))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                .stroke(HUDChrome.border, lineWidth: 0.5)
        )
    }
}

private struct EscChip: View {
    var body: some View {
        HStack(spacing: 5) {
            Text("ESC")
                .font(HUDType.mono(10, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(HUDChrome.inkDeep)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(
                    RoundedRectangle(cornerRadius: 2)
                        .fill(HUDChrome.canvas.opacity(0.55))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(HUDChrome.border, lineWidth: 0.5)
                )
            Text("dismiss")
                .font(HUDType.mono(10))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(HUDChrome.inkDeep)
        }
    }
}

// MARK: - Live dot

private struct LiveDot: View {
    let active: Bool
    @State private var phase: CGFloat = 0

    var body: some View {
        ZStack {
            if active {
                Circle()
                    .fill(HUDChrome.accent.opacity(0.35 * (1 - phase)))
                    .frame(width: 11, height: 11)
            }
            Circle()
                .fill(active ? HUDChrome.accent : HUDChrome.inkFaint)
                .frame(width: 5, height: 5)
        }
        .frame(width: 11, height: 11)
        .onAppear {
            if active {
                withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) {
                    phase = 1.0
                }
            }
        }
    }
}

// Tiny `?` chip in the masthead — clicking or pressing `?` opens the
// keymap cheatsheet. Lives here so the discovery affordance never
// scrolls off-screen with the content.
private struct CheatsheetChip: View {
    @ObservedObject private var sheet = HUDCheatsheetState.shared

    var body: some View {
        Button(action: { sheet.toggle() }) {
            Text("?")
                .font(HUDType.mono(10, weight: .bold))
                .foregroundStyle(sheet.visible ? HUDChrome.accent : HUDChrome.inkFaint)
                .frame(width: 14, height: 14)
                .overlay(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .stroke(sheet.visible ? HUDChrome.accent.opacity(0.7) : HUDChrome.border, lineWidth: 0.5)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Show keymap")
    }
}

private struct AttentionPip: View {
    @State private var phase: CGFloat = 0

    var body: some View {
        ZStack {
            Circle()
                .stroke(HUDChrome.accent.opacity(0.7 * (1 - phase)), lineWidth: 1)
                .frame(width: 10 + 6 * phase, height: 10 + 6 * phase)
            Circle()
                .fill(HUDChrome.accent)
                .frame(width: 5, height: 5)
        }
        .frame(width: 14, height: 14)
        .onAppear {
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) {
                phase = 1.0
            }
        }
    }
}

private struct BrokerOfflinePip: View {
    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(Color(red: 0.92, green: 0.42, blue: 0.38))
                .frame(width: 5, height: 5)
            Text("OFFLINE")
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(Color(red: 0.92, green: 0.42, blue: 0.38))
                .lineLimit(1)
        }
        // Keep the pip horizontal even when the masthead's right cluster
        // is tight — without this, "OFFLINE" wraps to one letter per line.
        .fixedSize()
    }
}

// MARK: - Fleet view

private struct FleetView: View {
    let agents: [HudAgent]
    let activeAgentId: String?

    @State private var expandedAgentId: String? = nil

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(spacing: 0) {
                ForEach(Array(agents.enumerated()), id: \.element.id) { idx, agent in
                    HudAgentRow(
                        agent: agent,
                        isFirst: idx == 0,
                        isActive: agent.id == activeAgentId,
                        isExpanded: agent.id == expandedAgentId,
                        onTap: {
                            withAnimation(.easeOut(duration: 0.14)) {
                                if expandedAgentId == agent.id {
                                    expandedAgentId = nil
                                } else {
                                    expandedAgentId = agent.id
                                }
                            }
                        }
                    )
                    if agent.id == expandedAgentId {
                        AgentExpandedPanel(agent: agent)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 8)
        }
    }
}

// MARK: - Agent row (compact manifest)
//
// Studio agent-row manifest density, translated to SwiftUI:
//
//   Top:    [dot] [name sans 13pt] [STATE eyebrow mono colored] [ago mono right]
//   Bottom: indented task in sans 12pt ink-muted
//
// Single accent (lime) for live/attention states; ink scales for the
// rest. No display serif on names, no italic-serif voice quote, no flag
// glyph, no per-agent hue. Selected/active rows get a 1.5px lime left
// rule. Hover lifts to canvas-alt at 0.30.

struct HudAgentRow: View {
    let agent: HudAgent
    let isFirst: Bool
    let isActive: Bool
    var isExpanded: Bool = false
    var onTap: () -> Void = {}

    @State private var hovered: Bool = false

    private var isAttention: Bool { agent.state == .needsAttention }
    private var isWorking: Bool { agent.state == .working }
    private var isDone: Bool { agent.state == .done }

    // Two-tone state palette: lime for things that need eyes, ink scales
    // for everything else. Matches studio AGENT_STATE_COLOR post-strip.
    private var stateColor: Color {
        switch agent.state {
        case .working, .needsAttention: return HUDChrome.accent
        case .available:                return HUDChrome.inkMuted
        case .done:                     return HUDChrome.inkMuted
        case .offline:                  return HUDChrome.inkFaint
        }
    }

    private var stateLabel: String {
        switch agent.state {
        case .working:        return "WORKING"
        case .needsAttention: return "NEEDS ATTENTION"
        case .available:      return "AVAILABLE"
        case .done:           return "DONE"
        case .offline:        return "OFFLINE"
        }
    }

    private var rowFill: Color {
        if isExpanded { return HUDChrome.canvasLift.opacity(0.55) }
        if hovered    { return HUDChrome.canvasLift.opacity(0.30) }
        return Color.clear
    }

    private var taskText: String {
        if isAttention, let ask = agent.pendingAsk { return ask }
        return agent.lastTurn
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            identityLine
            taskLine
        }
        .padding(.leading, 16)
        .padding(.trailing, 14)
        .padding(.top, isFirst ? 11 : 10)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowFill)
        .overlay(alignment: .leading) {
            // Selected/expanded gets a thin lime left rule — studio's
            // single painted accent. Working/attention agents get a
            // quieter inset dot via the eyebrow, not the rule.
            if isExpanded || isActive {
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
            StateDot(color: stateColor, working: isWorking)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

            Text(agent.name)
                .font(HUDType.body(13, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .fixedSize()

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

    private var taskLine: some View {
        Text(taskText)
            .font(HUDType.body(12))
            .foregroundStyle(isAttention ? HUDChrome.ink : HUDChrome.inkMuted)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .lineSpacing(1.5)
            .padding(.leading, 14) // align under name, past the dot
    }

    private var statRibbon: some View {
        HStack(spacing: 8) {
            Text(agent.runtime.uppercased())
            statDot
            Text("\(agent.files)F")
            statDot
            Text(agent.tokens.uppercased())
            statDot
            Text(agent.branchLabel)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
        .font(HUDType.mono(10, weight: .medium))
        .monospacedDigit()
        .foregroundStyle(HUDChrome.inkDeep)
        .padding(.top, 1)
    }

    private var statDot: some View {
        Circle()
            .fill(HUDChrome.inkFaint)
            .frame(width: 1.8, height: 1.8)
    }
}

// MARK: - State dot (studio manifest)
//
// Single colored dot, 6pt. Working state gets a 12pt halo at 32% to
// match studio AgentRow.tsx manifest density. Other states render bare.

private struct StateDot: View {
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

// MARK: - Status flag (legacy, kept for Tail compatibility)
//
// A printed status pill that replaces the cockpit's arc/dots glyph stack.
// Working = filled hue bar; done = lime bar with notch; available =
// hollow hue outline; offline = dashed inkFaint outline.

private struct BroadsheetStatusFlag: View {
    let state: HudAgentState
    let color: Color

    var body: some View {
        Canvas { ctx, size in
            let h: CGFloat = 6
            let w: CGFloat = size.width
            let y: CGFloat = (size.height - h) / 2
            let rect = CGRect(x: 0, y: y, width: w, height: h)
            let r: CGFloat = 1.4

            switch state {
            case .working:
                ctx.fill(
                    Path(roundedRect: rect, cornerRadius: r),
                    with: .color(color)
                )
            case .done:
                ctx.fill(
                    Path(roundedRect: rect, cornerRadius: r),
                    with: .color(HUDChrome.accent)
                )
                var notch = Path()
                notch.move(to: CGPoint(x: w - 5, y: y + h / 2))
                notch.addLine(to: CGPoint(x: w - 3.5, y: y + h - 1.5))
                notch.addLine(to: CGPoint(x: w - 1.5, y: y + 1.5))
                ctx.stroke(
                    notch,
                    with: .color(HUDChrome.canvas),
                    style: StrokeStyle(lineWidth: 1.1, lineCap: .round, lineJoin: .round)
                )
            case .available:
                ctx.stroke(
                    Path(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), cornerRadius: r),
                    with: .color(color.opacity(0.75)),
                    style: StrokeStyle(lineWidth: 1)
                )
            case .offline:
                ctx.stroke(
                    Path(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), cornerRadius: r),
                    with: .color(HUDChrome.inkFaint.opacity(0.5)),
                    style: StrokeStyle(lineWidth: 0.75, dash: [1.5, 1.5])
                )
            case .needsAttention:
                ctx.fill(
                    Path(roundedRect: rect, cornerRadius: r),
                    with: .color(HUDChrome.accent)
                )
            }
        }
    }
}

// MARK: - Agent expanded panel (tap-to-expand detail)

private struct AgentExpandedPanel: View {
    let agent: HudAgent

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let ask = agent.pendingAsk {
                detailBlock(label: "PENDING ASK", body: ask, isAccent: true)
            }
            detailBlock(label: "LAST TURN", body: agent.lastTurn, isAccent: false)

            if !agent.capabilities.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    HUDEyebrow(text: "CAPABILITIES", color: HUDChrome.inkFaint)
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

            if let selector = agent.selector {
                VStack(alignment: .leading, spacing: 3) {
                    HUDEyebrow(text: "SELECTOR", color: HUDChrome.inkFaint)
                    Text(selector)
                        .font(HUDType.mono(10, weight: .medium))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.55))
    }

    private func detailBlock(label: String, body: String, isAccent: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HUDEyebrow(text: label, color: isAccent ? HUDChrome.accent : HUDChrome.inkFaint)
            Text(body)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                .lineSpacing(2)
        }
    }
}

// MARK: - Fleet loading skeleton

private struct FleetLoadingView: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<3, id: \.self) { _ in
                FleetSkeletonRow()
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
    }
}

private struct FleetSkeletonRow: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                skeleton(width: 14, height: 7)
                skeleton(width: 90, height: 14)
                Spacer()
                skeleton(width: 22, height: 9)
            }
            skeleton(width: 280, height: 11)
            HStack(spacing: 7) {
                skeleton(width: 28, height: 8)
                skeleton(width: 22, height: 8)
                skeleton(width: 32, height: 8)
                skeleton(width: 60, height: 8)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.75)
                .padding(.horizontal, 16)
        }
    }

    private func skeleton(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(HUDChrome.canvasLift)
            .frame(width: width, height: height)
    }
}

// MARK: - Fleet empty state (broadsheet)
//
// A real morning-paper "no news" page. Display-serif headline, a single
// editorial line of body, then a hint pill. Centered in the well; the
// glyph is the masthead mark reproduced at 3× scale.

private struct FleetEmptyView: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDMastheadMark(size: 44)
                .opacity(0.85)

            HUDEyebrow(text: "MORNING EDITION  ·  NIL DISPATCHES", color: HUDChrome.inkFaint)
                .padding(.top, 18)

            Text("The fleet is quiet.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text("Coffee is on the operator.\nSpin up an agent and it will file here.")
                .font(HUDType.body(12).italic())
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .lineSpacing(2)
                .padding(.horizontal, 28)
                .padding(.top, 6)

            HStack(spacing: 5) {
                Text("⌃⌥⇧⌘H")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(HUDChrome.accent)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 2.5)
                            .fill(HUDChrome.accentSoft)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 2.5)
                            .stroke(HUDChrome.accent.opacity(0.4), lineWidth: 0.5)
                    )
                Text("re-summon")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            .padding(.top, 16)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Public StatusGlyph (kept for API parity with prior iterations)
//
// HUDTailView still references StatusGlyph for legacy ornaments; keep it
// available so the file compiles after the row's own status mark moved
// to the BroadsheetStatusFlag.

struct StatusGlyph: View {
    let state: HudAgentState
    let color: Color

    var body: some View {
        BroadsheetStatusFlag(state: state, color: color)
            .frame(width: 14, height: 11)
    }
}

// MARK: - MessageArrow (kept; used in tail/expanded blocks)

struct MessageArrow: View {
    var body: some View {
        Canvas { ctx, size in
            let style = StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round)
            let c = HUDChrome.inkMuted
            var stem = Path()
            stem.move(to: CGPoint(x: 1, y: size.height / 2))
            stem.addLine(to: CGPoint(x: size.width - 1.5, y: size.height / 2))
            var head = Path()
            head.move(to: CGPoint(x: size.width - 3.5, y: size.height / 2 - 2))
            head.addLine(to: CGPoint(x: size.width - 1, y: size.height / 2))
            head.addLine(to: CGPoint(x: size.width - 3.5, y: size.height / 2 + 2))
            ctx.stroke(stem, with: .color(c), style: style)
            ctx.stroke(head, with: .color(c), style: style)
        }
    }
}
