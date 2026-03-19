import ScoutCore
import SwiftUI

struct ScoutAppCommands: Commands {
    let viewModel: ScoutShellViewModel

    var body: some Commands {
        CommandMenu("Scout") {
            Button("Home") {
                viewModel.selectedRoute = .home
            }

            Button("Open Console") {
                viewModel.selectedRoute = .console
            }

            Divider()

            Button("Restart Helper") {
                viewModel.supervisor.restart()
            }

            Button("Open Support Directory") {
                viewModel.supervisor.openSupportDirectory()
            }
        }
    }
}
