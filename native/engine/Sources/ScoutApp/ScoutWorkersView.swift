import SwiftUI

struct ScoutWorkersView: View {
    let viewModel: ScoutShellViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Workers")
                .font(.largeTitle)
                .fontWeight(.semibold)

            Text("Scout starts with one dependable helper process. More workers can hang off the same supervision model later.")
                .foregroundStyle(.secondary)

            GroupBox {
                VStack(alignment: .leading, spacing: 10) {
                    LabeledContent("Name", value: "ScoutAgent")
                    LabeledContent("State", value: viewModel.supervisor.state.title)
                    LabeledContent("PID", value: viewModel.supervisor.processIdentifier.map(String.init) ?? "—")
                    LabeledContent("Detail", value: viewModel.supervisor.detail)

                    if let lastHeartbeat = viewModel.supervisor.lastHeartbeat {
                        LabeledContent("Last Heartbeat", value: lastHeartbeat.formatted(date: .abbreviated, time: .standard))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack {
                Button("Restart Helper") {
                    viewModel.supervisor.restart()
                }

                Button("Stop Helper") {
                    viewModel.supervisor.stop()
                }

                Button("Open Support Directory") {
                    viewModel.supervisor.openSupportDirectory()
                }
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(24)
    }
}
