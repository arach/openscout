import ScoutCore
import SwiftUI

struct ScoutAppCommands: Commands {
    let viewModel: ScoutShellViewModel

    var body: some Commands {
        CommandMenu("Scout") {
            Button("Home") {
                viewModel.selectedRoute = .home
            }

            Button("Open Notes") {
                viewModel.selectedRoute = .sessions
            }

            Button("Open Compose") {
                viewModel.selectedRoute = .console
            }

            Button("Open Workflows") {
                viewModel.selectedRoute = .integrations
            }

            Button("Open Agent Desk") {
                viewModel.selectedRoute = .workers
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
