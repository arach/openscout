import ScoutCore
import SwiftUI

struct ScoutDetailView: View {
    let viewModel: ScoutShellViewModel

    var body: some View {
        switch viewModel.selectedRoute {
        case .home:
            ScoutDashboardView(viewModel: viewModel)
        case .sessions:
            ScoutPlaceholderView(
                title: "Sessions",
                summary: "Shared session history, context, and playback will live here."
            )
        case .console:
            ScoutConsoleWorkspaceView(viewModel: viewModel)
        case .integrations:
            ScoutIntegrationsView(viewModel: viewModel)
        case .workers:
            ScoutWorkersView(viewModel: viewModel)
        case .settings:
            ScoutSettingsView(viewModel: viewModel)
        }
    }
}
