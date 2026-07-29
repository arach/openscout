import AppKit
import Foundation

/// Opens an attach command in the operator's preferred terminal app.
/// Mirrors `ScoutFileOpener` for editors.
@MainActor
enum ScoutTerminalOpener {
    /// Override the terminal by storing an absolute `.app` path under this key.
    static let terminalDefaultsKey = "scout.terminalAppPath"

    static func open(attachCommand: [String], cwd: String? = nil) {
        guard !attachCommand.isEmpty else {
            NSSound.beep()
            return
        }
        let shellLine = attachCommand.map(shellQuote).joined(separator: " ")
        let workingDirectory = cwd.flatMap { path -> String? in
            let expanded = (path as NSString).expandingTildeInPath
            return FileManager.default.isExecutableFile(atPath: expanded)
                || FileManager.default.fileExists(atPath: expanded)
                ? expanded
                : nil
        }

        guard let app = preferredTerminalAppURL() else {
            openViaTerminalApp(shellLine: shellLine, cwd: workingDirectory)
            return
        }

        switch identify(app: app) {
        case .terminal:
            openViaTerminalApp(shellLine: shellLine, cwd: workingDirectory)
        case .iterm:
            openViaITerm(shellLine: shellLine, cwd: workingDirectory)
        case .alacritty:
            openViaAlacritty(app: app, shellLine: shellLine, cwd: workingDirectory, attachCommand: attachCommand)
        case .hyper:
            openViaHyper(app: app, shellLine: shellLine)
        case .unknown:
            // Last resort: put the attach command on the pasteboard and open the app.
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(shellLine, forType: .string)
            NSWorkspace.shared.openApplication(at: app, configuration: NSWorkspace.OpenConfiguration())
        }
    }

    /// Open a full Herdr client for a discovered/attached Herdr surface.
    static func openHerdr(attachCommand: [String], cwd: String? = nil) {
        open(attachCommand: attachCommand, cwd: cwd)
    }

    // MARK: - App resolution

    private enum TerminalKind {
        case terminal
        case iterm
        case alacritty
        case hyper
        case unknown
    }

    private static func preferredTerminalAppURL() -> URL? {
        if let custom = UserDefaults.standard.string(forKey: terminalDefaultsKey),
           FileManager.default.fileExists(atPath: custom) {
            return URL(fileURLWithPath: custom)
        }
        let candidates = [
            "/Applications/iTerm.app",
            "\(NSHomeDirectory())/Applications/iTerm.app",
            "/Applications/Alacritty.app",
            "\(NSHomeDirectory())/Applications/Alacritty.app",
            "/Applications/Hyper.app",
            "\(NSHomeDirectory())/Applications/Hyper.app",
            "/System/Applications/Utilities/Terminal.app",
            "/Applications/Utilities/Terminal.app",
        ]
        return candidates.first { FileManager.default.fileExists(atPath: $0) }
            .map { URL(fileURLWithPath: $0) }
    }

    private static func identify(app: URL) -> TerminalKind {
        let name = app.deletingPathExtension().lastPathComponent.lowercased()
        if name == "terminal" { return .terminal }
        if name.contains("iterm") { return .iterm }
        if name.contains("alacritty") { return .alacritty }
        if name.contains("hyper") { return .hyper }
        return .unknown
    }

    // MARK: - Launchers

    private static func openViaTerminalApp(shellLine: String, cwd: String?) {
        let escaped = escapeAppleScriptString(shellLine)
        var script = """
        tell application "Terminal"
          activate
          do script "\(escaped)"
        end tell
        """
        if let cwd {
            let cd = escapeAppleScriptString("cd \(shellQuote(cwd)) && \(shellLine)")
            script = """
            tell application "Terminal"
              activate
              do script "\(cd)"
            end tell
            """
        }
        runAppleScript(script)
    }

    private static func openViaITerm(shellLine: String, cwd: String?) {
        let command = cwd.map { "cd \(shellQuote($0)) && \(shellLine)" } ?? shellLine
        let escaped = escapeAppleScriptString(command)
        let script = """
        tell application "iTerm"
          activate
          if (count of windows) = 0 then
            create window with default profile
          else
            tell current window
              create tab with default profile
            end tell
          end if
          tell current session of current window
            write text "\(escaped)"
          end tell
        end tell
        """
        runAppleScript(script)
    }

    private static func openViaAlacritty(
        app: URL,
        shellLine: String,
        cwd: String?,
        attachCommand: [String]
    ) {
        let binary = app.appendingPathComponent("Contents/MacOS/alacritty")
        let executable = FileManager.default.isExecutableFile(atPath: binary.path)
            ? binary
            : app
        let process = Process()
        process.executableURL = executable
        var args: [String] = []
        if let cwd {
            args += ["--working-directory", cwd]
        }
        // Prefer direct argv when the attach command needs no shell features.
        if attachCommand.allSatisfy({ !$0.contains(" ") && !$0.contains("=") }) {
            args += ["-e"] + attachCommand
        } else {
            let shell = ProcessInfo.processInfo.environment["SHELL"].flatMap { $0.isEmpty ? nil : $0 } ?? "/bin/zsh"
            args += ["-e", shell, "-lc", shellLine]
        }
        process.arguments = args
        do {
            try process.run()
        } catch {
            NSSound.beep()
        }
    }

    private static func openViaHyper(app: URL, shellLine: String) {
        // Hyper has no stable "run this command" API. Copy + open.
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(shellLine, forType: .string)
        NSWorkspace.shared.openApplication(at: app, configuration: NSWorkspace.OpenConfiguration())
    }

    private static func runAppleScript(_ source: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", source]
        do {
            try process.run()
        } catch {
            NSSound.beep()
        }
    }

    // MARK: - Quoting

    private static func shellQuote(_ value: String) -> String {
        if value.range(of: #"^[A-Za-z0-9_./:@%+=,-]+$"#, options: .regularExpression) != nil {
            return value
        }
        return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    private static func escapeAppleScriptString(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
    }
}
