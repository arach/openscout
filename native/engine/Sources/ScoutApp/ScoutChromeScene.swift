import ScoutCore
import SwiftUI

struct ScoutChromeScene: View {
    @Bindable var viewModel: ScoutShellViewModel

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ScoutSidebarView(viewModel: viewModel)
                    .frame(width: viewModel.sidebarWidth)
                    .animation(.easeInOut(duration: 0.18), value: viewModel.sidebarExpanded)

                Rectangle()
                    .fill(ScoutTheme.border)
                    .frame(width: 1)

                VStack(spacing: 0) {
                    ScoutHeaderRow(viewModel: viewModel)
                    ScoutDetailView(viewModel: viewModel)
                }
                .background(ScoutTheme.canvas)
            }
            .background(ScoutTheme.canvas)
            .overlay(alignment: .topLeading) {
                ScoutSidebarTooltipOverlay()
            }

            ScoutStatusBarView(viewModel: viewModel)
        }
        .background(ScoutTheme.canvas)
        .task {
            viewModel.start()
        }
    }
}
