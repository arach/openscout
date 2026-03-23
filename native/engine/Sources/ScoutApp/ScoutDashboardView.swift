import ScoutCore
import SwiftUI

struct ScoutDashboardView: View {
    let viewModel: ScoutShellViewModel

    var body: some View {
        ScoutPage {
            ScoutPageHeader(
                eyebrow: "Overview",
                title: "Agent Interaction Shell",
                subtitle: "OpenScout now centers notes, compose, prompt workflows, and relay handoff so the shell can actually help an end user work with agents."
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
                Text("Scout turns loose context into reusable notes, structured briefs, and agent-ready workflow packets.")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(ScoutTheme.ink)
                    .frame(maxWidth: 620, alignment: .leading)

                HStack(spacing: 10) {
                    Button("Compose Brief") {
                        viewModel.selectedRoute = .console
                    }
                    .buttonStyle(ScoutButtonStyle(tone: .primary))

                    Button("Open Notes") {
                        viewModel.selectedRoute = .sessions
                    }
                    .buttonStyle(ScoutButtonStyle())

                    Button("Agent Desk") {
                        viewModel.selectedRoute = .workers
                    }
                    .buttonStyle(ScoutButtonStyle())
                }
            }

            HStack(alignment: .top, spacing: 18) {
                summaryCard(
                    title: "Notes",
                    value: "\(viewModel.notes.count)",
                    detail: "Persistent context objects ready for prompt reuse."
                )

                summaryCard(
                    title: "Drafts",
                    value: "\(viewModel.drafts.count)",
                    detail: "Compose packets currently being shaped for agents."
                )

                summaryCard(
                    title: "Runs",
                    value: "\(viewModel.workflowRuns.count)",
                    detail: "Generated workflow packets with inspectable history."
                )
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
            RuntimeBlock(label: "Relay", value: viewModel.relayMessages.isEmpty ? "Quiet" : "Active")
            RuntimeBlock(label: "Agents", value: "\(viewModel.agentProfiles.count)")

            if let lastHeartbeat = viewModel.supervisor.lastHeartbeat {
                RuntimeMeta(
                    label: "Last heartbeat",
                    value: lastHeartbeat.formatted(date: .omitted, time: .shortened)
                )
            }

            if let latestMessage = viewModel.relayMessages.last {
                RuntimeMeta(
                    label: "Latest relay",
                    value: "\(latestMessage.from) · \(Date(timeIntervalSince1970: TimeInterval(latestMessage.timestamp)).formatted(date: .omitted, time: .shortened))"
                )
            }
        }
        .frame(width: 220, alignment: .leading)
    }

    private func summaryCard(title: String, value: String, detail: String) -> some View {
        ScoutSurface {
            VStack(alignment: .leading, spacing: 8) {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .tracking(0.8)
                    .foregroundStyle(ScoutTheme.inkFaint)

                Text(value)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(ScoutTheme.ink)

                Text(detail)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
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
