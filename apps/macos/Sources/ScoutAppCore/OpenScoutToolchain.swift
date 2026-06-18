import Foundation

public enum OpenScoutToolchainError: LocalizedError {
    case missingRuntime
    case missingScoutCLI
    case missingPairingRuntimeController
    case missingJavaScriptRuntime
    case missingBun

    public var errorDescription: String? {
        switch self {
        case .missingRuntime:
            return "Unable to locate `openscout-runtime`. Set OPENSCOUT_RUNTIME_BIN, install @openscout/runtime, or run from the OpenScout repo."
        case .missingScoutCLI:
            return "Unable to locate `scout`. Set OPENSCOUT_CLI_BIN, install @openscout/scout, or run from the OpenScout repo."
        case .missingPairingRuntimeController:
            return "Unable to locate the pairing runtime controller. Set OPENSCOUT_PAIRING_RUNTIME_CONTROLLER_BIN, install a pairing controller entrypoint, or build from the OpenScout repo."
        case .missingJavaScriptRuntime:
            return "Unable to locate Node.js or Bun for the runtime service script. Set OPENSCOUT_RUNTIME_NODE_BIN or install Node.js/Bun."
        case .missingBun:
            return "Unable to locate Bun. Set OPENSCOUT_BUN_BIN or install Bun."
        }
    }
}

public struct OpenScoutToolchain {
    private let resolver: OpenScoutPathResolver

    public init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.resolver = OpenScoutPathResolver(environment: environment)
    }

    public func runtimeServiceCommand(subcommand: String) throws -> CommandDescriptor {
        if let scoutd = scoutdCommand(), runtimePackageDirectory() != nil {
            return CommandDescriptor(
                executableURL: scoutd.url,
                arguments: [subcommand, "--json"],
                environment: scoutdEnvironment(),
                currentDirectoryURL: workspaceContextRoot()
            )
        }

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

    public func scoutCommand(arguments: [String]) throws -> CommandDescriptor {
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

        if let script = resolver.resolveRepoEntrypoint(relativePath: "packages/cli/src/main.ts") {
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

    public func pairingRuntimeControllerCommand() throws -> CommandDescriptor {
        if let explicit = resolver.resolvePath(fromEnvironmentKey: "OPENSCOUT_PAIRING_RUNTIME_CONTROLLER_BIN") {
            return try command(forPairingControllerAt: explicit.standardizedFileURL, environment: pairingRuntimeEnvironment())
        }

        if let installedBinary = resolver.resolveExecutable(envKeys: [], names: ["pairing-runtime-controller"]) {
            return try command(forPairingControllerAt: installedBinary.url, environment: pairingRuntimeEnvironment())
        }

        for candidate in installedPairingRuntimeControllerCandidates() {
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try command(forPairingControllerAt: candidate.standardizedFileURL, environment: pairingRuntimeEnvironment())
            }
        }

        let repoCandidates = [
            "packages/cli/dist/pairing-runtime-controller.mjs",
            "packages/web/dist/pairing-runtime-controller.mjs",
            "packages/web/server/pairing-runtime-controller.ts",
        ]

        for relativePath in repoCandidates {
            if let candidate = resolver.resolveRepoEntrypoint(relativePath: relativePath) {
                return try command(
                    forPairingControllerAt: candidate,
                    currentDirectoryURL: resolver.resolveRepoRoot(),
                    environment: pairingRuntimeEnvironment()
                )
            }
        }

        throw OpenScoutToolchainError.missingPairingRuntimeController
    }

    private func scoutdCommand() -> OpenScoutResolvedExecutable? {
        if let explicit = resolver.resolveExecutable(
            envKeys: ["OPENSCOUT_SCOUTD_BIN"],
            names: []
        ) {
            return explicit
        }

        if let repoRoot = resolver.resolveRepoRoot() {
            let candidates = [
                repoRoot.appending(path: "target/debug/scoutd"),
                repoRoot.appending(path: "target/release/scoutd"),
            ]
            for candidate in candidates where resolver.isExecutable(candidate) {
                return OpenScoutResolvedExecutable(url: candidate.standardizedFileURL, source: .repo)
            }
        }

        return resolver.resolveExecutable(envKeys: [], names: ["scoutd"])
    }

    public func pairingControlHint() -> String? {
        do {
            _ = try pairingRuntimeControllerCommand()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    private func command(
        forPairingControllerAt url: URL,
        currentDirectoryURL: URL? = nil,
        environment: [String: String]? = nil
    ) throws -> CommandDescriptor {
        let commandEnvironment = environment ?? defaultEnvironment()
        let ext = url.pathExtension.lowercased()
        if ext == "ts" || ext == "js" || ext == "mjs" || ext == "cjs" {
            guard let bun = resolver.resolveBunExecutable() else {
                throw OpenScoutToolchainError.missingBun
            }

            return CommandDescriptor(
                executableURL: bun.url,
                arguments: [url.path],
                environment: commandEnvironment,
                currentDirectoryURL: currentDirectoryURL ?? workspaceContextRoot()
            )
        }

        return CommandDescriptor(
            executableURL: url,
            arguments: [],
            environment: commandEnvironment,
            currentDirectoryURL: currentDirectoryURL ?? workspaceContextRoot()
        )
    }

    /// Environment for invoking the native `scoutd` binary.
    ///
    /// scoutd resolves its broker target (host/port/URL/socket) and launchd
    /// label purely from `OPENSCOUT_*` environment variables and never reads the
    /// unified `~/.openscout/config.json`. `CommandRunner` already merges the
    /// app's own process environment underneath these overrides, so any
    /// `OPENSCOUT_BROKER_*`/`OPENSCOUT_SERVICE_LABEL` set in the launching shell
    /// already propagate. The only value the app knows that the inherited
    /// environment may lack is the broker host/port declared in the config file
    /// (the same source `ScoutBroker.baseURL()` reads), so forward that — but
    /// only when the environment does not already pin a broker target, to avoid
    /// overriding an explicit override.
    private func scoutdEnvironment() -> [String: String] {
        var env = defaultEnvironment()

        let processEnv = ProcessInfo.processInfo.environment
        func hasEnv(_ key: String) -> Bool {
            (processEnv[key]?.trimmingCharacters(in: .whitespacesAndNewlines)).map { !$0.isEmpty } ?? false
        }

        let brokerTargetPinned = hasEnv("OPENSCOUT_BROKER_URL")
            || hasEnv("OPENSCOUT_BROKER_PORT")
            || hasEnv("OPENSCOUT_BROKER_HOST")
        if !brokerTargetPinned, let endpoint = ScoutBroker.configuredEndpoint() {
            env["OPENSCOUT_BROKER_HOST"] = endpoint.host
            env["OPENSCOUT_BROKER_PORT"] = String(endpoint.port)
            env["OPENSCOUT_BROKER_URL"] = "http://\(endpoint.host):\(endpoint.port)"
        }

        return env
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
        if let runtimePackageDirectory = runtimePackageDirectory() {
            env["OPENSCOUT_RUNTIME_PACKAGE_DIR"] = runtimePackageDirectory.path
        }
        return env
    }

    private func pairingRuntimeEnvironment() -> [String: String] {
        var env = defaultEnvironment()
        let settings = OpenScoutNetworkSettingsStore.load()
        guard settings.discoveryEnabled else {
            return env
        }
        guard let session = OpenScoutNetworkSessionStore.loadSessionToken() else {
            return env
        }

        let processEnv = ProcessInfo.processInfo.environment
        if !hasProcessEnv("OPENSCOUT_MESH_RENDEZVOUS_URL", processEnv) {
            env["OPENSCOUT_MESH_RENDEZVOUS_URL"] = settings.rendezvousURL
        }
        if !hasProcessEnv("OPENSCOUT_MESH_RENDEZVOUS_SESSION", processEnv) {
            env["OPENSCOUT_MESH_RENDEZVOUS_SESSION"] = session
        }
        if !hasProcessEnv("OPENSCOUT_PAIRING_RELAY_URL", processEnv),
           !hasProcessEnv("OPENSCOUT_MOBILE_PAIRING_RELAY_URL", processEnv),
           !hasConfiguredPairingRelay() {
            env["OPENSCOUT_PAIRING_RELAY_URL"] = settings.pairingRelayURL
        }
        return env
    }

    private func hasProcessEnv(_ key: String, _ env: [String: String]) -> Bool {
        guard let value = env[key]?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return false
        }
        return !value.isEmpty
    }

    private func hasConfiguredPairingRelay() -> Bool {
        let url = FileManager.default.homeDirectoryForCurrentUser
            .appending(path: ".scout/pairing/config.json")
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let relay = object["relay"] as? String else {
            return false
        }
        return !relay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func runtimePackageDirectory() -> URL? {
        if let explicit = resolver.resolvePath(fromEnvironmentKey: "OPENSCOUT_RUNTIME_PACKAGE_DIR") {
            return explicit
        }
        if let repoRoot = resolver.resolveRepoRoot() {
            let candidate = repoRoot.appending(path: "packages/runtime")
            if FileManager.default.fileExists(atPath: candidate.appending(path: "bin/openscout-runtime.mjs").path) {
                return candidate
            }
        }
        return nil
    }

    private func workspaceContextRoot() -> URL? {
        if let explicit = resolver.resolvePath(fromEnvironmentKey: "OPENSCOUT_SETUP_CWD") {
            return explicit
        }
        return resolver.resolveRepoRoot()
    }

    private func installedPairingRuntimeControllerCandidates() -> [URL] {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return [
            home.appending(path: ".bun/install/global/node_modules/@openscout/web/dist/pairing-runtime-controller.mjs"),
            home.appending(path: ".bun/node_modules/@openscout/web/dist/pairing-runtime-controller.mjs"),
            home.appending(path: ".bun/install/global/node_modules/@openscout/scout/dist/pairing-runtime-controller.mjs"),
            home.appending(path: ".bun/node_modules/@openscout/scout/dist/pairing-runtime-controller.mjs"),
        ]
    }
}
