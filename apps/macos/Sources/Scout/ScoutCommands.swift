import AppKit
import ScoutHUD
import SwiftUI

enum ScoutAppCommand: String {
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
            Button("New Conversation") {
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

        CommandMenu("Comms") {
            Button("Refresh") {
                ScoutAppCommand.refresh.post()
            }
            .keyboardShortcut("r", modifiers: .command)

            Divider()

            Button("Show All Chats") {
                guard !selectHUDTabIfVisible(.agents) else { return }
                ScoutAppCommand.filterAll.post()
            }
            .keyboardShortcut("1", modifiers: .command)

            Button("Show Direct Chats") {
                guard !selectHUDTabIfVisible(.activity) else { return }
                ScoutAppCommand.filterDirect.post()
            }
            .keyboardShortcut("2", modifiers: .command)

            Button("Show Shared Chats") {
                guard !selectHUDTabIfVisible(.tail) else { return }
                ScoutAppCommand.filterShared.post()
            }
            .keyboardShortcut("3", modifiers: .command)

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
    var handler: (NSEvent) -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(isActive: isActive, handler: handler)
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
        var handler: (NSEvent) -> Bool
        private var monitor: Any?

        init(isActive: Bool, handler: @escaping (NSEvent) -> Bool) {
            self.isActive = isActive
            self.handler = handler
        }

        deinit {
            uninstall()
        }

        func install() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
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
