import SwiftUI

enum ScoutTheme {
    static let accent = Color(red: 0.31, green: 0.62, blue: 1.0)
    static let accentSoft = Color(red: 0.31, green: 0.62, blue: 1.0).opacity(0.14)

    static let canvas = Color(red: 0.08, green: 0.09, blue: 0.11)
    static let sidebar = Color(red: 0.10, green: 0.11, blue: 0.14)
    static let surface = Color(red: 0.14, green: 0.15, blue: 0.19)
    static let surfaceStrong = Color(red: 0.11, green: 0.12, blue: 0.15)

    static let border = Color.white.opacity(0.08)
    static let borderStrong = Color.white.opacity(0.14)

    static let ink = Color(red: 0.95, green: 0.96, blue: 0.98)
    static let inkSecondary = Color(red: 0.76, green: 0.79, blue: 0.84)
    static let inkMuted = Color(red: 0.56, green: 0.60, blue: 0.67)
    static let inkFaint = Color(red: 0.42, green: 0.46, blue: 0.53)

    static let hover = Color.white.opacity(0.06)
    static let selection = accent.opacity(0.16)

    static let success = Color.green
    static let warning = Color.orange
    static let shadow = Color.black.opacity(0.08)
}
