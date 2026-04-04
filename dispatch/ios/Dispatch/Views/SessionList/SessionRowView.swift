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

    private var projectLabel: String? {
        guard let project = summary.project?.trimmingCharacters(in: .whitespacesAndNewlines),
              !project.isEmpty else {
            return nil
        }
        return project
    }

    private var modelDescriptor: DispatchModelDescriptor? {
        DispatchModelLabel.describe(summary.model)
    }

    var body: some View {
        HStack(spacing: DispatchSpacing.md) {
            adapterBadge
            details
            Spacer()
            trailing
        }
        .padding(.vertical, DispatchSpacing.sm)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Double tap to open session")
    }

    // MARK: - Adapter Badge

    private var adapterBadge: some View {
        ZStack {
            RoundedRectangle(cornerRadius: DispatchRadius.sm, style: .continuous)
                .fill(DispatchColors.accent.opacity(0.12))
                .frame(width: 38, height: 38)

            Image(systemName: AdapterIcon.systemName(for: summary.adapterType))
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(DispatchColors.accent)
        }
    }

    // MARK: - Details

    private var details: some View {
        VStack(alignment: .leading, spacing: DispatchSpacing.xxs) {
            HStack(spacing: DispatchSpacing.sm) {
                Text(summary.name)
                    .font(DispatchTypography.body(15, weight: .semibold))
                    .foregroundStyle(DispatchColors.textPrimary)
                    .lineLimit(1)

                if summary.isCachedOnly {
                    Image(systemName: "internaldrive")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(DispatchColors.textMuted)
                } else {
                    StatusDot(sessionStatus, size: 7)
                }
            }

            HStack(spacing: DispatchSpacing.xs) {
                Text(metadataLine)
                    .font(DispatchTypography.caption(12))
                    .foregroundStyle(DispatchColors.textMuted)
                    .lineLimit(1)

                if !summary.isCachedOnly, isStreaming {
                    HStack(spacing: DispatchSpacing.xxs) {
                        PulseIndicator()
                        Text("Working")
                            .font(DispatchTypography.caption(12, weight: .medium))
                            .foregroundStyle(DispatchColors.statusStreaming)
                    }
                }
            }

            if let modelDescriptor {
                Text(modelDescriptor.inlineLabel)
                    .font(DispatchTypography.caption(11, weight: .medium))
                    .foregroundStyle(DispatchColors.accent)
                    .lineLimit(1)
            }
        }
    }

    // MARK: - Trailing

    private var trailing: some View {
        VStack(alignment: .trailing, spacing: DispatchSpacing.xs) {
            Text(RelativeTime.string(from: summary.lastActivityAt))
                .font(DispatchTypography.caption(11))
                .foregroundStyle(DispatchColors.textMuted)

            if summary.turnCount > 0 {
                Text("\(summary.turnCount)")
                    .font(DispatchTypography.caption(11, weight: .semibold))
                    .foregroundStyle(DispatchColors.textSecondary)
                    .padding(.horizontal, DispatchSpacing.sm)
                    .padding(.vertical, DispatchSpacing.xxs)
                    .background(DispatchColors.surfaceAdaptive)
                    .clipShape(Capsule())
                    .accessibilityLabel("\(summary.turnCount) turns")
            }
        }
    }

    private var metadataLine: String {
        ([AdapterIcon.displayName(for: summary.adapterType), projectLabel].compactMap { $0 }).joined(separator: " · ")
    }

    private var accessibilityLabel: String {
        var parts = [
            summary.name,
            AdapterIcon.displayName(for: summary.adapterType),
        ]

        if let projectLabel {
            parts.append(projectLabel)
        }

        if let modelDescriptor {
            parts.append(modelDescriptor.menuLabel)
        }

        parts.append(summary.isCachedOnly ? "cached locally" : sessionStatus.rawValue)
        return parts.joined(separator: ", ")
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
            lastActivityAt: Int(Date().addingTimeInterval(-30).timeIntervalSince1970 * 1000),
            project: "openscout",
            model: "claude-sonnet-4-20250514"
        ))

        SessionRowView(summary: SessionSummary(
            sessionId: "s2", name: "Debug API endpoint",
            adapterType: "openai", status: "idle",
            turnCount: 5, currentTurnStatus: nil,
            startedAt: Int(Date().addingTimeInterval(-7200).timeIntervalSince1970 * 1000),
            lastActivityAt: Int(Date().addingTimeInterval(-600).timeIntervalSince1970 * 1000),
            project: "dispatch",
            model: "gpt-5.4-mini"
        ))

        SessionRowView(summary: SessionSummary(
            sessionId: "s3", name: "Write unit tests",
            adapterType: "claude-code", status: "error",
            turnCount: 3, currentTurnStatus: "failed",
            startedAt: Int(Date().addingTimeInterval(-1800).timeIntervalSince1970 * 1000),
            lastActivityAt: Int(Date().addingTimeInterval(-120).timeIntervalSince1970 * 1000),
            project: "dispatch",
            model: "claude-opus-4-1"
        ))
    }
    .listStyle(.plain)
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}
