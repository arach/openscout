import SwiftUI

typealias HUDRunnerFocusBinding = FocusState<HUDRunnerFocusTarget?>.Binding

struct HUDRunnerCardButtonStyle: ButtonStyle {
    var isSelected: Bool
    var isFocused: Bool
    var cornerRadius: CGFloat = 10

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.76 : 1)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(
                        isSelected
                            ? HUDChrome.composerActionWhisper
                            : HUDChrome.composerField.opacity(configuration.isPressed ? 0.92 : 0.74)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        isFocused
                            ? HUDChrome.composerAction.opacity(0.56)
                            : (isSelected
                                ? HUDChrome.composerAction.opacity(0.42)
                                : HUDChrome.composerBorder),
                        lineWidth: isFocused ? 1 : 0.75
                    )
            )
    }
}

struct HUDRunnerToolbarButtonStyle: ButtonStyle {
    var isActive: Bool
    var isFocused: Bool
    var cornerRadius: CGFloat = 8

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(HUDType.body(10, weight: .semibold))
            .foregroundStyle(isActive ? HUDChrome.composerAction : HUDChrome.inkMuted)
            .opacity(configuration.isPressed ? 0.72 : 1)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(
                        isActive
                            ? HUDChrome.composerActionWhisper
                            : HUDChrome.composerFieldLift.opacity(configuration.isPressed ? 0.72 : 0.28)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        isFocused
                            ? HUDChrome.composerBorderStrong
                            : (isActive
                                ? HUDChrome.composerAction.opacity(0.42)
                                : HUDChrome.composerBorder),
                        lineWidth: isFocused ? 1.25 : 0.75
                    )
            )
    }
}

struct HUDRunnerCircleButtonStyle: ButtonStyle {
    var isActive: Bool
    var isFocused: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(isActive ? HUDChrome.composerAction : HUDChrome.inkMuted)
            .opacity(configuration.isPressed ? 0.70 : 1)
            .background(
                Circle()
                    .fill(
                        isActive
                            ? HUDChrome.composerActionWhisper
                            : HUDChrome.composerFieldLift.opacity(configuration.isPressed ? 0.82 : 0.32)
                    )
            )
            .overlay(
                Circle()
                    .stroke(
                        isFocused
                            ? HUDChrome.composerBorderStrong
                            : (isActive
                                ? HUDChrome.composerAction.opacity(0.58)
                                : HUDChrome.composerBorder),
                        lineWidth: isFocused ? 1.25 : 0.8
                    )
            )
    }
}

struct HUDRunnerSecondaryButtonStyle: ButtonStyle {
    var isFocused: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(HUDType.body(11, weight: .semibold))
            .foregroundStyle(HUDChrome.inkMuted)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(HUDChrome.canvasLift.opacity(configuration.isPressed ? 0.46 : 0.25))
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(
                        isFocused ? HUDChrome.borderStrong : HUDChrome.borderSoft,
                        lineWidth: isFocused ? 1.25 : 0.75
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

struct HUDRunnerPrimaryTextButtonStyle: ButtonStyle {
    var isFocused: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(HUDType.body(11, weight: .semibold))
            .foregroundStyle(HUDChrome.canvas)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(HUDChrome.accent.opacity(configuration.isPressed ? 0.74 : 0.92))
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(
                        isFocused ? HUDChrome.borderStrong : .clear,
                        lineWidth: 1.25
                    )
            )
    }
}

struct HUDRunnerSendButtonStyle: ButtonStyle {
    var isFocused: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(HUDChrome.composerField)
            .background(
                Circle()
                    .fill(HUDChrome.composerAction.opacity(configuration.isPressed ? 0.74 : 0.96))
            )
            .overlay(
                Circle()
                    .stroke(
                        isFocused ? HUDChrome.composerBorderStrong : .clear,
                        lineWidth: 1.25
                    )
            )
    }
}

struct HUDRunnerIconButtonStyle: ButtonStyle {
    var isFocused: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.68 : 1)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isFocused ? HUDChrome.canvasLift.opacity(0.42) : .clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(
                        isFocused ? HUDChrome.borderStrong : .clear,
                        lineWidth: 1.25
                    )
            )
    }
}
