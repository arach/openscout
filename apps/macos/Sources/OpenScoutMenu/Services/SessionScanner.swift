import Foundation
import AppKit

// SessionScanner — probes local terminal sessions for the HUD.
// tmux via `tmux ls`, iTerm2 / Terminal via AppleScript. Cached for
// `cacheTTL` seconds while the HUD is visible so repeated reads don't
// re-shell every render.

enum SessionKind: String, Sendable {
    case tmux
    case iterm
    case terminal
}

struct ScoutSession: Identifiable, Sendable, Equatable {
    let id: String                  // stable: "tmux:<name>", "iterm:<idx>", ...
    let kind: SessionKind
    let name: String
    let windows: Int
    let attached: Bool
    let createdEpoch: TimeInterval? // tmux only, nil otherwise
    let latestAction: String?       // last non-empty pane line; tmux only

    var createdAgo: String? {
        guard let createdEpoch else { return nil }
        return Self.formatAgo(now: Date().timeIntervalSince1970, then: createdEpoch)
    }

    static func formatAgo(now: TimeInterval, then: TimeInterval) -> String {
        let delta = max(0, Int(now - then))
        if delta < 60 { return "\(delta)s" }
        if delta < 3600 { return "\(delta / 60)m" }
        let h = delta / 3600
        let m = (delta % 3600) / 60
        return m == 0 ? "\(h)h" : "\(h)h \(m)m"
    }
}

@MainActor
final class SessionScanner: ObservableObject {
    static let shared = SessionScanner()

    @Published private(set) var sessions: [ScoutSession] = []
    @Published private(set) var lastError: String? = nil
    @Published private(set) var isLoading: Bool = false

    private let cacheTTL: TimeInterval = 2.0
    private var lastFetchAt: TimeInterval = 0
    private var pollTask: Task<Void, Never>?
    private var inFlight: Task<Void, Never>?

    private init() {}

    // Called when the HUD becomes visible; idempotent.
    func start() {
        guard pollTask == nil else { return }
        // Kick a refresh immediately, then poll every cacheTTL.
        refresh()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(2.0 * 1_000_000_000))
                guard let self else { return }
                self.refresh()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    // MARK: - Refresh

    func refresh(force: Bool = false) {
        let now = Date().timeIntervalSince1970
        if !force, now - lastFetchAt < cacheTTL { return }
        if inFlight != nil { return }
        lastFetchAt = now
        isLoading = true

        inFlight = Task { [weak self] in
            let tmux = await Self.scanTmux()
            let iterm = await Self.scanITerm()
            let term = await Self.scanTerminal()
            await MainActor.run {
                guard let self else { return }
                // Sort: attached sessions first, then by recency (newest first).
                // Sessions without createdEpoch sink to the bottom of their group.
                self.sessions = (tmux + iterm + term).sorted { a, b in
                    if a.attached != b.attached { return a.attached }
                    return (a.createdEpoch ?? 0) > (b.createdEpoch ?? 0)
                }
                self.isLoading = false
                self.inFlight = nil
            }
        }
    }

    // MARK: - tmux

    private static func scanTmux() async -> [ScoutSession] {
        let tmuxURL = URL(fileURLWithPath: "/opt/homebrew/bin/tmux")
        let exists = FileManager.default.isExecutableFile(atPath: tmuxURL.path)
        let url = exists ? tmuxURL : URL(fileURLWithPath: "/usr/local/bin/tmux")
        guard FileManager.default.isExecutableFile(atPath: url.path) else { return [] }

        let descriptor = CommandDescriptor(
            executableURL: url,
            arguments: [
                "ls",
                "-F", "#{session_name}|#{session_attached}|#{session_created}|#{session_windows}"
            ]
        )

        let base: [ScoutSession]
        do {
            let result = try await CommandRunner.run(descriptor)
            guard result.exitCode == 0 else { return [] }
            base = parseTmux(result.trimmedStdout)
        } catch {
            return []
        }

        // Fan out capture-pane in parallel — last non-empty line of the
        // active window becomes the session's "latest action" snippet.
        return await withTaskGroup(of: (Int, String?).self) { group in
            for (idx, session) in base.enumerated() {
                group.addTask {
                    let snippet = await Self.captureLatestLine(tmux: url, session: session.name)
                    return (idx, snippet)
                }
            }
            var snippets: [Int: String] = [:]
            for await (idx, snippet) in group {
                if let snippet { snippets[idx] = snippet }
            }
            return base.enumerated().map { idx, s in
                ScoutSession(
                    id: s.id,
                    kind: s.kind,
                    name: s.name,
                    windows: s.windows,
                    attached: s.attached,
                    createdEpoch: s.createdEpoch,
                    latestAction: snippets[idx]
                )
            }
        }
    }

    static func parseTmux(_ raw: String) -> [ScoutSession] {
        var out: [ScoutSession] = []
        for line in raw.split(separator: "\n") {
            let parts = line.split(separator: "|", omittingEmptySubsequences: false)
            guard parts.count >= 4 else { continue }
            let name = String(parts[0])
            let attached = (Int(parts[1]) ?? 0) > 0
            let created = TimeInterval(parts[2]) ?? 0
            let windows = Int(parts[3]) ?? 0
            out.append(ScoutSession(
                id: "tmux:\(name)",
                kind: .tmux,
                name: name,
                windows: windows,
                attached: attached,
                createdEpoch: created > 0 ? created : nil,
                latestAction: nil
            ))
        }
        return out
    }

    // Grab the last non-empty line from the active pane. `capture-pane -p`
    // prints the visible buffer; we walk from the bottom up to find the
    // first line that has content. Clean of prompt-glyph noise via a
    // gentle trim.
    private static func captureLatestLine(tmux: URL, session: String) async -> String? {
        let descriptor = CommandDescriptor(
            executableURL: tmux,
            arguments: ["capture-pane", "-p", "-t", "\(session):", "-J"]
        )
        do {
            let result = try await CommandRunner.run(descriptor)
            guard result.exitCode == 0 else { return nil }
            let lines = result.trimmedStdout.split(separator: "\n", omittingEmptySubsequences: false)
            for raw in lines.reversed() {
                let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty { continue }
                // Skip bare prompt lines (just `$`, `❯`, `>`, etc.)
                if trimmed.count <= 2, trimmed.allSatisfy({ "$%>❯➜→ ".contains($0) }) {
                    continue
                }
                // Skip powerline / starship / p10k prompt lines: they
                // contain Nerd-Font glyphs in the Unicode private use
                // area (U+E000–U+F8FF). These render as tofu in our
                // panel and aren't actually "last action" — they're
                // the operator's idle prompt segments.
                if Self.containsPrivateUseAreaGlyph(trimmed) {
                    continue
                }
                return Self.compactLine(trimmed, max: 80)
            }
            return nil
        } catch {
            return nil
        }
    }

    private static func compactLine(_ s: String, max: Int) -> String {
        let sanitized = s
            .replacingOccurrences(of: "\t", with: " ")
            .unicodeScalars
            .filter { !Self.isPrivateUseAreaScalar($0) }
        let collapsed = String(String.UnicodeScalarView(sanitized))
            .components(separatedBy: .whitespaces)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        if collapsed.count <= max { return collapsed }
        let idx = collapsed.index(collapsed.startIndex, offsetBy: max - 1)
        return String(collapsed[..<idx]) + "…"
    }

    private static func containsPrivateUseAreaGlyph(_ s: String) -> Bool {
        s.unicodeScalars.contains(where: Self.isPrivateUseAreaScalar)
    }

    private static func isPrivateUseAreaScalar(_ scalar: Unicode.Scalar) -> Bool {
        let v = scalar.value
        return (0xE000...0xF8FF).contains(v)
            || (0xF0000...0xFFFFD).contains(v)
            || (0x100000...0x10FFFD).contains(v)
    }

    // MARK: - iTerm2

    private static func scanITerm() async -> [ScoutSession] {
        guard NSWorkspace.shared.runningApplications.contains(where: {
            $0.bundleIdentifier == "com.googlecode.iterm2"
        }) else { return [] }

        let script = """
        tell application "System Events"
            if not (exists process "iTerm2") then return ""
        end tell
        tell application "iTerm2"
            set out to ""
            try
                repeat with w in windows
                    set tabCount to count of tabs of w
                    set winId to id of w as string
                    set winName to name of w
                    set out to out & winId & "|" & winName & "|" & tabCount & linefeed
                end repeat
            end try
            return out
        end tell
        """

        return await runAppleScript(script).map { raw in
            var out: [ScoutSession] = []
            for line in raw.split(separator: "\n") {
                let parts = line.split(separator: "|", omittingEmptySubsequences: false)
                guard parts.count >= 3 else { continue }
                let id = String(parts[0])
                let name = String(parts[1])
                let tabs = Int(parts[2]) ?? 0
                out.append(ScoutSession(
                    id: "iterm:\(id)",
                    kind: .iterm,
                    name: name.isEmpty ? "iTerm window" : name,
                    windows: tabs,
                    attached: false,
                    createdEpoch: nil,
                    latestAction: nil
                ))
            }
            return out
        } ?? []
    }

    // MARK: - Terminal.app

    private static func scanTerminal() async -> [ScoutSession] {
        guard NSWorkspace.shared.runningApplications.contains(where: {
            $0.bundleIdentifier == "com.apple.Terminal"
        }) else { return [] }

        let script = """
        tell application "Terminal"
            set out to ""
            try
                repeat with w in windows
                    set winId to id of w as string
                    set winName to name of w
                    set tabCount to count of tabs of w
                    set out to out & winId & "|" & winName & "|" & tabCount & linefeed
                end repeat
            end try
            return out
        end tell
        """

        return await runAppleScript(script).map { raw in
            var out: [ScoutSession] = []
            for line in raw.split(separator: "\n") {
                let parts = line.split(separator: "|", omittingEmptySubsequences: false)
                guard parts.count >= 3 else { continue }
                let id = String(parts[0])
                let name = String(parts[1])
                let tabs = Int(parts[2]) ?? 0
                out.append(ScoutSession(
                    id: "term:\(id)",
                    kind: .terminal,
                    name: name.isEmpty ? "Terminal window" : name,
                    windows: tabs,
                    attached: false,
                    createdEpoch: nil,
                    latestAction: nil
                ))
            }
            return out
        } ?? []
    }

    // MARK: - AppleScript helper

    private static func runAppleScript(_ source: String) async -> String? {
        await Task.detached(priority: .utility) {
            var err: NSDictionary?
            guard let script = NSAppleScript(source: source) else { return nil }
            let descriptor = script.executeAndReturnError(&err)
            if err != nil { return nil }
            return descriptor.stringValue
        }.value
    }
}

// MARK: - Focus

enum SessionFocus {
    // Best-effort: tmux → new iTerm window attaching; iTerm/Terminal → activate
    static func focus(_ session: ScoutSession) {
        switch session.kind {
        case .tmux:
            attachTmux(session.name)
        case .iterm:
            activate(bundleId: "com.googlecode.iterm2")
        case .terminal:
            activate(bundleId: "com.apple.Terminal")
        }
    }

    private static func attachTmux(_ name: String) {
        let safe = name.replacingOccurrences(of: "\"", with: "\\\"")
        let script = """
        tell application "iTerm2"
            activate
            create window with default profile command "/opt/homebrew/bin/tmux attach -t \(safe)"
        end tell
        """
        var err: NSDictionary?
        NSAppleScript(source: script)?.executeAndReturnError(&err)
    }

    private static func activate(bundleId: String) {
        if let app = NSWorkspace.shared.runningApplications.first(where: {
            $0.bundleIdentifier == bundleId
        }) {
            app.activate()
        }
    }
}
