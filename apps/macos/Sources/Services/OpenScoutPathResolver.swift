import Foundation

enum OpenScoutResolutionSource: String {
    case env
    case path
    case commonPath = "common-path"
    case repo
}

enum OpenScoutJavaScriptRuntimeKind: String {
    case bun
    case node
}

struct OpenScoutResolvedExecutable {
    let url: URL
    let source: OpenScoutResolutionSource
}

struct OpenScoutResolvedJavaScriptRuntime {
    let executable: OpenScoutResolvedExecutable
    let kind: OpenScoutJavaScriptRuntimeKind

    var url: URL {
        executable.url
    }
}

struct OpenScoutPathResolver {
    private let fileManager: FileManager
    private let environment: [String: String]
    private let currentDirectoryURL: URL
    private let sourceDirectoryURL: URL

    init(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default,
        currentDirectoryURL: URL? = nil,
        sourceFilePath: String = #filePath
    ) {
        self.environment = environment
        self.fileManager = fileManager
        self.currentDirectoryURL = currentDirectoryURL ?? URL(fileURLWithPath: fileManager.currentDirectoryPath)
        self.sourceDirectoryURL = URL(fileURLWithPath: sourceFilePath).deletingLastPathComponent()
    }

    func resolveExecutable(
        envKeys: [String],
        names: [String]
    ) -> OpenScoutResolvedExecutable? {
        for key in envKeys {
            guard let explicit = resolvePath(fromEnvironmentKey: key) else {
                continue
            }

            if isExecutable(explicit) {
                return OpenScoutResolvedExecutable(url: explicit.standardizedFileURL, source: .env)
            }

            if let resolvedByName = findExecutable(named: environment[key] ?? "") {
                return OpenScoutResolvedExecutable(url: resolvedByName, source: .env)
            }
        }

        let commonPaths = commonExecutableDirectories().map(\.path)
        for directory in searchDirectories() {
            for name in names {
                let candidate = directory.appending(path: name)
                if isExecutable(candidate) {
                    let source: OpenScoutResolutionSource = commonPaths.contains(directory.path) ? .commonPath : .path
                    return OpenScoutResolvedExecutable(url: candidate.standardizedFileURL, source: source)
                }
            }
        }

        return nil
    }

    func resolveBunExecutable() -> OpenScoutResolvedExecutable? {
        resolveExecutable(
            envKeys: ["OPENSCOUT_BUN_BIN", "SCOUT_BUN_BIN", "BUN_BIN"],
            names: ["bun"]
        )
    }

    func resolveJavaScriptRuntime(
        explicitEnvKeys: [String] = [],
        allowNode: Bool = true,
        allowBun: Bool = true
    ) -> OpenScoutResolvedJavaScriptRuntime? {
        for key in explicitEnvKeys {
            guard let explicit = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !explicit.isEmpty else {
                continue
            }

            let explicitURL = expandPath(explicit)
            if isExecutable(explicitURL) {
                let kind = runtimeKind(for: explicitURL)
                if isAllowed(kind: kind, allowNode: allowNode, allowBun: allowBun) {
                    return OpenScoutResolvedJavaScriptRuntime(
                        executable: OpenScoutResolvedExecutable(url: explicitURL.standardizedFileURL, source: .env),
                        kind: kind
                    )
                }
            }

            if let resolvedByName = findExecutable(named: explicit) {
                let kind = runtimeKind(for: resolvedByName)
                if isAllowed(kind: kind, allowNode: allowNode, allowBun: allowBun) {
                    return OpenScoutResolvedJavaScriptRuntime(
                        executable: OpenScoutResolvedExecutable(url: resolvedByName, source: .env),
                        kind: kind
                    )
                }
            }
        }

        let names: [String] = {
            var values: [String] = []
            if allowNode { values.append("node") }
            if allowBun { values.append("bun") }
            return values
        }()

        guard let executable = resolveExecutable(envKeys: [], names: names) else {
            return nil
        }

        return OpenScoutResolvedJavaScriptRuntime(
            executable: executable,
            kind: runtimeKind(for: executable.url)
        )
    }

    func resolveRepoRoot() -> URL? {
        for start in uniqueStartDirectories() {
            for candidate in ancestorChain(startingAt: start) {
                let scoutPath = candidate.appending(path: "apps/desktop/bin/scout.ts").path
                let runtimePath = candidate.appending(path: "packages/runtime/bin/openscout-runtime.mjs").path
                if fileManager.fileExists(atPath: scoutPath) && fileManager.fileExists(atPath: runtimePath) {
                    return candidate
                }
            }
        }

        return nil
    }

    func resolveRepoEntrypoint(relativePath: String) -> URL? {
        guard let repoRoot = resolveRepoRoot() else {
            return nil
        }

        let candidate = repoRoot.appending(path: relativePath)
        return fileManager.fileExists(atPath: candidate.path) ? candidate : nil
    }

    func resolvePath(fromEnvironmentKey key: String) -> URL? {
        guard let value = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }

        return expandPath(value)
    }

    func expandPath(_ value: String) -> URL {
        if value == "~" {
            return fileManager.homeDirectoryForCurrentUser
        }

        if value.hasPrefix("~/") {
            let suffix = String(value.dropFirst(2))
            return fileManager.homeDirectoryForCurrentUser.appendingPathComponent(suffix)
        }

        return URL(fileURLWithPath: value)
    }

    func isExecutable(_ url: URL) -> Bool {
        fileManager.isExecutableFile(atPath: url.path)
    }

    private func isAllowed(kind: OpenScoutJavaScriptRuntimeKind, allowNode: Bool, allowBun: Bool) -> Bool {
        switch kind {
        case .node:
            return allowNode
        case .bun:
            return allowBun
        }
    }

    private func runtimeKind(for url: URL) -> OpenScoutJavaScriptRuntimeKind {
        url.lastPathComponent.lowercased().hasPrefix("bun") ? .bun : .node
    }

    private func uniqueStartDirectories() -> [URL] {
        var starts: [URL] = []
        if let explicit = resolvePath(fromEnvironmentKey: "OPENSCOUT_SETUP_CWD") {
            starts.append(explicit)
        }
        starts.append(currentDirectoryURL)
        starts.append(sourceDirectoryURL)

        var seen = Set<String>()
        return starts.filter { candidate in
            let path = candidate.standardizedFileURL.path
            if seen.contains(path) {
                return false
            }
            seen.insert(path)
            return true
        }
    }

    private func ancestorChain(startingAt start: URL) -> [URL] {
        var result: [URL] = []
        var current = start.standardizedFileURL

        while true {
            result.append(current)
            let parent = current.deletingLastPathComponent()
            if parent == current {
                break
            }
            current = parent
        }

        return result
    }

    private func searchDirectories() -> [URL] {
        var directories: [URL] = []
        let pathEntries = (environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)

        for entry in pathEntries {
            directories.append(expandPath(entry))
        }

        directories.append(contentsOf: commonExecutableDirectories())

        var seen = Set<String>()
        return directories.filter { directory in
            let key = directory.standardizedFileURL.path
            if seen.contains(key) {
                return false
            }
            seen.insert(key)
            return true
        }
    }

    private func commonExecutableDirectories() -> [URL] {
        [
            fileManager.homeDirectoryForCurrentUser.appending(path: ".bun/bin"),
            URL(fileURLWithPath: "/opt/homebrew/bin"),
            URL(fileURLWithPath: "/usr/local/bin"),
        ]
    }

    private func findExecutable(named name: String) -> URL? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return nil
        }

        for directory in searchDirectories() {
            let candidate = directory.appending(path: trimmed)
            if isExecutable(candidate) {
                return candidate.standardizedFileURL
            }
        }

        return nil
    }
}
