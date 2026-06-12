import SwiftUI

#if os(macOS)
import AppKit
#endif

/// User-tunable appearance for the Scout desktop app. Backed by UserDefaults so
/// choices persist; a single shared instance is injected at the root so the
/// settings panel and the window configurator read/write the same state.
enum ScoutThemeMode: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "System"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

@MainActor
final class ScoutAppearance: ObservableObject {
    static let shared = ScoutAppearance()

    @Published var themeMode: ScoutThemeMode {
        willSet { defaults.set(newValue.rawValue, forKey: Keys.theme) }
    }

    @Published var themePreset: ScoutThemePreset {
        willSet { defaults.set(newValue.rawValue, forKey: ScoutThemePreset.defaultsKey) }
    }

    @Published var accentPalette: ScoutAccentPalette {
        willSet { defaults.set(newValue.rawValue, forKey: ScoutAccentPalette.defaultsKey) }
    }

    /// 1.0 = fully opaque; lower lets the desktop show through the window.
    @Published var windowOpacity: Double {
        didSet { defaults.set(windowOpacity, forKey: Keys.opacity) }
    }

    /// When on, hovering an accent swatch in Settings previews that accent in the
    /// theme cards (contained to the panel — no app-wide repaint).
    @Published var previewAccentsOnHover: Bool {
        willSet { defaults.set(newValue, forKey: Keys.previewAccentsOnHover) }
    }

    static let minOpacity: Double = 0.0
    static let maxOpacity: Double = 1.0

    private let defaults = UserDefaults.standard

    private enum Keys {
        static let theme = "scout.appearance.themeMode"
        static let opacity = "scout.appearance.windowOpacity"
        static let accentDefaultMigration = "scout.appearance.accentPalette.blueDefaultMigration.v1"
        static let previewAccentsOnHover = "scout.appearance.previewAccentsOnHover"
    }

    private init() {
        themeMode = ScoutThemeMode(rawValue: defaults.string(forKey: Keys.theme) ?? "") ?? .dark
        themePreset = ScoutThemePreset(rawValue: defaults.string(forKey: ScoutThemePreset.defaultsKey) ?? "") ?? .scout
        let storedAccent = defaults.string(forKey: ScoutAccentPalette.defaultsKey)
        if !defaults.bool(forKey: Keys.accentDefaultMigration),
           storedAccent == nil || storedAccent == ScoutAccentPalette.forest.rawValue {
            accentPalette = .blue
            defaults.set(ScoutAccentPalette.blue.rawValue, forKey: ScoutAccentPalette.defaultsKey)
            defaults.set(true, forKey: Keys.accentDefaultMigration)
        } else {
            accentPalette = ScoutAccentPalette(rawValue: storedAccent ?? "") ?? .blue
        }
        let stored = defaults.object(forKey: Keys.opacity) as? Double
        windowOpacity = stored.map { min(max($0, Self.minOpacity), Self.maxOpacity) } ?? Self.maxOpacity
        previewAccentsOnHover = defaults.object(forKey: Keys.previewAccentsOnHover) as? Bool ?? true
    }

    static var currentWindowOpacity: Double {
        let value = UserDefaults.standard.object(forKey: Keys.opacity) as? Double ?? maxOpacity
        return min(max(value, minOpacity), maxOpacity)
    }
}

#if os(macOS)
/// Applies live appearance settings to the hosting NSWindow. Lives in the view
/// tree as a background so it re-applies whenever the settings change.
/// The window itself stays fully alpha-opaque for legible text. Scout's surface
/// fills and the material backdrop carry the user-facing opacity treatment.
struct ScoutWindowConfigurator: NSViewRepresentable {
    var opacity: Double
    var themeMode: ScoutThemeMode

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        apply(from: view)
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        apply(from: view)
    }

    private func apply(from view: NSView) {
        let mode = themeMode
        // Defer past HudChromeShell's own HudWindowChrome (which hard-sets
        // .darkAqua once on launch) so the picker's choice wins. Guard EVERY
        // assignment: re-setting window.appearance on each SwiftUI
        // update invalidates SwiftUI's internal WindowAppearanceViewModel, which
        // re-resolves the window background style read by every view — so the
        // whole tree (all those Buttons) re-renders every frame and idle CPU
        // sits ~35%. Only touch the window when a value actually changed.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            guard let window = view.window else { return }
            if window.alphaValue != 1 { window.alphaValue = 1 }
            if window.isOpaque { window.isOpaque = false }
            if window.backgroundColor != .clear { window.backgroundColor = .clear }
            let desired: NSAppearance?
            switch mode {
            case .system: desired = nil
            case .light: desired = NSAppearance(named: .aqua)
            case .dark: desired = NSAppearance(named: .darkAqua)
            }
            if window.appearance?.name != desired?.name { window.appearance = desired }
        }
    }
}

struct ScoutWindowBackdrop: NSViewRepresentable {
    var opacity: Double

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView(frame: .zero)
        view.material = .hudWindow
        view.blendingMode = .behindWindow
        view.state = .active
        view.isEmphasized = true
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.alphaValue = 1 - min(max(opacity, 0), 1)
    }
}
#endif
