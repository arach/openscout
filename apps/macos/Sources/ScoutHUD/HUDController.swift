import AppKit
import Combine
import ScoutSharedUI
import SwiftUI

private enum HUDTailPanelEdge {
    case left
    case right
    case top
    case bottom

    var isHorizontal: Bool {
        self == .top || self == .bottom
    }
}

private enum HUDTailPanelAlignment {
    case start
    case center
    case end
}

private struct HUDTailPanelAttachment {
    let edge: HUDTailPanelEdge
    let alignment: HUDTailPanelAlignment

    static func nearest(to point: NSPoint, in visible: NSRect) -> HUDTailPanelAttachment {
        let distances: [(HUDTailPanelEdge, CGFloat)] = [
            (.left, abs(point.x - visible.minX)),
            (.right, abs(point.x - visible.maxX)),
            (.top, abs(point.y - visible.maxY)),
            (.bottom, abs(point.y - visible.minY)),
        ]
        let edge = distances.min { $0.1 < $1.1 }?.0 ?? .right
        return HUDTailPanelAttachment(edge: edge, alignment: alignment(for: point, edge: edge, in: visible))
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

    private static func alignment(for point: NSPoint, edge: HUDTailPanelEdge, in visible: NSRect) -> HUDTailPanelAlignment {
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
    var hudCenter: NSPoint {
        NSPoint(x: midX, y: midY)
    }

    func isNearlyEqual(to other: NSRect, tolerance: CGFloat = 0.5) -> Bool {
        abs(origin.x - other.origin.x) <= tolerance
            && abs(origin.y - other.origin.y) <= tolerance
            && abs(size.width - other.size.width) <= tolerance
            && abs(size.height - other.size.height) <= tolerance
    }
}

// Singleton controller for the OpenScout HUD overlay.
// One non-activating glass panel; summon/dismiss via Hyper+H or the
// menu-bar item. Esc dismisses.

@MainActor
public final class HUDController {
    public static let shared = HUDController()

    private var panel: OverlayPanel?
    private var geometrySubscription: AnyCancellable?

    public var isVisible: Bool {
        guard let panel else { return false }
        // Drop the alpha gate: external IPC consumers (HUDStateFile,
        // capture loops) want "is the panel on screen" the moment show()
        // returns, not "fully faded in." The internal toggle() check
        // already handles the in-flight case via the panel == nil
        // sentinel after dismiss.
        return panel.isVisible
    }

    /// CGWindowID of the panel when visible; nil when dismissed. Consumed
    /// by HUDStateFile + external screencapture loops (scout:// IPC).
    public var currentWindowId: Int? {
        guard let panel, isVisible else { return nil }
        return panel.windowNumber
    }

    private init() {}

    /// True when the dock's TextField is firstResponder — used to gate
    /// global-style nav hotkeys (j, k, 1-5, etc.) so they don't fire
    /// while the operator is typing in the dock. Esc is the only key
    /// that bypasses this guard (it cascades regardless).
    private var isDockFocused: Bool {
        guard let panel else { return false }
        return (panel.firstResponder as? NSText)?.isEditable == true
    }

    /// Toggle voice dictation; if native voice capture is unavailable,
    /// surface the reason via the HUD flash row instead of silently
    /// no-op'ing. Shared by both the panel and global key monitors.
    @MainActor
    private static func toggleMicWithFlash() async {
        let voice = HudVoiceService.shared
        if case .unavailable(let reason) = voice.state {
            HUDFlashState.shared.flash(reason)
            return
        }
        await HUDDockState.shared.toggleDictation()
    }

    public func toggle() {
        if isVisible { dismiss() } else { show() }
    }

    public func show() {
        // Reuse the panel if it already exists (still fading out, etc).
        if let panel {
            panel.onFlagsChanged = { [weak self] event in
                self?.handleFlagsChanged(event)
            }
            OverlayPanelShell.position(
                panel,
                placement: placement(
                    for: HUDState.shared.view,
                    size: HUDState.shared.size,
                    tailCollapsed: HUDState.shared.tailCollapsed
                )
            )
            panel.alphaValue = 0
            OverlayPanelShell.present(panel, activate: false, makeKey: true, orderFrontRegardless: true)
            warmAndFadeIn(panel)
            installMonitors()
            installGeometryObserver()
            HUDStateFile.shared.touch()
            return
        }

        let view = HUDStatusView(onDismiss: { [weak self] in
            self?.dismiss()
        })
        .preferredColorScheme(.dark)

        var config = OverlayPanelShell.Config(
            size: HUDState.shared.size.contentSize(
                for: HUDState.shared.view,
                collapsed: HUDState.shared.tailCollapsed
            )
        )
        config.isMovableByWindowBackground = true
        config.resizable = true
        config.minContentSize = minContentSize(
            for: HUDState.shared.view,
            tailCollapsed: HUDState.shared.tailCollapsed
        )
        // Max is screen-bounded. The large tier docks to top half of the
        // active screen, which on a 4K/5K display can exceed an old fixed
        // ceiling — clamp to the visible frame's full size as the upper
        // bound so AppKit doesn't refuse the resize.
        if let visible = NSScreen.main?.visibleFrame.size {
            config.maxContentSize = visible
        } else {
            config.maxContentSize = NSSize(width: 3840, height: 2160)
        }
        // Keep the system window shadow ON. macOS samples the alpha of
        // the hosting view's content (NSPanel is `isOpaque = false`,
        // background `.clear`) and casts a shadow that follows the
        // rounded clip — which is what we want. SwiftUI `.shadow`
        // modifiers on the root view get clipped to the hosting view's
        // rectangular bounds and produce a faint rectangular silhouette
        // behind the rounded shape; we don't add any on HUDStatusView.
        config.hasShadow = HUDState.shared.view != .tail
        config.onKeyDown = { [weak self] event in
            guard let self else { return }
            self.handleKeyDown(event)
        }
        config.onFlagsChanged = { [weak self] event in
            self?.handleFlagsChanged(event)
        }

        let p = OverlayPanelShell.makePanel(config: config, rootView: view)
        OverlayPanelShell.position(
            p,
            placement: placement(
                for: HUDState.shared.view,
                size: HUDState.shared.size,
                tailCollapsed: HUDState.shared.tailCollapsed
            )
        )

        p.alphaValue = 0
        OverlayPanelShell.present(p, activate: false, makeKey: true, orderFrontRegardless: true)
        self.panel = p

        // Debug hook: write the window number so screencapture -l<id>
        // can target just this panel (used by the iteration loop).
        let id = p.windowNumber
        try? "\(id)".write(
            toFile: "/tmp/openscout-hud-window.txt",
            atomically: true,
            encoding: .utf8
        )

        warmAndFadeIn(p)
        installMonitors()
        installGeometryObserver()
        HUDStateFile.shared.touch()
    }

    public func dismiss() {
        guard let p = panel else { return }
        if HUDMotionState.shared.phase == .idle {
            HUDMotionState.shared.begin(.moving)
        }
        preparePanelForMotion(p)
        removeMonitors()
        geometrySubscription?.cancel()
        geometrySubscription = nil

        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.14
            ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
            p.animator().alphaValue = 0
        }) { [weak self] in
            Task { @MainActor [weak self] in
                p.orderOut(nil)
                self?.panel = nil
                HUDMotionState.shared.settle()
                HUDStateFile.shared.touch()
            }
        }
    }

    @discardableResult
    public func handleHostKeyDown(_ event: NSEvent) -> Bool {
        guard isVisible, shouldClaimHostKey(event) else {
            return false
        }
        handleKeyDown(event)
        return true
    }

    // Drive the panel frame from HUDState.size + view. Tail uses its own
    // portrait overlay geometry, so tab changes can legitimately resize and
    // re-anchor the same panel even when the S/M/L tier is unchanged.
    private func installGeometryObserver() {
        geometrySubscription?.cancel()
        geometrySubscription = Publishers.CombineLatest3(
            HUDState.shared.$size,
            HUDState.shared.$view,
            HUDState.shared.$tailCollapsed
        )
            .dropFirst() // ignore the initial value — already at that geometry
            .sink { [weak self] size, view, tailCollapsed in
                Task { @MainActor [weak self] in
                    self?.applyGeometry(size: size, view: view, tailCollapsed: tailCollapsed)
                }
            }
    }

    private func applyGeometry(size: HUDSize, view: HUDView, tailCollapsed: Bool) {
        guard let p = panel else { return }
        let screen = p.screen ?? NSScreen.main
        let collapsed = view == .tail && tailCollapsed
        let tailAttachment = view == .tail ? tailAttachment(for: p, on: screen) : nil
        let target = tailAttachment.map { attachment in
            tailContentSize(size: size, collapsed: collapsed, attachment: attachment, on: screen)
        } ?? size.contentSize(for: view, collapsed: collapsed, on: screen)
        let targetMinContentSize = minContentSize(for: view, tailCollapsed: collapsed)
        p.contentMinSize = motionMinContentSize(for: view, target: targetMinContentSize)
        p.hasShadow = view != .tail
        let isTailCollapseMotion = view == .tail && collapsed
        if isTailCollapseMotion {
            preparePanelForTailCollapse(p)
        } else {
            restorePanelContentSurface(p)
        }

        // Convert content size → frame size. For .borderless panels the
        // title-bar contribution is zero, so frame == content; keep the
        // call symmetric anyway in case the styleMask gains a titlebar.
        let frameSize = p.frameRect(forContentRect: NSRect(origin: .zero, size: target)).size

        let newFrame: NSRect
        if let tailAttachment, let visible = screen?.visibleFrame {
            newFrame = tailAttachment.frame(size: frameSize, in: visible)
        } else if size.isScreenAnchored(for: view), let visible = screen?.visibleFrame {
            // Dock to top half of the active screen. macOS coordinate
            // space has origin at bottom-left, so "top half" means y
            // starts at visible.midY and extends to visible.maxY.
            newFrame = NSRect(
                x: visible.minX,
                y: visible.maxY - frameSize.height,
                width: frameSize.width,
                height: frameSize.height
            )
        } else {
            // Compact + Medium: anchor on the panel's current center so the
            // resize reads as a tier swap, not a jump.
            let currentFrame = p.frame
            newFrame = NSRect(
                x: currentFrame.midX - frameSize.width / 2,
                y: currentFrame.midY - frameSize.height / 2,
                width: frameSize.width,
                height: frameSize.height
            )
        }

        if p.frame.isNearlyEqual(to: newFrame) {
            p.contentMinSize = targetMinContentSize
            p.setFrame(newFrame, display: true)
            HUDMotionState.shared.finish()
            restorePanelContentSurface(p)
            return
        }

        let motionToken = HUDMotionState.shared.isActive ? nil : HUDMotionState.shared.begin(.moving)
        preparePanelForMotion(p)
        let animationStyle = frameAnimationStyle(for: view, tailCollapsed: collapsed)

        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = animationStyle.duration
            ctx.timingFunction = animationStyle.timing
            ctx.allowsImplicitAnimation = true
            p.animator().setFrame(newFrame, display: true)
        }) {
            Task { @MainActor in
                p.contentMinSize = targetMinContentSize
                HUDMotionState.shared.finish(token: motionToken)
                self.restorePanelContentSurface(p)
            }
        }
    }

    private func tailAttachment(for panel: OverlayPanel, on screen: NSScreen?) -> HUDTailPanelAttachment? {
        guard let visible = screen?.visibleFrame else { return nil }
        return HUDTailPanelAttachment.nearest(to: panel.frame.hudCenter, in: visible)
    }

    private func tailContentSize(
        size: HUDSize,
        collapsed: Bool,
        attachment: HUDTailPanelAttachment,
        on screen: NSScreen?
    ) -> NSSize {
        let visible = screen?.visibleFrame ?? NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        if collapsed {
            return HUDTailCollapsedGeometry.size(isHorizontal: attachment.edge.isHorizontal, in: visible)
        }

        let edgeLength = attachment.edge.isHorizontal ? visible.width : visible.height
        let alongEdge = floor(edgeLength * size.tailEdgeCoverage)
        let crossEdge = tailCrossEdgeSize(size: size, attachment: attachment, visible: visible)

        if attachment.edge.isHorizontal {
            return NSSize(width: alongEdge, height: crossEdge)
        }
        return NSSize(width: crossEdge, height: alongEdge)
    }

    private func tailCrossEdgeSize(
        size: HUDSize,
        attachment: HUDTailPanelAttachment,
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
            return min(680, max(540, floor(visible.width * 0.34)))
        }
    }

    private func placement(for view: HUDView, size: HUDSize, tailCollapsed: Bool) -> OverlayPanelShell.Placement {
        if view == .tail {
            return .rightCenter(margin: 0)
        }
        return .mouseScreenCentered(yOffsetRatio: 0.04)
    }

    private func minContentSize(for view: HUDView, tailCollapsed: Bool) -> NSSize {
        guard view == .tail else {
            return NSSize(width: 360, height: 380)
        }
        if tailCollapsed {
            return NSSize(
                width: HUDTailCollapsedGeometry.verticalThickness,
                height: HUDTailCollapsedGeometry.horizontalThickness
            )
        }
        return NSSize(width: 240, height: 160)
    }

    private func motionMinContentSize(for view: HUDView, target: NSSize) -> NSSize {
        guard view == .tail else { return target }
        return NSSize(width: min(target.width, 42), height: min(target.height, 26))
    }

    private func preparePanelForTailCollapse(_ p: NSPanel) {
        p.contentView?.isHidden = true
        p.contentView?.alphaValue = 0
        p.backgroundColor = NSColor(srgbRed: 0.105, green: 0.108, blue: 0.108, alpha: 0.94)
        p.displayIfNeeded()
    }

    private func restorePanelContentSurface(_ p: NSPanel) {
        p.backgroundColor = .clear
        p.contentView?.alphaValue = 1
        p.contentView?.isHidden = false
        p.contentView?.layoutSubtreeIfNeeded()
        p.displayIfNeeded()
    }

    private func frameAnimationStyle(
        for view: HUDView,
        tailCollapsed: Bool
    ) -> (duration: TimeInterval, timing: CAMediaTimingFunction) {
        guard view == .tail else {
            return (0.18, CAMediaTimingFunction(name: .easeInEaseOut))
        }
        if tailCollapsed {
            return (
                0.135,
                CAMediaTimingFunction(controlPoints: 0.34, 0.00, 0.16, 1.00)
            )
        }
        return (
            0.215,
            CAMediaTimingFunction(controlPoints: 0.14, 0.82, 0.18, 1.00)
        )
    }

    private func fadeIn(_ p: NSPanel) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.10
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            p.animator().alphaValue = 1.0
        }
    }

    private func warmAndFadeIn(_ p: OverlayPanel) {
        HUDMotionState.shared.begin(.warming)
        preparePanelForMotion(p)
        Task { @MainActor [weak self, weak p] in
            try? await Task.sleep(nanoseconds: 45_000_000)
            guard let self, let p, self.panel === p else { return }
            self.fadeIn(p)
            HUDMotionState.shared.settle(after: 0.16)
        }
    }

    private func preparePanelForMotion(_ p: NSPanel) {
        p.contentView?.wantsLayer = true
        p.contentView?.layoutSubtreeIfNeeded()
        p.displayIfNeeded()
    }

    // MARK: - Event monitors

    private var globalKeyMonitor: Any?
    private var globalFlagsMonitor: Any?
    private var globalMouseUpMonitor: Any?
    private var outsideDismissTask: Task<Void, Never>?

    private func installMonitors() {
        removeMonitors()
        // Global key monitor is only a backup for the non-activating
        // panel being key while another app remains frontmost. It should
        // not turn normal typing in other apps into HUD shortcuts.
        globalKeyMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: .keyDown
        ) { [weak self] event in
            guard let self else { return }
            guard self.shouldHandleGlobalKey(event) else { return }
            self.handleKeyDown(event)
        }

        globalFlagsMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: .flagsChanged
        ) { event in
            let optionPressed = event.modifierFlags.contains(.option)
            Task { @MainActor in
                HUDMotionState.shared.setModifierLift(optionPressed)
            }
        }

        globalMouseUpMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseUp, .rightMouseUp]
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.scheduleOutsideClickDismiss()
            }
        }
    }

    private func shouldHandleGlobalKey(_ event: NSEvent) -> Bool {
        if event.keyCode == 53 {
            return true
        }
        guard let panel, panel.isVisible else { return false }
        return panel.isKeyWindow || NSApp.isActive
    }

    private func handleFlagsChanged(_ event: NSEvent) {
        HUDMotionState.shared.setModifierLift(event.modifierFlags.contains(.option))
    }

    private func shouldClaimHostKey(_ event: NSEvent) -> Bool {
        if event.keyCode == 53 {
            return true
        }
        if HUDRunnerState.shared.isPresented {
            let keyCode = event.keyCode
            if event.modifierFlags.contains(.command), (keyCode == 36 || keyCode == 76) {
                return true
            }
            if keyCode == 125 || keyCode == 126 || keyCode == 36 || keyCode == 48 {
                return true
            }
        }
        if HUDDockState.shared.suggestionsVisible {
            let keyCode = event.keyCode
            if keyCode == 36 || keyCode == 48 || keyCode == 125 || keyCode == 126 {
                return true
            }
        }
        if event.keyCode == 45,
           event.modifierFlags.contains(.command),
           HUDNavBus.shared.createNew != nil {
            return true
        }
        if event.keyCode == 17,
           HUDNavBus.shared.cycleTreatment != nil {
            return true
        }
        switch event.keyCode {
        case 18, 19, 20, 21, 23, 36, 38, 40, 34, 125, 126, 46, 5, 3, 44, 33, 30, 124, 123:
            return true
        default:
            return false
        }
    }

    private func handleKeyDown(_ event: NSEvent) {
        // Esc always cascades — it's the only way to blur the dock
        // back into nav mode, so it must fire even when focused.
        if event.keyCode == 53 {
            Task { @MainActor in self.handleEscape() }
            return
        }
        if HUDRunnerState.shared.handleKey(keyCode: event.keyCode, modifiers: event.modifierFlags) { return }
        if HUDRunnerState.shared.isPresented { return }
        if HUDDockState.shared.handleSuggestionKey(keyCode: event.keyCode) { return }
        if event.keyCode == 45,
           event.modifierFlags.contains(.command),
           !HUDRunnerState.shared.isPresented,
           HUDNavBus.shared.createNew != nil {
            Task { @MainActor in HUDNavBus.shared.createNew?() }
            return
        }
        // While the dock is focused the TextField owns the keystroke;
        // suppress the rest so the operator can type "j", "1", etc.
        // as text without also cycling rows or switching tabs.
        if shouldSuppressNavHotkeys(for: event) { return }
        switch event.keyCode {
        case 18: // 1
            Task { @MainActor in HUDState.shared.select(.agents) }
        case 19: // 2
            Task { @MainActor in HUDState.shared.select(.activity) }
        case 20: // 3
            Task { @MainActor in HUDState.shared.select(.tail) }
        case 21: // 4
            Task { @MainActor in HUDState.shared.select(.sessions) }
        case 23: // 5
            Task { @MainActor in HUDState.shared.select(.assistant) }
        case 36: // Return — engage selected row
            Task { @MainActor in
                HUDNavBus.shared.engageSelected?()
                self.activateSelected()
            }
        case 38: // j — next row
            Task { @MainActor in HUDNavBus.shared.cycleNext?() }
        case 40: // k — prev row
            Task { @MainActor in HUDNavBus.shared.cyclePrev?() }
        case 34: // i — focus the message dock
            Task { @MainActor in HUDDockState.shared.focus() }
        case 125: // Down arrow — next row; command steps tier down
            if isCommandOnly(event.modifierFlags) {
                Task { @MainActor in HUDState.shared.stepSize(-1) }
            } else {
                Task { @MainActor in HUDNavBus.shared.cycleNext?() }
            }
        case 126: // Up arrow — previous row; command steps tier up
            if isCommandOnly(event.modifierFlags) {
                Task { @MainActor in HUDState.shared.stepSize(+1) }
            } else {
                Task { @MainActor in HUDNavBus.shared.cyclePrev?() }
            }
        case 46: // m — toggle voice dictation
            Task { @MainActor in await Self.toggleMicWithFlash() }
        case 5: // g — top; G with shift = bottom
            if event.modifierFlags.contains(.shift) {
                Task { @MainActor in HUDNavBus.shared.jumpBottom?() }
            } else {
                Task { @MainActor in HUDNavBus.shared.jumpTop?() }
            }
        case 3: // f — toggle live-follow
            Task { @MainActor in HUDNavBus.shared.toggleFollow?() }
        case 17: // t — cycle visual treatment
            Task { @MainActor in HUDNavBus.shared.cycleTreatment?() }
        case 44: // / focuses dock; ? toggles cheatsheet
            if event.modifierFlags.contains(.shift) {
                Task { @MainActor in HUDCheatsheetState.shared.toggle() }
            } else {
                Task { @MainActor in
                    HUDDockState.shared.text = "/"
                    HUDDockState.shared.refreshSuggestions()
                    HUDDockState.shared.focus()
                }
            }
        case 33: // [
            Task { @MainActor in HUDState.shared.stepSize(-1) }
        case 30: // ]
            Task { @MainActor in HUDState.shared.stepSize(+1) }
        case 124: // Right arrow — command steps tier up
            if event.modifierFlags.contains(.command) {
                Task { @MainActor in HUDState.shared.stepSize(+1) }
            }
        case 123: // Left arrow — command steps tier down
            if event.modifierFlags.contains(.command) {
                Task { @MainActor in HUDState.shared.stepSize(-1) }
            }
        default:
            break
        }
    }

    private func scheduleOutsideClickDismiss() {
        guard let panel, panel.isVisible else { return }
        guard HUDState.shared.view != .tail else { return }
        guard !panel.frame.contains(NSEvent.mouseLocation) else { return }

        outsideDismissTask?.cancel()
        outsideDismissTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 220_000_000)
            guard !Task.isCancelled,
                  let self,
                  let panel = self.panel,
                  panel.isVisible,
                  !panel.frame.contains(NSEvent.mouseLocation) else { return }
            self.dismiss()
        }
    }

    private func activateSelected() {
        // Engage on Return is reserved for surfaces with a clear single
        // primary action. None of the redesigned tabs claim Return today;
        // hook back in once HUDEngageState carries a "primary action" verb.
        return
    }

    private func isCommandOnly(_ flags: NSEvent.ModifierFlags) -> Bool {
        flags.intersection(.deviceIndependentFlagsMask) == .command
    }

    private func shouldSuppressNavHotkeys(for event: NSEvent) -> Bool {
        guard isDockFocused else { return false }
        guard !HUDDockState.shared.suggestionsVisible else { return false }
        let kc = event.keyCode
        let dockIsIdle = HUDDockState.shared.text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
        if HUDState.shared.view == .agents && dockIsIdle && (kc == 125 || kc == 126) {
            return false
        }
        return true
    }

    /// Esc cascade — every Enter-driven state must have a reverse.
    /// Walks back one stage at a time so the operator's mental stack
    /// gets popped predictably:
    ///
    ///   0. `?` cheatsheet open    → close it
    ///   1. dock has text          → clear the text
    ///   2. dock has @target chip  → clear the chip
    ///   3. dock has focus         → blur dock
    ///   4. a row is engaged       → unengage (collapse expansion)
    ///   5. nothing left to undo   → dismiss HUD
    private func handleEscape() {
        // Runner draft overlay
        if HUDRunnerState.shared.isPresented {
            HUDRunnerState.shared.dismiss()
            return
        }

        // 0: cheatsheet overlay
        if HUDCheatsheetState.shared.visible {
            HUDCheatsheetState.shared.dismiss()
            return
        }

        // 1 + 2: text → target
        if HUDDockState.shared.escapePressed() { return }

        // 3: dock focus (blur but keep target/text empty already)
        // Detect via the panel's firstResponder being the field editor.
        if let panel, let editor = panel.firstResponder as? NSText, editor.isEditable {
            HUDDockState.shared.blur()
            return
        }

        // 4: collapse engaged row
        if HUDNavBus.shared.unengageSelected?() == true { return }

        // 5: dismiss
        dismiss()
    }

    private func removeMonitors() {
        outsideDismissTask?.cancel()
        outsideDismissTask = nil
        if let m = globalKeyMonitor {
            NSEvent.removeMonitor(m)
            globalKeyMonitor = nil
        }
        if let m = globalFlagsMonitor {
            NSEvent.removeMonitor(m)
            globalFlagsMonitor = nil
        }
        if let m = globalMouseUpMonitor {
            NSEvent.removeMonitor(m)
            globalMouseUpMonitor = nil
        }
        HUDMotionState.shared.setModifierLift(false)
    }
}
