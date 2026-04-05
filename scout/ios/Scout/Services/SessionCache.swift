// SessionCache — Local persistence for session state.
//
// Stores the last N turns per session as JSON on disk.
// Survives app restarts, bridge disconnects, bridge restarts.
// SessionStore reads from cache on launch, overlays fresh data from bridge.

import Foundation

final class SessionCache: Sendable {
    static let shared = SessionCache()

    private let maxTurnsPerSession = 400
    private let cacheDir: URL

    private init() {
        let base = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        cacheDir = base.appendingPathComponent("session_cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    }

    // MARK: - Save

    /// Persist a session snapshot to disk. Trims to last N turns.
    func save(_ state: SessionState) {
        var trimmed = state
        if trimmed.turns.count > maxTurnsPerSession {
            trimmed.turns = Array(trimmed.turns.suffix(maxTurnsPerSession))
        }

        let url = fileURL(for: state.session.id)
        do {
            let data = try JSONEncoder().encode(trimmed)
            try data.write(to: url, options: .atomic)
            ScoutLog.session.debug("Cached session \(state.session.id): \(trimmed.turns.count) turns")
        } catch {
            ScoutLog.session.warning("Failed to cache session \(state.session.id): \(error.localizedDescription)")
        }

        // Also update the session index
        updateIndex(session: state.session)
    }

    // MARK: - Load

    /// Load a cached session snapshot from disk.
    func load(sessionId: String) -> SessionState? {
        let url = fileURL(for: sessionId)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(SessionState.self, from: data)
    }

    /// Load all cached session snapshots.
    func loadAll() -> [SessionState] {
        let index = loadIndex()
        return index.compactMap { load(sessionId: $0.id) }
    }

    // MARK: - Delete

    func delete(sessionId: String) {
        let url = fileURL(for: sessionId)
        try? FileManager.default.removeItem(at: url)
        removeFromIndex(sessionId: sessionId)
    }

    func deleteAll() {
        try? FileManager.default.removeItem(at: cacheDir)
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
    }

    // MARK: - Session Index (lightweight metadata for listing)

    struct CachedSessionInfo: Codable {
        let id: String
        let name: String
        let adapterType: String
        let cachedAt: Date
        let turnCount: Int
    }

    func loadIndex() -> [CachedSessionInfo] {
        let url = cacheDir.appendingPathComponent("index.json")
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([CachedSessionInfo].self, from: data)) ?? []
    }

    private func updateIndex(session: Session) {
        var index = loadIndex()
        index.removeAll { $0.id == session.id }

        let state = load(sessionId: session.id)
        let info = CachedSessionInfo(
            id: session.id,
            name: session.name,
            adapterType: session.adapterType,
            cachedAt: Date(),
            turnCount: state?.turns.count ?? 0
        )
        index.insert(info, at: 0)

        // Keep a deeper local history so prior work is still reviewable after leaving the app.
        if index.count > 100 {
            let removed = index.suffix(from: 100)
            for entry in removed {
                let url = fileURL(for: entry.id)
                try? FileManager.default.removeItem(at: url)
            }
            index = Array(index.prefix(100))
        }

        let url = cacheDir.appendingPathComponent("index.json")
        if let data = try? JSONEncoder().encode(index) {
            try? data.write(to: url, options: .atomic)
        }
    }

    private func removeFromIndex(sessionId: String) {
        var index = loadIndex()
        index.removeAll { $0.id == sessionId }
        let url = cacheDir.appendingPathComponent("index.json")
        if let data = try? JSONEncoder().encode(index) {
            try? data.write(to: url, options: .atomic)
        }
    }

    // MARK: - Helpers

    private func fileURL(for sessionId: String) -> URL {
        // Sanitize session ID for filename
        let safe = sessionId.replacingOccurrences(of: "/", with: "_")
        return cacheDir.appendingPathComponent("\(safe).json")
    }
}
