// QuestionBlockView — renders an AskUserQuestion block.
//
// Three states:
//   awaiting_answer — shows options as tappable buttons
//   answered        — shows the chosen answer(s) collapsed
//   denied          — muted card showing the agent wanted to ask something

import SwiftUI

struct QuestionBlockView: View {
    let sessionId: String
    let block: Block

    @Environment(ConnectionManager.self) private var connection

    private var questionStatus: QuestionBlockStatus {
        block.questionStatus ?? .denied
    }

    var body: some View {
        switch questionStatus {
        case .awaitingAnswer:
            awaitingView
        case .answered:
            answeredView
        case .denied:
            deniedView
        }
    }

    // MARK: - Awaiting answer

    private var awaitingView: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            if let header = block.header {
                Text(header.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(ScoutColors.accent)
            }

            Text(block.question ?? "")
                .font(ScoutTypography.body(15, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)

            VStack(spacing: ScoutSpacing.sm) {
                ForEach(block.options ?? [], id: \.label) { option in
                    Button {
                        sendAnswer([option.label])
                    } label: {
                        HStack(spacing: ScoutSpacing.sm) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(option.label)
                                    .font(ScoutTypography.body(14, weight: .medium))
                                    .foregroundStyle(ScoutColors.textPrimary)
                                if let desc = option.description {
                                    Text(desc)
                                        .font(ScoutTypography.caption(12))
                                        .foregroundStyle(ScoutColors.textMuted)
                                }
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(ScoutColors.textMuted)
                        }
                        .padding(ScoutSpacing.md)
                        .background(ScoutColors.surfaceAdaptive)
                        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                                .strokeBorder(ScoutColors.border, lineWidth: 0.5)
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(ScoutSpacing.lg)
        .background(ScoutColors.accent.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                .strokeBorder(ScoutColors.accent.opacity(0.2), lineWidth: 0.5)
        )
    }

    // MARK: - Answered

    private var answeredView: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(ScoutColors.statusActive)
            VStack(alignment: .leading, spacing: 2) {
                if let header = block.header {
                    Text(header)
                        .font(ScoutTypography.caption(11, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                }
                Text((block.answer ?? []).joined(separator: ", "))
                    .font(ScoutTypography.body(13, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)
            }
            Spacer()
        }
        .padding(ScoutSpacing.md)
        .background(ScoutColors.statusActive.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
    }

    // MARK: - Denied

    private var deniedView: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "questionmark.circle")
                .font(.system(size: 13))
                .foregroundStyle(ScoutColors.textMuted)
            VStack(alignment: .leading, spacing: 2) {
                Text("Agent wanted to ask")
                    .font(ScoutTypography.caption(11, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                Text(block.question ?? "")
                    .font(ScoutTypography.body(12))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(2)
            }
            Spacer()
        }
        .padding(ScoutSpacing.md)
        .background(ScoutColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                .strokeBorder(ScoutColors.border, lineWidth: 0.5)
        )
    }

    // MARK: - Action

    private func sendAnswer(_ answer: [String]) {
        Task {
            try? await connection.answerQuestion(
                sessionId: sessionId,
                blockId: block.id,
                answer: answer
            )
        }
    }
}
