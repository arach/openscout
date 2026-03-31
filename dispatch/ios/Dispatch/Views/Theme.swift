// Theme — Shared design tokens for the Dispatch iOS client.
//
// Dark-first palette, monospace code typography, consistent spacing.
// All views reference these tokens instead of hard-coding values.

import SwiftUI

// MARK: - Color Palette

enum DispatchColors {
    // Backgrounds
    static let background = Color("background", bundle: nil)
    static let surface = Color("surface", bundle: nil)
    static let surfaceRaised = Color("surfaceRaised", bundle: nil)

    // Adaptive fallbacks (used if asset catalog colors are not yet defined)
    static let backgroundAdaptive = Color(light: .init(white: 0.98), dark: .init(white: 0.07))
    static let surfaceAdaptive = Color(light: .init(white: 0.94), dark: .init(white: 0.11))
    static let surfaceRaisedAdaptive = Color(light: .white, dark: .init(white: 0.15))

    // Text
    static let textPrimary = Color(light: .init(white: 0.1), dark: .init(white: 0.93))
    static let textSecondary = Color(light: .init(white: 0.4), dark: .init(white: 0.55))
    static let textMuted = Color(light: .init(white: 0.6), dark: .init(white: 0.38))

    // Accent
    static let accent = Color(light: .init(red: 0.35, green: 0.55, blue: 1.0),
                               dark: .init(red: 0.45, green: 0.65, blue: 1.0))

    // Status
    static let statusActive = Color(light: .init(red: 0.2, green: 0.78, blue: 0.4),
                                     dark: .init(red: 0.3, green: 0.85, blue: 0.5))
    static let statusStreaming = Color(light: .init(red: 1.0, green: 0.8, blue: 0.2),
                                       dark: .init(red: 1.0, green: 0.85, blue: 0.3))
    static let statusIdle = Color(light: .init(white: 0.65), dark: .init(white: 0.4))
    static let statusError = Color(light: .init(red: 1.0, green: 0.3, blue: 0.3),
                                    dark: .init(red: 1.0, green: 0.4, blue: 0.4))

    // Semantic
    static let diffAdded = Color(light: .init(red: 0.2, green: 0.7, blue: 0.3),
                                  dark: .init(red: 0.3, green: 0.8, blue: 0.4))
    static let diffRemoved = Color(light: .init(red: 0.9, green: 0.3, blue: 0.3),
                                    dark: .init(red: 1.0, green: 0.4, blue: 0.4))
    static let errorBackground = Color(light: .init(red: 1.0, green: 0.93, blue: 0.93),
                                        dark: .init(red: 0.25, green: 0.1, blue: 0.1))
    static let reasoningBackground = Color(light: .init(white: 0.95), dark: .init(white: 0.1))

    // Borders / Dividers
    static let border = Color(light: .init(white: 0.88), dark: .init(white: 0.18))
    static let divider = Color(light: .init(white: 0.9), dark: .init(white: 0.15))
}

// MARK: - Typography

enum DispatchTypography {
    static let codeFontName = "SF Mono"
    static let codeFontFallback = "Menlo"

    static func code(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    static func body(_ size: CGFloat = 15, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }

    static func caption(_ size: CGFloat = 12, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .default)
    }

    // Scaled variants for Dynamic Type
    static let codeBody: Font = .system(.body, design: .monospaced)
    static let codeCaption: Font = .system(.caption, design: .monospaced)
    static let codeFootnote: Font = .system(.footnote, design: .monospaced)
}

// MARK: - Spacing

enum DispatchSpacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

// MARK: - Corner Radius

enum DispatchRadius {
    static let sm: CGFloat = 6
    static let md: CGFloat = 10
    static let lg: CGFloat = 14
    static let xl: CGFloat = 20
}

// MARK: - Card Style

struct DispatchCardModifier: ViewModifier {
    var padding: CGFloat = DispatchSpacing.md
    var cornerRadius: CGFloat = DispatchRadius.md

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(DispatchColors.surfaceRaisedAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(DispatchColors.border, lineWidth: 0.5)
            )
    }
}

extension View {
    func dispatchCard(padding: CGFloat = DispatchSpacing.md,
                    cornerRadius: CGFloat = DispatchRadius.md) -> some View {
        modifier(DispatchCardModifier(padding: padding, cornerRadius: cornerRadius))
    }
}

// MARK: - Status Dot

struct StatusDot: View {
    let status: SessionStatus
    let size: CGFloat

    init(_ status: SessionStatus, size: CGFloat = 8) {
        self.status = status
        self.size = size
    }

    var color: Color {
        switch status {
        case .active: DispatchColors.statusActive
        case .connecting: DispatchColors.statusStreaming
        case .idle: DispatchColors.statusIdle
        case .error: DispatchColors.statusError
        case .closed: DispatchColors.statusIdle
        }
    }

    var isAnimated: Bool {
        status == .active || status == .connecting
    }

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .shadow(color: isAnimated ? color.opacity(0.6) : .clear, radius: isAnimated ? 4 : 0)
            .overlay {
                if isAnimated {
                    Circle()
                        .stroke(color.opacity(0.4), lineWidth: 1.5)
                        .frame(width: size + 4, height: size + 4)
                        .scaleEffect(isAnimated ? 1.0 : 0.5)
                        .opacity(isAnimated ? 0.0 : 1.0)
                        .animation(
                            .easeOut(duration: 1.5)
                            .repeatForever(autoreverses: false),
                            value: isAnimated
                        )
                }
            }
            .accessibilityLabel(accessibilityDescription)
    }

    private var accessibilityDescription: String {
        switch status {
        case .active: "Active"
        case .connecting: "Connecting"
        case .idle: "Idle"
        case .error: "Error"
        case .closed: "Closed"
        }
    }
}

// MARK: - Streaming Cursor

struct StreamingCursor: View {
    @State private var visible = true

    var body: some View {
        RoundedRectangle(cornerRadius: 1)
            .fill(DispatchColors.accent)
            .frame(width: 2, height: 16)
            .opacity(visible ? 1.0 : 0.0)
            .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: visible)
            .onAppear { visible = false }
            .accessibilityHidden(true)
    }
}

// MARK: - Pulse Indicator

struct PulseIndicator: View {
    @State private var animating = false

    var body: some View {
        Circle()
            .fill(DispatchColors.accent.opacity(0.8))
            .frame(width: 6, height: 6)
            .scaleEffect(animating ? 1.3 : 0.7)
            .opacity(animating ? 0.5 : 1.0)
            .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: animating)
            .onAppear { animating = true }
            .accessibilityLabel("Streaming")
    }
}

// MARK: - Adapter Icon Helper

enum AdapterIcon {
    static func systemName(for adapterType: String) -> String {
        switch adapterType.lowercased() {
        case "claude-code", "claude": "terminal"
        case "openai", "gpt": "brain"
        case "anthropic": "sparkles"
        case "groq": "bolt.fill"
        case "together": "square.stack.3d.up"
        case "lm-studio", "lmstudio": "desktopcomputer"
        default: "cpu"
        }
    }

    static func displayName(for adapterType: String) -> String {
        switch adapterType.lowercased() {
        case "claude-code": "Claude Code"
        case "openai": "OpenAI"
        case "anthropic": "Anthropic"
        case "groq": "Groq"
        case "together": "Together"
        case "lm-studio", "lmstudio": "LM Studio"
        default: adapterType
        }
    }
}

// MARK: - Relative Time Formatter

enum RelativeTime {
    static func string(from epochMs: Int) -> String {
        let date = Date(timeIntervalSince1970: Double(epochMs) / 1000.0)
        return string(from: date)
    }

    static func string(from date: Date) -> String {
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 5 { return "just now" }
        if seconds < 60 { return "\(seconds)s ago" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        return "\(days)d ago"
    }

    static func string(fromISO iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) else {
            // Try without fractional seconds
            formatter.formatOptions = [.withInternetDateTime]
            guard let date = formatter.date(from: iso) else { return "" }
            return string(from: date)
        }
        return string(from: date)
    }
}

// MARK: - Color convenience for light/dark

extension Color {
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(dark)
                : UIColor(light)
        })
    }
}
