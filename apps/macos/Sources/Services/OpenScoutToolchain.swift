import Foundation

enum OpenScoutToolchainError: LocalizedError {
    case missingRuntime
    case missingScoutCLI
    case missingPairSupervisor
    case missingJavaScriptRuntime
    case missingBun

    var errorDescription: String? {
        switch self {
        case .missingRuntime:
            return "Unable to locate `openscout-runtime`. Set OPENSCOUT_RUNTIME_BIN, install @openscout/runtime, or run from the OpenScout repo."
        case .missingScoutCLI:
            return "Unable to locate `scout`. Set OPENSCOUT_CLI_BIN, install @openscout/scout, or run from the OpenScout repo."
        case .missingPairSupervisor:
            return "Unable to locate the pair supervisor. Set OPENSCOUT_PAIR_SUPERVISOR_BIN, install a pair supervisor entrypoint, or build from the OpenScout repo."
        case .missingJavaScriptRuntime:
            return "Unable to locate Node.js or Bun for the runtime service script. Set OPENSCOUT_RUNTIME_NODE_BIN or install Node.js/Bun."
        case .missingBun:
            return "Unable to locate Bun. Set OPENSCOUT_BUN_BIN or install Bun."
        }
    }
}

struct OpenScoutToolchain {
    private let resolver: OpenScoutPathResolver

    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.resolver = OpenScoutPathResolver(environment: environment)
    }

    func runtimeServiceCommand(subcommand: String) throws -> CommandDescriptor {
        if let runtimeExecutable = resolver.resolveExecutable(
            envKeys: ["OPENSCOUT_RUNTIME_BIN"],
            names: ["openscout-runtime"]
        ) {
            return CommandDescriptor(
                executableURL: runtimeExecutable.url,
                arguments: ["service", subcommand, "--json"],
                environment: defaultEnvironment(),
                currentDirectoryURL: workspaceContextRoot()
            )
        }

        guard let script = resolver.resolveRepoEntrypoint(relativePath: "packages/runtime/bin/openscout-runtime.mjs") else {
            throw OpenScoutToolchainError.missingRuntime
        }
        guard let runtime = resolver.resolveJavaScriptRuntime(
            explicitEnvKeys: ["OPENSCOUT_RUNTIME_NODE_BIN"],
            allowNode: true,
            allowBun: true
        ) else {
            throw OpenScoutToolchainError.missingJavaScriptRuntime
        }

        return CommandDescriptor(
            executableURL: runtime.url,
            arguments: [script.path, "service", subcommand, "--json"],
            environment: defaultEnvironment(),
            currentDirectoryURL: workspaceContextRoot() ?? resolver.resolveRepoRoot()
        )
    }

    func scoutCommand(arguments: [String]) throws -> CommandDescriptor {
        if let scoutExecutable = resolver.resolveExecutable(
            envKeys: ["OPENSCOUT_CLI_BIN", "SCOUT_CLI_BIN"],
            names: ["scout"]
        ) {
            return CommandDescriptor(
                executableURL: scoutExecutable.url,
                arguments: arguments,
                environment: defaultEnvironment(),
                currentDirectoryURL: workspaceContextRoot()
            )
        }

        if let script = resolver.resolveRepoEntrypoint(relativePath: "apps/desktop/bin/scout.ts") {
            guard let bun = resolver.resolveBunExecutable() else {
                throw OpenScoutToolchainError.missingBun
            }

            return CommandDescriptor(
                executableURL: bun.url,
                arguments: [script.path] + arguments,
                environment: defaultEnvironment(),
                currentDirectoryURL: resolver.resolveRepoRoot()
            )
        }

        throw OpenScoutToolchainError.missingScoutCLI
    }

    func pairSupervisorCommand() throws -> CommandDescriptor {
        if let explicit = resolver.resolvePath(fromEnvironmentKey: "OPENSCOUT_PAIR_SUPERVISOR_BIN") {
            return try command(forSupervisorAt: explicit.standardizedFileURL)
        }

        if let installedBinary = resolver.resolveExecutable(envKeys: [], names: ["pair-supervisor"]) {
            return try command(forSupervisorAt: installedBinary.url)
        }

        for candidate in installedPairSupervisorCandidates() {
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try command(forSupervisorAt: candidate.standardizedFileURL)
            }
        }

        let repoCandidates = [
            "packages/cli/dist/pair-supervisor.mjs",
            "packages/web/dist/pair-supervisor.mjs",
            "apps/desktop/bin/pair-supervisor.ts",
        ]

        for relativePath in repoCandidates {
            if let candidate = resolver.resolveRepoEntrypoint(relativePath: relativePath) {
                return try command(forSupervisorAt: candidate, currentDirectoryURL: resolver.resolveRepoRoot())
            }
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
            guard let bun = resolver.resolveBunExecutable() else {
                throw OpenScoutToolchainError.missingBun
            }

            return CommandDescriptor(
                executableURL: bun.url,
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
        if let scoutCLI = resolver.resolveExecutable(
            envKeys: ["OPENSCOUT_CLI_BIN", "SCOUT_CLI_BIN"],
            names: ["scout"]
        ) {
            env["OPENSCOUT_CLI_BIN"] = scoutCLI.url.path
        }
        if let bun = resolver.resolveBunExecutable() {
            env["OPENSCOUT_BUN_BIN"] = bun.url.path
        }
        return env
    }

    private func workspaceContextRoot() -> URL? {
        if let explicit = resolver.resolvePath(fromEnvironmentKey: "OPENSCOUT_SETUP_CWD") {
            return explicit
        }
        return resolver.resolveRepoRoot()
    }

    private func installedPairSupervisorCandidates() -> [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return [
            home.appending(path: ".bun/install/global/node_modules/@openscout/web/dist/pair-supervisor.mjs"),
            home.appending(path: ".bun/node_modules/@openscout/web/dist/pair-supervisor.mjs"),
            home.appending(path: ".bun/install/global/node_modules/@openscout/scout/dist/pair-supervisor.mjs"),
            home.appending(path: ".bun/node_modules/@openscout/scout/dist/pair-supervisor.mjs"),
        ]
    }
}
