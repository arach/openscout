import SwiftUI

struct HUDRunnerCompletionView: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let completion: HUDRunnerCompletion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(HUDChrome.composerAction)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Task started")
                        .font(HUDType.body(17, weight: .semibold))
                        .foregroundStyle(HUDChrome.ink)
                    Text(completion.title)
                        .font(HUDType.mono(10, weight: .medium))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .lineLimit(1)
                }
                Spacer()
            }
            .padding(.horizontal, 22)
            .frame(height: 78)

            Rectangle()
                .fill(HUDChrome.composerBorder)
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 10) {
                receiptRow(
                    icon: "folder.fill",
                    label: "PROJECT",
                    value: completion.projectTitle,
                    detail: completion.projectPath
                )
                receiptRow(
                    icon: "cpu",
                    label: "RUNTIME",
                    value: completion.runtimeLabel,
                    detail: "Reasoning effort: \(completion.effortLabel)"
                )
                if let reference = completion.referenceLabel {
                    receiptRow(
                        icon: "number",
                        label: "REFERENCE",
                        value: reference,
                        detail: "Use this to find the task again"
                    )
                }
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 16)

            Spacer(minLength: 8)

            HStack(spacing: 10) {
                Spacer()
                Button("Done", action: runner.cancel)
                    .buttonStyle(HUDRunnerSecondaryButtonStyle(isFocused: false))
                    .keyboardShortcut(.cancelAction)
                if completion.conversationId != nil {
                    Button("Open task", action: runner.openCompletedTask)
                        .buttonStyle(HUDRunnerPrimaryTextButtonStyle())
                        .keyboardShortcut(.defaultAction)
                }
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HUDChrome.composerPanel)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            "Task started in \(completion.projectTitle) with \(completion.runtimeLabel), \(completion.effortLabel) effort"
        )
    }

    private func receiptRow(
        icon: String,
        label: String,
        value: String,
        detail: String
    ) -> some View {
        HStack(spacing: 13) {
            Image(systemName: icon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(HUDChrome.composerAction)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(label)
                    .font(HUDType.mono(9, weight: .semibold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkFaint)
                Text(value)
                    .font(HUDType.body(13, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                Text(detail)
                    .font(HUDType.mono(9))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 6)
        }
        .padding(.horizontal, 15)
        .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
        .background(HUDChrome.composerField.opacity(0.76))
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(HUDChrome.composerBorder, lineWidth: 0.75)
        )
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}
