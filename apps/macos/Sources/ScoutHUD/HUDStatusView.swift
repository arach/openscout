import ScoutAppCore
import SwiftUI

enum HUDTailAppearance {
    static let blurOpacityKey = "scout.hud.tail.blurOpacity.v1"
    static let passiveBlurOpacityKey = "scout.hud.tail.passiveBlurOpacity.v1"
    static let passiveOpacityKey = "scout.hud.tail.passiveOpacity.v1"
    static let activeOpacityKey = "scout.hud.tail.activeOpacity.v1"
    static let tintOpacityKey = "scout.hud.tail.tintOpacity.v1"
    static let rowOpacityKey = "scout.hud.tail.rowOpacity.v1"
    static let pathColumnWidthKey = "scout.hud.tail.pathColumnWidth.v1"
    static let kindColumnWidthKey = "scout.hud.tail.kindColumnWidth.v1"

    static let defaultBlurOpacity = 0.86
    static let defaultPassiveBlurOpacity = 0.78
    static let defaultPassiveOpacity = 0.86
    static let defaultActiveOpacity = 1.0
    static let defaultTintOpacity = 0.34
    static let defaultRowOpacity = 1.0
    static let defaultPathColumnWidth = 88.0
    static let defaultKindColumnWidth = 36.0

    static func clamp(_ value: Double, _ range: ClosedRange<Double>) -> Double {
        min(max(value, range.lowerBound), range.upperBound)
    }
}

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
    var onDismiss: () -> Void

    @ObservedObject private var state = HUDState.shared
    @ObservedObject private var motion = HUDMotionState.shared
    @StateObject private var agentsStore = ScoutAgentsStore()
    @StateObject private var activityStore = ScoutActivityStore()
    @StateObject private var tail = ScoutTailStore()
    @StateObject private var sessionsTail = ScoutTailStore(
        recentLimit: 10,
        discoveryScope: .hot,
        discoveryLimit: 10,
        primesTranscriptHistory: false,
        maxRawEvents: 10,
        maxWorkEvents: 10
    )
    @State private var tailHovered = false
    @AppStorage(HUDTailAppearance.blurOpacityKey) private var tailBlurOpacity = HUDTailAppearance.defaultBlurOpacity
    @AppStorage(HUDTailAppearance.passiveBlurOpacityKey) private var tailPassiveBlurOpacity = HUDTailAppearance.defaultPassiveBlurOpacity
    @AppStorage(HUDTailAppearance.passiveOpacityKey) private var tailPassiveOpacity = HUDTailAppearance.defaultPassiveOpacity
    @AppStorage(HUDTailAppearance.activeOpacityKey) private var tailActiveOpacity = HUDTailAppearance.defaultActiveOpacity
    @AppStorage(HUDTailAppearance.tintOpacityKey) private var tailTintOpacity = HUDTailAppearance.defaultTintOpacity
    @AppStorage(HUDTailAppearance.rowOpacityKey) private var tailRowOpacity = HUDTailAppearance.defaultRowOpacity
    @AppStorage(HUDTailAppearance.pathColumnWidthKey) private var tailPathColumnWidth = HUDTailAppearance.defaultPathColumnWidth
    @AppStorage(HUDTailAppearance.kindColumnWidthKey) private var tailKindColumnWidth = HUDTailAppearance.defaultKindColumnWidth
    @AppStorage(HUDTailTreatment.storageKey) private var tailTreatmentRaw = HUDTailTreatment.firehose.rawValue

    private let minPanelW: CGFloat = 360
    private let minPanelH: CGFloat = 380
    private let cornerRadius: CGFloat = 12

    /// HUD tab 3 hosts the shared tail render in the normal HUD panel skin.
    /// TailModeController hosts the same render in its attach/free overlay skin.
    private var tailSurface: TailSurface? {
        guard state.view == .tail else { return nil }
        return .panel
    }

    private var isTailOverlay: Bool {
        tailSurface == .overlay
    }

    private var isTailFullHeight: Bool {
        isTailOverlay && state.size == .large && !state.tailCollapsed
    }

    private var isTailCollapsing: Bool {
        isTailOverlay && motion.phase == .collapsing
    }

    private var tailPresenceLifted: Bool {
        tailHovered || motion.modifierLift || motion.isActive
    }

    private var tailPresenceOpacity: Double {
        guard isTailOverlay else { return 1.0 }
        if isTailCollapsing { return 1.0 }
        return tailPresenceLifted ? resolvedTailActiveOpacity : resolvedTailPassiveOpacity
    }

    private var activeCornerRadius: CGFloat {
        if isTailCollapsing { return 7 }
        if isTailOverlay && state.tailCollapsed { return 8 }
        if isTailFullHeight { return 0 }
        return isTailOverlay ? 10 : cornerRadius
    }

    private var resolvedTailBlurOpacity: Double {
        HUDTailAppearance.clamp(tailBlurOpacity, 0...1)
    }

    private var resolvedTailPassiveBlurOpacity: Double {
        HUDTailAppearance.clamp(tailPassiveBlurOpacity, 0.30...1)
    }

    private var resolvedTailPassiveOpacity: Double {
        HUDTailAppearance.clamp(tailPassiveOpacity, 0.35...1)
    }

    private var resolvedTailActiveOpacity: Double {
        HUDTailAppearance.clamp(tailActiveOpacity, 0.35...1)
    }

    private var resolvedTailTintOpacity: Double {
        HUDTailAppearance.clamp(tailTintOpacity, 0...0.85)
    }

    private var resolvedTailRowOpacity: Double {
        HUDTailAppearance.clamp(tailRowOpacity, 0.55...1)
    }

    private var activeMinPanelW: CGFloat {
        guard isTailOverlay else { return minPanelW }
        return state.tailCollapsed ? 42 : 320
    }

    private var activeMinPanelH: CGFloat {
        guard isTailOverlay else { return minPanelH }
        return state.tailCollapsed ? 26 : 380
    }

    private var tailMaterialOpacity: Double {
        tailPresenceLifted ? resolvedTailBlurOpacity : resolvedTailPassiveBlurOpacity
    }

    private var tailVeilOpacity: Double {
        0.12 + (resolvedTailTintOpacity * 0.42)
    }

    private var agents: [HudAgent] {
        agentsStore.agents ?? []
    }

    private var tailTreatment: HUDTailTreatment {
        HUDTailTreatment(rawValue: tailTreatmentRaw) ?? .firehose
    }

    private var tailTreatmentBinding: Binding<HUDTailTreatment> {
        Binding(
            get: { tailTreatment },
            set: { tailTreatmentRaw = $0.rawValue }
        )
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
            // ── Substrate ───────────────────────────────────────────
            // The normal HUD stays on a solid printed canvas. Tail is
            // intentionally closer to desktop glass: a light material blur
            // underneath a faint warm tint, so large mode can read as part of
            // the display rather than a floating card.
            if isTailCollapsing {
                tailCollapseSlab
            } else if isTailOverlay {
                VisualEffectBackground(
                    material: .hudWindow,
                    blendingMode: .behindWindow,
                    state: .active,
                    cornerRadius: activeCornerRadius
                )
                .opacity(tailMaterialOpacity)
                tailReadabilityVeil
                    .opacity(tailPresenceOpacity)
            } else {
                HUDChrome.canvas
            }

            // ── Content stack ───────────────────────────────────────
            // No .drawingGroup / .compositingGroup — both pre-rasterize
            // glyphs at layer scale and lose the subpixel positioning
            // SwiftUI's text renderer normally hands to the display.
            if isTailCollapsing {
                EmptyView()
            } else if isTailOverlay && state.tailCollapsed {
                tailCollapsedRail
                    .transition(tailCollapsedTransition)
            } else {
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
                    if tailSurface?.showsDock ?? true {
                        HudMessageDock(agents: agents)
                    }
                }
                .transition(tailExpandedTransition)
            }

            // `?` cheatsheet — drawn on top of the panel body, masthead
            // and dock stay visible underneath. Toggled from HUDController.
            if !isTailCollapsing {
                HUDCheatsheetOverlay()
            }

            // Runner draft — a HUD-local composer for broker-owned project
            // asks. Swift gathers helpful inputs; TS owns routing.
            if !isTailCollapsing {
                HUDRunnerOverlay()
            }
        }
        .frame(
            minWidth: activeMinPanelW, maxWidth: .infinity,
            minHeight: activeMinPanelH, maxHeight: .infinity
        )
        .clipShape(RoundedRectangle(cornerRadius: activeCornerRadius, style: .continuous))
        // Crisp warm-cream hairline at the panel edge. One restrained
        // thin line cuts the rectangle out of the desktop the way
        // Lattices' voice panel does — no brackets, no glow on the
        // border itself. Shadow is the NSPanel's native one (configured
        // in HUDController), which samples the alpha mask of the
        // rounded content and casts a proper rounded halo; SwiftUI
        // `.shadow` modifiers here would get clipped to the hosting
        // view's rectangle and read as a faint rectangle behind us.
        .overlay {
            if !isTailFullHeight && !isTailCollapsing {
                RoundedRectangle(cornerRadius: activeCornerRadius, style: .continuous)
                    .strokeBorder(
                        HUDChrome.borderRim.opacity(isTailOverlay ? 0.14 : 1.0),
                        lineWidth: isTailOverlay ? 0.5 : 1
                    )
            }
        }
        .animation(
            .timingCurve(0.18, 0.88, 0.22, 1.0, duration: tailPresenceLifted ? 0.10 : 0.18),
            value: tailPresenceOpacity
        )
        .onHover { hovering in
            guard isTailOverlay else { return }
            tailHovered = hovering
        }
        .onChange(of: isTailOverlay) { _, active in
            if !active { tailHovered = false }
        }
        .onAppear {
            agentsStore.start()
            activityStore.start()
            HUDDockState.shared.setSuggestionAgents(agents)
        }
        .onChange(of: agents) { _, next in
            HUDDockState.shared.setSuggestionAgents(next)
        }
        .onDisappear {
            agentsStore.stop()
            activityStore.stop()
        }
    }

    private var tailCollapsedTransition: AnyTransition {
        isTailOverlay ? .identity : .opacity.combined(with: .move(edge: .trailing))
    }

    private var tailExpandedTransition: AnyTransition {
        isTailOverlay ? .identity : .opacity.combined(with: .move(edge: .leading))
    }

    private var tailCollapseSlab: some View {
        RoundedRectangle(cornerRadius: activeCornerRadius, style: .continuous)
            .fill(Color(red: 0.105, green: 0.108, blue: 0.108).opacity(0.88))
            .overlay {
                RoundedRectangle(cornerRadius: activeCornerRadius, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.055), lineWidth: 0.5)
            }
            .allowsHitTesting(false)
    }

    private var tailReadabilityVeil: some View {
        ZStack {
            HUDChrome.canvas.opacity(tailVeilOpacity)
            LinearGradient(
                colors: [
                    HUDChrome.canvas.opacity(tailVeilOpacity + 0.10),
                    HUDChrome.canvas.opacity(tailVeilOpacity * 0.70),
                    HUDChrome.canvas.opacity(tailVeilOpacity + (state.tailCollapsed ? 0.08 : 0.02)),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(
                colors: [
                    Color.white.opacity(0.030),
                    Color.clear,
                    Color.black.opacity(0.055),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .allowsHitTesting(false)
    }

    // MARK: - Masthead
    //
    // One row: tiny mark + nav tabs. No wordmark, no live meter, no
    // hotkey chip. Attention surfaces as a single lime pip at the right
    // *only* when there's actually attention. Hotkey moves to footer.

    @ViewBuilder
    private var masthead: some View {
        if isTailOverlay {
            tailMasthead
        } else {
            defaultMasthead
        }
    }

    private var defaultMasthead: some View {
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

    private var tailMasthead: some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            TailCollapseButton(expanded: true) {
                HUDState.shared.setTailCollapsed(true)
            }
            .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

            HUDMastheadMark(size: 12)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

            Text("TAIL")
                .font(HUDType.mono(11, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.ink)

            Text("\(tail.filteredEvents.count)")
                .font(HUDType.mono(10, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkMuted)

            Spacer(minLength: 8)

            HStack(spacing: 8) {
                if brokerOffline {
                    BrokerOfflinePip()
                } else if attentionCount > 0 {
                    AttentionPip()
                        .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 3 }
                }
                DismissedFlashPip()
                HUDTailTreatmentToggle(selection: tailTreatmentBinding)
                    .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
                HUDTailAppearanceButton(
                    blurOpacity: $tailBlurOpacity,
                    passiveBlurOpacity: $tailPassiveBlurOpacity,
                    passiveOpacity: $tailPassiveOpacity,
                    activeOpacity: $tailActiveOpacity,
                    tintOpacity: $tailTintOpacity,
                    rowOpacity: $tailRowOpacity,
                    pathColumnWidth: $tailPathColumnWidth,
                    kindColumnWidth: $tailKindColumnWidth
                )
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
                HUDSizeToggle(filled: true)
                    .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
                CheatsheetChip(filled: true)
                    .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
                TailDismissButton {
                    onDismiss()
                }
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }
            }
        }
        .padding(.horizontal, 13)
        .padding(.top, 8)
        .padding(.bottom, 7)
        .background(tailMastheadBackground)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.border.opacity(0.78))
                .frame(height: 0.5)
        }
    }

    private var tailMastheadBackground: some View {
        ZStack {
            HUDChrome.canvas.opacity(0.96)
            LinearGradient(
                colors: [
                    HUDChrome.canvasAlt.opacity(0.62),
                    HUDChrome.canvas.opacity(0.98),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .allowsHitTesting(false)
    }

    private var tailCollapsedRail: some View {
        GeometryReader { proxy in
            let horizontal = proxy.size.width > proxy.size.height * 2.2

            Group {
                if horizontal {
                    tailCollapsedHorizontalHandle
                } else {
                    tailCollapsedVerticalRail
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .onTapGesture {
                HUDState.shared.setTailCollapsed(false)
            }
            .help("Expand Tail")
        }
    }

    private var tailCollapsedHorizontalHandle: some View {
        HStack(spacing: 6) {
            TailCollapseButton(expanded: false, collapsedSystemName: "chevron.down") {
                HUDState.shared.setTailCollapsed(false)
            }

            HUDMastheadMark(size: 11)

            Text("TAIL")
                .font(HUDType.mono(8.5, weight: .bold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)

            Text("\(tail.filteredEvents.count)")
                .font(HUDType.mono(8.5, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkFaint)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)

            Spacer(minLength: 0)

            if brokerOffline {
                BrokerOfflinePip()
                    .scaleEffect(0.78)
            } else if attentionCount > 0 {
                AttentionPip()
                    .scaleEffect(0.78)
            }

            TailDismissButton(compact: true) {
                onDismiss()
            }
        }
        .padding(.horizontal, 7)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    private var tailCollapsedVerticalRail: some View {
        VStack(spacing: 7) {
            TailCollapseButton(expanded: false) {
                HUDState.shared.setTailCollapsed(false)
            }

            TailDismissButton(compact: true) {
                onDismiss()
            }

            HUDMastheadMark(size: 12)

            VStack(spacing: 2) {
                ForEach(Array("TAIL"), id: \.self) { char in
                    Text(String(char))
                        .font(HUDType.mono(8, weight: .bold))
                        .foregroundStyle(HUDChrome.inkMuted)
                }
            }
            .padding(.top, 2)

            Text("\(tail.filteredEvents.count)")
                .font(HUDType.mono(8.5, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkFaint)
                .lineLimit(1)
                .rotationEffect(.degrees(90))
                .fixedSize()
                .frame(width: 18, height: 28)

            if brokerOffline {
                Circle()
                    .fill(Color(red: 0.92, green: 0.42, blue: 0.38))
                    .frame(width: 5, height: 5)
            } else if attentionCount > 0 {
                AttentionPip()
                    .scaleEffect(0.82)
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
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
                    activity: activityStore.items,
                    isLoading: activityStore.isLoading && activityStore.items == nil
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .transition(.opacity)
            case .tail:
                HUDTailView(tail: tail, agents: agents, treatment: tailTreatmentBinding, size: state.size, surface: tailSurface ?? .overlay)
                    .opacity(tailContentOpacity)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .transition(.opacity)
            case .sessions:
                HUDSessionsView(agents: agents, tail: sessionsTail)
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

    private var tailContentOpacity: Double {
        let streamOpacity = tailTreatment == .firehose ? resolvedTailRowOpacity : 1.0
        return streamOpacity * tailPresenceOpacity
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
struct CheatsheetChip: View {
    var filled = false

    @ObservedObject private var sheet = HUDCheatsheetState.shared

    var body: some View {
        Button(action: { sheet.toggle() }) {
            Text("?")
                .font(HUDType.mono(10, weight: .bold))
                .foregroundStyle(sheet.visible ? HUDChrome.accent : HUDChrome.inkFaint)
                .frame(width: 14, height: 14)
                .background(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(filled ? HUDChrome.canvasAlt.opacity(sheet.visible ? 0.86 : 0.68) : Color.clear)
                )
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

struct TailCollapseButton: View {
    let expanded: Bool
    var collapsedSystemName = "chevron.left"
    let action: () -> Void

    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: expanded ? "chevron.right" : collapsedSystemName)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(hovered ? HUDChrome.ink : HUDChrome.inkFaint)
                .frame(width: 16, height: 16)
                .background(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(hovered ? HUDChrome.canvasLift.opacity(0.72) : HUDChrome.canvasAlt.opacity(0.68))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .stroke(hovered ? HUDChrome.inkMuted.opacity(0.50) : HUDChrome.border.opacity(0.70), lineWidth: 0.5)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .help(expanded ? "Collapse Tail" : "Expand Tail")
    }
}

struct TailDismissButton: View {
    var compact = false
    let action: () -> Void

    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: compact ? 8 : 9, weight: .bold))
                .foregroundStyle(hovered ? HUDChrome.ink : HUDChrome.inkFaint)
                .frame(width: compact ? 15 : 16, height: compact ? 15 : 16)
                .background(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(hovered ? HUDChrome.canvasLift.opacity(0.72) : HUDChrome.canvasAlt.opacity(0.64))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .stroke(hovered ? HUDChrome.inkMuted.opacity(0.50) : HUDChrome.border.opacity(0.58), lineWidth: 0.5)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .help("Dismiss Tail")
    }
}

struct HUDTailTreatmentToggle: View {
    @Binding var selection: HUDTailTreatment

    var body: some View {
        HStack(spacing: 0) {
            ForEach(HUDTailTreatment.allCases) { treatment in
                Button(action: { selection = treatment }) {
                    HStack(spacing: 3) {
                        Image(systemName: treatment.systemName)
                            .font(.system(size: 8.5, weight: .semibold))
                        Text(treatment.shortLabel)
                            .font(HUDType.mono(8.5, weight: .bold))
                            .tracking(0.45)
                    }
                    .foregroundStyle(selection == treatment ? HUDChrome.accent : HUDChrome.inkFaint)
                    .frame(width: 48, height: 16)
                    .background(
                        RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                            .fill(selection == treatment ? HUDChrome.canvasLift.opacity(0.50) : Color.clear)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(HUDChrome.canvasAlt.opacity(0.62))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .stroke(HUDChrome.border.opacity(0.92), lineWidth: 0.75)
        )
        .help("Tail treatment: \(selection.title). Press T to cycle.")
    }
}

struct HUDTailAppearanceButton: View {
    @Binding var blurOpacity: Double
    @Binding var passiveBlurOpacity: Double
    @Binding var passiveOpacity: Double
    @Binding var activeOpacity: Double
    @Binding var tintOpacity: Double
    @Binding var rowOpacity: Double
    @Binding var pathColumnWidth: Double
    @Binding var kindColumnWidth: Double
    @State private var showing = false

    var body: some View {
        Button(action: { showing.toggle() }) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(showing ? HUDChrome.ink : HUDChrome.inkFaint)
                .frame(width: 14, height: 14)
                .background(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .fill(showing ? HUDChrome.canvasLift.opacity(0.58) : HUDChrome.canvasAlt.opacity(0.66))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .stroke(showing ? HUDChrome.inkMuted.opacity(0.7) : HUDChrome.border, lineWidth: 0.5)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Tail appearance")
        .popover(isPresented: $showing, arrowEdge: .top) {
            HUDTailAppearancePopover(
                blurOpacity: $blurOpacity,
                passiveBlurOpacity: $passiveBlurOpacity,
                passiveOpacity: $passiveOpacity,
                activeOpacity: $activeOpacity,
                tintOpacity: $tintOpacity,
                rowOpacity: $rowOpacity,
                pathColumnWidth: $pathColumnWidth,
                kindColumnWidth: $kindColumnWidth
            )
        }
    }
}

private struct HUDTailAppearancePopover: View {
    @Binding var blurOpacity: Double
    @Binding var passiveBlurOpacity: Double
    @Binding var passiveOpacity: Double
    @Binding var activeOpacity: Double
    @Binding var tintOpacity: Double
    @Binding var rowOpacity: Double
    @Binding var pathColumnWidth: Double
    @Binding var kindColumnWidth: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                HUDEyebrow(text: "TAIL  ·  TRANSPARENCY", color: HUDChrome.inkFaint)
                Spacer(minLength: 0)
                Button(action: resetAll) {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(HUDChrome.inkFaint)
                        .frame(width: 18, height: 18)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Reset Tail appearance")
            }

            HUDTailTransparencyPresets { preset in
                apply(preset)
            }

            HUDTailAppearanceSection(title: "Surface") {
                HUDTailAppearanceSlider(label: "Active blur", value: $blurOpacity, range: 0.30...1)
                HUDTailAppearanceSlider(label: "Idle blur", value: $passiveBlurOpacity, range: 0.30...1)
                HUDTailAppearanceSlider(label: "Tint", value: $tintOpacity, range: 0...0.85)
            }

            HUDTailAppearanceSection(title: "Presence") {
                HUDTailAppearanceSlider(label: "Active opacity", value: $activeOpacity, range: 0.35...1)
                HUDTailAppearanceSlider(label: "Idle opacity", value: $passiveOpacity, range: 0.35...1)
            }

            HUDTailAppearanceSection(title: "Stream") {
                HUDTailAppearanceSlider(label: "Row ink", value: $rowOpacity, range: 0.55...1)
            }

            HUDTailAppearanceSection(title: "Columns") {
                HUDTailAppearanceSlider(
                    label: "Path",
                    value: $pathColumnWidth,
                    range: 64...240,
                    step: 1,
                    valueStyle: .points
                )
                HUDTailAppearanceSlider(
                    label: "Kind",
                    value: $kindColumnWidth,
                    range: 28...64,
                    step: 1,
                    valueStyle: .points
                )
            }
        }
        .padding(12)
        .frame(width: 286)
        .background(HUDChrome.canvas)
    }

    private func apply(_ preset: HUDTailTransparencyPreset) {
        let values = preset.values
        blurOpacity = values.blurOpacity
        passiveBlurOpacity = values.passiveBlurOpacity
        passiveOpacity = values.passiveOpacity
        activeOpacity = values.activeOpacity
        tintOpacity = values.tintOpacity
        rowOpacity = values.rowOpacity
    }

    private func resetAll() {
        blurOpacity = HUDTailAppearance.defaultBlurOpacity
        passiveBlurOpacity = HUDTailAppearance.defaultPassiveBlurOpacity
        passiveOpacity = HUDTailAppearance.defaultPassiveOpacity
        activeOpacity = HUDTailAppearance.defaultActiveOpacity
        tintOpacity = HUDTailAppearance.defaultTintOpacity
        rowOpacity = HUDTailAppearance.defaultRowOpacity
        pathColumnWidth = HUDTailAppearance.defaultPathColumnWidth
        kindColumnWidth = HUDTailAppearance.defaultKindColumnWidth
    }
}

private enum HUDTailTransparencyPreset: String, CaseIterable, Identifiable {
    case airy
    case balanced
    case solid

    var id: String { rawValue }

    var label: String {
        switch self {
        case .airy: return "AIRY"
        case .balanced: return "BAL"
        case .solid: return "SOLID"
        }
    }

    var values: (
        blurOpacity: Double,
        passiveBlurOpacity: Double,
        passiveOpacity: Double,
        activeOpacity: Double,
        tintOpacity: Double,
        rowOpacity: Double
    ) {
        switch self {
        case .airy:
            return (0.68, 0.52, 0.58, 0.88, 0.20, 0.88)
        case .balanced:
            return (
                HUDTailAppearance.defaultBlurOpacity,
                HUDTailAppearance.defaultPassiveBlurOpacity,
                HUDTailAppearance.defaultPassiveOpacity,
                HUDTailAppearance.defaultActiveOpacity,
                HUDTailAppearance.defaultTintOpacity,
                HUDTailAppearance.defaultRowOpacity
            )
        case .solid:
            return (0.96, 0.92, 0.94, 1.0, 0.50, 1.0)
        }
    }
}

private struct HUDTailTransparencyPresets: View {
    let apply: (HUDTailTransparencyPreset) -> Void

    var body: some View {
        HStack(spacing: 6) {
            ForEach(HUDTailTransparencyPreset.allCases) { preset in
                Button(action: { apply(preset) }) {
                    Text(preset.label)
                        .font(HUDType.mono(8.5, weight: .bold))
                        .tracking(0.4)
                        .foregroundStyle(HUDChrome.inkMuted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 18)
                        .background(
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(HUDChrome.canvasLift.opacity(0.24))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .stroke(HUDChrome.border.opacity(0.85), lineWidth: 0.5)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct HUDTailAppearanceSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HUDEyebrow(text: title.uppercased(), color: HUDChrome.inkFaint)
            VStack(alignment: .leading, spacing: 8) {
                content()
            }
        }
    }
}

private enum HUDTailAppearanceValueStyle {
    case percent
    case points
}

private struct HUDTailAppearanceSlider: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double = 0.01
    var valueStyle: HUDTailAppearanceValueStyle = .percent

    private var valueLabel: String {
        switch valueStyle {
        case .percent:
            return "\(Int((value * 100).rounded()))%"
        case .points:
            return "\(Int(value.rounded()))px"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(label)
                    .font(HUDType.mono(9, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkMuted)
                Spacer(minLength: 0)
                Text(valueLabel)
                    .font(HUDType.mono(9))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            Slider(value: $value, in: range, step: step)
                .controlSize(.mini)
        }
    }
}

struct AttentionPip: View {
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

struct BrokerOfflinePip: View {
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
