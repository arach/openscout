import AppKit
import ScoutHUD
import SwiftUI
import WebKit

#if HUDSON_TERMINAL
import Termini
#endif

enum ScoutAppCommand: RawRepresentable {
    case newConversation
    case moveDown
    case moveUp
    case focusSearch
    case focusComposer
    case refresh
    case filterAll
    case filterDirect
    case filterShared
    case observeSelectedAgent
    case openSelectedAgentChannel
    case toggleCheatsheet
    case toggleDesignPreview
    case openSettings
    /// ⌘1…⌘9 — the Nth most recent conversation.
    case jumpToRecent(Int)
    /// The `g`-chord destinations, also reachable from the Go menu.
    case goToSection(ScoutSection)

    private static let jumpPrefix = "jumpToRecent:"
    private static let goPrefix = "goToSection:"

    var rawValue: String {
        switch self {
        case .newConversation: return "newConversation"
        case .moveDown: return "moveDown"
        case .moveUp: return "moveUp"
        case .focusSearch: return "focusSearch"
        case .focusComposer: return "focusComposer"
        case .refresh: return "refresh"
        case .filterAll: return "filterAll"
        case .filterDirect: return "filterDirect"
        case .filterShared: return "filterShared"
        case .observeSelectedAgent: return "observeSelectedAgent"
        case .openSelectedAgentChannel: return "openSelectedAgentChannel"
        case .toggleCheatsheet: return "toggleCheatsheet"
        case .toggleDesignPreview: return "toggleDesignPreview"
        case .openSettings: return "openSettings"
        case .jumpToRecent(let ordinal): return "\(Self.jumpPrefix)\(ordinal)"
        case .goToSection(let section): return "\(Self.goPrefix)\(section.rawValue)"
        }
    }

    init?(rawValue: String) {
        if rawValue.hasPrefix(Self.jumpPrefix) {
            guard let ordinal = Int(rawValue.dropFirst(Self.jumpPrefix.count)) else { return nil }
            self = .jumpToRecent(ordinal)
            return
        }
        if rawValue.hasPrefix(Self.goPrefix) {
            guard let section = ScoutSection(rawValue: String(rawValue.dropFirst(Self.goPrefix.count))) else {
                return nil
            }
            self = .goToSection(section)
            return
        }
        switch rawValue {
        case "newConversation": self = .newConversation
        case "moveDown": self = .moveDown
        case "moveUp": self = .moveUp
        case "focusSearch": self = .focusSearch
        case "focusComposer": self = .focusComposer
        case "refresh": self = .refresh
        case "filterAll": self = .filterAll
        case "filterDirect": self = .filterDirect
        case "filterShared": self = .filterShared
        case "observeSelectedAgent": self = .observeSelectedAgent
        case "openSelectedAgentChannel": self = .openSelectedAgentChannel
        case "toggleCheatsheet": self = .toggleCheatsheet
        case "toggleDesignPreview": self = .toggleDesignPreview
        case "openSettings": self = .openSettings
        default: return nil
        }
    }

    func post() {
        NotificationCenter.default.post(name: .scoutAppCommand, object: rawValue)
    }

    init?(notification: Notification) {
        guard let rawValue = notification.object as? String else { return nil }
        self.init(rawValue: rawValue)
    }
}

extension Notification.Name {
    static let scoutAppCommand = Notification.Name("app.openscout.scout.command")
}

@MainActor
enum ScoutKeyboardInputContext {
    /// App-level key monitors must never consume input owned by an embedded
    /// terminal. WebKit makes its private content view first responder rather
    /// than the WKWebView itself, so walk both the responder and view trees.
    static func isTerminalInput(for event: NSEvent) -> Bool {
        containsTerminalInput(event.window?.firstResponder)
            || containsTerminalInput(NSApp.keyWindow?.firstResponder)
    }

    private static func containsTerminalInput(_ responder: NSResponder?) -> Bool {
        var current = responder
        while let candidate = current {
            if isTerminalView(candidate) {
                return true
            }
            if let view = candidate as? NSView, hasTerminalSuperview(view) {
                return true
            }
            current = candidate.nextResponder
        }
        return false
    }

    private static func hasTerminalSuperview(_ view: NSView) -> Bool {
        var current: NSView? = view
        while let candidate = current {
            if isTerminalView(candidate) {
                return true
            }
            current = candidate.superview
        }
        return false
    }

    private static func isTerminalView(_ responder: NSResponder) -> Bool {
        if responder is WKWebView {
            return true
        }
        #if HUDSON_TERMINAL
        if responder is SurfaceContainerView {
            return true
        }
        #endif
        return false
    }
}

@MainActor
private func selectHUDTabIfVisible(_ view: HUDView) -> Bool {
    guard HUDController.shared.isVisible else { return false }
    HUDState.shared.select(view)
    return true
}

struct ScoutCommands: Commands {
    @ObservedObject private var updater = ScoutUpdater.shared

    var body: some Commands {
        CommandGroup(after: .appInfo) {
            Button("Check for Updates…") {
                updater.checkForUpdates()
            }
            .disabled(!updater.canCheckForUpdates)
        }

        CommandGroup(after: .newItem) {
            Button("New") {
                ScoutAppCommand.newConversation.post()
            }
            .keyboardShortcut("n", modifiers: .command)
        }

        CommandGroup(replacing: .appSettings) {
            Button("Settings...") {
                ScoutAppCommand.openSettings.post()
            }
            .keyboardShortcut(",", modifiers: .command)
        }

        CommandMenu("Navigate") {
            Button("Next Item") {
                ScoutAppCommand.moveDown.post()
            }
            .keyboardShortcut(.downArrow, modifiers: .command)

            Button("Previous Item") {
                ScoutAppCommand.moveUp.post()
            }
            .keyboardShortcut(.upArrow, modifiers: .command)

            Button("Open Selection") {
                ScoutAppCommand.openSelectedAgentChannel.post()
            }
            .keyboardShortcut(.return, modifiers: .command)

            Divider()

            Button("Focus Search") {
                ScoutAppCommand.focusSearch.post()
            }
            .keyboardShortcut("k", modifiers: .command)

            Button("Focus Composer") {
                ScoutAppCommand.focusComposer.post()
            }
            .keyboardShortcut("l", modifiers: .command)
        }

        // The `g`-chord destinations, spelled out. The chord is the fast path;
        // this menu is how it gets discovered, and how it stays reachable from
        // the mouse. Chord letters ride in the titles because SwiftUI cannot
        // express a two-key sequence as a `keyboardShortcut`.
        CommandMenu("Go") {
            ForEach(ScoutKeyMap.destinations) { entry in
                Button("\(entry.section.title)    g \(entry.chord)") {
                    ScoutAppCommand.goToSection(entry.section).post()
                }
            }
        }

        // ⌘1…⌘9 — the macOS idiom for "nth thing", pointed at conversations.
        // Fires while typing, which is the point: you jump out of a chat from
        // inside it. ⌘1–3 still yield to the HUD's tabs when the HUD is up, so
        // that surface keeps the bindings it has always had.
        CommandMenu("Jump") {
            ForEach(1...ScoutKeyMap.jumpTargetCount, id: \.self) { ordinal in
                Button("Recent Conversation \(ordinal)") {
                    switch ordinal {
                    case 1 where selectHUDTabIfVisible(.focus): return
                    case 2 where selectHUDTabIfVisible(.threads): return
                    case 3 where selectHUDTabIfVisible(.tail): return
                    default: ScoutAppCommand.jumpToRecent(ordinal).post()
                    }
                }
                .keyboardShortcut(KeyEquivalent(Character("\(ordinal)")), modifiers: .command)
            }
        }

        CommandMenu("Comms") {
            Button("Refresh") {
                ScoutAppCommand.refresh.post()
            }
            .keyboardShortcut("r", modifiers: .command)

            Divider()

            // Relocated from ⌘1–3, which now carry the conversation jump.
            Button("Show All Chats") {
                ScoutAppCommand.filterAll.post()
            }
            .keyboardShortcut("1", modifiers: [.command, .option])

            Button("Show Direct Chats") {
                ScoutAppCommand.filterDirect.post()
            }
            .keyboardShortcut("2", modifiers: [.command, .option])

            Button("Show Shared Chats") {
                ScoutAppCommand.filterShared.post()
            }
            .keyboardShortcut("3", modifiers: [.command, .option])

            Divider()

            Button("Observe Agent") {
                ScoutAppCommand.observeSelectedAgent.post()
            }
            .keyboardShortcut("o", modifiers: .command)
        }

        CommandMenu("Scout") {
            Button("Keyboard Shortcuts") {
                ScoutAppCommand.toggleCheatsheet.post()
            }
            .keyboardShortcut("/", modifiers: .command)

            #if DEBUG
            Button("Design Preview") {
                ScoutAppCommand.toggleDesignPreview.post()
            }
            .keyboardShortcut("d", modifiers: [.command, .shift])
            #endif
        }
    }
}

struct ScoutKeyboardEventMonitor: NSViewRepresentable {
    var isActive: Bool
    /// Which events to intercept. `.keyDown` for bindings; `.flagsChanged` for
    /// the held-modifier reveals, which never produce a key event at all.
    var mask: NSEvent.EventTypeMask = .keyDown
    var handler: (NSEvent) -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(isActive: isActive, mask: mask, handler: handler)
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        context.coordinator.install()
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        context.coordinator.isActive = isActive
        context.coordinator.handler = handler
        context.coordinator.install()
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    final class Coordinator {
        var isActive: Bool
        let mask: NSEvent.EventTypeMask
        var handler: (NSEvent) -> Bool
        private var monitor: Any?

        init(isActive: Bool, mask: NSEvent.EventTypeMask, handler: @escaping (NSEvent) -> Bool) {
            self.isActive = isActive
            self.mask = mask
            self.handler = handler
        }

        deinit {
            uninstall()
        }

        func install() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: mask) { [weak self] event in
                guard let self else { return event }
                guard self.isActive else { return event }
                return self.handler(event) ? nil : event
            }
        }

        func uninstall() {
            if let monitor {
                NSEvent.removeMonitor(monitor)
            }
            monitor = nil
        }
    }
}
