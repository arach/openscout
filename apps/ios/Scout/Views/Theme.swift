// Theme — Shared design tokens for the Dispatch iOS client.
//
// Dark-first palette, monospace code typography, consistent spacing.
// All views reference these tokens instead of hard-coding values.

import Foundation
import SwiftUI

// MARK: - Color Palette

enum ScoutColors {
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

enum ScoutTypography {
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

enum ScoutSpacing {
    static let xxs: CGFloat = 2
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

// MARK: - Corner Radius

enum ScoutRadius {
    static let sm: CGFloat = 6
    static let md: CGFloat = 10
    static let lg: CGFloat = 14
    static let xl: CGFloat = 20
}

// MARK: - Card Style

struct ScoutCardModifier: ViewModifier {
    var padding: CGFloat = ScoutSpacing.md
    var cornerRadius: CGFloat = ScoutRadius.md

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(ScoutColors.surfaceRaisedAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(ScoutColors.border, lineWidth: 0.5)
            )
    }
}

extension View {
    func scoutCard(padding: CGFloat = ScoutSpacing.md,
                    cornerRadius: CGFloat = ScoutRadius.md) -> some View {
        modifier(ScoutCardModifier(padding: padding, cornerRadius: cornerRadius))
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
        case .active: ScoutColors.statusActive
        case .connecting: ScoutColors.statusStreaming
        case .idle: ScoutColors.statusIdle
        case .error: ScoutColors.statusError
        case .closed: ScoutColors.statusIdle
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
            .fill(ScoutColors.accent)
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
            .fill(ScoutColors.accent.opacity(0.8))
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
        case "openai", "gpt", "codex": "brain"
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
        case "codex": "Codex"
        case "openai": "OpenAI"
        case "anthropic": "Anthropic"
        case "groq": "Groq"
        case "together": "Together"
        case "lm-studio", "lmstudio": "LM Studio"
        default: adapterType
        }
    }
}

// MARK: - Harness / Model Catalog

enum ScoutModelCatalog {
    static func launchOptions(for adapterType: String?) -> [String] {
        switch normalizedAdapterType(adapterType) {
        case "claude-code":
            return ["sonnet", "opus", "haiku"]
        default:
            return []
        }
    }

    static func composerOptions(for adapterType: String?) -> [String] {
        switch normalizedAdapterType(adapterType) {
        case "openai":
            return ["gpt-5.4", "gpt-5.4-mini", "o4-mini"]
        default:
            return []
        }
    }

    static func supportsComposerModelSelection(for adapterType: String?) -> Bool {
        !composerOptions(for: adapterType).isEmpty
    }

    static func supportsComposerEffortSelection(for adapterType: String?) -> Bool {
        switch normalizedAdapterType(adapterType) {
        case "openai":
            return true
        default:
            return false
        }
    }

    static func normalizedAdapterType(_ adapterType: String?) -> String? {
        guard let adapterType else { return nil }

        switch adapterType.lowercased() {
        case "claude", "claude-code":
            return "claude-code"
        case "openai", "openai-compat":
            return "openai"
        case "codex":
            return "codex"
        default:
            return adapterType.lowercased()
        }
    }
}

// MARK: - Model Label Helper

struct ScoutModelDescriptor: Sendable {
    let raw: String
    let title: String
    let subtitle: String?
    let detail: String?

    var inlineLabel: String {
        guard let detail, !detail.isEmpty else { return title }
        return "\(title) · \(detail)"
    }

    var menuLabel: String {
        guard let subtitle, !subtitle.isEmpty else { return title }
        return "\(title) — \(subtitle)"
    }
}

enum ScoutModelLabel {
    static func describe(_ rawModel: String?) -> ScoutModelDescriptor? {
        guard let raw = rawModel?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else {
            return nil
        }

        let normalized = raw.lowercased()
        let snapshotDate = snapshotDate(in: normalized)
        let cleaned = removingTrailingSnapshot(from: normalized)
        let provider = providerName(for: cleaned)
        let detailComponents = detailComponents(for: cleaned, snapshotDate: snapshotDate)
        let detail = detailComponents.joined(separator: " · ")
        var subtitleComponents: [String] = []
        if let provider {
            subtitleComponents.append(provider)
        }
        subtitleComponents.append(contentsOf: detailComponents)

        return ScoutModelDescriptor(
            raw: raw,
            title: title(for: cleaned, fallback: raw),
            subtitle: subtitleComponents.isEmpty ? nil : subtitleComponents.joined(separator: " · "),
            detail: detail.isEmpty ? nil : detail
        )
    }

    static func displayText(for rawModel: String?, fallback: String = "Default") -> String {
        describe(rawModel)?.title ?? fallback
    }

    private static func detailComponents(for cleaned: String, snapshotDate: Date?) -> [String] {
        var components: [String] = []

        if cleaned.contains("opus") {
            components.append("flagship")
        } else if cleaned.contains("sonnet") {
            components.append("balanced")
        } else if cleaned.contains("haiku") {
            components.append("fast")
        }

        if cleaned.contains("codex") {
            components.append("coding")
        } else if cleaned.range(of: #"^o\d"#, options: .regularExpression) != nil {
            components.append("reasoning")
        }

        if cleaned.contains("mini") {
            components.append("smaller/faster")
        } else if cleaned.contains("nano") {
            components.append("smallest")
        } else if cleaned.contains("preview") {
            components.append("preview")
        }

        if let snapshotDate {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "MMM yyyy"
            components.append("snapshot \(formatter.string(from: snapshotDate))")
        } else if cleaned.contains("latest") {
            components.append("rolling")
        }

        var deduped: [String] = []
        for component in components where !deduped.contains(component) {
            deduped.append(component)
        }
        return deduped
    }

    private static func providerName(for cleaned: String) -> String? {
        if cleaned.hasPrefix("claude") {
            return "Anthropic"
        }
        if cleaned.hasPrefix("gpt")
            || cleaned.range(of: #"^o\d"#, options: .regularExpression) != nil
            || cleaned.contains("codex") {
            return "OpenAI"
        }
        if cleaned.hasPrefix("gemini") {
            return "Google"
        }
        if cleaned.hasPrefix("llama") {
            return "Meta"
        }
        if cleaned.hasPrefix("qwen") {
            return "Qwen"
        }
        return nil
    }

    private static func title(for cleaned: String, fallback: String) -> String {
        let tokens = cleaned
            .split(whereSeparator: { $0 == "-" || $0 == "_" })
            .map(String.init)
            .filter { !$0.isEmpty }
        guard let first = tokens.first else {
            return fallback
        }

        if first == "claude" {
            let family = tokens.dropFirst().first.map(displayToken) ?? "Claude"
            let version = versionString(from: Array(tokens.dropFirst(2)))
            return ["Claude", family == "Claude" ? nil : family, version]
                .compactMap { $0 }
                .joined(separator: " ")
        }

        if first == "gpt" {
            let version = tokens.dropFirst().first.map(displayToken) ?? ""
            let variants = tokens.dropFirst(2).map(displayToken)
            return (["GPT", version] + variants)
                .filter { !$0.isEmpty }
                .joined(separator: " ")
        }

        if first.range(of: #"^o\d"#, options: .regularExpression) != nil {
            let variants = tokens.dropFirst().map(displayToken)
            return ([first] + variants)
                .filter { !$0.isEmpty }
                .joined(separator: " ")
        }

        return tokens.map(displayToken).joined(separator: " ")
    }

    private static func versionString(from tokens: [String]) -> String? {
        let versionTokens = tokens.prefix { token in
            token.range(of: #"^\d+(?:\.\d+)?$"#, options: .regularExpression) != nil
        }
        guard !versionTokens.isEmpty else { return nil }
        if let first = versionTokens.first, versionTokens.count == 1 {
            return first
        }
        return Array(versionTokens).joined(separator: ".")
    }

    private static func displayToken(_ token: String) -> String {
        switch token.lowercased() {
        case "gpt": return "GPT"
        case "codex": return "Codex"
        case "claude": return "Claude"
        case "sonnet": return "Sonnet"
        case "opus": return "Opus"
        case "haiku": return "Haiku"
        case "mini": return "Mini"
        case "nano": return "Nano"
        case "lm": return "LM"
        default: return token.capitalized
        }
    }

    private static func snapshotDate(in value: String) -> Date? {
        guard let range = value.range(of: #"20\d{2}(?:[-_]?\d{2}){2}"#, options: .regularExpression) else {
            return nil
        }

        let digits = value[range].filter(\.isNumber)
        guard digits.count == 8 else { return nil }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd"
        return formatter.date(from: String(digits))
    }

    private static func removingTrailingSnapshot(from value: String) -> String {
        guard let range = value.range(of: #"(?:-|_)?20\d{2}(?:[-_]?\d{2}){2}$"#, options: .regularExpression) else {
            return value
        }

        return String(value[..<range.lowerBound])
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
