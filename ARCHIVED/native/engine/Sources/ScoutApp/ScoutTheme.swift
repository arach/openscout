import AppKit
import SwiftUI

enum ScoutTheme {
    static let accent = Color(nsColor: .controlAccentColor)
    static let accentSoft = dynamic(
        light: NSColor.controlAccentColor.withAlphaComponent(0.12),
        dark: NSColor.controlAccentColor.withAlphaComponent(0.18)
    )

    static let canvas = dynamic(
        light: NSColor(srgbRed: 0.979, green: 0.980, blue: 0.977, alpha: 1),
        dark: NSColor(srgbRed: 0.102, green: 0.111, blue: 0.126, alpha: 1)
    )
    static let chrome = dynamic(
        light: NSColor(srgbRed: 0.989, green: 0.989, blue: 0.986, alpha: 1),
        dark: NSColor(srgbRed: 0.132, green: 0.142, blue: 0.161, alpha: 1)
    )
    static let sidebar = dynamic(
        light: NSColor(srgbRed: 0.961, green: 0.962, blue: 0.958, alpha: 1),
        dark: NSColor(srgbRed: 0.120, green: 0.132, blue: 0.152, alpha: 1)
    )
    static let surface = dynamic(
        light: NSColor(srgbRed: 0.992, green: 0.992, blue: 0.990, alpha: 1),
        dark: NSColor(srgbRed: 0.155, green: 0.166, blue: 0.189, alpha: 1)
    )
    static let surfaceStrong = dynamic(
        light: NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 1),
        dark: NSColor(srgbRed: 0.182, green: 0.194, blue: 0.218, alpha: 1)
    )
    static let surfaceMuted = dynamic(
        light: NSColor(srgbRed: 0.968, green: 0.968, blue: 0.964, alpha: 1),
        dark: NSColor(srgbRed: 0.141, green: 0.152, blue: 0.173, alpha: 1)
    )
    static let thread = dynamic(
        light: NSColor(srgbRed: 0.992, green: 0.994, blue: 0.998, alpha: 1),
        dark: NSColor(srgbRed: 0.127, green: 0.135, blue: 0.153, alpha: 1)
    )
    static let input = dynamic(
        light: NSColor.white,
        dark: NSColor(srgbRed: 0.166, green: 0.177, blue: 0.201, alpha: 1)
    )

    static let border = dynamic(
        light: NSColor(srgbRed: 0.854, green: 0.851, blue: 0.840, alpha: 0.72),
        dark: NSColor(srgbRed: 0.286, green: 0.313, blue: 0.364, alpha: 1)
    )
    static let borderStrong = dynamic(
        light: NSColor(srgbRed: 0.803, green: 0.799, blue: 0.786, alpha: 0.88),
        dark: NSColor(srgbRed: 0.338, green: 0.367, blue: 0.422, alpha: 1)
    )

    static let ink = Color.primary
    static let inkSecondary = Color.secondary
    static let inkMuted = dynamic(
        light: NSColor(srgbRed: 0.470, green: 0.467, blue: 0.452, alpha: 1),
        dark: NSColor.tertiaryLabelColor
    )
    static let inkFaint = dynamic(
        light: NSColor(srgbRed: 0.646, green: 0.638, blue: 0.615, alpha: 1),
        dark: NSColor.quaternaryLabelColor
    )

    static let hover = dynamic(
        light: NSColor.black.withAlphaComponent(0.026),
        dark: NSColor.white.withAlphaComponent(0.05)
    )
    static let selection = dynamic(
        light: NSColor.controlAccentColor.withAlphaComponent(0.12),
        dark: NSColor.controlAccentColor.withAlphaComponent(0.22)
    )
    static let selectionStrong = dynamic(
        light: NSColor.controlAccentColor.withAlphaComponent(0.18),
        dark: NSColor.controlAccentColor.withAlphaComponent(0.28)
    )

    static let success = Color(nsColor: .systemGreen)
    static let warning = Color(nsColor: .systemOrange)
    static let shadow = dynamic(
        light: NSColor.black.withAlphaComponent(0.08),
        dark: NSColor.black.withAlphaComponent(0.28)
    )

    private static func dynamic(light: NSColor, dark: NSColor) -> Color {
        Color(
            nsColor: NSColor(name: nil) { appearance in
                switch appearance.bestMatch(from: [.darkAqua, .vibrantDark, .aqua, .vibrantLight]) {
                case .darkAqua, .vibrantDark:
                    return dark
                default:
                    return light
                }
            }
        )
    }
}
