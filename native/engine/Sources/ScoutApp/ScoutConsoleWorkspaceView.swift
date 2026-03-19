import SwiftUI

struct ScoutConsoleWorkspaceView: View {
    let viewModel: ScoutShellViewModel

    var body: some View {
        HSplitView {
            ScoutWebConsoleView(consoleURL: viewModel.consoleURL)
                .frame(minWidth: 760, minHeight: 500)

            VStack(alignment: .leading, spacing: 16) {
                Text("Runtime")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(ScoutTheme.ink)

                LabeledContent("Helper State", value: viewModel.supervisor.state.title)
                LabeledContent("Helper Detail", value: viewModel.supervisor.detail)
                LabeledContent("Support Path", value: viewModel.supportPaths.applicationSupportDirectory.path(percentEncoded: false))

                if let lastHeartbeat = viewModel.supervisor.lastHeartbeat {
                    LabeledContent("Last Heartbeat", value: lastHeartbeat.formatted(date: .abbreviated, time: .standard))
                }

                Spacer()

                HStack {
                    Button("Restart Helper") {
                        viewModel.supervisor.restart()
                    }
                    .buttonStyle(ScoutButtonStyle(tone: .primary))

                    Button("Open Settings") {
                        viewModel.selectedRoute = .settings
                    }
                    .buttonStyle(ScoutButtonStyle())
                }
            }
            .padding(20)
            .frame(minWidth: 280)
            .background(ScoutTheme.surfaceStrong)
        }
        .padding(24)
        .background(ScoutTheme.canvas)
    }
}
