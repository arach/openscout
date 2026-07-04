import AppKit
import Combine
import ScoutAppCore
import SwiftUI

public enum TailModePlacement: String, CaseIterable, Identifiable, Sendable {
    case attached
    case floating

    public var id: String { rawValue }

    var label: String {
        switch self {
        case .attached: return "Edge"
        case .floating: return "Free"
        }
    }
}

@MainActor
public final class TailModeState: ObservableObject {
    public static let shared = TailModeState()

    @Published public private(set) var size: HUDSize = .large
    @Published public private(set) var collapsed = false
    @Published public private(set) var placement: TailModePlacement = .attached

    private init() {}

    public func setSize(_ size: HUDSize) {
        guard self.size != size else {
            TailModeStateFile.shared.touch()
            return
        }
        HUDMotionState.shared.begin(.moving)
        self.size = size
        TailModeStateFile.shared.touch()
    }

    public func stepSize(_ direction: Int) {
        let next = size.rawValue + direction
        if let size = HUDSize(rawValue: next) {
            setSize(size)
        }
    }

    public func setCollapsed(_ collapsed: Bool) {
        guard self.collapsed != collapsed else {
            TailModeStateFile.shared.touch()
            return
        }
        HUDMotionState.shared.begin(collapsed ? .collapsing : .expanding)
        self.collapsed = collapsed
        TailModeStateFile.shared.touch()
    }

    public func toggleCollapsed() {
        setCollapsed(!collapsed)
    }

    public func setPlacement(_ placement: TailModePlacement) {
        guard self.placement != placement else {
            TailModeStateFile.shared.touch()
            return
        }
        HUDMotionState.shared.begin(.moving)
        self.placement = placement
        TailModeStateFile.shared.touch()
    }
}

@MainActor
public final class TailModeStateFile {
    public static let shared = TailModeStateFile()
    private static let path = "/tmp/openscout-tail-state.json"

    private var cancellables = Set<AnyCancellable>()
    private var started = false

    private init() {}

    public func start() {
        guard !started else { return }
        started = true

        TailModeState.shared.$size
            .sink { [weak self] _ in self?.write() }
            .store(in: &cancellables)
        TailModeState.shared.$collapsed
            .sink { [weak self] _ in self?.write() }
            .store(in: &cancellables)
        TailModeState.shared.$placement
            .sink { [weak self] _ in self?.write() }
            .store(in: &cancellables)

        write()
    }

    public func touch() {
        write()
    }

    private func write() {
        let state = TailModeState.shared
        let payload: [String: Any] = [
            "visible": TailModeController.shared.isVisible,
            "size": state.size.tailModeCliLabel,
            "collapsed": state.collapsed,
            "placement": state.placement.rawValue,
            "windowId": TailModeController.shared.currentWindowId ?? 0,
            "ts": Int(Date().timeIntervalSince1970 * 1000),
        ]
        guard let data = try? JSONSerialization.data(
            withJSONObject: payload,
            options: [.prettyPrinted, .sortedKeys]
        ) else { return }
        try? data.write(to: URL(fileURLWithPath: Self.path), options: .atomic)
    }
}

private enum TailModePanelEdge {
    case left
    case right
    case top
    case bottom

    var isHorizontal: Bool {
        self == .top || self == .bottom
    }
}

private enum TailModePanelAlignment {
    case start
    case center
    case end
}

private struct TailModePanelAttachment {
    let edge: TailModePanelEdge
    let alignment: TailModePanelAlignment

    static func nearest(to point: NSPoint, in visible: NSRect) -> TailModePanelAttachment {
        let distances: [(TailModePanelEdge, CGFloat)] = [
            (.left, abs(point.x - visible.minX)),
            (.right, abs(point.x - visible.maxX)),
            (.top, abs(point.y - visible.maxY)),
            (.bottom, abs(point.y - visible.minY)),
        ]
        let edge = distances.min { $0.1 < $1.1 }?.0 ?? .right
        return TailModePanelAttachment(edge: edge, alignment: alignment(for: point, edge: edge, in: visible))
    }

    func frame(size: NSSize, in visible: NSRect) -> NSRect {
        let x: CGFloat
        let y: CGFloat

        switch edge {
        case .left:
            x = visible.minX
            y = alignedOrigin(
                availableStart: visible.minY,
                availableLength: visible.height,
                itemLength: size.height,
                flipped: true
            )
        case .right:
            x = visible.maxX - size.width
            y = alignedOrigin(
                availableStart: visible.minY,
                availableLength: visible.height,
                itemLength: size.height,
                flipped: true
            )
        case .top:
            x = alignedOrigin(
                availableStart: visible.minX,
                availableLength: visible.width,
                itemLength: size.width,
                flipped: false
            )
            y = visible.maxY - size.height
        case .bottom:
            x = alignedOrigin(
                availableStart: visible.minX,
                availableLength: visible.width,
                itemLength: size.width,
                flipped: false
            )
            y = visible.minY
        }

        return NSRect(x: x, y: y, width: size.width, height: size.height)
    }

    private static func alignment(for point: NSPoint, edge: TailModePanelEdge, in visible: NSRect) -> TailModePanelAlignment {
        let value: CGFloat
        if edge.isHorizontal {
            value = (point.x - visible.minX) / max(visible.width, 1)
        } else {
            value = (point.y - visible.minY) / max(visible.height, 1)
        }

        if value < 1.0 / 3.0 { return edge.isHorizontal ? .start : .end }
        if value > 2.0 / 3.0 { return edge.isHorizontal ? .end : .start }
        return .center
    }

    private func alignedOrigin(
        availableStart: CGFloat,
        availableLength: CGFloat,
        itemLength: CGFloat,
        flipped: Bool
    ) -> CGFloat {
        let clampedLength = min(itemLength, availableLength)
        switch alignment {
        case .start:
            return flipped ? availableStart + availableLength - clampedLength : availableStart
        case .center:
            return availableStart + (availableLength - clampedLength) / 2
        case .end:
            return flipped ? availableStart : availableStart + availableLength - clampedLength
        }
    }
}

private extension NSRect {
    var tailModeCenter: NSPoint {
        NSPoint(x: midX, y: midY)
    }

    func tailModeIsNearlyEqual(to other: NSRect, tolerance: CGFloat = 0.5) -> Bool {
        abs(origin.x - other.origin.x) <= tolerance
            && abs(origin.y - other.origin.y) <= tolerance
            && abs(size.width - other.size.width) <= tolerance
            && abs(size.height - other.size.height) <= tolerance
    }
}

@MainActor
public final class TailModeController {
    public static let shared = TailModeController()

    private var panel: OverlayPanel?
    private var geometrySubscription: AnyCancellable?

    public var isVisible: Bool {
        guard let panel else { return false }
        return panel.isVisible
    }

    public var currentWindowId: Int? {
        guard let panel, isVisible else { return nil }
        return panel.windowNumber
    }

    private init() {}

    public func toggle() {
        if isVisible {
            hide()
        } else {
            show(expand: false)
        }
    }

    public func show(size: HUDSize? = nil, expand: Bool = true) {
        if let size {
            TailModeState.shared.setSize(size)
        }
        if expand {
            TailModeState.shared.setCollapsed(false)
        }

        if let panel {
            panel.onKeyDown = { [weak self] event in
                self?.handleKeyDown(event)
            }
            applyGeometry(animated: false)
            panel.alphaValue = 0
            OverlayPanelShell.present(panel, activate: false, makeKey: true, orderFrontRegardless: true)
            warmAndFadeIn(panel)
            installGeometryObserver()
            TailModeStateFile.shared.touch()
            return
        }

        let view = TailModeView(onDismiss: { [weak self] in
            self?.hide()
        })
        .preferredColorScheme(.dark)

        var config = OverlayPanelShell.Config(
            size: initialContentSize()
        )
        config.isMovableByWindowBackground = true
        config.resizable = true
        config.hasShadow = false
        config.minContentSize = minContentSize(collapsed: TailModeState.shared.collapsed)
        config.maxContentSize = maxContentSize()
        config.onKeyDown = { [weak self] event in
            self?.handleKeyDown(event)
        }
        config.onFlagsChanged = { event in
            HUDMotionState.shared.setModifierLift(event.modifierFlags.contains(.option))
        }

        let panel = OverlayPanelShell.makePanel(config: config, rootView: view)
        position(panel, animated: false)

        panel.alphaValue = 0
        OverlayPanelShell.present(panel, activate: false, makeKey: true, orderFrontRegardless: true)
        self.panel = panel

        try? "\(panel.windowNumber)".write(
            toFile: "/tmp/openscout-tail-window.txt",
            atomically: true,
            encoding: .utf8
        )

        warmAndFadeIn(panel)
        installGeometryObserver()
        TailModeStateFile.shared.touch()
    }

    public func hide() {
        guard let panel else { return }
        if HUDMotionState.shared.phase == .idle {
            HUDMotionState.shared.begin(.moving)
        }
        preparePanelForMotion(panel)
        geometrySubscription?.cancel()
        geometrySubscription = nil

        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.14
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().alphaValue = 0
        }) { [weak self] in
            Task { @MainActor [weak self] in
                panel.orderOut(nil)
                self?.panel = nil
                HUDMotionState.shared.settle()
                HUDMotionState.shared.setModifierLift(false)
                TailModeStateFile.shared.touch()
            }
        }
    }

    private func installGeometryObserver() {
        geometrySubscription?.cancel()
        geometrySubscription = Publishers.CombineLatest3(
            TailModeState.shared.$size,
            TailModeState.shared.$collapsed,
            TailModeState.shared.$placement
        )
            .dropFirst()
            .sink { [weak self] _, _, _ in
                Task { @MainActor [weak self] in
                    self?.applyGeometry(animated: true)
                }
            }
    }

    private func applyGeometry(animated: Bool) {
        guard let panel else { return }
        position(panel, animated: animated)
        TailModeStateFile.shared.touch()
    }

    private func position(_ panel: OverlayPanel, animated: Bool) {
        let screen = panel.screen ?? mouseScreen()
        let visible = screen.visibleFrame
        let attachment = TailModeState.shared.placement == .attached
            ? attachment(for: panel, in: visible)
            : nil
        let targetContentSize = contentSize(on: screen, attachment: attachment)
        let targetMinContentSize = minContentSize(collapsed: TailModeState.shared.collapsed)
        panel.contentMinSize = motionMinContentSize(target: targetMinContentSize)
        panel.contentMaxSize = maxContentSize(on: screen)

        let targetCollapsed = TailModeState.shared.collapsed
        if targetCollapsed {
            preparePanelForCollapse(panel)
        } else {
            restorePanelContentSurface(panel, forceLayout: !animated)
        }

        let frameSize = panel.frameRect(forContentRect: NSRect(origin: .zero, size: targetContentSize)).size
        let newFrame = targetFrame(frameSize: frameSize, panel: panel, screen: screen, attachment: attachment)

        guard !panel.frame.tailModeIsNearlyEqual(to: newFrame) else {
            panel.contentMinSize = targetMinContentSize
            panel.setFrame(newFrame, display: true)
            HUDMotionState.shared.finish()
            restorePanelContentSurface(panel)
            return
        }

        let motionToken = HUDMotionState.shared.isActive ? nil : HUDMotionState.shared.begin(.moving)
        preparePanelForMotion(panel, forceLayout: targetCollapsed)
        let animation = animationStyle(collapsed: TailModeState.shared.collapsed)

        let update = {
            panel.setFrame(newFrame, display: true)
        }

        guard animated else {
            update()
            panel.contentMinSize = targetMinContentSize
            HUDMotionState.shared.finish(token: motionToken)
            restorePanelContentSurface(panel)
            return
        }

        NSAnimationContext.runAnimationGroup({ context in
            context.duration = animation.duration
            context.timingFunction = animation.timing
            context.allowsImplicitAnimation = true
            panel.animator().setFrame(newFrame, display: true)
        }) {
            Task { @MainActor in
                panel.contentMinSize = targetMinContentSize
                HUDMotionState.shared.finish(token: motionToken)
                self.restorePanelContentSurface(panel)
            }
        }
    }

    private func targetFrame(
        frameSize: NSSize,
        panel: OverlayPanel,
        screen: NSScreen,
        attachment: TailModePanelAttachment?
    ) -> NSRect {
        let visible = screen.visibleFrame
        switch TailModeState.shared.placement {
        case .attached:
            return (attachment ?? self.attachment(for: panel, in: visible)).frame(size: frameSize, in: visible)
        case .floating:
            let current = panel.frame
            let fallback = floatingDefaultCenter(in: visible)
            let center = panel.isVisible ? current.tailModeCenter : fallback
            let width = min(frameSize.width, visible.width)
            let height = min(frameSize.height, visible.height)
            return NSRect(
                x: min(max(visible.minX, center.x - width / 2), visible.maxX - width),
                y: min(max(visible.minY, center.y - height / 2), visible.maxY - height),
                width: width,
                height: height
            )
        }
    }

    private func attachment(for panel: OverlayPanel, in visible: NSRect) -> TailModePanelAttachment {
        if !panel.isVisible {
            return TailModePanelAttachment(edge: .right, alignment: .center)
        }
        return TailModePanelAttachment.nearest(to: panel.frame.tailModeCenter, in: visible)
    }

    private func initialContentSize() -> NSSize {
        let screen = mouseScreen()
        return contentSize(on: screen, attachment: TailModePanelAttachment(edge: .right, alignment: .center))
    }

    private func contentSize(on screen: NSScreen?, attachment: TailModePanelAttachment?) -> NSSize {
        let visible = screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        switch TailModeState.shared.placement {
        case .attached:
            return attachedContentSize(
                size: TailModeState.shared.size,
                collapsed: TailModeState.shared.collapsed,
                attachment: attachment ?? TailModePanelAttachment(edge: .right, alignment: .center),
                visible: visible
            )
        case .floating:
            return floatingContentSize(
                size: TailModeState.shared.size,
                collapsed: TailModeState.shared.collapsed,
                visible: visible
            )
        }
    }

    private func attachedContentSize(
        size: HUDSize,
        collapsed: Bool,
        attachment: TailModePanelAttachment,
        visible: NSRect
    ) -> NSSize {
        if collapsed {
            return HUDTailCollapsedGeometry.size(isHorizontal: attachment.edge.isHorizontal, in: visible)
        }

        let edgeLength = attachment.edge.isHorizontal ? visible.width : visible.height
        let alongEdge = floor(edgeLength * size.tailEdgeCoverage)
        let crossEdge = attachedCrossEdgeSize(size: size, attachment: attachment, visible: visible)

        if attachment.edge.isHorizontal {
            return NSSize(width: alongEdge, height: crossEdge)
        }
        return NSSize(width: crossEdge, height: alongEdge)
    }

    private func attachedCrossEdgeSize(
        size: HUDSize,
        attachment: TailModePanelAttachment,
        visible: NSRect
    ) -> CGFloat {
        if attachment.edge.isHorizontal {
            switch size {
            case .compact:
                return min(360, max(300, floor(visible.height * 0.32)))
            case .medium:
                return min(460, max(380, floor(visible.height * 0.40)))
            case .large:
                return min(620, max(440, floor(visible.height * 0.42)))
            }
        }

        switch size {
        case .compact:
            return 460
        case .medium:
            return 540
        case .large:
            return min(visible.width, max(860, floor(visible.width * 0.5)))
        }
    }

    private func floatingContentSize(size: HUDSize, collapsed: Bool, visible: NSRect) -> NSSize {
        if collapsed {
            return HUDTailCollapsedGeometry.verticalSize(in: visible)
        }

        switch size {
        case .compact:
            return NSSize(width: min(560, visible.width), height: min(520, visible.height))
        case .medium:
            return NSSize(width: min(760, floor(visible.width * 0.72)), height: min(680, floor(visible.height * 0.78)))
        case .large:
            return NSSize(width: min(980, floor(visible.width * 0.82)), height: min(820, floor(visible.height * 0.86)))
        }
    }

    private func minContentSize(collapsed: Bool) -> NSSize {
        if collapsed {
            return NSSize(
                width: HUDTailCollapsedGeometry.verticalThickness,
                height: HUDTailCollapsedGeometry.horizontalThickness
            )
        }
        return NSSize(width: 240, height: 160)
    }

    private func motionMinContentSize(target: NSSize) -> NSSize {
        NSSize(width: min(target.width, 42), height: min(target.height, 26))
    }

    private func maxContentSize(on screen: NSScreen? = NSScreen.main) -> NSSize {
        screen?.visibleFrame.size
            ?? NSScreen.main?.visibleFrame.size
            ?? NSSize(width: 3840, height: 2160)
    }

    private func floatingDefaultCenter(in visible: NSRect) -> NSPoint {
        NSPoint(x: visible.midX, y: visible.midY + visible.height * 0.04)
    }

    private func preparePanelForCollapse(_ panel: NSPanel) {
        panel.contentView?.isHidden = true
        panel.contentView?.alphaValue = 0
        panel.backgroundColor = NSColor(srgbRed: 0.105, green: 0.108, blue: 0.108, alpha: 0.94)
        panel.displayIfNeeded()
    }

    private func restorePanelContentSurface(_ panel: NSPanel, forceLayout: Bool = true) {
        panel.backgroundColor = .clear
        panel.contentView?.alphaValue = 1
        panel.contentView?.isHidden = false
        guard forceLayout else { return }
        panel.contentView?.layoutSubtreeIfNeeded()
        panel.displayIfNeeded()
    }

    private func preparePanelForMotion(_ panel: NSPanel, forceLayout: Bool = true) {
        panel.contentView?.wantsLayer = true
        guard forceLayout else { return }
        panel.contentView?.layoutSubtreeIfNeeded()
        panel.displayIfNeeded()
    }

    private func animationStyle(collapsed: Bool) -> (duration: TimeInterval, timing: CAMediaTimingFunction) {
        if collapsed {
            return (0.135, CAMediaTimingFunction(controlPoints: 0.34, 0.00, 0.16, 1.00))
        }
        return (0.215, CAMediaTimingFunction(controlPoints: 0.14, 0.82, 0.18, 1.00))
    }

    private func warmAndFadeIn(_ panel: OverlayPanel) {
        HUDMotionState.shared.begin(.warming)
        preparePanelForMotion(panel)
        Task { @MainActor [weak self, weak panel] in
            try? await Task.sleep(nanoseconds: 45_000_000)
            guard let self, let panel, self.panel === panel else { return }
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = 0.10
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().alphaValue = 1.0
            }, completionHandler: {})
            HUDMotionState.shared.settle(after: 0.16)
        }
    }

    private func handleKeyDown(_ event: NSEvent) {
        if event.keyCode == 53 {
            if HUDNavBus.shared.unengageSelected?() == true { return }
            hide()
            return
        }

        switch event.keyCode {
        case 36:
            HUDNavBus.shared.engageSelected?()
        case 38, 125:
            if isCommandOnly(event.modifierFlags) {
                TailModeState.shared.stepSize(-1)
            } else {
                HUDNavBus.shared.cycleNext?()
            }
        case 40, 126:
            if isCommandOnly(event.modifierFlags) {
                TailModeState.shared.stepSize(+1)
            } else {
                HUDNavBus.shared.cyclePrev?()
            }
        case 5:
            if event.modifierFlags.contains(.shift) {
                HUDNavBus.shared.jumpBottom?()
            } else {
                HUDNavBus.shared.jumpTop?()
            }
        case 3:
            HUDNavBus.shared.toggleFollow?()
        case 17:
            HUDNavBus.shared.cycleTreatment?()
        case 33, 123:
            TailModeState.shared.stepSize(-1)
        case 30, 124:
            TailModeState.shared.stepSize(+1)
        case 8:
            TailModeState.shared.toggleCollapsed()
        default:
            break
        }
    }

    private func isCommandOnly(_ flags: NSEvent.ModifierFlags) -> Bool {
        flags.intersection(.deviceIndependentFlagsMask) == .command
    }

    private func mouseScreen() -> NSScreen {
        let mouseLocation = NSEvent.mouseLocation
        return NSScreen.screens.first(where: { $0.frame.contains(mouseLocation) })
            ?? NSScreen.main
            ?? NSScreen.screens.first!
    }
}

struct TailModeView: View {
    var onDismiss: () -> Void

    @ObservedObject private var state = TailModeState.shared
    @ObservedObject private var motion = HUDMotionState.shared
    @StateObject private var agentsStore = ScoutAgentsStore()
    @StateObject private var tail = ScoutTailStore()
    @State private var tailHovered = false
    // Mount the row tree after expand resize settles; measuring rows in the
    // collapsed frame is the visible stagger this surface is avoiding.
    @State private var tailContentReady = !TailModeState.shared.collapsed
    @AppStorage(HUDTailAppearance.blurOpacityKey) private var tailBlurOpacity = HUDTailAppearance.defaultBlurOpacity
    @AppStorage(HUDTailAppearance.passiveBlurOpacityKey) private var tailPassiveBlurOpacity = HUDTailAppearance.defaultPassiveBlurOpacity
    @AppStorage(HUDTailAppearance.passiveOpacityKey) private var tailPassiveOpacity = HUDTailAppearance.defaultPassiveOpacity
    @AppStorage(HUDTailAppearance.activeOpacityKey) private var tailActiveOpacity = HUDTailAppearance.defaultActiveOpacity
    @AppStorage(HUDTailAppearance.tintOpacityKey) private var tailTintOpacity = HUDTailAppearance.defaultTintOpacity
    @AppStorage(HUDTailAppearance.rowOpacityKey) private var tailRowOpacity = HUDTailAppearance.defaultRowOpacity
    @AppStorage(HUDTailAppearance.pathColumnWidthKey) private var tailPathColumnWidth = HUDTailAppearance.defaultPathColumnWidth
    @AppStorage(HUDTailAppearance.kindColumnWidthKey) private var tailKindColumnWidth = HUDTailAppearance.defaultKindColumnWidth
    @AppStorage(HUDTailTreatment.storageKey) private var tailTreatmentRaw = HUDTailTreatment.firehose.rawValue

    private var agents: [HudAgent] {
        agentsStore.agents ?? []
    }

    private var brokerOffline: Bool {
        agentsStore.lastError != nil && (agentsStore.agents?.isEmpty ?? true)
    }

    private var attentionCount: Int {
        agents.filter { $0.state == .needsAttention }.count
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

    private var isCollapsing: Bool {
        motion.phase == .collapsing
    }

    private var isExpanding: Bool {
        motion.phase == .expanding
    }

    private var isFullHeight: Bool {
        state.placement == .attached && state.size == .large && !state.collapsed
    }

    private var presenceLifted: Bool {
        tailHovered || motion.modifierLift || motion.isActive
    }

    private var resolvedBlurOpacity: Double {
        HUDTailAppearance.clamp(tailBlurOpacity, 0...1)
    }

    private var resolvedPassiveBlurOpacity: Double {
        HUDTailAppearance.clamp(tailPassiveBlurOpacity, 0.30...1)
    }

    private var resolvedPassiveOpacity: Double {
        HUDTailAppearance.clamp(tailPassiveOpacity, 0.35...1)
    }

    private var resolvedActiveOpacity: Double {
        HUDTailAppearance.clamp(tailActiveOpacity, 0.35...1)
    }

    private var resolvedTintOpacity: Double {
        HUDTailAppearance.clamp(tailTintOpacity, 0...0.85)
    }

    private var resolvedRowOpacity: Double {
        HUDTailAppearance.clamp(tailRowOpacity, 0.55...1)
    }

    private var presenceOpacity: Double {
        if isCollapsing { return 1.0 }
        return presenceLifted ? resolvedActiveOpacity : resolvedPassiveOpacity
    }

    private var materialOpacity: Double {
        presenceLifted ? resolvedBlurOpacity : resolvedPassiveBlurOpacity
    }

    private var cornerRadius: CGFloat {
        if isCollapsing { return 7 }
        if state.collapsed { return 8 }
        if isFullHeight { return 0 }
        return 10
    }

    var body: some View {
        ZStack {
            if isCollapsing {
                tailCollapseSlab
            } else {
                VisualEffectBackground(
                    material: .hudWindow,
                    blendingMode: .behindWindow,
                    state: .active,
                    cornerRadius: cornerRadius
                )
                .opacity(materialOpacity)
                tailReadabilityVeil
                    .opacity(presenceOpacity)
            }

            if isCollapsing {
                EmptyView()
            } else if state.collapsed {
                tailCollapsedRail
            } else if !tailContentReady || isExpanding {
                tailExpansionShell
            } else {
                tailExpandedContent
            }
        }
        .frame(
            minWidth: state.collapsed ? 42 : 240,
            maxWidth: .infinity,
            minHeight: state.collapsed ? 26 : 160,
            maxHeight: .infinity
        )
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay {
            if !isFullHeight && !isCollapsing {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(HUDChrome.borderRim.opacity(0.14), lineWidth: 0.5)
            }
        }
        .animation(
            .timingCurve(0.18, 0.88, 0.22, 1.0, duration: presenceLifted ? 0.10 : 0.18),
            value: presenceOpacity
        )
        .onHover { tailHovered = $0 }
        .onAppear {
            agentsStore.start()
            tail.start()
            tailContentReady = !state.collapsed && !isExpanding
        }
        .onChange(of: state.collapsed) { _, collapsed in
            if collapsed {
                tailContentReady = false
            } else if motion.phase == .idle {
                tailContentReady = true
            } else {
                tailContentReady = false
            }
        }
        .onChange(of: motion.phase) { _, phase in
            if phase == .expanding {
                tailContentReady = false
            } else if phase == .idle && !state.collapsed {
                tailContentReady = true
            }
        }
        .onDisappear {
            agentsStore.stop()
            tail.stop()
        }
    }

    private var tailContentOpacity: Double {
        let streamOpacity = tailTreatment == .firehose ? resolvedRowOpacity : 1.0
        return streamOpacity * presenceOpacity
    }

    private var tailCollapseSlab: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Color(red: 0.105, green: 0.108, blue: 0.108).opacity(0.88))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.055), lineWidth: 0.5)
            }
            .allowsHitTesting(false)
    }

    private var tailExpansionShell: some View {
        VStack(spacing: 0) {
            tailMasthead
            Spacer(minLength: 0)
            HUDFlashRow()
        }
    }

    private var tailExpandedContent: some View {
        VStack(spacing: 0) {
            tailMasthead
            HUDTailView(
                tail: tail,
                agents: agents,
                treatment: tailTreatmentBinding,
                size: state.size,
                surface: .overlay,
                managesTailLifecycle: false
            )
            .opacity(tailContentOpacity)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            HUDFlashRow()
        }
    }

    private var tailReadabilityVeil: some View {
        ZStack {
            HUDChrome.canvas.opacity(0.12 + (resolvedTintOpacity * 0.42))
            LinearGradient(
                colors: [
                    HUDChrome.canvas.opacity(0.22 + (resolvedTintOpacity * 0.42)),
                    HUDChrome.canvas.opacity(0.09 + (resolvedTintOpacity * 0.29)),
                    HUDChrome.canvas.opacity(0.14 + (resolvedTintOpacity * 0.42)),
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

    private var tailMasthead: some View {
        HStack(alignment: .firstTextBaseline, spacing: 9) {
            TailCollapseButton(expanded: true) {
                TailModeState.shared.setCollapsed(true)
            }
            .alignmentGuide(.firstTextBaseline) { dimensions in dimensions[VerticalAlignment.center] + 4 }

            HUDMastheadMark(size: 12)
                .alignmentGuide(.firstTextBaseline) { dimensions in dimensions[VerticalAlignment.center] + 4 }

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
                        .alignmentGuide(.firstTextBaseline) { dimensions in dimensions[VerticalAlignment.center] + 3 }
                }
                DismissedFlashPip()
                TailModePlacementToggle()
                    .alignmentGuide(.firstTextBaseline) { dimensions in dimensions[VerticalAlignment.center] + 4 }
                HUDTailTreatmentToggle(selection: tailTreatmentBinding)
                    .alignmentGuide(.firstTextBaseline) { dimensions in dimensions[VerticalAlignment.center] + 4 }
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
                .alignmentGuide(.firstTextBaseline) { dimensions in dimensions[VerticalAlignment.center] + 4 }
                TailModeSizeToggle()
                    .alignmentGuide(.firstTextBaseline) { dimensions in dimensions[VerticalAlignment.center] + 4 }
                TailDismissButton {
                    onDismiss()
                }
                .alignmentGuide(.firstTextBaseline) { dimensions in dimensions[VerticalAlignment.center] + 4 }
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
                TailModeState.shared.setCollapsed(false)
            }
            .help("Expand Tail")
        }
    }

    private var tailCollapsedHorizontalHandle: some View {
        HStack(spacing: 6) {
            TailCollapseButton(expanded: false, collapsedSystemName: "chevron.down") {
                TailModeState.shared.setCollapsed(false)
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
                TailModeState.shared.setCollapsed(false)
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
}

private struct TailModePlacementToggle: View {
    @ObservedObject private var state = TailModeState.shared

    var body: some View {
        HStack(spacing: 0) {
            placementButton(.attached)
            placementButton(.floating)
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
        .help("Tail placement: \(state.placement.label)")
    }

    private func placementButton(_ placement: TailModePlacement) -> some View {
        Button(action: { TailModeState.shared.setPlacement(placement) }) {
            Text(placement == .attached ? "EDGE" : "FREE")
                .font(HUDType.mono(8.5, weight: .bold))
                .tracking(0.45)
                .foregroundStyle(state.placement == placement ? HUDChrome.accent : HUDChrome.inkFaint)
                .frame(width: 38, height: 16)
                .background(
                    RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                        .fill(state.placement == placement ? HUDChrome.canvasLift.opacity(0.50) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct TailModeSizeToggle: View {
    @ObservedObject private var state = TailModeState.shared

    var body: some View {
        HStack(spacing: 0) {
            ForEach(HUDSize.allCases) { size in
                Button(action: { TailModeState.shared.setSize(size) }) {
                    Text(size.label)
                        .font(HUDType.mono(8.5, weight: .bold))
                        .foregroundStyle(state.size == size ? HUDChrome.accent : HUDChrome.inkFaint)
                        .frame(width: 18, height: 16)
                        .background(
                            RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                                .fill(state.size == size ? HUDChrome.canvasLift.opacity(0.50) : Color.clear)
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
        .help("Tail size")
    }
}

private extension HUDSize {
    var tailModeCliLabel: String {
        switch self {
        case .compact: return "compact"
        case .medium: return "medium"
        case .large: return "large"
        }
    }
}
