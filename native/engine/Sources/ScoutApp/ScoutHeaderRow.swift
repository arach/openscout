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
            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    viewModel.toggleSidebar()
                }
            } label: {
                HStack(spacing: 9) {
                    ScoutBrandMark(size: 24)

                    Text("OpenScout")
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        .textCase(.uppercase)
                        .tracking(0.4)
                        .foregroundStyle(ScoutTheme.ink)
                        .lineLimit(1)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer()

            headerActions
        }
        .frame(height: 32)
        .padding(.horizontal, 14)
        .background(
            Rectangle()
                .fill(ScoutTheme.chrome.opacity(0.985))
        )
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutTheme.border)
                .frame(height: 1)
        }
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
                    Label("NEW", systemImage: "square.and.pencil")
                }
                .buttonStyle(ScoutHeaderToolbarButtonStyle())
                .help("Start a new relay message")

                Button {
                    Task {
                        await viewModel.refreshWorkersNow()
                    }
                } label: {
                    Label("RELOAD", systemImage: "arrow.clockwise")
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
                .font(.system(size: 8, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(ScoutTheme.inkFaint)

            Text(label)
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(ScoutTheme.ink)
        }
    }
}

private struct ScoutIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(ScoutTheme.inkMuted)
            .frame(width: 26, height: 22)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(configuration.isPressed ? ScoutTheme.hover : Color.clear)
            )
    }
}

private struct ScoutHeaderToolbarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 9, weight: .medium, design: .monospaced))
            .textCase(.uppercase)
            .foregroundStyle(ScoutTheme.ink)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 999, style: .continuous)
                    .fill(ScoutTheme.surfaceStrong)
                    .overlay(
                        RoundedRectangle(cornerRadius: 999, style: .continuous)
                            .strokeBorder(ScoutTheme.border.opacity(0.7), lineWidth: 0.75)
                    )
            )
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}
