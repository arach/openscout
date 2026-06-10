import AppKit
import SwiftUI

// Ported from lattices apps/mac/Sources/Core/Overlays/OverlayPanelShell.swift.
// NSPanel factory for non-activating floating overlays — follows the
// operator across Spaces, doesn't steal focus from the frontmost app.

final class OverlayPanel: NSPanel {
    var activatesOnMouseDown = false
    var onKeyDown: ((NSEvent) -> Void)?
    var onFlagsChanged: ((NSEvent) -> Void)?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    override func sendEvent(_ event: NSEvent) {
        if activatesOnMouseDown,
           event.type == .leftMouseDown || event.type == .rightMouseDown {
            if !NSApp.isActive {
                NSApp.activate(ignoringOtherApps: true)
            }
            if !isKeyWindow {
                makeKey()
            }
        }
        super.sendEvent(event)
    }

    override func keyDown(with event: NSEvent) {
        // Let text fields consume their own input. Without this guard,
        // typing in a dock TextField sends '1','2',… through to the
        // panel's nav hotkeys and the user can't compose a message.
        // Esc and the dock suggestion keys still reach onKeyDown so
        // completion can be accepted/dismissed while typing.
        let kc = event.keyCode
        let isEscape = kc == 53
        let hasCommand = event.modifierFlags.contains(.command)
        let isSuggestionKey = HUDDockState.shared.suggestionsVisible
            && (kc == 36 || kc == 48 || kc == 125 || kc == 126)
        let isRunnerProjectKey = HUDRunnerState.shared.isPresented
            && HUDRunnerState.shared.shouldShowProjectMatches
            && (kc == 36 || kc == 48 || kc == 125 || kc == 126)
        let isIdleAgentRosterArrow = HUDState.shared.view == .agents
            && !HUDDockState.shared.suggestionsVisible
            && HUDDockState.shared.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (kc == 125 || kc == 126)
        if firstResponderIsTextEditing
            && !isEscape
            && !hasCommand
            && !isSuggestionKey
            && !isRunnerProjectKey
            && !isIdleAgentRosterArrow {
            super.keyDown(with: event)
            return
        }
        if let onKeyDown {
            onKeyDown(event)
        } else {
            super.keyDown(with: event)
        }
    }

    private var firstResponderIsTextEditing: Bool {
        // SwiftUI TextField bridges to NSTextView via the field editor.
        // The field editor is the firstResponder when a TextField has
        // focus inside an NSHostingView.
        if let responder = firstResponder as? NSText, responder.isEditable {
            return true
        }
        if firstResponder is NSTextView {
            return true
        }
        return false
    }

    override func flagsChanged(with event: NSEvent) {
        if let onFlagsChanged {
            onFlagsChanged(event)
        } else {
            super.flagsChanged(with: event)
        }
    }
}

private final class OverlayHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var focusRingType: NSFocusRingType { get { .none } set {} }

    // Force the hosting view + every sublayer onto the window's backing
    // scale. Floating SwiftUI panels routinely come up at 1× when the
    // layer is created before a window is attached; the result is fuzzy
    // text and edges. Fix that on the way in and any time the panel
    // hops screens.
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        applyBackingScale()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        applyBackingScale()
    }

    private func applyBackingScale() {
        let scale = window?.backingScaleFactor
            ?? NSScreen.main?.backingScaleFactor
            ?? 2.0
        func apply(to layer: CALayer?) {
            guard let layer else { return }
            layer.contentsScale = scale
            layer.rasterizationScale = scale
            layer.sublayers?.forEach { apply(to: $0) }
        }
        wantsLayer = true
        apply(to: layer)
    }
}

@MainActor
public enum OverlayPanelShell {
    public enum Placement {
        case centered(yOffsetRatio: CGFloat = 0)
        case mouseScreenCentered(yOffsetRatio: CGFloat = 0)
        case topCenter(margin: CGFloat = 40)
    }

    struct Config {
        var size: NSSize
        var styleMask: NSWindow.StyleMask = [.borderless, .nonactivatingPanel]
        var title: String = ""
        var level: NSWindow.Level = .floating
        var hasShadow = true
        var hidesOnDeactivate = false
        var isReleasedWhenClosed = false
        var isMovableByWindowBackground = false
        var collectionBehavior: NSWindow.CollectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
        ]
        var activatesOnMouseDown = false
        var onKeyDown: ((NSEvent) -> Void)? = nil
        var appearance: NSAppearance? = NSAppearance(named: .darkAqua)
        var resizable: Bool = false
        var minContentSize: NSSize? = nil
        var maxContentSize: NSSize? = nil
    }

    static func makePanel<Content: View>(config: Config, rootView: Content) -> OverlayPanel {
        let hosting = OverlayHostingView(rootView: rootView)
        hosting.translatesAutoresizingMaskIntoConstraints = false

        var styleMask = config.styleMask
        if config.resizable { styleMask.insert(.resizable) }

        let panel = OverlayPanel(
            contentRect: NSRect(origin: .zero, size: config.size),
            styleMask: styleMask,
            backing: .buffered,
            defer: false
        )
        if let minSize = config.minContentSize {
            panel.contentMinSize = minSize
        }
        if let maxSize = config.maxContentSize {
            panel.contentMaxSize = maxSize
        }
        panel.title = config.title
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.level = config.level
        panel.sharingType = .readOnly
        // Beefier ambient shadow — the panel should *sit* in front of
        // the world. macOS clamps the radius, so we lean on the SwiftUI
        // shadow modifier inside HUDStatusView for the soft penumbra.
        panel.hasShadow = config.hasShadow
        panel.hidesOnDeactivate = config.hidesOnDeactivate
        panel.isReleasedWhenClosed = config.isReleasedWhenClosed
        panel.isMovableByWindowBackground = config.isMovableByWindowBackground
        panel.collectionBehavior = config.collectionBehavior
        panel.activatesOnMouseDown = config.activatesOnMouseDown
        panel.onKeyDown = config.onKeyDown
        if let appearance = config.appearance {
            panel.appearance = appearance
        }

        panel.contentView = hosting
        return panel
    }

    public static func position(_ window: NSWindow, placement: Placement) {
        let screen: NSScreen
        switch placement {
        case .mouseScreenCentered, .topCenter:
            screen = mouseScreen()
        case .centered:
            screen = NSScreen.main ?? mouseScreen()
        }

        let visibleFrame = screen.visibleFrame
        let size = window.frame.size
        let origin: NSPoint

        switch placement {
        case .centered(let yOffsetRatio), .mouseScreenCentered(let yOffsetRatio):
            origin = NSPoint(
                x: visibleFrame.midX - size.width / 2,
                y: visibleFrame.midY - size.height / 2 + (visibleFrame.height * yOffsetRatio)
            )
        case .topCenter(let margin):
            origin = NSPoint(
                x: visibleFrame.midX - size.width / 2,
                y: visibleFrame.maxY - size.height - margin
            )
        }

        window.setFrameOrigin(origin)
    }

    static func present(
        _ panel: NSPanel,
        activate: Bool = false,
        makeKey: Bool = true,
        orderFrontRegardless: Bool = true
    ) {
        if orderFrontRegardless {
            panel.orderFrontRegardless()
        } else if makeKey {
            panel.makeKeyAndOrderFront(nil)
        } else {
            panel.orderFront(nil)
        }

        if makeKey {
            panel.makeKey()
        }

        if activate {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private static func mouseScreen() -> NSScreen {
        let mouseLocation = NSEvent.mouseLocation
        return NSScreen.screens.first(where: { $0.frame.contains(mouseLocation) })
            ?? NSScreen.main
            ?? NSScreen.screens.first!
    }
}
