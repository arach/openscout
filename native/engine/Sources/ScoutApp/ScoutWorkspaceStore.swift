import Foundation
import ScoutCore

actor ScoutWorkspaceStore {
    private let supportPaths: ScoutSupportPaths
    private let seedSnapshot: ScoutWorkspaceSnapshot
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(
        supportPaths: ScoutSupportPaths,
        seedSnapshot: ScoutWorkspaceSnapshot
    ) {
        self.supportPaths = supportPaths
        self.seedSnapshot = seedSnapshot

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        self.encoder = encoder

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        self.decoder = decoder
    }

    func loadWorkspace() throws -> ScoutWorkspaceSnapshot {
        try ensureWorkspaceDirectory()

        guard FileManager.default.fileExists(atPath: supportPaths.workspaceStateFileURL.path(percentEncoded: false)) else {
            try saveWorkspace(seedSnapshot)
            return seedSnapshot
        }

        let data = try Data(contentsOf: supportPaths.workspaceStateFileURL)
        return try decoder.decode(ScoutWorkspaceSnapshot.self, from: data)
    }

    func saveWorkspace(_ snapshot: ScoutWorkspaceSnapshot) throws {
        try ensureWorkspaceDirectory()
        let data = try encoder.encode(snapshot)
        try data.write(to: supportPaths.workspaceStateFileURL, options: .atomic)
    }

    private func ensureWorkspaceDirectory() throws {
        try FileManager.default.createDirectory(
            at: supportPaths.applicationSupportDirectory,
            withIntermediateDirectories: true
        )
    }
}
