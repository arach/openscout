import SwiftUI

struct ScoutEditor: View {
    let title: String
    let placeholder: String
    @Binding var text: String
    var minHeight: CGFloat = 220
    var usesMonospacedFont = false
    var subtitle: String? = nil
    var showsLineNumbers = false
    var showsStatusBar = false

    @State private var metrics = ScoutEditorMetrics.empty

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScoutSubsectionHeader(title, subtitle: subtitle)

            ZStack(alignment: .topLeading) {
                ScoutTextEditor(
                    text: $text,
                    metrics: $metrics,
                    usesMonospacedFont: usesMonospacedFont,
                    showsLineNumbers: showsLineNumbers,
                    accessibilityLabel: title,
                    accessibilityHint: subtitle ?? placeholder,
                    onCommandEnter: nil
                )
                .frame(minHeight: minHeight)

                if text.isEmpty {
                    Text(placeholder)
                        .font(.system(size: 13))
                        .foregroundStyle(ScoutTheme.inkFaint)
                        .padding(.leading, showsLineNumbers ? 52 : 14)
                        .padding(.top, 12)
                        .allowsHitTesting(false)
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(ScoutTheme.surfaceStrong)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(ScoutTheme.border, lineWidth: 1)
                    )
            )

            if showsStatusBar {
                HStack(spacing: 12) {
                    Text("\(metrics.lineCount) lines")
                    Text("\(metrics.wordCount) words")
                    Text("\(metrics.characterCount) chars")

                    Spacer(minLength: 0)

                    Text(statusSummary)
                }
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(ScoutTheme.inkMuted)
            }
        }
    }

    private var statusSummary: String {
        var parts = ["Ln \(metrics.cursorLine)", "Col \(metrics.cursorColumn)"]

        if metrics.selectedCharacterCount > 0 {
            parts.append("Sel \(metrics.selectedCharacterCount)")
        }

        return parts.joined(separator: "  ")
    }
}
