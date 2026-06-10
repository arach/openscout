import SwiftUI

#if os(macOS)
import AppKit
#endif

extension Color {
    /// Resolves to `light` in light appearance and `dark` in dark appearance,
    /// via NSColor's dynamic provider — so it also honors a window.appearance
    /// override (how the Scout theme picker forces light/dark/system).
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

/// Adaptive semantic palette for the Scout desktop app. Dark values are
/// pixel-identical to the previous static palette (HudPalette / ScoutDesign);
/// light values are lifted from the calibrated ScoutMenu `ShellPalette`.
///
/// Views consume these in place of the static `ScoutPalette.*` / `ScoutDesign.*`
/// colors, so the whole app follows light/dark. (Arbitrary runtime themes /
/// templates would layer an environment-injected resolver on top of these same
/// call sites later.)
enum ScoutPalette {
    // Surfaces
    static let bg = Color.scoutAdaptive(
        light: Color(red: 0.97, green: 0.97, blue: 0.98),
        dark: Color(red: 10.0 / 255, green: 10.0 / 255, blue: 10.0 / 255)
    )
    static let chrome = Color.scoutAdaptive(
        light: Color(red: 0.94, green: 0.94, blue: 0.96),
        dark: Color(red: 6.0 / 255, green: 6.0 / 255, blue: 6.0 / 255)
    )
    static let surface = Color.scoutAdaptive(
        light: .white,
        dark: Color(red: 23.0 / 255, green: 23.0 / 255, blue: 23.0 / 255)
    )

    // Text
    static let ink = Color.scoutAdaptive(
        light: Color(red: 0.06, green: 0.07, blue: 0.09),
        dark: Color(red: 229.0 / 255, green: 229.0 / 255, blue: 229.0 / 255)
    )
    static let muted = Color.scoutAdaptive(
        light: Color(red: 0.40, green: 0.41, blue: 0.44),
        dark: Color(red: 163.0 / 255, green: 163.0 / 255, blue: 163.0 / 255)
    )
    static let dim = Color.scoutAdaptive(
        light: Color(red: 0.55, green: 0.56, blue: 0.59),
        dark: Color(red: 115.0 / 255, green: 115.0 / 255, blue: 115.0 / 255)
    )

    // Structure
    static let border = Color.scoutAdaptive(
        light: Color(white: 0.88),
        dark: Color(red: 39.0 / 255, green: 39.0 / 255, blue: 39.0 / 255)
    )
    static let hairline = Color.scoutAdaptive(
        light: Color(white: 0.91),
        dark: Color.white.opacity(0.045)
    )
    static let hairlineStrong = Color.scoutAdaptive(
        light: Color(white: 0.85),
        dark: Color.white.opacity(0.075)
    )

    // Accent
    static let accent = Color.scoutAdaptive(
        light: Color(red: 0.18, green: 0.60, blue: 0.34),
        dark: Color(red: 16.0 / 255, green: 185.0 / 255, blue: 129.0 / 255)
    )
    static let accentSoft = Color.scoutAdaptive(
        light: Color(red: 0.84, green: 0.91, blue: 0.87),
        dark: Color(red: 16.0 / 255, green: 185.0 / 255, blue: 129.0 / 255).opacity(0.10)
    )

    // Status
    static let statusOk = Color.scoutAdaptive(
        light: Color(red: 0.18, green: 0.60, blue: 0.34),
        dark: Color(red: 34.0 / 255, green: 197.0 / 255, blue: 94.0 / 255)
    )
    static let statusWarn = Color.scoutAdaptive(
        light: Color(red: 0.80, green: 0.50, blue: 0.08),
        dark: Color(red: 245.0 / 255, green: 158.0 / 255, blue: 11.0 / 255)
    )
    static let statusError = Color.scoutAdaptive(
        light: Color(red: 0.83, green: 0.28, blue: 0.30),
        dark: Color(red: 220.0 / 255, green: 38.0 / 255, blue: 38.0 / 255)
    )
    static let statusInfo = Color.scoutAdaptive(
        light: Color(red: 0.20, green: 0.50, blue: 0.92),
        dark: Color(red: 59.0 / 255, green: 130.0 / 255, blue: 246.0 / 255)
    )
}
