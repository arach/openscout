import SwiftUI

#if os(macOS)
import AppKit
#endif

private func scoutRGB(_ red: Double, _ green: Double, _ blue: Double, opacity: Double = 1.0) -> Color {
    Color(red: red, green: green, blue: blue).opacity(opacity)
}

extension Color {
    /// Resolves to `light` in light appearance and `dark` in dark appearance,
    /// via NSColor's dynamic provider, so it also honors a window.appearance
    /// override from the Scout mode picker.
    static func scoutAdaptive(light: Color, dark: Color) -> Color {
        #if os(macOS)
        return Color(nsColor: NSColor(name: nil) { appearance in
            let resolved = appearance.bestMatch(from: [.aqua, .darkAqua]) ?? .aqua
            return resolved == .darkAqua ? NSColor(dark) : NSColor(light)
        })
        #else
        return dark
        #endif
    }
}

struct ScoutThemeColors {
    let bg: Color
    let chrome: Color
    let surface: Color
    let ink: Color
    let muted: Color
    let dim: Color
    let border: Color
    let hairline: Color
    let hairlineStrong: Color
    let accent: Color
    let accentSoft: Color
    let statusOk: Color
    let statusWarn: Color
    let statusError: Color
    let statusInfo: Color

    func applying(palette: ScoutAccentPalette) -> ScoutThemeColors {
        ScoutThemeColors(
            bg: bg,
            chrome: chrome,
            surface: surface,
            ink: ink,
            muted: muted,
            dim: dim,
            border: border,
            hairline: hairline,
            hairlineStrong: hairlineStrong,
            accent: palette.accent,
            accentSoft: palette.accentSoft,
            statusOk: statusOk,
            statusWarn: statusWarn,
            statusError: statusError,
            statusInfo: palette.info
        )
    }

    static func adaptive(light: ScoutThemeColors, dark: ScoutThemeColors) -> ScoutThemeColors {
        ScoutThemeColors(
            bg: .scoutAdaptive(light: light.bg, dark: dark.bg),
            chrome: .scoutAdaptive(light: light.chrome, dark: dark.chrome),
            surface: .scoutAdaptive(light: light.surface, dark: dark.surface),
            ink: .scoutAdaptive(light: light.ink, dark: dark.ink),
            muted: .scoutAdaptive(light: light.muted, dark: dark.muted),
            dim: .scoutAdaptive(light: light.dim, dark: dark.dim),
            border: .scoutAdaptive(light: light.border, dark: dark.border),
            hairline: .scoutAdaptive(light: light.hairline, dark: dark.hairline),
            hairlineStrong: .scoutAdaptive(light: light.hairlineStrong, dark: dark.hairlineStrong),
            accent: .scoutAdaptive(light: light.accent, dark: dark.accent),
            accentSoft: .scoutAdaptive(light: light.accentSoft, dark: dark.accentSoft),
            statusOk: .scoutAdaptive(light: light.statusOk, dark: dark.statusOk),
            statusWarn: .scoutAdaptive(light: light.statusWarn, dark: dark.statusWarn),
            statusError: .scoutAdaptive(light: light.statusError, dark: dark.statusError),
            statusInfo: .scoutAdaptive(light: light.statusInfo, dark: dark.statusInfo)
        )
    }
}

enum ScoutAccentPalette: String, CaseIterable, Identifiable {
    case forest
    case teal
    case blue
    case amber
    case rose

    static let defaultsKey = "scout.appearance.accentPalette"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .forest: return "Forest"
        case .teal: return "Cyan"
        case .blue: return "Indigo"
        case .amber: return "Amber"
        case .rose: return "Rose"
        }
    }

    var accent: Color {
        switch self {
        case .forest: return .scoutAdaptive(light: scoutRGB(0.22, 0.48, 0.34), dark: scoutRGB(0.31, 0.64, 0.45))
        case .teal: return .scoutAdaptive(light: scoutRGB(0.00, 0.49, 0.53), dark: scoutRGB(0.39, 0.78, 0.76))
        case .blue: return .scoutAdaptive(light: scoutRGB(0.243, 0.400, 0.800), dark: scoutRGB(0.333, 0.522, 0.902))
        case .amber: return .scoutAdaptive(light: scoutRGB(0.75, 0.41, 0.09), dark: scoutRGB(0.91, 0.60, 0.24))
        case .rose: return .scoutAdaptive(light: scoutRGB(0.70, 0.29, 0.38), dark: scoutRGB(0.92, 0.35, 0.45))
        }
    }

    var accentSoft: Color {
        switch self {
        case .forest: return .scoutAdaptive(light: scoutRGB(0.86, 0.91, 0.88), dark: scoutRGB(0.31, 0.64, 0.45, opacity: 0.14))
        case .teal: return .scoutAdaptive(light: scoutRGB(0.82, 0.92, 0.92), dark: scoutRGB(0.39, 0.78, 0.76, opacity: 0.14))
        case .blue: return .scoutAdaptive(light: scoutRGB(0.894, 0.918, 0.976), dark: scoutRGB(0.333, 0.522, 0.902, opacity: 0.22))
        case .amber: return .scoutAdaptive(light: scoutRGB(0.96, 0.90, 0.80), dark: scoutRGB(0.91, 0.60, 0.24, opacity: 0.15))
        case .rose: return .scoutAdaptive(light: scoutRGB(0.96, 0.86, 0.89), dark: scoutRGB(0.92, 0.35, 0.45, opacity: 0.15))
        }
    }

    var info: Color {
        accent
    }

    static var settingsCases: [ScoutAccentPalette] {
        let preferred: [ScoutAccentPalette] = [.blue, .amber, .rose]
        let current = Self.current
        return preferred.contains(current) ? preferred : preferred + [current]
    }

    static var current: ScoutAccentPalette {
        ScoutAccentPalette(rawValue: UserDefaults.standard.string(forKey: defaultsKey) ?? "") ?? .blue
    }
}

enum ScoutThemePreset: String, CaseIterable, Identifiable {
    case scout
    case workbench
    case porcelain
    case graphite
    case juniper

    static let defaultsKey = "scout.appearance.themePreset"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .scout: return "Paper"
        case .workbench: return "Mist"
        case .porcelain: return "Porcelain"
        case .graphite: return "Graphite"
        case .juniper: return "Nocturne"
        }
    }

    var toneLabel: String {
        switch self {
        case .scout, .workbench, .porcelain: return "Light"
        case .graphite, .juniper: return "Soft dark"
        }
    }

    var lightPreview: ScoutThemeColors { lightColors }
    var darkPreview: ScoutThemeColors { darkColors }

    var colors: ScoutThemeColors {
        ScoutThemeColors.adaptive(light: lightColors, dark: darkColors)
    }

    static var current: ScoutThemePreset {
        ScoutThemePreset(rawValue: UserDefaults.standard.string(forKey: defaultsKey) ?? "") ?? .scout
    }

    static var settingsCases: [ScoutThemePreset] {
        let preferred: [ScoutThemePreset] = [.scout, .workbench, .graphite, .juniper]
        let current = Self.current
        return preferred.contains(current) ? preferred : preferred + [current]
    }

    private var lightColors: ScoutThemeColors {
        switch self {
        case .scout:
            // "Paper" is warm: grays lean R>G>B (like the web light vars and
            // the landing's paper/ink system) instead of the old blue-gray,
            // so light mode reads as paper rather than office-cool. Surface
            // stays pure white — cards keep a crisp cool-white pop against
            // the warm canvas. Luminance matches the old values, only the
            // temperature moved. Mist stays the cool option.
            return ScoutThemeColors(
                bg: scoutRGB(0.982, 0.980, 0.972),
                chrome: scoutRGB(0.949, 0.945, 0.934),
                surface: .white,
                ink: scoutRGB(0.096, 0.090, 0.078),
                muted: scoutRGB(0.390, 0.378, 0.356),
                dim: scoutRGB(0.512, 0.500, 0.474),
                border: scoutRGB(0.886, 0.876, 0.854),
                hairline: scoutRGB(0.918, 0.910, 0.890),
                hairlineStrong: scoutRGB(0.816, 0.802, 0.774),
                accent: scoutRGB(0.286, 0.329, 0.769),
                accentSoft: scoutRGB(0.910, 0.920, 0.980),
                statusOk: scoutRGB(0.184, 0.490, 0.333),
                statusWarn: scoutRGB(0.660, 0.384, 0.067),
                statusError: scoutRGB(0.725, 0.212, 0.259),
                statusInfo: scoutRGB(0.286, 0.329, 0.769)
            )
        case .workbench:
            return ScoutThemeColors(
                bg: scoutRGB(0.961, 0.969, 0.980),
                chrome: scoutRGB(0.914, 0.929, 0.949),
                surface: scoutRGB(0.992, 0.996, 1.000),
                ink: scoutRGB(0.067, 0.078, 0.098),
                muted: scoutRGB(0.330, 0.365, 0.416),
                dim: scoutRGB(0.500, 0.535, 0.585),
                border: scoutRGB(0.827, 0.851, 0.886),
                hairline: scoutRGB(0.880, 0.900, 0.925),
                hairlineStrong: scoutRGB(0.745, 0.780, 0.827),
                accent: scoutRGB(0.286, 0.329, 0.769),
                accentSoft: scoutRGB(0.900, 0.918, 0.980),
                statusOk: scoutRGB(0.184, 0.490, 0.333),
                statusWarn: scoutRGB(0.650, 0.380, 0.072),
                statusError: scoutRGB(0.720, 0.220, 0.270),
                statusInfo: scoutRGB(0.286, 0.329, 0.769)
            )
        case .porcelain:
            return ScoutThemeColors(
                bg: scoutRGB(0.972, 0.972, 0.968),
                chrome: scoutRGB(0.932, 0.932, 0.925),
                surface: .white,
                ink: scoutRGB(0.085, 0.082, 0.078),
                muted: scoutRGB(0.400, 0.392, 0.380),
                dim: scoutRGB(0.560, 0.552, 0.535),
                border: scoutRGB(0.858, 0.854, 0.842),
                hairline: scoutRGB(0.900, 0.896, 0.886),
                hairlineStrong: scoutRGB(0.790, 0.782, 0.760),
                accent: scoutRGB(0.286, 0.329, 0.769),
                accentSoft: scoutRGB(0.912, 0.918, 0.978),
                statusOk: scoutRGB(0.184, 0.490, 0.333),
                statusWarn: scoutRGB(0.660, 0.384, 0.067),
                statusError: scoutRGB(0.725, 0.212, 0.259),
                statusInfo: scoutRGB(0.286, 0.329, 0.769)
            )
        case .graphite:
            return ScoutThemeColors(
                bg: scoutRGB(0.949, 0.953, 0.957),
                chrome: scoutRGB(0.902, 0.910, 0.918),
                surface: scoutRGB(0.988, 0.990, 0.992),
                ink: scoutRGB(0.075, 0.078, 0.085),
                muted: scoutRGB(0.360, 0.380, 0.404),
                dim: scoutRGB(0.520, 0.540, 0.565),
                border: scoutRGB(0.800, 0.816, 0.835),
                hairline: scoutRGB(0.870, 0.880, 0.895),
                hairlineStrong: scoutRGB(0.735, 0.755, 0.780),
                accent: scoutRGB(0.286, 0.329, 0.769),
                accentSoft: scoutRGB(0.900, 0.910, 0.972),
                statusOk: scoutRGB(0.184, 0.490, 0.333),
                statusWarn: scoutRGB(0.650, 0.380, 0.072),
                statusError: scoutRGB(0.720, 0.220, 0.270),
                statusInfo: scoutRGB(0.286, 0.329, 0.769)
            )
        case .juniper:
            return ScoutThemeColors(
                bg: scoutRGB(0.955, 0.960, 0.970),
                chrome: scoutRGB(0.905, 0.914, 0.930),
                surface: scoutRGB(0.992, 0.994, 0.998),
                ink: scoutRGB(0.070, 0.078, 0.095),
                muted: scoutRGB(0.345, 0.372, 0.420),
                dim: scoutRGB(0.510, 0.535, 0.585),
                border: scoutRGB(0.805, 0.825, 0.858),
                hairline: scoutRGB(0.875, 0.890, 0.915),
                hairlineStrong: scoutRGB(0.735, 0.760, 0.805),
                accent: scoutRGB(0.286, 0.329, 0.769),
                accentSoft: scoutRGB(0.902, 0.912, 0.976),
                statusOk: scoutRGB(0.184, 0.490, 0.333),
                statusWarn: scoutRGB(0.650, 0.380, 0.072),
                statusError: scoutRGB(0.720, 0.220, 0.270),
                statusInfo: scoutRGB(0.286, 0.329, 0.769)
            )
        }
    }

    private var darkColors: ScoutThemeColors {
        switch self {
        case .scout:
            return ScoutThemeColors(
                bg: scoutRGB(0.075, 0.078, 0.086),
                chrome: scoutRGB(0.055, 0.059, 0.067),
                surface: scoutRGB(0.102, 0.106, 0.118),
                ink: scoutRGB(0.918, 0.922, 0.933),
                muted: scoutRGB(0.625, 0.642, 0.678),
                dim: scoutRGB(0.416, 0.435, 0.478),
                border: Color.white.opacity(0.090),
                hairline: Color.white.opacity(0.060),
                hairlineStrong: Color.white.opacity(0.140),
                accent: scoutRGB(0.369, 0.416, 0.824),
                accentSoft: scoutRGB(0.369, 0.416, 0.824, opacity: 0.16),
                statusOk: scoutRGB(0.298, 0.718, 0.510),
                statusWarn: scoutRGB(0.910, 0.604, 0.235),
                statusError: scoutRGB(0.898, 0.282, 0.302),
                statusInfo: scoutRGB(0.369, 0.416, 0.824)
            )
        case .workbench:
            return ScoutThemeColors(
                bg: scoutRGB(0.067, 0.078, 0.094),
                chrome: scoutRGB(0.043, 0.051, 0.063),
                surface: scoutRGB(0.098, 0.118, 0.141),
                ink: scoutRGB(0.900, 0.915, 0.930),
                muted: scoutRGB(0.620, 0.660, 0.700),
                dim: scoutRGB(0.410, 0.455, 0.500),
                border: Color.white.opacity(0.095),
                hairline: Color.white.opacity(0.060),
                hairlineStrong: Color.white.opacity(0.140),
                accent: scoutRGB(0.369, 0.416, 0.824),
                accentSoft: scoutRGB(0.369, 0.416, 0.824, opacity: 0.16),
                statusOk: scoutRGB(0.298, 0.718, 0.510),
                statusWarn: scoutRGB(0.910, 0.604, 0.235),
                statusError: scoutRGB(0.898, 0.282, 0.302),
                statusInfo: scoutRGB(0.369, 0.416, 0.824)
            )
        case .porcelain:
            return ScoutThemeColors(
                bg: scoutRGB(0.086, 0.082, 0.078),
                chrome: scoutRGB(0.061, 0.059, 0.055),
                surface: scoutRGB(0.130, 0.124, 0.118),
                ink: scoutRGB(0.910, 0.900, 0.880),
                muted: scoutRGB(0.665, 0.650, 0.625),
                dim: scoutRGB(0.455, 0.445, 0.420),
                border: Color.white.opacity(0.090),
                hairline: Color.white.opacity(0.055),
                hairlineStrong: Color.white.opacity(0.135),
                accent: scoutRGB(0.369, 0.416, 0.824),
                accentSoft: scoutRGB(0.369, 0.416, 0.824, opacity: 0.15),
                statusOk: scoutRGB(0.298, 0.718, 0.510),
                statusWarn: scoutRGB(0.910, 0.604, 0.235),
                statusError: scoutRGB(0.898, 0.282, 0.302),
                statusInfo: scoutRGB(0.369, 0.416, 0.824)
            )
        case .graphite:
            // Higher-contrast neutral dark. Surface lifted clearly off the
            // canvas so cards separate; ink/muted/dim raised for legible
            // secondary text; stronger white hairlines. Mirrors the Studio
            // `graphite` skin.
            return ScoutThemeColors(
                bg: scoutRGB(0.071, 0.071, 0.078),
                chrome: scoutRGB(0.031, 0.031, 0.039),
                surface: scoutRGB(0.141, 0.141, 0.157),
                ink: Color.white.opacity(0.970),
                muted: Color.white.opacity(0.690),
                dim: Color.white.opacity(0.490),
                border: Color.white.opacity(0.170),
                hairline: Color.white.opacity(0.100),
                hairlineStrong: Color.white.opacity(0.220),
                accent: scoutRGB(0.427, 0.478, 0.910),
                accentSoft: scoutRGB(0.427, 0.478, 0.910, opacity: 0.26),
                statusOk: scoutRGB(0.329, 0.788, 0.557),
                statusWarn: scoutRGB(0.937, 0.627, 0.267),
                statusError: scoutRGB(0.945, 0.353, 0.376),
                statusInfo: scoutRGB(0.427, 0.478, 0.910)
            )
        case .juniper:
            // Neutralized "Nocturne" — true charcoal gray, not navy. The old
            // skin tinted every surface and hairline steel-blue, so the whole
            // window read cool before the accent. Now the grays are genuinely
            // neutral (R=G=B) and indigo is the ONLY hue in the window. Surface
            // is lifted off the canvas so cards separate; ink/muted/dim stay
            // high-contrast. Mirrors the de-purpled Studio control.
            return ScoutThemeColors(
                bg: scoutRGB(0.098, 0.098, 0.098),
                chrome: scoutRGB(0.059, 0.059, 0.059),
                surface: scoutRGB(0.161, 0.161, 0.161),
                ink: scoutRGB(0.961, 0.961, 0.961),
                muted: scoutRGB(0.714, 0.714, 0.714),
                dim: scoutRGB(0.525, 0.525, 0.525),
                border: scoutRGB(0.706, 0.706, 0.706, opacity: 0.22),
                hairline: scoutRGB(0.706, 0.706, 0.706, opacity: 0.12),
                hairlineStrong: scoutRGB(0.706, 0.706, 0.706, opacity: 0.28),
                accent: scoutRGB(0.333, 0.522, 0.902),
                accentSoft: scoutRGB(0.333, 0.522, 0.902, opacity: 0.22),
                statusOk: scoutRGB(0.329, 0.788, 0.557),
                statusWarn: scoutRGB(0.937, 0.627, 0.267),
                statusError: scoutRGB(0.945, 0.353, 0.376),
                statusInfo: scoutRGB(0.333, 0.522, 0.902)
            )
        }
    }
}

/// How loudly the accent is spent on stateful fills — your turns in a thread,
/// the active scope segment, the activity chart. Quiet (default) keeps them on
/// an accent-soft wash with standard ink prose; Vivid restores the classic
/// solid-accent fills. Attention marks and primary actions stay accent in both.
enum ScoutAccentVolume: String, CaseIterable, Identifiable {
    case quiet, vivid

    static let defaultsKey = "scout.appearance.accentVolume"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .quiet: return "Quiet"
        case .vivid: return "Vivid"
        }
    }

    static var current: ScoutAccentVolume {
        ScoutAccentVolume(rawValue: UserDefaults.standard.string(forKey: defaultsKey) ?? "") ?? .quiet
    }
}

/// Adaptive semantic palette for the Scout desktop app. Views consume these
/// tokens, so named presets can swap colors without changing every surface.
enum ScoutPalette {
    private static var colors: ScoutThemeColors {
        ScoutThemePreset.current.colors.applying(palette: ScoutAccentPalette.current)
    }

    private static var surfaceOpacity: Double {
        let value = UserDefaults.standard.object(forKey: "scout.appearance.windowOpacity") as? Double ?? 1
        return min(max(value, 0), 1)
    }

    // Surfaces
    static var bg: Color { colors.bg.opacity(surfaceOpacity) }
    static var chrome: Color { colors.chrome.opacity(surfaceOpacity) }
    static var surface: Color { colors.surface.opacity(surfaceOpacity) }

    // Text
    static var ink: Color { colors.ink }
    static var muted: Color { colors.muted }
    static var dim: Color { colors.dim }

    // Structure
    static var border: Color { colors.border }
    static var hairline: Color { colors.hairline }
    static var hairlineStrong: Color { colors.hairlineStrong }

    // Accent
    static var accent: Color { colors.accent }
    static var accentSoft: Color { colors.accentSoft }

    // Status
    static var statusOk: Color { colors.statusOk }
    static var statusWarn: Color { colors.statusWarn }
    static var statusError: Color { colors.statusError }
    static var statusInfo: Color { colors.statusInfo }
}

enum ScoutSurface {
    static var inset: Color {
        Color.scoutAdaptive(
            light: scoutRGB(0.941, 0.945, 0.953),
            dark: Color.white.opacity(0.040)
        )
    }

    static var hover: Color {
        Color.scoutAdaptive(
            light: scoutRGB(0.914, 0.922, 0.938),
            dark: Color.white.opacity(0.070)
        )
    }

    static var press: Color {
        Color.scoutAdaptive(
            light: scoutRGB(0.875, 0.890, 0.910),
            dark: Color.white.opacity(0.100)
        )
    }

    static var control: Color {
        Color.scoutAdaptive(
            light: scoutRGB(0.968, 0.972, 0.980),
            dark: Color.white.opacity(0.055)
        )
    }

    static var controlFocused: Color {
        Color.scoutAdaptive(
            light: .white,
            dark: Color.white.opacity(0.085)
        )
    }

    static func selected(_ color: Color) -> Color {
        color.opacity(0.12)
    }

    static func tintGhost(_ color: Color) -> Color {
        color.opacity(0.10)
    }

    static func tintFill(_ color: Color) -> Color {
        color.opacity(0.16)
    }

    static func tintBorder(_ color: Color) -> Color {
        color.opacity(0.32)
    }

    /// Drop-shadow color for lifted surfaces. Pass the dark-mode opacity that
    /// already reads well against near-black chrome; light mode is derived far
    /// softer, because a heavy black shadow looks like dirt on a light surface.
    static func shadow(_ darkOpacity: Double) -> Color {
        Color.scoutAdaptive(
            light: Color.black.opacity(darkOpacity * 0.3),
            dark: Color.black.opacity(darkOpacity)
        )
    }
}
