import HudsonObservability
import ScoutAppCore
import SwiftUI

/// Mirrors Scout status surfaces into `HudLogStore` so the HudsonKit activity
/// inspector shows the same errors the status bar truncates.
@MainActor
struct ScoutStatusLogBridge: ViewModifier {
    let store: ScoutCommsStore
    let tail: ScoutTailStore
    let repos: ScoutRepoStore

    @State private var lastCommsError: String?
    @State private var lastObserveError: String?
    @State private var lastTailError: String?
    @State private var lastReposError: String?

    func body(content: Content) -> some View {
        content
            .onAppear {
                recordIfChanged(&lastCommsError, store.lastError, category: "comms")
                recordIfChanged(&lastObserveError, store.observeError, category: "observe")
                recordIfChanged(&lastTailError, tail.lastError, category: "tail")
                recordIfChanged(&lastReposError, repos.lastError, category: "repos")
            }
            .onChange(of: store.lastError) { _, value in
                recordIfChanged(&lastCommsError, value, category: "comms")
            }
            .onChange(of: store.observeError) { _, value in
                recordIfChanged(&lastObserveError, value, category: "observe")
            }
            .onChange(of: tail.lastError) { _, value in
                recordIfChanged(&lastTailError, value, category: "tail")
            }
            .onChange(of: repos.lastError) { _, value in
                recordIfChanged(&lastReposError, value, category: "repos")
            }
    }

    private func recordIfChanged(_ last: inout String?, _ value: String?, category: String) {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            last = nil
            return
        }
        guard trimmed != last else { return }
        last = trimmed
        HudLogStore.shared.record(trimmed, level: .error, category: category)
    }
}

extension View {
    func scoutStatusLogBridge(
        store: ScoutCommsStore,
        tail: ScoutTailStore,
        repos: ScoutRepoStore
    ) -> some View {
        modifier(ScoutStatusLogBridge(store: store, tail: tail, repos: repos))
    }
}