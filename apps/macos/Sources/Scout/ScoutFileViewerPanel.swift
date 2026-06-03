import AppKit
import Foundation
import HudsonShell
import HudsonUI
import SwiftUI

// MARK: - Controller

/// Shared, app-wide handle for the embedded file viewer. File links are detected
/// deep in the message render tree (`ScoutMarkdownView`), so rather than thread a
/// closure through every layer we route opens through this singleton; the root
/// view observes it and mounts the panel in the trailing slot.
@MainActor
final class ScoutFileViewer: ObservableObject {
    static let shared = ScoutFileViewer()

    struct Target: Equatable {
        let path: String
        let line: Int?
    }

    @Published var target: Target?

    func open(path: String, line: Int?) {
        target = Target(path: path, line: line)
    }

    func close() {
        target = nil
    }
}

enum ScoutFileViewerMetrics {
    static let defaultWidth: CGFloat = 540
    static let widthRange: ClosedRange<CGFloat> = 380...960
    /// Files larger than this are not slurped into memory for preview.
    static let maxByteSize = 2_000_000
    /// Cap the rendered line count so pathological files don't stall layout.
    static let maxLines = 6000
}

// MARK: - Document loading

/// A file read for preview — either its syntax-highlighted lines, or a human
/// reason it couldn't be shown (with the pop-out always available as the escape
/// hatch). Highlighting is precomputed once on load, not per scroll.
struct ScoutFileDocument: Sendable {
    let url: URL
    let lineCount: Int
    let highlighted: [AttributedString]
    let rawText: String
    let isMarkdown: Bool
    let truncated: Bool
    let error: String?

    /// Single lines longer than this are clipped before highlight + render, so a
    /// minified one-liner (e.g. a packed JSON) can't blow up layout cost.
    static let maxLineLength = 2000

    private static func failure(_ url: URL, _ message: String) -> ScoutFileDocument {
        ScoutFileDocument(url: url, lineCount: 0, highlighted: [], rawText: "", isMarkdown: false, truncated: false, error: message)
    }

    static func load(path: String) -> ScoutFileDocument {
        let expanded = (path as NSString).expandingTildeInPath
        let url = URL(fileURLWithPath: expanded)

        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: expanded, isDirectory: &isDir) else {
            return failure(url, "Not found:\n\(expanded)")
        }
        if isDir.boolValue {
            return failure(url, "That's a folder — open it in your editor.")
        }

        let attrs = try? FileManager.default.attributesOfItem(atPath: expanded)
        let size = (attrs?[.size] as? Int) ?? 0
        if size > ScoutFileViewerMetrics.maxByteSize {
            let mb = Double(size) / 1_000_000
            return failure(url, String(format: "Too large to preview (%.1f MB).", mb))
        }

        guard let text = try? String(contentsOf: url, encoding: .utf8) else {
            return failure(url, "Can't preview this file (binary or non-UTF-8).")
        }

        let all = text.components(separatedBy: "\n")
        let truncated = all.count > ScoutFileViewerMetrics.maxLines
        let limited = truncated ? Array(all.prefix(ScoutFileViewerMetrics.maxLines)) : all
        let lines = limited.map { $0.count > maxLineLength ? String($0.prefix(maxLineLength)) + " …" : $0 }
        let language = ScoutCodeLanguage.from(ext: url.pathExtension)
        let highlighted = ScoutSyntaxHighlighter.highlight(lines: lines, language: language)
        let isMarkdown = ["md", "markdown", "mdown", "mkd", "mdx"].contains(url.pathExtension.lowercased())
        return ScoutFileDocument(
            url: url,
            lineCount: lines.count,
            highlighted: highlighted,
            rawText: text,
            isMarkdown: isMarkdown,
            truncated: truncated,
            error: nil
        )
    }
}

// MARK: - Panel

/// Embedded, resizable file preview that lives in the trailing slot beside the
/// inspector/observe sidecars. Read-only line-numbered text in the HUD palette,
/// with the active line highlighted and a one-click pop-out to the real editor.
struct ScoutFileViewerPanel: View {
    let target: ScoutFileViewer.Target
    @Binding var width: CGFloat
    let onClose: () -> Void
    let onOpenInEditor: () -> Void

    @State private var document: ScoutFileDocument?
    /// For markdown: rendered preview vs. raw source. Defaults to preview.
    @State private var showPreview = true

    private var fileName: String { (target.path as NSString).lastPathComponent }
    private var dirPath: String {
        let dir = (target.path as NSString).deletingLastPathComponent
        return dir.isEmpty ? target.path : dir
    }

    var body: some View {
        HudSidebarPanel(
            width: $width,
            edge: .trailing,
            widthRange: ScoutFileViewerMetrics.widthRange
        ) {
            VStack(spacing: 0) {
                header
                HudDivider(color: ScoutDesign.hairline)
                content
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(ScoutDesign.chrome)
        }
        .task(id: target.path) {
            // Read + highlight off the main thread so a big or minified file
            // shows the spinner instead of beachballing the whole app.
            let path = target.path
            let loaded = await Task.detached(priority: .userInitiated) {
                ScoutFileDocument.load(path: path)
            }.value
            guard !Task.isCancelled else { return }
            document = loaded
            showPreview = loaded.isMarkdown
        }
    }

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: glyph(forFile: fileName))
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(HudPalette.accent)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudPalette.accentSoft))

            VStack(alignment: .leading, spacing: 1) {
                Text(fileName)
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(dirPath)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(HudPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: HudSpacing.sm)

            if document?.isMarkdown == true {
                ScoutMarkdownModeToggle(showPreview: $showPreview)
            }

            if let line = target.line, !(document?.isMarkdown == true && showPreview) {
                Text("L\(line)")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(HudPalette.muted)
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, HudSpacing.xxs)
                    .background(RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous).fill(HudSurface.inset))
            }

            Button(action: onOpenInEditor) {
                Image(systemName: "arrow.up.forward.app")
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .foregroundStyle(HudPalette.muted)
            .frame(width: 26, height: 26)
            .contentShape(Rectangle())
            .help("Open in editor")

            Button(action: onClose) {
                Image(systemName: "sidebar.right")
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .foregroundStyle(HudPalette.muted)
            .frame(width: 26, height: 26)
            .contentShape(Rectangle())
            .help("Close file viewer")
        }
        .padding(.horizontal, HudSpacing.lg)
        .frame(height: 48)
        .background(ScoutDesign.chrome)
    }

    @ViewBuilder
    private var content: some View {
        if let document {
            if let error = document.error {
                errorState(error)
            } else if document.isMarkdown, showPreview {
                markdownPreview(document)
            } else {
                code(document)
            }
        } else {
            ProgressView()
                .controlSize(.small)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func markdownPreview(_ document: ScoutFileDocument) -> some View {
        ScrollView(.vertical) {
            ScoutMarkdownView(
                text: document.rawText,
                baseDirectory: (target.path as NSString).deletingLastPathComponent
            )
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .scoutOverlayScrollers()
        }
        .scrollIndicators(.visible)
    }

    private func code(_ document: ScoutFileDocument) -> some View {
        let gutter = gutterWidth(for: document.lineCount)
        return ScrollViewReader { proxy in
            ScrollView(.vertical) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(document.highlighted.enumerated()), id: \.offset) { index, line in
                        lineRow(number: index + 1, content: line, gutter: gutter)
                            .id(index + 1)
                    }
                    if document.truncated {
                        Text("Preview truncated at \(ScoutFileViewerMetrics.maxLines) lines — open in editor for the rest.")
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(HudPalette.dim)
                            .padding(HudSpacing.lg)
                    }
                }
                .padding(.vertical, HudSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .scoutOverlayScrollers()
            }
            .scrollIndicators(.visible)
            .onAppear { jumpToTargetLine(proxy, lineCount: document.lineCount) }
            .onChange(of: target.line) { _, _ in jumpToTargetLine(proxy, lineCount: document.lineCount) }
        }
    }

    private func lineRow(number: Int, content: AttributedString, gutter: CGFloat) -> some View {
        let isTarget = target.line == number
        return HStack(alignment: .top, spacing: HudSpacing.md) {
            Text("\(number)")
                .font(HudFont.mono(HudTextSize.xxs))
                .monospacedDigit()
                .foregroundStyle(isTarget ? HudPalette.accent : HudPalette.dim)
                .frame(width: gutter, alignment: .trailing)
            Text(content)
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(HudPalette.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, HudSpacing.lg)
        .padding(.vertical, 1)
        .background(isTarget ? HudPalette.accentSoft : Color.clear)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: HudSpacing.md) {
            Image(systemName: "doc.questionmark")
                .font(HudFont.ui(HudTextSize.xxl, weight: .regular))
                .foregroundStyle(HudPalette.dim)
            Text(message)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(HudPalette.muted)
                .multilineTextAlignment(.center)
            Button(action: onOpenInEditor) {
                Text("Open in editor")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .foregroundStyle(HudPalette.accent)
        }
        .padding(HudSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func jumpToTargetLine(_ proxy: ScrollViewProxy, lineCount: Int) {
        guard let line = target.line, line >= 1, line <= lineCount else { return }
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(line, anchor: .center)
            }
        }
    }

    private func gutterWidth(for lineCount: Int) -> CGFloat {
        let digits = max(2, String(lineCount).count)
        return CGFloat(digits) * 7 + 4
    }

    private func glyph(forFile name: String) -> String {
        switch (name as NSString).pathExtension.lowercased() {
        case "swift", "ts", "tsx", "js", "jsx", "py", "rs", "go", "rb", "c", "cpp", "h", "java", "kt":
            return "chevron.left.forwardslash.chevron.right"
        case "json", "yaml", "yml", "toml", "plist", "xml":
            return "curlybraces"
        case "md", "markdown", "txt", "rtf":
            return "doc.text"
        case "png", "jpg", "jpeg", "gif", "svg", "webp", "heic":
            return "photo"
        default:
            return "doc"
        }
    }
}

/// Compact Preview ⇄ Source segmented toggle for markdown files.
private struct ScoutMarkdownModeToggle: View {
    @Binding var showPreview: Bool

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            segment("Preview", active: showPreview) { showPreview = true }
            segment("Source", active: !showPreview) { showPreview = false }
        }
        .padding(HudSpacing.xxs)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
    }

    private func segment(_ title: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .foregroundStyle(active ? HudPalette.ink : HudPalette.muted)
                .padding(.horizontal, HudSpacing.sm)
                .frame(height: 20)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard - 2, style: .continuous)
                        .fill(active ? HudSurface.selected(HudPalette.accent) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
    }
}

// MARK: - Syntax highlighting

/// Coarse language buckets — enough to drive comment/keyword rules for a
/// read-only preview without pulling in a full grammar.
enum ScoutCodeLanguage {
    case cFamily   // swift, ts/js, c/c++, go, rust, java, kotlin, css…
    case script    // python, ruby, shell, yaml, toml ( `#` comments )
    case json
    case plain

    static func from(ext: String) -> ScoutCodeLanguage {
        switch ext.lowercased() {
        case "swift", "ts", "tsx", "js", "jsx", "mjs", "cjs",
             "c", "cc", "cpp", "cxx", "h", "hpp", "m", "mm",
             "java", "kt", "kts", "go", "rs", "scala", "cs", "php",
             "css", "scss", "less":
            return .cFamily
        case "py", "rb", "sh", "bash", "zsh", "yaml", "yml",
             "toml", "ini", "conf", "cfg", "r", "pl", "rake", "gemspec":
            return .script
        case "json", "jsonc":
            return .json
        default:
            return .plain
        }
    }

    var lineComment: String? {
        switch self {
        case .cFamily: return "//"
        case .script: return "#"
        case .json, .plain: return nil
        }
    }

    var blockComments: Bool { self == .cFamily }
    var usesTypes: Bool { self == .cFamily }
    var highlightsLiterals: Bool { self != .plain }

    var keywords: Set<String> {
        switch self {
        case .cFamily: return Self.cKeywords
        case .script: return Self.scriptKeywords
        case .json: return ["true", "false", "null"]
        case .plain: return []
        }
    }

    // A deliberately broad union across the C-family + Swift + TS/JS + Go/Rust.
    // Over-matching the odd word as a keyword is harmless in a preview.
    private static let cKeywords: Set<String> = [
        "let", "var", "const", "func", "function", "fn", "def",
        "class", "struct", "enum", "protocol", "interface", "extension", "impl", "trait",
        "import", "export", "from", "package", "use", "mod", "module", "namespace",
        "return", "if", "else", "for", "while", "switch", "case", "default", "match",
        "break", "continue", "guard", "defer", "do", "try", "catch", "finally", "throw", "throws",
        "async", "await", "yield", "in", "is", "as", "where", "typealias", "associatedtype", "type",
        "self", "super", "this", "init", "deinit", "new", "delete",
        "static", "public", "private", "internal", "fileprivate", "open", "final", "override", "pub", "mut",
        "extends", "implements", "abstract", "virtual", "operator", "typeof", "instanceof", "void",
        "true", "false", "nil", "null", "undefined", "let", "go", "chan", "map", "range", "select",
        "int", "string", "bool", "float", "double", "char", "byte", "rune", "any", "never", "unknown",
    ]

    private static let scriptKeywords: Set<String> = [
        "def", "class", "return", "if", "elif", "else", "for", "while",
        "import", "from", "as", "in", "is", "not", "and", "or", "with",
        "try", "except", "finally", "raise", "lambda", "pass", "break", "continue",
        "yield", "async", "await", "global", "nonlocal", "assert", "del",
        "True", "False", "None", "self", "end", "do", "then", "module",
        "require", "require_relative", "begin", "rescue", "ensure", "puts", "attr_accessor",
        "function", "local", "export", "echo", "fi", "esac",
    ]
}

/// Minimal, allocation-light tokenizer producing one `AttributedString` per
/// line. Carries block-comment state across lines. Colors stay inside the
/// approved cyan/blue/teal/emerald/amber family (no purple).
enum ScoutSyntaxHighlighter {
    private static let commentColor = HudPalette.dim
    private static let stringColor = HudTint.green.color
    private static let keywordColor = HudTint.blue.color
    private static let numberColor = HudTint.amber.color
    private static let typeColor = HudTint.teal.color

    static func highlight(lines: [String], language: ScoutCodeLanguage) -> [AttributedString] {
        guard language != .plain else {
            return lines.map { AttributedString($0.isEmpty ? " " : $0) }
        }
        var inBlock = false
        return lines.map { line(from: $0, language: language, inBlock: &inBlock) }
    }

    private static func line(from raw: String, language: ScoutCodeLanguage, inBlock: inout Bool) -> AttributedString {
        if raw.isEmpty { return AttributedString(" ") }
        var out = AttributedString()
        let chars = Array(raw)
        let n = chars.count
        var i = 0

        func emit(_ range: Range<Int>, _ color: Color?) {
            guard !range.isEmpty else { return }
            var piece = AttributedString(String(chars[range]))
            if let color { piece.foregroundColor = color }
            out.append(piece)
        }

        // Resume an open block comment from a previous line.
        if inBlock {
            if let end = blockEnd(chars, from: 0) {
                emit(0..<end, commentColor)
                i = end
                inBlock = false
            } else {
                emit(0..<n, commentColor)
                return out
            }
        }

        while i < n {
            let c = chars[i]

            if let lc = language.lineComment, matches(chars, i, lc) {
                emit(i..<n, commentColor)
                break
            }

            if language.blockComments, matches(chars, i, "/*") {
                if let end = blockEnd(chars, from: i + 2) {
                    emit(i..<end, commentColor)
                    i = end
                } else {
                    emit(i..<n, commentColor)
                    inBlock = true
                    i = n
                }
                continue
            }

            if language.highlightsLiterals, c == "\"" || c == "'" || c == "`" {
                let end = stringEnd(chars, from: i, quote: c)
                emit(i..<end, stringColor)
                i = end
                continue
            }

            if language.highlightsLiterals, c.isNumber {
                var j = i
                while j < n, chars[j].isNumber || chars[j] == "." || chars[j] == "_"
                    || "xXoObBeE".contains(chars[j]) || "abcdefABCDEF".contains(chars[j]) {
                    j += 1
                }
                emit(i..<j, numberColor)
                i = j
                continue
            }

            if c.isLetter || c == "_" || c == "$" {
                var j = i
                while j < n, chars[j].isLetter || chars[j].isNumber || chars[j] == "_" || chars[j] == "$" {
                    j += 1
                }
                let word = String(chars[i..<j])
                if language.keywords.contains(word) {
                    emit(i..<j, keywordColor)
                } else if language.usesTypes, let first = word.first, first.isUppercase, word.count > 1 {
                    emit(i..<j, typeColor)
                } else {
                    emit(i..<j, nil)
                }
                i = j
                continue
            }

            emit(i..<(i + 1), nil)
            i += 1
        }
        return out
    }

    private static func matches(_ chars: [Character], _ i: Int, _ token: String) -> Bool {
        let t = Array(token)
        guard i + t.count <= chars.count else { return false }
        for k in 0..<t.count where chars[i + k] != t[k] { return false }
        return true
    }

    /// Index just past the closing `*/`, or nil if the block runs off the line.
    private static func blockEnd(_ chars: [Character], from start: Int) -> Int? {
        guard start < chars.count else { return nil }
        var j = start
        while j < chars.count - 1 {
            if chars[j] == "*" && chars[j + 1] == "/" { return j + 2 }
            j += 1
        }
        return nil
    }

    /// Index just past the closing quote (escapes skipped), clamped to EOL.
    private static func stringEnd(_ chars: [Character], from start: Int, quote: Character) -> Int {
        let n = chars.count
        var j = start + 1
        while j < n {
            if chars[j] == "\\" { j += 2; continue }
            if chars[j] == quote { return min(j + 1, n) }
            j += 1
        }
        return n
    }
}
