// SessionRowView — Individual session row in the session list.
//
// Shows adapter icon, session name, status dot, turn count, and relative timestamp.
// Animated streaming indicator when a turn is active.

import SwiftUI

struct SessionRowView: View {
    let summary: SessionSummary

    private var sessionStatus: SessionStatus {
        SessionStatus(rawValue: summary.status) ?? .idle
    }

    private var isStreaming: Bool {
        summary.currentTurnStatus == "streaming" || summary.currentTurnStatus == "started"
    }

    var body: some View {
        HStack(spacing: PlexusSpacing.md) {
            adapterBadge
            details
            Spacer()
            trailing
        }
        .padding(.vertical, PlexusSpacing.sm)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(summary.name), \(AdapterIcon.displayName(for: summary.adapterType)), \(sessionStatus.rawValue)")
        .accessibilityHint("Double tap to open session")
    }

    // MARK: - Adapter Badge

    private var adapterBadge: some View {
        ZStack {
            RoundedRectangle(cornerRadius: PlexusRadius.sm, style: .continuous)
                .fill(PlexusColors.accent.opacity(0.12))
                .frame(width: 38, height: 38)

            Image(systemName: AdapterIcon.systemName(for: summary.adapterType))
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(PlexusColors.accent)
        }
    }

    // MARK: - Details

    private var details: some View {
        VStack(alignment: .leading, spacing: PlexusSpacing.xxs) {
            HStack(spacing: PlexusSpacing.sm) {
                Text(summary.name)
                    .font(PlexusTypography.body(15, weight: .semibold))
                    .foregroundStyle(PlexusColors.textPrimary)
                    .lineLimit(1)

                StatusDot(sessionStatus, size: 7)
            }

            HStack(spacing: PlexusSpacing.xs) {
                Text(AdapterIcon.displayName(for: summary.adapterType))
                    .font(PlexusTypography.caption(12))
                    .foregroundStyle(PlexusColors.textMuted)

                if isStreaming {
                    HStack(spacing: PlexusSpacing.xxs) {
                        PulseIndicator()
                        Text("Working")
                            .font(PlexusTypography.caption(12, weight: .medium))
                            .foregroundStyle(PlexusColors.statusStreaming)
                    }
                }
            }
        }
    }

    // MARK: - Trailing

    private var trailing: some View {
        VStack(alignment: .trailing, spacing: PlexusSpacing.xs) {
            Text(RelativeTime.string(from: summary.lastActivityAt))
                .font(PlexusTypography.caption(11))
                .foregroundStyle(PlexusColors.textMuted)

            if summary.turnCount > 0 {
                Text("\(summary.turnCount)")
                    .font(PlexusTypography.caption(11, weight: .semibold))
                    .foregroundStyle(PlexusColors.textSecondary)
                    .padding(.horizontal, PlexusSpacing.sm)
                    .padding(.vertical, PlexusSpacing.xxs)
                    .background(PlexusColors.surfaceAdaptive)
                    .clipShape(Capsule())
                    .accessibilityLabel("\(summary.turnCount) turns")
            }
        }
    }
}

// MARK: - Preview

#Preview {
    List {
        SessionRowView(summary: SessionSummary(
            sessionId: "s1", name: "Refactor auth module",
            adapterType: "claude-code", status: "active",
            turnCount: 12, currentTurnStatus: "streaming",
            startedAt: Int(Date().addingTimeInterval(-3600).timeIntervalSince1970 * 1000),
            lastActivityAt: Int(Date().addingTimeInterval(-30).timeIntervalSince1970 * 1000)
        ))

        SessionRowView(summary: SessionSummary(
            sessionId: "s2", name: "Debug API endpoint",
            adapterType: "openai", status: "idle",
            turnCount: 5, currentTurnStatus: nil,
            startedAt: Int(Date().addingTimeInterval(-7200).timeIntervalSince1970 * 1000),
            lastActivityAt: Int(Date().addingTimeInterval(-600).timeIntervalSince1970 * 1000)
        ))

        SessionRowView(summary: SessionSummary(
            sessionId: "s3", name: "Write unit tests",
            adapterType: "claude-code", status: "error",
            turnCount: 3, currentTurnStatus: "failed",
            startedAt: Int(Date().addingTimeInterval(-1800).timeIntervalSince1970 * 1000),
            lastActivityAt: Int(Date().addingTimeInterval(-120).timeIntervalSince1970 * 1000)
        ))
    }
    .listStyle(.plain)
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}
