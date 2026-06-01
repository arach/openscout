import AppKit
import Combine
import SwiftUI

// MARK: - Adaptive color helper

extension Color {
    /// Builds a SwiftUI Color that resolves to `light` in light appearance and
    /// `dark` in dark appearance. Powered by NSColor's dynamic provider so it
    /// also honors window.appearance overrides.
    static func adaptive(light: Color, dark: Color) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let resolved = appearance.bestMatch(from: [.aqua, .darkAqua]) ?? .aqua
            return resolved == .darkAqua ? NSColor(dark) : NSColor(light)
        })
    }
}

// MARK: - Tokens

/// Lats-inspired tokens. Names are stable so the views compile unchanged —
/// each one resolves to a light or dark value via the current appearance.
enum ShellPalette {
    // Surfaces
    static let shellBackground = Color.adaptive(
        light: Color(red: 0.97, green: 0.97, blue: 0.98),
        dark:  Color(hue: 0.62, saturation: 0.05, brightness: 0.08)
    )
    static let shellPanel = Color.adaptive(
        light: Color.white,
        dark:  Color(hue: 0.62, saturation: 0.05, brightness: 0.10)
    )
    static let card = Color.adaptive(
        light: Color.white,
        dark:  Color(hue: 0.62, saturation: 0.06, brightness: 0.13)
    )
    static let cardMuted = Color.adaptive(
        light: Color(red: 0.96, green: 0.96, blue: 0.97),
        dark:  Color(hue: 0.62, saturation: 0.06, brightness: 0.16)
    )
    static let chrome = Color.adaptive(
        light: Color(red: 0.94, green: 0.94, blue: 0.96),
        dark:  Color(white: 0.06)
    )
    static let chromeFooter = Color.adaptive(
        light: Color(red: 0.95, green: 0.95, blue: 0.97),
        dark:  Color(white: 0.07)
    )

    // Text — solid greys (no opacity-on-white compositing).
    static let ink = Color.adaptive(
        light: Color(red: 0.06, green: 0.07, blue: 0.09),
        dark:  Color.white
    )
    static let copy = Color.adaptive(
        light: Color(red: 0.27, green: 0.28, blue: 0.30),
        dark:  Color(white: 0.78)
    )
    static let dim = Color.adaptive(
        light: Color(red: 0.46, green: 0.47, blue: 0.50),
        dark:  Color(white: 0.56)
    )
    static let muted = Color.adaptive(
        light: Color(red: 0.65, green: 0.66, blue: 0.69),
        dark:  Color(white: 0.36)
    )

    // Hairlines — solid greys.
    static let line = Color.adaptive(
        light: Color(white: 0.90),
        dark:  Color(white: 0.14)
    )
    static let lineStrong = Color.adaptive(
        light: Color(white: 0.85),
        dark:  Color(white: 0.20)
    )
    static let sand = lineStrong

    // Accents — jewel-tone, slightly darker on light for legible contrast.
    static let accent = Color.adaptive(
        light: Color(red: 0.18, green: 0.60, blue: 0.34),
        dark:  Color(red: 0.43, green: 0.86, blue: 0.55)
    )
    // Soft accent fill — solid color pre-blended over the shell background.
    static let accentSoft = Color.adaptive(
        light: Color(red: 0.84, green: 0.91, blue: 0.87),
        dark:  Color(red: 0.14, green: 0.21, blue: 0.16)
    )
    // Stroke around accent pills — solid mid-tone of accent + shell bg.
    static let accentBorder = Color.adaptive(
        light: Color(red: 0.58, green: 0.79, blue: 0.66),
        dark:  Color(red: 0.26, green: 0.47, blue: 0.32)
    )

    static let success = accent
    static let successSoft = accentSoft

    static let warning = Color.adaptive(
        light: Color(red: 0.80, green: 0.50, blue: 0.08),
        dark:  Color(red: 0.96, green: 0.74, blue: 0.36)
    )
    static let warningSoft = Color.adaptive(
        light: Color(red: 0.94, green: 0.89, blue: 0.81),
        dark:  Color(red: 0.24, green: 0.20, blue: 0.13)
    )

    static let error = Color.adaptive(
        light: Color(red: 0.83, green: 0.28, blue: 0.30),
        dark:  Color(red: 0.95, green: 0.40, blue: 0.42)
    )
    static let errorSoft = Color.adaptive(
        light: Color(red: 0.94, green: 0.85, blue: 0.85),
        dark:  Color(red: 0.24, green: 0.14, blue: 0.14)
    )
    static let errorBorder = Color.adaptive(
        light: Color(red: 0.91, green: 0.65, blue: 0.66),
        dark:  Color(red: 0.51, green: 0.24, blue: 0.25)
    )

    static let violet = Color.adaptive(
        light: Color(red: 0.50, green: 0.35, blue: 0.85),
        dark:  Color(red: 0.74, green: 0.59, blue: 0.99)
    )
    static let blue = Color.adaptive(
        light: Color(red: 0.20, green: 0.50, blue: 0.92),
        dark:  Color(red: 0.49, green: 0.71, blue: 0.97)
    )
    static let teal = Color.adaptive(
        light: Color(red: 0.18, green: 0.62, blue: 0.66),
        dark:  Color(red: 0.43, green: 0.83, blue: 0.84)
    )

    // Subtle fills used by buttons / hover states — solid greys.
    static let surfaceFill = Color.adaptive(
        light: Color(white: 0.93),
        dark:  Color(white: 0.12)
    )
    static let surfaceFillStrong = Color.adaptive(
        light: Color(white: 0.89),
        dark:  Color(white: 0.17)
    )
    static let accentPressed = Color.adaptive(
        light: Color(red: 0.78, green: 0.88, blue: 0.82),
        dark:  Color(red: 0.16, green: 0.27, blue: 0.19)
    )

    static let gridLine = Color.adaptive(
        light: Color(white: 0.94),
        dark:  Color(white: 0.10)
    )

    static let chipFill = Color.adaptive(
        light: Color(white: 0.93),
        dark:  Color(white: 0.13)
    )
}

// MARK: - Typography

enum MenuType {
    static func title(_ size: CGFloat) -> Font {
        .system(size: size, weight: .semibold, design: .monospaced)
    }

    static func body(_ size: CGFloat) -> Font {
        .system(size: size, weight: .regular, design: .default)
    }

    static func bodyMedium(_ size: CGFloat) -> Font {
        .system(size: size, weight: .medium, design: .default)
    }

    static func mono(_ size: CGFloat, weight: Font.Weight = .medium) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

// MARK: - Buttons

struct PrimaryPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(MenuType.mono(10, weight: .semibold))
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(ShellPalette.accent)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(configuration.isPressed ? ShellPalette.accentPressed : ShellPalette.accentSoft)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(ShellPalette.accentBorder, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

struct SecondaryPillStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(MenuType.mono(10, weight: .medium))
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(ShellPalette.copy)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(configuration.isPressed ? ShellPalette.surfaceFillStrong : ShellPalette.surfaceFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(ShellPalette.lineStrong, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

struct HeaderIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(ShellPalette.copy)
            .frame(width: 26, height: 26)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(configuration.isPressed ? ShellPalette.surfaceFillStrong : ShellPalette.surfaceFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(ShellPalette.line, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

// MARK: - Backdrop

/// Faint line grid backdrop in the Lats idiom. Adapts grid line color via the
/// environment, so it works on both light and dark surfaces.
struct LatsGridBackdrop: View {
    var step: CGFloat = 22

    var body: some View {
        Canvas { context, size in
            var path = Path()
            var x: CGFloat = 0
            while x < size.width {
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: size.height))
                x += step
            }
            var y: CGFloat = 0
            while y < size.height {
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
                y += step
            }
            context.stroke(path, with: .color(ShellPalette.gridLine), lineWidth: 1)
        }
    }
}

// MARK: - Theme manager

@MainActor
final class ThemeManager: ObservableObject {
    static let shared = ThemeManager()

    enum Mode: String, CaseIterable, Identifiable {
        case system, light, dark

        var id: String { rawValue }

        var label: String {
            switch self {
            case .system: return "Auto"
            case .light:  return "Light"
            case .dark:   return "Dark"
            }
        }

        var symbol: String {
            switch self {
            case .system: return "circle.lefthalf.filled"
            case .light:  return "sun.max"
            case .dark:   return "moon"
            }
        }
    }

    @Published var mode: Mode {
        didSet {
            UserDefaults.standard.set(mode.rawValue, forKey: Self.defaultsKey)
        }
    }

    private static let defaultsKey = "OpenScoutThemeMode"

    private init() {
        let raw = UserDefaults.standard.string(forKey: Self.defaultsKey) ?? Mode.dark.rawValue
        self.mode = Mode(rawValue: raw) ?? .dark
    }

    var colorScheme: ColorScheme? {
        switch mode {
        case .system: return nil
        case .light:  return .light
        case .dark:   return .dark
        }
    }

    var nsAppearance: NSAppearance? {
        switch mode {
        case .system: return nil
        case .light:  return NSAppearance(named: .aqua)
        case .dark:   return NSAppearance(named: .darkAqua)
        }
    }
}
