import Foundation

enum ScoutRuntimeLocator {
    static func repositoryRoot() -> URL? {
        if let override = ProcessInfo.processInfo.environment["OPENSCOUT_REPO_ROOT"],
           !override.isEmpty {
            return URL(filePath: override, directoryHint: .isDirectory)
        }

        let candidates: [URL] = [
            URL(filePath: FileManager.default.currentDirectoryPath, directoryHint: .isDirectory),
            Bundle.main.executableURL?.deletingLastPathComponent(),
            URL(filePath: CommandLine.arguments[0]).deletingLastPathComponent(),
        ].compactMap { $0 }

        for candidate in candidates {
            if let root = searchUpwardsForRepositoryRoot(from: candidate) {
                return root
            }
        }

        return nil
    }

    static func packageURL(relativePath: String) -> URL? {
        repositoryRoot()?.appending(path: relativePath, directoryHint: .isDirectory)
    }

    static func bunExecutableURL() -> URL? {
        let environment = ProcessInfo.processInfo.environment
        let explicitPaths = [
            environment["OPENSCOUT_BUN_BIN"],
            environment["BUN_BIN"],
        ].compactMap { $0 }

        for path in explicitPaths {
            let expanded = (path as NSString).expandingTildeInPath
            if FileManager.default.isExecutableFile(atPath: expanded) {
                return URL(filePath: expanded)
            }
        }

        let pathEntries = (environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        let commonPaths = [
            "~/.bun/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ]

        for directory in pathEntries + commonPaths {
            let expandedDirectory = (directory as NSString).expandingTildeInPath
            let executablePath = URL(filePath: expandedDirectory, directoryHint: .isDirectory)
                .appending(path: "bun")
                .path(percentEncoded: false)
            if FileManager.default.isExecutableFile(atPath: executablePath) {
                return URL(filePath: executablePath)
            }
        }

        return nil
    }

    static func codexExecutableURL() -> URL? {
        let environment = ProcessInfo.processInfo.environment
        let explicitPaths = [
            environment["OPENSCOUT_CODEX_BIN"],
            environment["CODEX_BIN"],
        ].compactMap { $0 }

        for path in explicitPaths {
            let expanded = (path as NSString).expandingTildeInPath
            if FileManager.default.isExecutableFile(atPath: expanded) {
                return URL(filePath: expanded)
            }
        }

        let pathEntries = (environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)
        let commonPaths = [
            "~/.local/bin",
            "~/.bun/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ]

        for directory in pathEntries + commonPaths {
            let expandedDirectory = (directory as NSString).expandingTildeInPath
            let executablePath = URL(filePath: expandedDirectory, directoryHint: .isDirectory)
                .appending(path: "codex")
                .path(percentEncoded: false)
            if FileManager.default.isExecutableFile(atPath: executablePath) {
                return URL(filePath: executablePath)
            }
        }

        return nil
    }

    static func developerProjectURL(named projectName: String) -> URL? {
        let normalized = projectName
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()

        guard !normalized.isEmpty else {
            return nil
        }

        let environment = ProcessInfo.processInfo.environment
        let root = environment["OPENSCOUT_PROJECTS_ROOT"]
            ?? ((environment["HOME"] ?? NSHomeDirectory()) as NSString).appendingPathComponent("dev")
        let expandedRoot = (root as NSString).expandingTildeInPath
        let projectURL = URL(filePath: expandedRoot, directoryHint: .isDirectory)
            .appending(path: normalized, directoryHint: .isDirectory)

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: projectURL.path(percentEncoded: false), isDirectory: &isDirectory),
              isDirectory.boolValue else {
            return nil
        }

        return projectURL
    }

    private static func searchUpwardsForRepositoryRoot(from startURL: URL) -> URL? {
        var currentURL = startURL

        while true {
            let packageURL = currentURL.appending(path: "package.json")
            let packagesURL = currentURL.appending(path: "packages", directoryHint: .isDirectory)
            let nativeURL = currentURL.appending(path: "native", directoryHint: .isDirectory)

            if FileManager.default.fileExists(atPath: packageURL.path(percentEncoded: false)),
               FileManager.default.fileExists(atPath: packagesURL.path(percentEncoded: false)),
               FileManager.default.fileExists(atPath: nativeURL.path(percentEncoded: false)) {
                return currentURL
            }

            let parentURL = currentURL.deletingLastPathComponent()
            if parentURL == currentURL {
                return nil
            }

            currentURL = parentURL
        }
    }
}
