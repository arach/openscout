// SessionCardView — Grid card for the all-sessions view.
//
// Shows adapter icon, session name, status dot, relative time, and turn count.

import SwiftUI

struct SessionCardView: View {
    let summary: SessionSummary

    private var sessionStatus: SessionStatus {
        SessionStatus(rawValue: summary.status) ?? .idle
    }

    private var isStreaming: Bool {
        summary.currentTurnStatus == "streaming" || summary.currentTurnStatus == "started"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            HStack {
                Image(systemName: AdapterIcon.systemName(for: summary.adapterType))
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(ScoutColors.accent)

                Spacer()

                StatusDot(sessionStatus, size: 7)
            }

            Text(summary.name)
                .font(ScoutTypography.body(14, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            Spacer(minLength: 0)

            HStack(spacing: ScoutSpacing.xs) {
                if isStreaming {
                    PulseIndicator()
                    Text("Working")
                        .font(ScoutTypography.caption(11, weight: .medium))
                        .foregroundStyle(ScoutColors.statusStreaming)
                } else {
                    Text(RelativeTime.string(from: summary.lastActivityAt))
                        .font(ScoutTypography.caption(11))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                Spacer()

                if summary.turnCount > 0 {
                    Text("\(summary.turnCount)")
                        .font(ScoutTypography.caption(10, weight: .semibold))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(ScoutColors.surfaceAdaptive)
                        .clipShape(Capsule())
                }
            }
        }
        .scoutCard(padding: ScoutSpacing.md, cornerRadius: ScoutRadius.md)
        .frame(minHeight: 110)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(summary.name), \(AdapterIcon.displayName(for: summary.adapterType))")
        .accessibilityHint("Double tap to open session")
    }
}
