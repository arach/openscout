import SwiftUI

#if os(macOS)
import AppKit
#endif

/// User-tunable appearance for the Scout desktop app. Today: window
/// transparency, with theme mode + design-token overrides to follow (they
/// land alongside the adaptive palette). Backed by UserDefaults so choices
/// persist; a single shared instance is injected at the root so the settings
/// panel and the window configurator read/write the same state.
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

    /// Reserved for the adaptive-palette work; persisted now so the choice
    /// survives the upgrade.
    @Published var themeMode: ScoutThemeMode {
        didSet { defaults.set(themeMode.rawValue, forKey: Keys.theme) }
    }

    /// 1.0 = fully opaque; lower lets the desktop show through the window.
    @Published var windowOpacity: Double {
        didSet { defaults.set(windowOpacity, forKey: Keys.opacity) }
    }

    static let minOpacity: Double = 0.5
    static let maxOpacity: Double = 1.0

    private let defaults = UserDefaults.standard

    private enum Keys {
        static let theme = "scout.appearance.themeMode"
        static let opacity = "scout.appearance.windowOpacity"
    }

    private init() {
        themeMode = ScoutThemeMode(rawValue: defaults.string(forKey: Keys.theme) ?? "") ?? .dark
        let stored = defaults.double(forKey: Keys.opacity)
        windowOpacity = stored == 0 ? Self.maxOpacity : min(max(stored, Self.minOpacity), Self.maxOpacity)
    }
}

#if os(macOS)
/// Applies live appearance settings to the hosting NSWindow. Lives in the view
/// tree as a background so it re-applies whenever the settings change.
/// `HudWindowChrome` forces the window opaque/dark; `alphaValue` composites on
/// top of that, so the transparency slider works without fighting it.
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
        let value = opacity
        let mode = themeMode
        // Defer past HudChromeShell's own HudWindowChrome (which hard-sets
        // .darkAqua once on launch) so the picker's choice wins.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            guard let window = view.window else { return }
            window.alphaValue = value
            window.isOpaque = value >= 1.0
            switch mode {
            case .system: window.appearance = nil
            case .light: window.appearance = NSAppearance(named: .aqua)
            case .dark: window.appearance = NSAppearance(named: .darkAqua)
            }
        }
    }
}
#endif
