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

    var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 3) {
                Text(viewModel.selectedRoute.title)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(ScoutTheme.ink)

                Text(statusLine)
                    .font(.system(size: 12))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            }

            Spacer()

            headerActions
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 11)
        .background(
            Rectangle()
                .fill(ScoutTheme.chrome.opacity(0.98))
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
            return "\(viewModel.relayMessages.count) messages · \(viewModel.agentProfiles.count) agents · \(viewModel.relayTransportMode.title.lowercased())"
        }

        if let lastHeartbeat = viewModel.supervisor.lastHeartbeat {
            return "Last heartbeat \(lastHeartbeat.formatted(date: .omitted, time: .shortened))"
        }

        return viewModel.supervisor.detail
    }

    @ViewBuilder
    private var headerActions: some View {
        HStack(spacing: 8) {
            RuntimePill(
                label: viewModel.supervisor.state.title,
                detail: "Helper",
                color: helperColor
            )

            if viewModel.selectedRoute == .workers {
                Button {
                    viewModel.prepareNewRelayMessage()
                } label: {
                    Label("New", systemImage: "square.and.pencil")
                }
                .buttonStyle(ScoutButtonStyle(tone: .quiet))
                .help("Start a new relay message")

                Button {
                    Task {
                        await viewModel.refreshRelayNow()
                    }
                } label: {
                    Label("Reload", systemImage: "arrow.clockwise")
                }
                .buttonStyle(ScoutButtonStyle(tone: .quiet))
                .help("Refresh relay")
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

private struct RuntimePill: View {
    let label: String
    let detail: String
    let color: Color

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)

            Text(detail)
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(ScoutTheme.inkFaint)

            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(ScoutTheme.ink)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(ScoutTheme.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .strokeBorder(ScoutTheme.border.opacity(0.5), lineWidth: 0.75)
                )
        )
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
