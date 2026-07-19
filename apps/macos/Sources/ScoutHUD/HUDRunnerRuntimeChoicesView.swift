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

struct HUDRunnerRuntimePicker: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding

    var body: some View {
        Group {
            if runner.runtimePickerShowsConfiguration {
                HUDRunnerRuntimeConfiguration(
                    focus: focus,
                    presentedInPicker: true
                )
            } else {
                choices
            }
        }
        .padding(14)
        .frame(width: 520, height: 330, alignment: .top)
        .background(HUDChrome.canvas)
    }

    private var choices: some View {
        VStack(spacing: 8) {
            HStack(spacing: 9) {
                Text("MODEL & RUNTIME")
                    .font(HUDType.mono(9, weight: .semibold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
                Spacer()
                Button(action: { runner.closeRuntimePicker() }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(
                    HUDRunnerToolbarButtonStyle(
                        isActive: false,
                        isFocused: false
                    )
                )
                .accessibilityLabel("Close runtime picker")
            }
            .frame(height: 30)

            ForEach(runner.runtimeQuickChoices(limit: 3)) { preset in
                HUDRunnerRuntimeOptionRow(
                    preset: preset,
                    focus: focus
                )
            }

            Button(action: runner.openRuntimePickerConfiguration) {
                HStack(spacing: 7) {
                    Image(systemName: "slider.horizontal.3")
                    Text("All models and runtime options")
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
        let tuning = runner.runtimePickerTuningPresetID == preset.id
        return VStack(spacing: 6) {
            HStack(spacing: 0) {
                Button {
                    runner.selectRuntimePreset(preset)
                } label: {
                    HStack(spacing: 12) {
                        runtimeIcon(selected: selected)
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
                    .padding(.leading, 14)
                    .padding(.trailing, 8)
                    .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .focused(focus, equals: target)

                tweakButton(isTuning: tuning)
                    .frame(width: 48, height: 56)
            }
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(
                        selected
                            ? HUDChrome.accentWhisper
                            : HUDChrome.canvasAlt.opacity(0.52)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(
                        focus.wrappedValue == target
                            ? HUDChrome.accent.opacity(0.56)
                            : (selected
                                ? HUDChrome.accent.opacity(0.42)
                                : HUDChrome.border.opacity(0.72)),
                        lineWidth: focus.wrappedValue == target ? 1 : 0.75
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .accessibilityElement(children: .contain)

            if tuning {
                tuningShelf
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.easeOut(duration: 0.14), value: tuning)
    }

    private func tweakButton(isTuning: Bool) -> some View {
        Button {
            runner.toggleRuntimeTuning(preset)
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(isTuning ? HUDChrome.accent : HUDChrome.inkMuted)
                .frame(width: 34, height: 34)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(isTuning ? HUDChrome.accentWhisper : .clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .focused(focus, equals: .runtimeTweaks(preset.id))
        .help("Adjust version or effort")
        .accessibilityLabel(
            "Adjust \(HUDRunnerRuntimeFormatter.presentation(preset, runner: runner).title)"
        )
    }

    private func runtimeIcon(selected: Bool) -> some View {
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
    }

    private var tuningShelf: some View {
        VStack(spacing: 7) {
            HStack(spacing: 8) {
                parameterLabel("VERSION")
                HStack(spacing: 5) {
                    ForEach(familyModels) { model in
                        parameterChip(
                            HUDRunnerRuntimeFormatter.versionDisplay(model.versionLabel),
                            selected: model.option.id == preset.model
                        ) {
                            runner.applyRuntimeTweak(
                                HUDRunnerRuntimePreset(
                                    harness: preset.harness,
                                    model: model.option.id,
                                    effort: preset.effort
                                )
                            )
                        }
                    }
                }
                Spacer(minLength: 0)
            }

            HStack(spacing: 8) {
                parameterLabel("EFFORT")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 5) {
                        ForEach(runner.availableEfforts(for: preset.harness)) { effort in
                            parameterChip(
                                effort.label,
                                selected: effort.id == preset.effort
                            ) {
                                runner.applyRuntimeTweak(
                                    HUDRunnerRuntimePreset(
                                        harness: preset.harness,
                                        model: preset.model,
                                        effort: effort.id
                                    )
                                )
                            }
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(HUDChrome.canvasLift.opacity(0.18))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(HUDChrome.border.opacity(0.76), lineWidth: 0.75)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func parameterLabel(_ value: String) -> some View {
        Text(value)
            .font(HUDType.mono(7, weight: .semibold))
            .tracking(HUDType.eyebrowMicro)
            .foregroundStyle(HUDChrome.inkFaint)
            .frame(width: 48, alignment: .leading)
    }

    private func parameterChip(
        _ label: String,
        selected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label)
                .font(HUDType.body(9, weight: selected ? .semibold : .medium))
                .foregroundStyle(selected ? HUDChrome.accent : HUDChrome.inkMuted)
                .padding(.horizontal, 8)
                .frame(height: 23)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(selected ? HUDChrome.accentWhisper : HUDChrome.canvasAlt.opacity(0.58))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(
                            selected ? HUDChrome.accent.opacity(0.44) : HUDChrome.borderSoft,
                            lineWidth: 0.75
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityValue(selected ? "Selected" : "Not selected")
    }

    private var descriptors: [HUDRunnerModelDescriptor] {
        HUDRunnerRuntimeFormatter.descriptors(
            models: runner.availableModels(for: preset.harness),
            selectedModel: preset.model,
            harness: preset.harness
        )
    }

    private var familyModels: [HUDRunnerModelDescriptor] {
        guard let selected = descriptors.first(where: { $0.option.id == preset.model }) else {
            return descriptors
        }
        return descriptors.filter { $0.familyID == selected.familyID }
    }
}
