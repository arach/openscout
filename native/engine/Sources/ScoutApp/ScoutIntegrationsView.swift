import ScoutCore
import SwiftUI

struct ScoutIntegrationsView: View {
    let viewModel: ScoutShellViewModel

    var body: some View {
        List {
            Section("Integration Strategy") {
                Text("Scout starts by linking strong existing apps, then embeds shared primitives only when the capability is clearly cross-cutting.")
            }

            Section("Current Modules") {
                ForEach(viewModel.modules) { module in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(module.name)
                                .font(.headline)

                            Spacer()

                            Text(module.integrationMode.title)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Text(module.summary)
                            .foregroundStyle(.secondary)

                        Text(module.capabilities.joined(separator: " • "))
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }
            }
        }
    }
}
