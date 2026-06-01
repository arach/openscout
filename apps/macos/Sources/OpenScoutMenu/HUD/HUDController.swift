import AppKit
import Combine
import ScoutSharedUI
import SwiftUI

// Singleton controller for the OpenScout HUD overlay.
// One non-activating glass panel; summon/dismiss via Hyper+H or the
// menu-bar item. Esc dismisses.

@MainActor
final class HUDController {
    static let shared = HUDController()

    private var panel: OverlayPanel?
    private var sizeSubscription: AnyCancellable?

    var isVisible: Bool {
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
    var currentWindowId: Int? {
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

    /// Toggle voice dictation; if the Vox companion is unavailable,
    /// surface the reason via the HUD flash row instead of silently
    /// no-op'ing. Shared by both the panel and global key monitors.
    @MainActor
    private static func toggleMicWithFlash() async {
        let vox = HudVoxService.shared
        if case .unavailable(let reason) = vox.state {
            HUDFlashState.shared.flash(
                reason,
                action: .init(label: "LAUNCH VOX", perform: launchVoxApp)
            )
            return
        }
        await HUDDockState.shared.toggleDictation()
    }

    /// Boot the Vox companion app if it's installed. Tries the standard
    /// install locations and falls back to a follow-up flash if the app
    /// can't be found — better than silently failing the action button.
    @MainActor
    private static func launchVoxApp() {
        let candidates = [
            "/Applications/Vox.app",
            (NSHomeDirectory() as NSString).appendingPathComponent("Applications/Vox.app"),
        ]
        for path in candidates where FileManager.default.fileExists(atPath: path) {
            let cfg = NSWorkspace.OpenConfiguration()
            cfg.activates = true
            NSWorkspace.shared.openApplication(
                at: URL(fileURLWithPath: path),
                configuration: cfg,
                completionHandler: nil
            )
            return
        }
        HUDFlashState.shared.flash(
            "Vox.app not found in /Applications. Install the Vox companion to enable dictation."
        )
    }

    func toggle() {
        if isVisible { dismiss() } else { show() }
    }

    func show() {
        let controller = OpenScoutAppController.shared

        // Trigger a refresh so the HUD glance reflects current state, not
        // whatever was cached when the timer last fired.
        controller.refresh()

        // Reuse the panel if it already exists (still fading out, etc).
        if let panel {
            OverlayPanelShell.position(panel, placement: .mouseScreenCentered(yOffsetRatio: 0.04))
            panel.alphaValue = 0
            OverlayPanelShell.present(panel, activate: false, makeKey: true, orderFrontRegardless: true)
            fadeIn(panel)
            installMonitors()
            installSizeObserver()
            HUDStateFile.shared.touch()
            return
        }

        let view = HUDStatusView(controller: controller, onDismiss: { [weak self] in
            self?.dismiss()
        })
        .preferredColorScheme(.dark)

        var config = OverlayPanelShell.Config(size: HUDState.shared.size.contentSize())
        config.isMovableByWindowBackground = true
        config.resizable = true
        config.minContentSize = NSSize(width: 360, height: 380)
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
            guard let self else { return }
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
            if self.shouldSuppressNavHotkeys(for: event) { return }
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
            case 36: // Return — engage selected row (focus dock, prefill @target)
                Task { @MainActor in
                    HUDNavBus.shared.engageSelected?()
                    self.activateSelected()
                }
            case 38: // j — cycle selection next
                Task { @MainActor in HUDNavBus.shared.cycleNext?() }
            case 40: // k — cycle selection prev
                Task { @MainActor in HUDNavBus.shared.cyclePrev?() }
            case 34: // i — focus the message dock (vim-style "insert")
                Task { @MainActor in HUDDockState.shared.focus() }
            case 125: // Down arrow — next row; ⌘↓ steps tier down
                if self.isCommandOnly(event.modifierFlags) {
                    Task { @MainActor in HUDState.shared.stepSize(-1) }
                } else {
                    Task { @MainActor in HUDNavBus.shared.cycleNext?() }
                }
            case 126: // Up arrow — prev row; ⌘↑ steps tier up
                if self.isCommandOnly(event.modifierFlags) {
                    Task { @MainActor in HUDState.shared.stepSize(+1) }
                } else {
                    Task { @MainActor in HUDNavBus.shared.cyclePrev?() }
                }
            case 46: // m — toggle voice dictation (transcript lands in dock)
                Task { @MainActor in await Self.toggleMicWithFlash() }
            case 5: // g — top (G with shift = bottom)
                if event.modifierFlags.contains(.shift) {
                    Task { @MainActor in HUDNavBus.shared.jumpBottom?() }
                } else {
                    Task { @MainActor in HUDNavBus.shared.jumpTop?() }
                }
            case 3: // f — toggle live-follow (tail / stream views)
                Task { @MainActor in HUDNavBus.shared.toggleFollow?() }
            case 44: // / (alone) → focus dock + seed slash; ? (shift) → cheatsheet
                if event.modifierFlags.contains(.shift) {
                    Task { @MainActor in HUDCheatsheetState.shared.toggle() }
                } else {
                    Task { @MainActor in
                        HUDDockState.shared.text = "/"
                        HUDDockState.shared.refreshSuggestions(agents: HudFleetService.shared.agents ?? [])
                        HUDDockState.shared.focus()
                    }
                }
            case 33: // [ — step size down
                Task { @MainActor in HUDState.shared.stepSize(-1) }
            case 30: // ] — step size up
                Task { @MainActor in HUDState.shared.stepSize(+1) }
            case 124: // Right arrow — ⌘→ steps tier up
                if event.modifierFlags.contains(.command) {
                    Task { @MainActor in HUDState.shared.stepSize(+1) }
                }
            case 123: // Left arrow — ⌘← steps tier down
                if event.modifierFlags.contains(.command) {
                    Task { @MainActor in HUDState.shared.stepSize(-1) }
                }
            default:
                break
            }
        }

        let p = OverlayPanelShell.makePanel(config: config, rootView: view)
        OverlayPanelShell.position(p, placement: .mouseScreenCentered(yOffsetRatio: 0.04))

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

        fadeIn(p)
        installMonitors()
        installSizeObserver()
        HUDStateFile.shared.touch()
    }

    func dismiss() {
        guard let p = panel else { return }
        removeMonitors()
        sizeSubscription?.cancel()
        sizeSubscription = nil

        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.14
            ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
            p.animator().alphaValue = 0
        }) { [weak self] in
            Task { @MainActor [weak self] in
                p.orderOut(nil)
                self?.panel = nil
                HUDStateFile.shared.touch()
            }
        }
    }

    // Drive the panel frame from HUDState.size. The window resize is
    // anchored on its current center so the panel grows/shrinks in
    // place — feels like a tier swap, not a jump.
    private func installSizeObserver() {
        sizeSubscription?.cancel()
        sizeSubscription = HUDState.shared.$size
            .dropFirst() // ignore the initial value — already at that size
            .sink { [weak self] newSize in
                Task { @MainActor [weak self] in
                    self?.applySize(newSize)
                }
            }
    }

    private func applySize(_ size: HUDSize) {
        guard let p = panel else { return }
        let screen = p.screen ?? NSScreen.main
        let target = size.contentSize(on: screen)

        // Convert content size → frame size. For .borderless panels the
        // title-bar contribution is zero, so frame == content; keep the
        // call symmetric anyway in case the styleMask gains a titlebar.
        let frameSize = p.frameRect(forContentRect: NSRect(origin: .zero, size: target)).size

        let newFrame: NSRect
        if size.isScreenAnchored, let visible = screen?.visibleFrame {
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

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.22
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            ctx.allowsImplicitAnimation = true
            p.animator().setFrame(newFrame, display: true)
        }
    }

    private func fadeIn(_ p: NSPanel) {
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.12
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            p.animator().alphaValue = 1.0
        }
    }

    // MARK: - Event monitors

    private var globalKeyMonitor: Any?
    private var globalMouseUpMonitor: Any?
    private var outsideDismissTask: Task<Void, Never>?

    private func installMonitors() {
        removeMonitors()
        // Global key monitor — catches nav keys + Esc even when our
        // non-activating panel isn't the key window. (Local onKeyDown
        // also fires when the panel IS key.)
        globalKeyMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: .keyDown
        ) { [weak self] event in
            guard let self else { return }
            let kc = event.keyCode
            // Esc always cascades.
            if kc == 53 {
                Task { @MainActor in self.handleEscape() }
                return
            }
            if HUDRunnerState.shared.handleKey(keyCode: kc, modifiers: event.modifierFlags) { return }
            if HUDRunnerState.shared.isPresented { return }
            if HUDDockState.shared.handleSuggestionKey(keyCode: kc) { return }
            if kc == 45,
               event.modifierFlags.contains(.command),
               !HUDRunnerState.shared.isPresented,
               HUDNavBus.shared.createNew != nil {
                Task { @MainActor in HUDNavBus.shared.createNew?() }
                return
            }
            // Guard against firing nav hotkeys while the dock is the
            // first responder (typing in the field).
            if self.shouldSuppressNavHotkeys(for: event) { return }
            switch kc {
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
            case 34: // i — focus dock
                Task { @MainActor in HUDDockState.shared.focus() }
            case 125: // Down arrow — next row; ⌘↓ steps tier down
                if self.isCommandOnly(event.modifierFlags) {
                    Task { @MainActor in HUDState.shared.stepSize(-1) }
                } else {
                    Task { @MainActor in HUDNavBus.shared.cycleNext?() }
                }
            case 126: // Up arrow — prev row; ⌘↑ steps tier up
                if self.isCommandOnly(event.modifierFlags) {
                    Task { @MainActor in HUDState.shared.stepSize(+1) }
                } else {
                    Task { @MainActor in HUDNavBus.shared.cyclePrev?() }
                }
            case 46: // m — toggle voice dictation
                Task { @MainActor in await Self.toggleMicWithFlash() }
            case 5: // g / G
                if event.modifierFlags.contains(.shift) {
                    Task { @MainActor in HUDNavBus.shared.jumpBottom?() }
                } else {
                    Task { @MainActor in HUDNavBus.shared.jumpTop?() }
                }
            case 3: // f — toggle follow
                Task { @MainActor in HUDNavBus.shared.toggleFollow?() }
            case 44: // / (alone) → focus dock + seed slash; ? (shift) → cheatsheet
                if event.modifierFlags.contains(.shift) {
                    Task { @MainActor in HUDCheatsheetState.shared.toggle() }
                } else {
                    Task { @MainActor in
                        HUDDockState.shared.text = "/"
                        HUDDockState.shared.refreshSuggestions(agents: HudFleetService.shared.agents ?? [])
                        HUDDockState.shared.focus()
                    }
                }
            case 33: // [
                Task { @MainActor in HUDState.shared.stepSize(-1) }
            case 30: // ]
                Task { @MainActor in HUDState.shared.stepSize(+1) }
            default:
                break
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
        if let m = globalMouseUpMonitor {
            NSEvent.removeMonitor(m)
            globalMouseUpMonitor = nil
        }
    }
}
