import SwiftUI

@main
struct ScoutApp: App {
    @State private var viewModel = ScoutShellViewModel()

    var body: some Scene {
        WindowGroup("OpenScout") {
            ScoutChromeScene(viewModel: viewModel)
                .frame(minWidth: 1120, minHeight: 720)
                .preferredColorScheme(.dark)
        }
        .commands {
            ScoutAppCommands(viewModel: viewModel)
        }
    }
}
