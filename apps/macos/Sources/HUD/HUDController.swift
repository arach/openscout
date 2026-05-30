import AppKit
import Combine
import HudsonShell
import SwiftUI

// Singleton controller for the OpenScout HUD overlay.
// One non-activating glass panel; summon/dismiss via Hyper+H or the
// menu-bar item. Esc dismisses; clicking outside dismisses.

@MainActor
final class HUDController {
    static let shared = HUDController()

    private var panel: HudOverlayPanel?
    private var clickMonitor: Any?
    private var sizeSubscription: AnyCancellable?
    private lazy var keyRouter = makeKeyRouter()

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

    /// Toggle voice dictation; if embedded transcription is unavailable,
    /// surface the reason via the HUD flash row instead of silently
    /// no-op'ing. Shared by both the panel and global key monitors.
    @MainActor
    private static func toggleMicWithFlash() async {
        let vox = ScoutVoiceService.shared
        if case .unavailable(let reason) = vox.state {
            HUDFlashState.shared.flash(reason)
            return
        }
        await HUDDockState.shared.toggleDictation()
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
            HudOverlayPanelShell.position(panel, placement: .mouseScreenCentered(yOffsetRatio: 0.04))
            panel.alphaValue = 0
            HudOverlayPanelShell.present(panel, activate: false, makeKey: true, orderFrontRegardless: true)
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

        var config = HudOverlayPanelShell.Configuration(size: HUDState.shared.size.contentSize())
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
            guard let self else { return false }
            return self.handleKeyDown(HudOverlayKeyPress(event: event))
        }

        let p = HudOverlayPanelShell.makePanel(configuration: config, rootView: view)
        HudOverlayPanelShell.position(p, placement: .mouseScreenCentered(yOffsetRatio: 0.04))

        p.alphaValue = 0
        HudOverlayPanelShell.present(p, activate: false, makeKey: true, orderFrontRegardless: true)
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

        HudOverlayPanelShell.fadeOut(p) { [weak self] in
            p.orderOut(nil)
            self?.panel = nil
            HUDStateFile.shared.touch()
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
        HudOverlayPanelShell.animateFrame(p, to: size.frame(for: p))
    }

    private func fadeIn(_ p: NSPanel) {
        HudOverlayPanelShell.fadeIn(p)
    }

    // MARK: - Event monitors

    private var globalKeyMonitor: Any?

    private func installMonitors() {
        removeMonitors()
        clickMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown]
        ) { [weak self] _ in
            guard let self, let panel = self.panel else { return }
            let loc = NSEvent.mouseLocation
            if !panel.frame.contains(loc) {
                Task { @MainActor in self.dismiss() }
            }
        }
        // Global key monitor — catches nav keys + Esc even when our
        // non-activating panel isn't the key window. (Local onKeyDown
        // also fires when the panel IS key.)
        globalKeyMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: .keyDown
        ) { [weak self] event in
            let press = HudOverlayKeyPress(event: event)
            Task { @MainActor in _ = self?.handleKeyDown(press) }
        }
    }

    private func makeKeyRouter() -> HudOverlayKeyRouter {
        HudOverlayKeyRouter(commands: [
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.one) { _ in HUDState.shared.select(.agents) },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.two) { _ in HUDState.shared.select(.activity) },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.three) { _ in HUDState.shared.select(.tail) },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.four) { _ in HUDState.shared.select(.sessions) },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.five) { _ in HUDState.shared.select(.assistant) },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.enter) { [weak self] _ in
                HUDNavBus.shared.engageSelected?()
                self?.activateSelected()
            },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.j) { _ in HUDNavBus.shared.cycleNext?() },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.k) { _ in HUDNavBus.shared.cyclePrev?() },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.i) { _ in HUDDockState.shared.focus() },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.m) { _ in
                Task { @MainActor in await Self.toggleMicWithFlash() }
            },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.g) { _ in HUDNavBus.shared.jumpTop?() },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.g, modifiers: .contains(.shift)) { _ in
                HUDNavBus.shared.jumpBottom?()
            },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.f) { _ in HUDNavBus.shared.toggleFollow?() },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.slash) { _ in
                HUDDockState.shared.text = "/"
                HUDDockState.shared.focus()
            },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.slash, modifiers: .contains(.shift)) { _ in
                HUDCheatsheetState.shared.toggle()
            },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.leftBracket) { _ in HUDState.shared.stepSize(-1) },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.rightBracket) { _ in HUDState.shared.stepSize(+1) },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.rightArrow, modifiers: .contains(.command)) { _ in
                HUDState.shared.stepSize(+1)
            },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.upArrow, modifiers: .contains(.command)) { _ in
                HUDState.shared.stepSize(+1)
            },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.leftArrow, modifiers: .contains(.command)) { _ in
                HUDState.shared.stepSize(-1)
            },
            HudOverlayKeyCommand(keyCode: HudOverlayKeyCode.downArrow, modifiers: .contains(.command)) { _ in
                HUDState.shared.stepSize(-1)
            },
        ])
    }

    @discardableResult
    private func handleKeyDown(_ press: HudOverlayKeyPress) -> Bool {
        // Esc always cascades so the dock can blur back into navigation mode.
        if press.keyCode == HudOverlayKeyCode.escape {
            handleEscape()
            return true
        }
        // While the dock is focused, editable text owns ordinary shortcuts.
        if isDockFocused { return false }
        return keyRouter.route(press)
    }

    private func activateSelected() {
        // Engage on Return is reserved for surfaces with a clear single
        // primary action. None of the redesigned tabs claim Return today;
        // hook back in once HUDEngageState carries a "primary action" verb.
        return
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
        if let m = clickMonitor {
            NSEvent.removeMonitor(m)
            clickMonitor = nil
        }
        if let m = globalKeyMonitor {
            NSEvent.removeMonitor(m)
            globalKeyMonitor = nil
        }
    }
}
