import SwiftUI

struct ScoutTextArea: View {
    let title: String
    let prompt: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScoutSubsectionHeader(title)

            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(prompt)
                        .font(.system(size: 13))
                        .foregroundStyle(ScoutTheme.inkFaint)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .allowsHitTesting(false)
                }

                TextEditor(text: $text)
                    .scrollContentBackground(.hidden)
                    .font(.system(size: 13))
                    .foregroundStyle(ScoutTheme.ink)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .frame(minHeight: 120)
            }
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(.thinMaterial)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .strokeBorder(ScoutTheme.border, lineWidth: 1)
                    )
            )
        }
    }
}

struct ScoutValueRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .textCase(.uppercase)
                .foregroundStyle(ScoutTheme.inkMuted)

            Text(value)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(ScoutTheme.ink)
                .textSelection(.enabled)
        }
    }
}
