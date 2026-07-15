import AppKit
import Combine
import ScoutSharedUI
import SwiftUI

private extension NSRect {
    func isNearlyEqual(to other: NSRect, tolerance: CGFloat = 0.5) -> Bool {
        abs(origin.x - other.origin.x) <= tolerance
            && abs(origin.y - other.origin.y) <= tolerance
            && abs(size.width - other.size.width) <= tolerance
            && abs(size.height - other.size.height) <= tolerance
    }
}

// Singleton controller for the OpenScout HUD overlay.
// One non-activating glass panel; summon/dismiss via Hyper+H, or open the
// task composer directly via Hyper+A / the configured hot corner. Esc dismisses.

@MainActor
public final class HUDController {
    public static let shared = HUDController()

    private var panel: OverlayPanel?
    private var geometrySubscription: AnyCancellable?
    private var runnerGeometrySubscription: AnyCancellable?
    private var captureAnchor: HUDCaptureAnchor?

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
        return HUDKeyboardInput.isTextEditing(panel.firstResponder)
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

    public func show(captureAnchor: HUDCaptureAnchor? = nil) {
        self.captureAnchor = captureAnchor
        // Reuse the panel if it already exists (still fading out, etc).
        if let panel {
            panel.onFlagsChanged = { [weak self] event in
                self?.handleFlagsChanged(event)
            }
            panel.onKeyUp = { [weak self] event in
                self?.handleKeyUp(event)
            }
            panel.setContentSize(
                desiredContentSize(
                    size: HUDState.shared.size,
                    view: HUDState.shared.view,
                    tailCollapsed: HUDState.shared.tailCollapsed,
                    screen: captureAnchor?.screen() ?? panel.screen ?? NSScreen.main
                )
            )
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
            HUDState.shared.setVisible(true)
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
            size: desiredContentSize(
                size: HUDState.shared.size,
                view: HUDState.shared.view,
                tailCollapsed: HUDState.shared.tailCollapsed,
                screen: captureAnchor?.screen() ?? NSScreen.main
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
        config.hasShadow = true
        config.onKeyDown = { [weak self] event in
            self?.handleKeyDown(event) ?? false
        }
        config.onKeyUp = { [weak self] event in
            self?.handleKeyUp(event)
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
        HUDState.shared.setVisible(true)

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
        if HUDRunnerState.shared.isPresented {
            guard HUDRunnerState.shared.dismiss() else { return }
        }
        guard let p = panel else { return }
        HUDState.shared.setVisible(false)
        if HUDMotionState.shared.phase == .idle {
            HUDMotionState.shared.begin(.moving)
        }
        resetMicKeyHold()
        // Force-cancel any hold regardless of source — the mouse path's own
        // onDisappear may not fire if the panel is hidden rather than torn
        // down, and a dismissed HUD must never leave the mic hot.
        HUDDockState.shared.cancelHoldToTalk()
        preparePanelForMotion(p)
        removeMonitors()
        geometrySubscription?.cancel()
        geometrySubscription = nil
        runnerGeometrySubscription?.cancel()
        runnerGeometrySubscription = nil

        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.14
            ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
            p.animator().alphaValue = 0
        }) { [weak self] in
            Task { @MainActor [weak self] in
                // A show request can reuse this panel while the fade-out is
                // still completing. In that case visibility has already been
                // restored; do not let the stale dismissal completion tear
                // down the live panel and strand its store lifecycle as active.
                guard !HUDState.shared.isVisible else { return }
                p.orderOut(nil)
                self?.panel = nil
                self?.captureAnchor = nil
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
        return handleKeyDown(event)
    }

    // Drive the panel frame from HUDState.size + view. The Tail tab shares
    // normal HUD geometry; TailMode owns the separate attach/free overlay panel.
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

        runnerGeometrySubscription?.cancel()
        let runner = HUDRunnerState.shared
        let hasCaptures = Publishers.CombineLatest(
            runner.$attachments.map { !$0.isEmpty },
            runner.$localReferences.map { !$0.isEmpty }
        )
            .map { $0 || $1 }
            .removeDuplicates()

        runnerGeometrySubscription = Publishers.CombineLatest3(
            runner.$isPresented.removeDuplicates(),
            runner.$disclosure.removeDuplicates(),
            hasCaptures
        )
            .dropFirst()
            .sink { [weak self] _, _, _ in
                Task { @MainActor [weak self] in
                    let runner = HUDRunnerState.shared
                    guard runner.isPresented || !runner.closesHUDOnDismiss else { return }
                    self?.applyGeometry(
                        size: HUDState.shared.size,
                        view: HUDState.shared.view,
                        tailCollapsed: HUDState.shared.tailCollapsed
                    )
                }
            }
    }

    private func applyGeometry(size: HUDSize, view: HUDView, tailCollapsed _: Bool) {
        guard let p = panel else { return }
        let screen = captureAnchor?.screen() ?? p.screen ?? NSScreen.main
        let target = desiredContentSize(
            size: size,
            view: view,
            tailCollapsed: false,
            screen: screen
        )
        let targetMinContentSize = minContentSize(for: view, tailCollapsed: false)
        p.contentMinSize = targetMinContentSize
        p.hasShadow = true
        restorePanelContentSurface(p)

        // Convert content size → frame size. For .borderless panels the
        // title-bar contribution is zero, so frame == content; keep the
        // call symmetric anyway in case the styleMask gains a titlebar.
        let frameSize = p.frameRect(forContentRect: NSRect(origin: .zero, size: target)).size

        let newFrame: NSRect
        if let captureAnchor, let visible = screen?.visibleFrame {
            newFrame = NSRect(
                origin: captureAnchor.corner.panelOrigin(size: frameSize, in: visible),
                size: frameSize
            )
        } else if !HUDRunnerState.shared.isPresented,
                  size.isScreenAnchored(for: view),
                  let visible = screen?.visibleFrame {
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
        let animationStyle = (duration: 0.18, timing: CAMediaTimingFunction(name: .easeInEaseOut))

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

    private func placement(for view: HUDView, size: HUDSize, tailCollapsed _: Bool) -> OverlayPanelShell.Placement {
        if let captureAnchor {
            return .screenCorner(
                captureAnchor.corner,
                displayID: captureAnchor.displayID
            )
        }
        if HUDRunnerState.shared.isPresented {
            return .mouseScreenCentered(yOffsetRatio: 0.04)
        }
        if size.isScreenAnchored(for: view) {
            return .topCenter(margin: 0)
        }
        return .mouseScreenCentered(yOffsetRatio: 0.04)
    }

    private func desiredContentSize(
        size: HUDSize,
        view: HUDView,
        tailCollapsed: Bool,
        screen: NSScreen?
    ) -> NSSize {
        let runner = HUDRunnerState.shared
        if runner.isPresented {
            return HUDRunnerLayout.contentSize(
                disclosure: runner.disclosure,
                hasCaptures: !runner.attachments.isEmpty || !runner.localReferences.isEmpty
            )
        }
        return size.contentSize(for: view, collapsed: tailCollapsed, on: screen)
    }

    private func minContentSize(for _: HUDView, tailCollapsed _: Bool) -> NSSize {
        NSSize(width: 360, height: 380)
    }

    private func restorePanelContentSurface(_ p: NSPanel) {
        p.backgroundColor = .clear
        p.contentView?.alphaValue = 1
        p.contentView?.isHidden = false
        p.contentView?.layoutSubtreeIfNeeded()
        p.displayIfNeeded()
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

    // m-key push-to-talk. keyDown (non-repeat) starts a threshold timer;
    // crossing 250ms enters hold mode; keyUp ends it. A short tap keeps the
    // existing toggle behavior.
    private var micKeyDownAt: Date?
    private var micHoldActive = false
    private var micHoldArmTask: Task<Void, Never>?
    private var micHoldToken: UUID?

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
            _ = self.handleKeyDown(event)
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
            if event.modifierFlags.contains(.command),
               (keyCode == 36 || keyCode == 76 || keyCode == 37 || keyCode == 31 || keyCode == 15) {
                return true
            }
            if HUDRunnerState.shared.shouldHandleProjectNavigation {
                if keyCode == 125 || keyCode == 126 || keyCode == 36 {
                    return true
                }
                let navModifiers: NSEvent.ModifierFlags = [.control, .option, .command]
                if keyCode == 48,
                   event.modifierFlags.intersection(navModifiers).isEmpty {
                    return true
                }
            }
            let focusModifiers: NSEvent.ModifierFlags = [.control, .option, .command]
            if keyCode == 48,
               event.modifierFlags.intersection(focusModifiers).isEmpty {
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
        if event.keyCode == 46 {
            return HUDKeyboardInput.isUnmodifiedCharacterShortcut(event)
                && !HUDKeyboardInput.isTextEditingTarget(for: event, panel: panel)
        }
        switch event.keyCode {
        case 18, 19, 20, 21, 23, 36, 38, 40, 34, 125, 126, 5, 3, 44, 33, 30, 124, 123:
            return true
        default:
            return false
        }
    }

    @discardableResult
    private func handleKeyDown(_ event: NSEvent) -> Bool {
        // Esc always cascades — it's the only way to blur the dock
        // back into nav mode, so it must fire even when focused.
        if event.keyCode == 53 {
            Task { @MainActor in self.handleEscape() }
            return true
        }
        if HUDRunnerState.shared.handleKey(keyCode: event.keyCode, modifiers: event.modifierFlags) { return true }
        if HUDRunnerState.shared.isPresented { return false }
        if HUDDockState.shared.handleSuggestionKey(keyCode: event.keyCode) { return true }
        if event.keyCode == 45,
           event.modifierFlags.contains(.command),
           !HUDRunnerState.shared.isPresented,
           HUDNavBus.shared.createNew != nil {
            Task { @MainActor in HUDNavBus.shared.createNew?() }
            return true
        }
        // While the dock is focused the TextField owns the keystroke;
        // suppress the rest so the operator can type "j", "1", etc.
        // as text without also cycling rows or switching tabs.
        if shouldSuppressNavHotkeys(for: event) { return false }
        switch event.keyCode {
        case 18: // 1
            Task { @MainActor in HUDState.shared.select(.agents) }
            return true
        case 19: // 2
            Task { @MainActor in HUDState.shared.select(.activity) }
            return true
        case 20: // 3
            Task { @MainActor in HUDState.shared.select(.tail) }
            return true
        case 21: // 4
            Task { @MainActor in HUDState.shared.select(.sessions) }
            return true
        case 23: // 5
            Task { @MainActor in HUDState.shared.select(.assistant) }
            return true
        case 36: // Return — engage selected row
            Task { @MainActor in
                HUDNavBus.shared.engageSelected?()
                self.activateSelected()
            }
            return true
        case 38: // j — next row
            Task { @MainActor in HUDNavBus.shared.cycleNext?() }
            return true
        case 40: // k — prev row
            Task { @MainActor in HUDNavBus.shared.cyclePrev?() }
            return true
        case 34: // i — focus the message dock
            Task { @MainActor in HUDDockState.shared.focus() }
            return true
        case 125: // Down arrow — next row; command steps tier down
            if isCommandOnly(event.modifierFlags) {
                Task { @MainActor in HUDState.shared.stepSize(-1) }
            } else {
                Task { @MainActor in HUDNavBus.shared.cycleNext?() }
            }
            return true
        case 126: // Up arrow — previous row; command steps tier up
            if isCommandOnly(event.modifierFlags) {
                Task { @MainActor in HUDState.shared.stepSize(+1) }
            } else {
                Task { @MainActor in HUDNavBus.shared.cyclePrev?() }
            }
            return true
        case 46: // m — hold to talk (push-to-talk); tap to toggle dictation
            guard HUDKeyboardInput.isUnmodifiedCharacterShortcut(event),
                  !HUDKeyboardInput.isTextEditingTarget(for: event, panel: panel) else { return false }
            handleMicKeyDown(event)
            return true
        case 5: // g — top; G with shift = bottom
            if event.modifierFlags.contains(.shift) {
                Task { @MainActor in HUDNavBus.shared.jumpBottom?() }
            } else {
                Task { @MainActor in HUDNavBus.shared.jumpTop?() }
            }
            return true
        case 3: // f — toggle live-follow
            Task { @MainActor in HUDNavBus.shared.toggleFollow?() }
            return true
        case 17: // t — cycle visual treatment
            Task { @MainActor in HUDNavBus.shared.cycleTreatment?() }
            return true
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
            return true
        case 33: // [
            Task { @MainActor in HUDState.shared.stepSize(-1) }
            return true
        case 30: // ]
            Task { @MainActor in HUDState.shared.stepSize(+1) }
            return true
        case 124: // Right arrow — command steps tier up
            if event.modifierFlags.contains(.command) {
                Task { @MainActor in HUDState.shared.stepSize(+1) }
                return true
            }
            return false
        case 123: // Left arrow — command steps tier down
            if event.modifierFlags.contains(.command) {
                Task { @MainActor in HUDState.shared.stepSize(-1) }
                return true
            }
            return false
        default:
            return false
        }
    }

    // MARK: - m-key push-to-talk

    private func handleKeyUp(_ event: NSEvent) {
        if event.keyCode == 46 {
            handleMicKeyUp(event)
        }
    }

    private func handleMicKeyDown(_ event: NSEvent) {
        guard !event.isARepeat else { return }   // ignore auto-repeat
        // Host-forwarded keydowns (the main window is key, ScoutCommands'
        // .keyDown-only monitor relays into here) have no matching keyup
        // route — a hold begun there can never end and the mic sticks hot.
        // Keep the tap toggle for that path; arm push-to-talk only when the
        // panel itself is key and will see the release.
        guard panel?.isKeyWindow == true else {
            Task { @MainActor in await Self.toggleMicWithFlash() }
            return
        }
        guard micKeyDownAt == nil else { return }
        micKeyDownAt = Date()
        micHoldActive = false
        micHoldArmTask?.cancel()
        micHoldArmTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard let self, !Task.isCancelled, self.micKeyDownAt != nil else { return }
            self.micHoldActive = true
            self.micHoldToken = HUDDockState.shared.beginHoldToTalk()
        }
    }

    private func handleMicKeyUp(_ event: NSEvent) {
        guard micKeyDownAt != nil else { return }
        micHoldArmTask?.cancel()
        micHoldArmTask = nil
        let wasHold = micHoldActive
        let token = micHoldToken
        micKeyDownAt = nil
        micHoldActive = false
        micHoldToken = nil
        if wasHold {
            if let token {
                HUDDockState.shared.endHoldToTalk(token: token)
            }
        } else {
            Task { @MainActor in await Self.toggleMicWithFlash() }
        }
    }

    /// Drop any in-flight m-key hold (HUD dismissed mid-hold, etc.) so the
    /// next keyDown isn't blocked and no send is left armed.
    private func resetMicKeyHold() {
        micHoldArmTask?.cancel()
        micHoldArmTask = nil
        micKeyDownAt = nil
        micHoldActive = false
        if let token = micHoldToken {
            HUDDockState.shared.cancelHoldToTalk(token: token)
            micHoldToken = nil
        }
    }

    private func scheduleOutsideClickDismiss() {
        guard let panel, panel.isVisible else { return }
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
            HUDRunnerState.shared.escapePressed()
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
