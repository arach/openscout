import ScoutAppCore
import SwiftUI

struct HUDRunnerRuntimeChoices: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding

    var body: some View {
        HUDRunnerDisclosurePanel {
            VStack(spacing: 5) {
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
                    .font(HUDType.body(10, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .padding(.horizontal, 9)
                    .frame(height: 24)
                    .contentShape(Rectangle())
                }
                .buttonStyle(
                    HUDRunnerCardButtonStyle(
                        isSelected: false,
                        isFocused: focus.wrappedValue == .configureRuntime,
                        cornerRadius: 7
                    )
                )
                .focused(focus, equals: .configureRuntime)
                .accessibilityHint("Opens harness, model, version, and effort controls")
            }
            .padding(7)
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
            HStack(spacing: 7) {
                Image(systemName: selected ? "checkmark.circle.fill" : "cpu")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(selected ? HUDChrome.accent : HUDChrome.inkFaint)
                Text(presentation.title)
                    .font(HUDType.body(10, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                Spacer(minLength: 7)
                Text(presentation.detail)
                    .font(HUDType.mono(8))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: 27, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(
            HUDRunnerCardButtonStyle(
                isSelected: selected,
                isFocused: focus.wrappedValue == target,
                cornerRadius: 7
            )
        )
        .focused(focus, equals: target)
        .accessibilityLabel("\(presentation.title), \(presentation.detail)")
        .accessibilityValue(selected ? "Selected" : "Not selected")
    }
}
