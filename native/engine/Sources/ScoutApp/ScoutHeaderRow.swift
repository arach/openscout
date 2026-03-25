import SwiftUI

struct ScoutHeaderRow: View {
    let viewModel: ScoutShellViewModel

    private var helperColor: Color {
        switch viewModel.supervisor.state {
        case .running:
            return ScoutTheme.success
        case .launching:
            return ScoutTheme.accent
        case .degraded:
            return ScoutTheme.warning
        case .failed:
            return .red
        case .stopped:
            return ScoutTheme.inkMuted
        }
    }

    private var brokerColor: Color {
        switch viewModel.brokerSupervisor.state {
        case .running:
            return ScoutTheme.success
        case .launching:
            return ScoutTheme.accent
        case .degraded:
            return ScoutTheme.warning
        case .failed:
            return .red
        case .stopped:
            return ScoutTheme.inkMuted
        }
    }

    private var meshColor: Color {
        switch viewModel.meshDiscoveryState {
        case .ready where viewModel.meshKnownNodeCount > 0:
            return ScoutTheme.success
        case .scanning:
            return ScoutTheme.accent
        case .failed:
            return ScoutTheme.warning
        case .ready, .inactive, .unavailable:
            return ScoutTheme.inkMuted
        }
    }

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(viewModel.selectedRoute.title)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(ScoutTheme.ink)

                Text(statusLine)
                    .font(.system(size: 11))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            }

            Spacer()

            headerActions
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 9)
        .background(
            Rectangle()
                .fill(ScoutTheme.surfaceStrong.opacity(0.98))
        )
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutTheme.border)
                .frame(height: 1)
        }
    }

    private var statusLine: String {
        if viewModel.selectedRoute == .home {
            return "\(viewModel.notes.count) notes · \(viewModel.drafts.count) drafts · \(viewModel.workflowRuns.count) runs"
        }

        if viewModel.selectedRoute == .workers {
            return "\(viewModel.relayMessages.count) messages · \(viewModel.agentProfiles.count) agents · \(viewModel.meshStatusLine)"
        }

        if let lastHeartbeat = viewModel.supervisor.lastHeartbeat {
            return "Last heartbeat \(lastHeartbeat.formatted(date: .omitted, time: .shortened))"
        }

        return viewModel.supervisor.detail
    }

    @ViewBuilder
    private var headerActions: some View {
        HStack(spacing: 9) {
            RuntimeStatusInline(
                label: viewModel.supervisor.state.title,
                detail: "Helper",
                color: helperColor
            )

            RuntimeStatusInline(
                label: viewModel.brokerSupervisor.state.title,
                detail: "Broker",
                color: brokerColor
            )

            if viewModel.selectedRoute == .workers {
                RuntimeStatusInline(
                    label: viewModel.meshStatusTitle,
                    detail: "Mesh",
                    color: meshColor
                )

                Button {
                    viewModel.prepareNewRelayMessage()
                } label: {
                    Label("New", systemImage: "square.and.pencil")
                }
                .buttonStyle(ScoutHeaderToolbarButtonStyle())
                .help("Start a new relay message")

                Button {
                    Task {
                        await viewModel.refreshWorkersNow()
                    }
                } label: {
                    Label("Reload", systemImage: "arrow.clockwise")
                }
                .buttonStyle(ScoutHeaderToolbarButtonStyle())
                .help("Refresh relay and mesh")
            } else {
                Button {
                    viewModel.selectedRoute = .console
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .buttonStyle(ScoutIconButtonStyle())
                .help("Open Compose")

                Button {
                    viewModel.supervisor.restart()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .buttonStyle(ScoutIconButtonStyle())
                .help("Restart Helper")
            }
        }
    }
}

private struct RuntimeStatusInline: View {
    let label: String
    let detail: String
    let color: Color

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 5, height: 5)

            Text(detail)
                .font(.system(size: 8.5, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(ScoutTheme.inkFaint)

            Text(label)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(ScoutTheme.ink)
        }
    }
}

private struct ScoutIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(ScoutTheme.inkMuted)
            .frame(width: 30, height: 28)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(configuration.isPressed ? ScoutTheme.hover : Color.clear)
            )
    }
}

private struct ScoutHeaderToolbarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(ScoutTheme.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(ScoutTheme.surfaceStrong)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(ScoutTheme.border.opacity(0.7), lineWidth: 0.75)
                    )
            )
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
