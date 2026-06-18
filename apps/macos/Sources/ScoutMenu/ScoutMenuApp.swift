import SwiftUI

@main
struct ScoutMenuApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        Settings {
            SettingsRootView(controller: OpenScoutAppController.shared)
                .frame(width: 720, height: 540)
                .preferredColorScheme(.dark)
        }
        .commands {
            CommandGroup(replacing: .appSettings) {
                Button("Settings...") {
                    SettingsWindowController.shared.show(controller: OpenScoutAppController.shared)
                }
                .keyboardShortcut(",", modifiers: .command)
            }
        }
    }
}
