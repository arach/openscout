import AppKit
import SwiftUI

// Singleton controller for the OpenScout HUD overlay.
// One non-activating glass panel; summon/dismiss via Hyper+H or the
// menu-bar item. Esc dismisses; clicking outside dismisses.

@MainActor
final class HUDController {
    static let shared = HUDController()

    private var panel: OverlayPanel?
    private var clickMonitor: Any?

    var isVisible: Bool {
        guard let panel else { return false }
        return panel.isVisible && panel.alphaValue > 0.5
    }

    private init() {}

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
            return
        }

        let view = HUDStatusView(controller: controller, onDismiss: { [weak self] in
            self?.dismiss()
        })
        .preferredColorScheme(.dark)

        var config = OverlayPanelShell.Config(size: NSSize(width: 420, height: 520))
        config.isMovableByWindowBackground = true
        config.resizable = true
        config.minContentSize = NSSize(width: 360, height: 380)
        config.maxContentSize = NSSize(width: 880, height: 1200)
        config.onKeyDown = { [weak self] event in
            switch event.keyCode {
            case 53: // Escape
                Task { @MainActor in self?.dismiss() }
            case 18: // 1
                Task { @MainActor in HUDState.shared.select(.fleet) }
            case 19: // 2
                Task { @MainActor in HUDState.shared.select(.tail) }
            case 20: // 3
                Task { @MainActor in HUDState.shared.select(.sessions) }
            case 36: // Return — activate selected row (Sessions only for now)
                Task { @MainActor in self?.activateSelected() }
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
    }

    func dismiss() {
        guard let p = panel else { return }
        removeMonitors()

        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.14
            ctx.timingFunction = CAMediaTimingFunction(name: .easeIn)
            p.animator().alphaValue = 0
        }) { [weak self] in
            Task { @MainActor [weak self] in
                p.orderOut(nil)
                self?.panel = nil
            }
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
            guard let self else { return }
            let kc = event.keyCode
            switch kc {
            case 53: // Escape
                Task { @MainActor in self.dismiss() }
            case 18: // 1
                Task { @MainActor in HUDState.shared.select(.fleet) }
            case 19: // 2
                Task { @MainActor in HUDState.shared.select(.tail) }
            case 20: // 3
                Task { @MainActor in HUDState.shared.select(.sessions) }
            case 36: // Return
                Task { @MainActor in self.activateSelected() }
            default:
                break
            }
        }
    }

    private func activateSelected() {
        switch HUDState.shared.view {
        case .sessions:
            guard let first = SessionScanner.shared.sessions.first else { return }
            SessionFocus.focus(first)
            dismiss()
        case .fleet, .tail:
            break
        }
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
