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
        ZStack {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(viewModel.selectedRoute.title)
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .textCase(.uppercase)
                        .tracking(1.4)
                        .foregroundStyle(ScoutTheme.inkMuted)

                    Text(statusLine)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(ScoutTheme.inkSecondary)
                }

                Spacer()

                HStack(spacing: 8) {
                    RuntimePill(
                        label: viewModel.supervisor.state.title,
                        detail: "Helper",
                        color: helperColor
                    )

                    Button {
                        viewModel.selectedRoute = .console
                    } label: {
                        Image(systemName: "globe")
                    }
                    .buttonStyle(ScoutIconButtonStyle())
                    .help("Open Workspace")

                    Button {
                        viewModel.supervisor.restart()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(ScoutIconButtonStyle())
                    .help("Restart Helper")
                }
            }

            VStack(spacing: 2) {
                Text("OPENSCOUT")
                    .font(.system(size: 15, weight: .semibold))
                    .tracking(-0.1)
                    .foregroundStyle(ScoutTheme.ink)

                Text(viewModel.selectedRoute.summary)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .tracking(0.7)
                    .foregroundStyle(ScoutTheme.inkMuted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .background(
            Rectangle()
                .fill(ScoutTheme.surfaceStrong.opacity(0.88))
        )
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutTheme.border)
                .frame(height: 1)
        }
    }

    private var statusLine: String {
        if let lastHeartbeat = viewModel.supervisor.lastHeartbeat {
            return "Last heartbeat \(lastHeartbeat.formatted(date: .omitted, time: .shortened))"
        }

        return viewModel.supervisor.detail
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
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(ScoutTheme.inkFaint)

            Text(label)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(ScoutTheme.inkSecondary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(ScoutTheme.surface.opacity(0.75))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(ScoutTheme.border, lineWidth: 1)
                )
        )
    }
}

private struct ScoutIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(ScoutTheme.inkMuted)
            .frame(width: 28, height: 26)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(configuration.isPressed ? ScoutTheme.hover : Color.clear)
            )
    }
}
