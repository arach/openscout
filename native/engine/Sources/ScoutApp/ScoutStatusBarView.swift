import SwiftUI

struct ScoutStatusBarView: View {
    let viewModel: ScoutShellViewModel

    var body: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(ScoutTheme.border)
                .frame(height: 1)

            HStack(spacing: 8) {
                Image(systemName: viewModel.selectedRoute.systemImage)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkFaint)

                Text(viewModel.selectedRoute.title)
                    .font(.system(size: 11))
                    .foregroundStyle(ScoutTheme.inkMuted)

                Circle()
                    .fill(statusColor)
                    .frame(width: 5, height: 5)

                Text(viewModel.supervisor.state.title)
                    .font(.system(size: 11))
                    .foregroundStyle(ScoutTheme.inkMuted)

                Spacer()

                Text("OpenScout")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(ScoutTheme.inkFaint)

                if let lastHeartbeat = viewModel.supervisor.lastHeartbeat {
                    Text(lastHeartbeat.formatted(date: .omitted, time: .shortened))
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(ScoutTheme.inkFaint)
                        .monospacedDigit()
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(ScoutTheme.chrome.opacity(0.96))
        }
    }

    private var statusColor: Color {
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
            return ScoutTheme.inkFaint
        }
    }
}
