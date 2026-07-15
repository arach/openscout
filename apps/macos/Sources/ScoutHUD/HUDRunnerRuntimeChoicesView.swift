import ScoutAppCore
import SwiftUI

struct HUDRunnerRuntimeChoices: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding

    var body: some View {
        HUDRunnerDisclosurePanel {
            VStack(spacing: 8) {
                HUDRunnerDisclosureHeader(
                    title: "RUNTIMES",
                    detail: "Recent and suggested",
                    focus: focus
                )

                ForEach(runner.runtimeQuickChoices(limit: 3)) { preset in
                    HUDRunnerRuntimeOptionRow(
                        preset: preset,
                        focus: focus
                    )
                }

                Button(action: runner.openRuntimeConfiguration) {
                    HStack(spacing: 7) {
                        Image(systemName: "slider.horizontal.3")
                        Text("Configure runtime")
                        Spacer()
                        Image(systemName: "arrow.right")
                    }
                    .font(HUDType.body(12, weight: .medium))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .padding(.horizontal, 14)
                    .frame(height: 42)
                    .contentShape(Rectangle())
                }
                .buttonStyle(
                    HUDRunnerCardButtonStyle(
                        isSelected: false,
                        isFocused: focus.wrappedValue == .configureRuntime,
                        cornerRadius: 11
                    )
                )
                .focused(focus, equals: .configureRuntime)
                .accessibilityHint("Opens harness, model, version, and effort controls")
            }
        }
    }
}

private struct HUDRunnerRuntimeOptionRow: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let preset: HUDRunnerRuntimePreset
    let focus: HUDRunnerFocusBinding

    var body: some View {
        let selected = preset == runner.currentRuntimePreset
        let target = HUDRunnerFocusTarget.runtimeChoice(preset.id)
        let presentation = HUDRunnerRuntimeFormatter.presentation(
            preset,
            runner: runner
        )
        return Button {
            runner.selectRuntimePreset(preset)
        } label: {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(selected ? HUDChrome.accentWhisper : HUDChrome.canvasLift.opacity(0.24))
                    .frame(width: 34, height: 34)
                    .overlay(
                        Image(systemName: "chevron.left.forwardslash.chevron.right")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(selected ? HUDChrome.accent : HUDChrome.inkMuted)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(
                                selected ? HUDChrome.accent.opacity(0.40) : HUDChrome.borderSoft,
                                lineWidth: 0.75
                            )
                    )
                VStack(alignment: .leading, spacing: 3) {
                    Text(presentation.title)
                        .font(HUDType.body(13, weight: .semibold))
                        .foregroundStyle(HUDChrome.ink)
                        .lineLimit(1)
                    Text(presentation.detail)
                        .font(HUDType.mono(9))
                        .foregroundStyle(HUDChrome.inkFaint)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(HUDChrome.accent)
                }
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(
            HUDRunnerCardButtonStyle(
                isSelected: selected,
                isFocused: focus.wrappedValue == target,
                cornerRadius: 11
            )
        )
        .focused(focus, equals: target)
        .accessibilityLabel("\(presentation.title), \(presentation.detail)")
        .accessibilityValue(selected ? "Selected" : "Not selected")
    }
}
