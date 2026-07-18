import SwiftUI

typealias HUDRunnerFocusBinding = FocusState<HUDRunnerFocusTarget?>.Binding

/// The hot-zone composer deliberately follows the quieter mint/graphite
/// treatment used by the task-capture reference. Keep it local to the runner:
/// the rest of the HUD still uses Scout's lime identity accent.
enum HUDRunnerPalette {
    static let panel = Color(red: 0.055, green: 0.058, blue: 0.057)
    static let field = Color(red: 0.032, green: 0.035, blue: 0.034)
    static let fieldLift = Color(red: 0.072, green: 0.078, blue: 0.076)
    static let border = Color(red: 0.175, green: 0.190, blue: 0.186)
    static let borderStrong = Color(red: 0.285, green: 0.305, blue: 0.300)
    static let accent = Color(red: 0.420, green: 0.730, blue: 0.640)
    static let accentWhisper = accent.opacity(0.07)
}

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
                            ? HUDRunnerPalette.accentWhisper
                            : HUDRunnerPalette.field.opacity(configuration.isPressed ? 0.92 : 0.74)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        isFocused
                            ? HUDRunnerPalette.accent.opacity(0.56)
                            : (isSelected
                                ? HUDRunnerPalette.accent.opacity(0.42)
                                : HUDRunnerPalette.border),
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
            .foregroundStyle(isActive ? HUDRunnerPalette.accent : HUDChrome.inkMuted)
            .opacity(configuration.isPressed ? 0.72 : 1)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(
                        isActive
                            ? HUDRunnerPalette.accentWhisper
                            : HUDRunnerPalette.fieldLift.opacity(configuration.isPressed ? 0.72 : 0.28)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        isFocused
                            ? HUDRunnerPalette.borderStrong
                            : (isActive
                                ? HUDRunnerPalette.accent.opacity(0.42)
                                : HUDRunnerPalette.border),
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
            .foregroundStyle(isActive ? HUDRunnerPalette.accent : HUDChrome.inkMuted)
            .opacity(configuration.isPressed ? 0.70 : 1)
            .background(
                Circle()
                    .fill(
                        isActive
                            ? HUDRunnerPalette.accentWhisper
                            : HUDRunnerPalette.fieldLift.opacity(configuration.isPressed ? 0.82 : 0.32)
                    )
            )
            .overlay(
                Circle()
                    .stroke(
                        isFocused
                            ? HUDRunnerPalette.borderStrong
                            : (isActive
                                ? HUDRunnerPalette.accent.opacity(0.58)
                                : HUDRunnerPalette.border),
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
            .foregroundStyle(HUDRunnerPalette.field)
            .background(
                Circle()
                    .fill(HUDRunnerPalette.accent.opacity(configuration.isPressed ? 0.74 : 0.96))
            )
            .overlay(
                Circle()
                    .stroke(
                        isFocused ? HUDRunnerPalette.borderStrong : .clear,
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
