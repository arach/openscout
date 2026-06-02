import AppKit
import Foundation
import Quartz
import SwiftUI

// MARK: - Link encoding

/// Custom URL scheme used to carry a file path (and optional line) through a
/// SwiftUI `Text` link so it can be intercepted by `OpenURLAction`.
enum ScoutFileLink {
    static let scheme = "openscout-file"

    static func url(path: String, line: Int?) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = "open"
        var items = [URLQueryItem(name: "path", value: path)]
        if let line { items.append(URLQueryItem(name: "line", value: String(line))) }
        components.queryItems = items
        return components.url
    }

    static func parse(_ url: URL) -> (path: String, line: Int?)? {
        guard url.scheme == scheme,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let items = components.queryItems ?? []
        guard let path = items.first(where: { $0.name == "path" })?.value, !path.isEmpty else { return nil }
        let line = items.first(where: { $0.name == "line" })?.value.flatMap(Int.init)
        return (path, line)
    }
}

// MARK: - Detection

/// Finds file-path-like tokens in plain text. Matches absolute (`/…`), home
/// (`~/…`), and relative paths that carry a file extension, with an optional
/// `:line` / `:line:col` suffix.
enum ScoutFilePathDetector {
    struct Match {
        /// Range (over the source string) of the whole token, including any `:line` suffix.
        let nsRange: NSRange
        let path: String
        let line: Int?
    }

    private static let regex: NSRegularExpression = {
        // group 1: path (requires at least one `/`); group 2: line; trailing col ignored.
        let pattern = #"(~?/?(?:[A-Za-z0-9._+\-]+/)+[A-Za-z0-9._+\-]+)(?::(\d+))?(?::\d+)?"#
        return try! NSRegularExpression(pattern: pattern)
    }()

    static func matches(in text: String) -> [Match] {
        guard !text.isEmpty else { return [] }
        let ns = text as NSString
        let full = NSRange(location: 0, length: ns.length)
        var out: [Match] = []
        regex.enumerateMatches(in: text, range: full) { result, _, _ in
            guard let result else { return }
            let pathRange = result.range(at: 1)
            guard pathRange.location != NSNotFound else { return }

            var whole = result.range
            var path = ns.substring(with: pathRange)
            // A path never legitimately ends in a dot — trim sentence punctuation.
            while path.hasSuffix(".") {
                path.removeLast()
                whole.length -= 1
            }
            guard !path.isEmpty, isLikelyPath(path) else { return }

            // Skip URLs (the `//host/path` portion of e.g. `https://…`).
            let lookbackStart = max(0, whole.location - 3)
            let lookback = ns.substring(with: NSRange(location: lookbackStart, length: whole.location - lookbackStart))
            if lookback.hasSuffix("://") || lookback.hasSuffix(":/") { return }

            var line: Int?
            let lineRange = result.range(at: 2)
            if lineRange.location != NSNotFound {
                line = Int(ns.substring(with: lineRange))
            }
            out.append(Match(nsRange: whole, path: path, line: line))
        }
        return out
    }

    private static func isLikelyPath(_ token: String) -> Bool {
        if token.hasPrefix("/") || token.hasPrefix("~/") { return true }
        let last = token.split(separator: "/").last.map(String.init) ?? token
        return last.contains(".") // relative path must carry an extension
    }
}

// MARK: - AttributedString linkifying

enum ScoutFileLinkifier {
    /// Applies tappable `openscout-file://` links over any file paths found in
    /// the already-parsed attributed text.
    static func apply(to attributed: AttributedString, accent: Color) -> AttributedString {
        var result = attributed
        let plain = String(result.characters)
        let matches = ScoutFilePathDetector.matches(in: plain)
        guard !matches.isEmpty else { return result }

        for match in matches {
            guard let range = Range(match.nsRange, in: plain),
                  let url = ScoutFileLink.url(path: match.path, line: match.line) else { continue }
            let startOffset = plain.distance(from: plain.startIndex, to: range.lowerBound)
            let length = plain.distance(from: range.lowerBound, to: range.upperBound)
            let start = result.index(result.startIndex, offsetByCharacters: startOffset)
            let end = result.index(start, offsetByCharacters: length)
            result[start..<end].link = url
            result[start..<end].foregroundColor = accent
            result[start..<end].underlineStyle = .single
        }
        return result
    }
}

// MARK: - Opening

/// Local Quick Look preview in a reusable floating panel.
@MainActor
final class ScoutFilePreview: NSObject {
    static let shared = ScoutFilePreview()

    private var panel: NSPanel?
    private var preview: QLPreviewView?

    static func show(path: String) { shared.present(path) }

    private func present(_ path: String) {
        let expanded = (path as NSString).expandingTildeInPath
        guard FileManager.default.fileExists(atPath: expanded) else {
            NSSound.beep()
            return
        }
        let url = URL(fileURLWithPath: expanded)
        ensurePanel()
        let wasVisible = panel?.isVisible ?? false
        preview?.previewItem = url as NSURL
        panel?.title = url.lastPathComponent
        if !wasVisible { panel?.center() }
        panel?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func ensurePanel() {
        guard panel == nil else { return }
        let frame = NSRect(x: 0, y: 0, width: 760, height: 600)
        let view = QLPreviewView(frame: frame, style: .normal) ?? QLPreviewView(frame: frame)
        let panel = NSPanel(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .utilityWindow, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = view
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.title = "Preview"
        self.panel = panel
        self.preview = view
    }
}

/// Opens a file in the user's preferred editor, jumping to a line when known.
@MainActor
enum ScoutFileOpener {
    /// Override the editor by storing an absolute `.app` path under this key.
    static let editorDefaultsKey = "scout.fileEditorAppPath"

    static func openInEditor(path: String, line: Int?) {
        let expanded = (path as NSString).expandingTildeInPath
        guard FileManager.default.fileExists(atPath: expanded) else {
            NSSound.beep()
            return
        }
        let url = URL(fileURLWithPath: expanded)
        guard let app = editorAppURL() else {
            NSWorkspace.shared.open(url)
            return
        }
        // VS Code-family editors can jump to a line via their bundled CLI.
        if let line, let cli = cliBinary(forApp: app) {
            let process = Process()
            process.executableURL = cli
            process.arguments = ["--goto", "\(expanded):\(line)"]
            if (try? process.run()) != nil { return }
        }
        NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
    }

    private static func editorAppURL() -> URL? {
        if let custom = UserDefaults.standard.string(forKey: editorDefaultsKey),
           FileManager.default.fileExists(atPath: custom) {
            return URL(fileURLWithPath: custom)
        }
        let candidates = [
            "/Applications/Cursor.app",
            "\(NSHomeDirectory())/Applications/Cursor.app",
            "/Applications/Visual Studio Code.app",
            "/Applications/VSCodium.app",
            "/Applications/Zed.app",
            "/Applications/Sublime Text.app",
        ]
        return candidates.first { FileManager.default.fileExists(atPath: $0) }.map { URL(fileURLWithPath: $0) }
    }

    private static func cliBinary(forApp app: URL) -> URL? {
        let name = app.deletingPathExtension().lastPathComponent
        let binNames: [String]
        switch name {
        case "Cursor": binNames = ["cursor", "code"]
        case "Visual Studio Code": binNames = ["code"]
        case "VSCodium": binNames = ["codium", "code"]
        default: return nil
        }
        let binDir = app.appendingPathComponent("Contents/Resources/app/bin")
        return binNames
            .map { binDir.appendingPathComponent($0) }
            .first { FileManager.default.isExecutableFile(atPath: $0.path) }
    }
}
