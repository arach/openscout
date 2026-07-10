import SwiftUI

#if os(macOS)
import AppKit
#endif

/// Bridges the app's **resolved** theme to the embedded web viewers (observe /
/// repo-diff / session). Without it the web embeds fall back to a generic
/// light/dark design system — warm surfaces, a green accent — that visibly
/// doesn't match the native app. Passing the app's actual palette as
/// `?themeVars=<base64url(JSON)>` makes the embed render with the same surfaces,
/// accent, and status colors as the surrounding native chrome.
///
/// Native stays the single source of truth: the values are read from
/// `ScoutPalette`, so the bridge automatically tracks the active theme preset,
/// accent palette, and light/dark mode — no per-preset duplication on the web.
enum ScoutEmbedTheme {
    /// Query items for an embed URL: the theme **mode** (`theme=light|dark`,
    /// which the web reads even standalone) plus the encoded **palette**.
    static func queryItems(for colorScheme: ColorScheme) -> [URLQueryItem] {
        var items = [
            URLQueryItem(
                name: "theme",
                value: ScoutBranchDiffTheme(colorScheme: colorScheme).queryValue
            )
        ]
        if let vars = encodedThemeVars(for: colorScheme) {
            items.append(URLQueryItem(name: "themeVars", value: vars))
        }
        return items
    }

    /// The encoded-palette query item for builders that already hold a
    /// `ScoutBranchDiffTheme` (the diff + session embeds). `nil` if encoding
    /// fails, so callers can append it conditionally. base64url is query-safe,
    /// so it rides either `queryItems` or `percentEncodedQueryItems` untouched.
    static func themeVarsQueryItem(for theme: ScoutBranchDiffTheme) -> URLQueryItem? {
        let scheme: ColorScheme = theme == .dark ? .dark : .light
        guard let vars = encodedThemeVars(for: scheme) else { return nil }
        return URLQueryItem(name: "themeVars", value: vars)
    }

    /// The palette encoded as base64url(JSON) of a `--hud-*` CSS-variable map,
    /// resolved for `colorScheme`. base64url (no `+` `/` `=`) so it rides a query
    /// value untouched — `URLSearchParams` would otherwise turn `+` into a space.
    static func encodedThemeVars(for colorScheme: ColorScheme) -> String? {
        #if os(macOS)
        let appearance = NSAppearance(named: colorScheme == .dark ? .darkAqua : .aqua)
            ?? NSAppearance(named: .aqua)
        var vars: [String: String] = [:]
        let resolve = {
            // Resolve the preset's raw colors, NOT `ScoutPalette.bg/surface`:
            // those multiply in the window-opacity setting, and the embed can't
            // reproduce native translucency — WKWebView composites the alpha
            // against an undefined (near-black) backdrop, so an 84%-alpha paper
            // background renders as a flat mud gray. Opaque values keep the
            // embed deterministic; translucency stays a native-only effect.
            let colors = ScoutThemePreset.current.colors
                .applying(palette: ScoutAccentPalette.current)
            vars = [
                "--hud-bg": hex(colors.bg),
                "--hud-surface": hex(colors.surface),
                "--hud-ink": hex(colors.ink),
                "--hud-muted": hex(colors.muted),
                "--hud-dim": hex(colors.dim),
                "--hud-border": hex(colors.border),
                "--hud-accent": hex(colors.accent),
                "--hud-accent-soft": hex(colors.accentSoft),
                "--hud-status-ok": hex(colors.statusOk),
                "--hud-status-warn": hex(colors.statusWarn),
                "--hud-status-error": hex(colors.statusError),
                "--info": hex(colors.statusInfo),
            ]
        }
        if let appearance {
            appearance.performAsCurrentDrawingAppearance(resolve)
        } else {
            resolve()
        }
        guard let data = try? JSONSerialization.data(
            withJSONObject: vars,
            options: [.sortedKeys]
        ) else { return nil }
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        #else
        return nil
        #endif
    }

    #if os(macOS)
    /// Resolve a SwiftUI color to an `#RRGGBB`(`AA`) string in sRGB. Must be
    /// called inside `performAsCurrentDrawingAppearance` so adaptive colors pick
    /// the right light/dark variant.
    private static func hex(_ color: Color) -> String {
        let ns = NSColor(color).usingColorSpace(.sRGB) ?? NSColor.black
        let r = Int((ns.redComponent * 255).rounded())
        let g = Int((ns.greenComponent * 255).rounded())
        let b = Int((ns.blueComponent * 255).rounded())
        let a = ns.alphaComponent
        if a >= 0.999 {
            return String(format: "#%02X%02X%02X", r, g, b)
        }
        return String(format: "#%02X%02X%02X%02X", r, g, b, Int((a * 255).rounded()))
    }
    #endif
}
