import ScoutCore
import SwiftUI

struct ScoutDashboardView: View {
    let viewModel: ScoutShellViewModel

    var body: some View {
        ScoutPage {
            ScoutPageHeader(
                eyebrow: "Overview",
                title: "Local shell baseline",
                subtitle: "A quieter starting point for Scout. Shell and helper are live; deeper capability routing comes next."
            )

            HStack(alignment: .top, spacing: 28) {
                mainColumn
                runtimeColumn
            }
        }
    }

    private var mainColumn: some View {
        VStack(alignment: .leading, spacing: 28) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Scout brings voice, workspace, and execution tools into one shell.")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(ScoutTheme.ink)
                    .frame(maxWidth: 620, alignment: .leading)

                HStack(spacing: 10) {
                    Button("Open Workspace") {
                        viewModel.selectedRoute = .console
                    }
                    .buttonStyle(ScoutButtonStyle(tone: .primary))

                    Button("Workers") {
                        viewModel.selectedRoute = .workers
                    }
                    .buttonStyle(ScoutButtonStyle())
                }
            }

            VStack(alignment: .leading, spacing: 12) {
                ScoutSubsectionHeader("Modules")

                ForEach(viewModel.modules) { module in
                    ModuleLine(module: module)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var runtimeColumn: some View {
        VStack(alignment: .leading, spacing: 18) {
            ScoutSubsectionHeader("Runtime")

            RuntimeBlock(label: "Helper", value: viewModel.supervisor.state.title)
            RuntimeBlock(label: "Support", value: "Local")
            RuntimeBlock(label: "Modules", value: "\(viewModel.modules.count)")

            if let lastHeartbeat = viewModel.supervisor.lastHeartbeat {
                RuntimeMeta(
                    label: "Last heartbeat",
                    value: lastHeartbeat.formatted(date: .omitted, time: .shortened)
                )
            }
        }
        .frame(width: 220, alignment: .leading)
    }
}

private struct ModuleLine: View {
    let module: ScoutModule

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(module.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(ScoutTheme.ink)

                    Text(module.integrationMode.title.uppercased())
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .tracking(0.8)
                        .foregroundStyle(ScoutTheme.inkFaint)
                }

                Text(module.summary)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutTheme.border)
                .frame(height: 1)
        }
    }
}

private struct RuntimeBlock: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .tracking(0.9)
                .foregroundStyle(ScoutTheme.inkFaint)

            Text(value)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(ScoutTheme.ink)
        }
        .padding(.bottom, 6)
    }
}

private struct RuntimeMeta: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                .tracking(0.9)
                .foregroundStyle(ScoutTheme.inkFaint)

            Text(value)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(ScoutTheme.inkMuted)
                .monospacedDigit()
        }
        .padding(.top, 4)
    }
}
