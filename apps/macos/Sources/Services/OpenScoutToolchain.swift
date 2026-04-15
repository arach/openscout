import Foundation

enum OpenScoutToolchainError: LocalizedError {
    case missingRuntime
    case missingScoutCLI
    case missingPairSupervisor
    case missingBun

    var errorDescription: String? {
        switch self {
        case .missingRuntime:
            return "Unable to locate `openscout-runtime`. Set OPENSCOUT_RUNTIME_BIN or run from the OpenScout repo."
        case .missingScoutCLI:
            return "Unable to locate `scout`. Set OPENSCOUT_CLI_BIN or run from the OpenScout repo."
        case .missingPairSupervisor:
            return "Unable to locate the pair supervisor. Set OPENSCOUT_PAIR_SUPERVISOR_BIN or build from the OpenScout repo."
        case .missingBun:
            return "Unable to locate Bun. Set OPENSCOUT_BUN_BIN or install Bun."
        }
    }
}

struct OpenScoutToolchain {
    private let fileManager = FileManager.default
    private let environment: [String: String]

    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.environment = environment
    }

    func runtimeServiceCommand(subcommand: String) throws -> CommandDescriptor {
        if let runtimeExecutable = resolveExecutable(
            envKeys: ["OPENSCOUT_RUNTIME_BIN"],
            names: ["openscout-runtime"]
        ) {
            return CommandDescriptor(
                executableURL: runtimeExecutable,
                arguments: ["service", subcommand, "--json"],
                environment: defaultEnvironment(),
                currentDirectoryURL: workspaceContextRoot()
            )
        }

        guard let repoRoot = resolveRepoRoot() else {
            throw OpenScoutToolchainError.missingRuntime
        }
        guard let bun = resolveBunExecutable() else {
            throw OpenScoutToolchainError.missingBun
        }

        let script = repoRoot.appending(path: "packages/runtime/bin/openscout-runtime.mjs")
        guard fileManager.fileExists(atPath: script.path) else {
            throw OpenScoutToolchainError.missingRuntime
        }

        return CommandDescriptor(
            executableURL: bun,
            arguments: [script.path, "service", subcommand, "--json"],
            environment: defaultEnvironment(),
            currentDirectoryURL: repoRoot
        )
    }

    func scoutCommand(arguments: [String]) throws -> CommandDescriptor {
        if let scoutExecutable = resolveExecutable(
            envKeys: ["OPENSCOUT_CLI_BIN", "SCOUT_CLI_BIN"],
            names: ["scout"]
        ) {
            return CommandDescriptor(
                executableURL: scoutExecutable,
                arguments: arguments,
                environment: defaultEnvironment(),
                currentDirectoryURL: workspaceContextRoot()
            )
        }

        guard let repoRoot = resolveRepoRoot() else {
            throw OpenScoutToolchainError.missingScoutCLI
        }
        guard let bun = resolveBunExecutable() else {
            throw OpenScoutToolchainError.missingBun
        }

        let script = repoRoot.appending(path: "apps/desktop/bin/scout.ts")
        guard fileManager.fileExists(atPath: script.path) else {
            throw OpenScoutToolchainError.missingScoutCLI
        }

        return CommandDescriptor(
            executableURL: bun,
            arguments: [script.path] + arguments,
            environment: defaultEnvironment(),
            currentDirectoryURL: repoRoot
        )
    }

    func pairSupervisorCommand() throws -> CommandDescriptor {
        if let explicit = resolvePath(fromEnvironmentKey: "OPENSCOUT_PAIR_SUPERVISOR_BIN") {
            return try command(forSupervisorAt: explicit)
        }

        for candidate in installedPairSupervisorCandidates() where fileManager.fileExists(atPath: candidate.path) {
            return try command(forSupervisorAt: candidate)
        }

        guard let repoRoot = resolveRepoRoot() else {
            throw OpenScoutToolchainError.missingPairSupervisor
        }

        let repoCandidates = [
            repoRoot.appending(path: "packages/cli/dist/pair-supervisor.mjs"),
            repoRoot.appending(path: "packages/web/dist/pair-supervisor.mjs"),
            repoRoot.appending(path: "apps/desktop/bin/pair-supervisor.ts"),
        ]

        for candidate in repoCandidates where fileManager.fileExists(atPath: candidate.path) {
            return try command(forSupervisorAt: candidate, currentDirectoryURL: repoRoot)
        }

        throw OpenScoutToolchainError.missingPairSupervisor
    }

    func pairingControlHint() -> String? {
        do {
            _ = try pairSupervisorCommand()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private func command(
        forSupervisorAt url: URL,
        currentDirectoryURL: URL? = nil
    ) throws -> CommandDescriptor {
        let ext = url.pathExtension.lowercased()
        if ext == "ts" || ext == "js" || ext == "mjs" || ext == "cjs" {
            guard let bun = resolveBunExecutable() else {
                throw OpenScoutToolchainError.missingBun
            }

            return CommandDescriptor(
                executableURL: bun,
                arguments: [url.path],
                environment: defaultEnvironment(),
                currentDirectoryURL: currentDirectoryURL ?? workspaceContextRoot()
            )
        }

        return CommandDescriptor(
            executableURL: url,
            arguments: [],
            environment: defaultEnvironment(),
            currentDirectoryURL: currentDirectoryURL ?? workspaceContextRoot()
        )
    }

    private func defaultEnvironment() -> [String: String] {
        var env: [String: String] = [:]
        if let workspaceRoot = workspaceContextRoot() {
            env["OPENSCOUT_SETUP_CWD"] = workspaceRoot.path
        }
        return env
    }

    private func workspaceContextRoot() -> URL? {
        if let explicit = resolvePath(fromEnvironmentKey: "OPENSCOUT_SETUP_CWD") {
            return explicit
        }
        return resolveRepoRoot()
    }

    private func resolveRepoRoot() -> URL? {
        let sourcePath = URL(fileURLWithPath: #filePath)
        let candidateStarts = [
            URL(fileURLWithPath: fileManager.currentDirectoryPath),
            sourcePath.deletingLastPathComponent(),
        ]

        for start in candidateStarts {
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

    private func resolveExecutable(envKeys: [String], names: [String]) -> URL? {
        for key in envKeys {
            if let explicit = resolvePath(fromEnvironmentKey: key), isExecutable(explicit) {
                return explicit
            }
        }

        for directory in searchDirectories() {
            for name in names {
                let candidate = directory.appending(path: name)
                if isExecutable(candidate) {
                    return candidate
                }
            }
        }

        return nil
    }

    private func resolveBunExecutable() -> URL? {
        resolveExecutable(
            envKeys: ["OPENSCOUT_BUN_BIN", "SCOUT_BUN_BIN", "BUN_BIN"],
            names: ["bun"]
        )
    }

    private func searchDirectories() -> [URL] {
        var directories: [URL] = []
        let pathEntries = (environment["PATH"] ?? "")
            .split(separator: ":")
            .map(String.init)

        for entry in pathEntries {
            directories.append(expandPath(entry))
        }

        directories.append(fileManager.homeDirectoryForCurrentUser.appending(path: ".bun/bin"))
        directories.append(URL(fileURLWithPath: "/opt/homebrew/bin"))
        directories.append(URL(fileURLWithPath: "/usr/local/bin"))

        var seen = Set<String>()
        return directories.filter { directory in
            let key = directory.path
            if seen.contains(key) {
                return false
            }
            seen.insert(key)
            return true
        }
    }

    private func installedPairSupervisorCandidates() -> [URL] {
        let home = fileManager.homeDirectoryForCurrentUser
        return [
            home.appending(path: ".bun/install/global/node_modules/@openscout/scout/dist/pair-supervisor.mjs"),
            home.appending(path: ".bun/node_modules/@openscout/scout/dist/pair-supervisor.mjs"),
            home.appending(path: ".bun/install/global/node_modules/@openscout/web/dist/pair-supervisor.mjs"),
            home.appending(path: ".bun/node_modules/@openscout/web/dist/pair-supervisor.mjs"),
        ]
    }

    private func resolvePath(fromEnvironmentKey key: String) -> URL? {
        guard let value = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }

        return expandPath(value)
    }

    private func expandPath(_ value: String) -> URL {
        if value == "~" {
            return fileManager.homeDirectoryForCurrentUser
        }

        if value.hasPrefix("~/") {
            let suffix = String(value.dropFirst(2))
            return fileManager.homeDirectoryForCurrentUser.appendingPathComponent(suffix)
        }

        return URL(fileURLWithPath: value)
    }

    private func isExecutable(_ url: URL) -> Bool {
        fileManager.isExecutableFile(atPath: url.path)
    }
}
