import ScoutCore
import SwiftUI

struct ScoutChromeScene: View {
    @Bindable var viewModel: ScoutShellViewModel

    var body: some View {
        VStack(spacing: 0) {
            ScoutHeaderRow(viewModel: viewModel)

            HStack(alignment: .top, spacing: 0) {
                ScoutSidebarView(viewModel: viewModel)
                    .frame(width: viewModel.sidebarWidth)
                    .animation(.easeInOut(duration: 0.18), value: viewModel.sidebarExpanded)

                Rectangle()
                    .fill(ScoutTheme.border)
                    .frame(width: 1)

                ScoutDetailView(viewModel: viewModel)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(ScoutTheme.canvas)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(ScoutTheme.canvas)
            .overlay(alignment: .topLeading) {
                ScoutSidebarTooltipOverlay()
            }

            ScoutStatusBarView(viewModel: viewModel)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ScoutTheme.canvas)
        .task {
            viewModel.start()
        }
    }
}
