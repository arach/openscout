import ScoutCore
import SwiftUI

struct ScoutDetailView: View {
    let viewModel: ScoutShellViewModel

    var body: some View {
        switch viewModel.selectedRoute {
        case .home:
            ScoutDashboardView(viewModel: viewModel)
        case .sessions:
            ScoutNotesView(viewModel: viewModel)
        case .console:
            ScoutComposeView(viewModel: viewModel)
        case .integrations:
            ScoutWorkflowsView(viewModel: viewModel)
        case .workers:
            ScoutAgentDeskView(viewModel: viewModel)
        case .settings:
            ScoutSettingsView(viewModel: viewModel)
        }
    }
}
