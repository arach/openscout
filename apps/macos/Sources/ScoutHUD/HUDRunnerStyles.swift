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
                            ? HUDChrome.accentWhisper
                            : HUDChrome.canvasAlt.opacity(configuration.isPressed ? 0.70 : 0.52)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        isFocused
                            ? HUDChrome.accent.opacity(0.56)
                            : (isSelected
                                ? HUDChrome.accent.opacity(0.42)
                                : HUDChrome.border.opacity(0.72)),
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
            .foregroundStyle(isActive ? HUDChrome.accent : HUDChrome.inkMuted)
            .opacity(configuration.isPressed ? 0.72 : 1)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(
                        isActive
                            ? HUDChrome.accentWhisper
                            : HUDChrome.canvasLift.opacity(configuration.isPressed ? 0.44 : 0.24)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        isFocused
                            ? HUDChrome.borderStrong
                            : (isActive
                                ? HUDChrome.accent.opacity(0.34)
                                : HUDChrome.borderSoft),
                        lineWidth: isFocused ? 1.25 : 0.75
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
    var cornerRadius: CGFloat = 9

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(HUDChrome.canvas)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(HUDChrome.accent.opacity(configuration.isPressed ? 0.72 : 0.94))
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        isFocused ? HUDChrome.borderStrong : .clear,
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
