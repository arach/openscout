import Combine
import Foundation

/// Mirrors live HUD state to `/tmp/openscout-hud-state.json` so external
/// tools (the `bun bin/openscout-menu.ts hud state` CLI, screenshot
/// loops, etc.) can read the current view + size + window id without
/// going through any IPC round trip.
///
/// Pairs with HUDURLRouter (action ingress via scout:// URLs). The two
/// together form the HUD's external API surface: URLs for actions,
/// JSON file for queries.
@MainActor
public final class HUDStateFile {
    public static let shared = HUDStateFile()
    private static let path = "/tmp/openscout-hud-state.json"

    private var cancellables = Set<AnyCancellable>()
    private var started = false

    private init() {}

    public func start() {
        guard !started else { return }
        started = true

        // Recompute on every relevant change. Window id updates are
        // driven by HUDController calling `touch()` after show/dismiss.
        HUDState.shared.$view
            .sink { [weak self] _ in self?.write() }
            .store(in: &cancellables)
        HUDState.shared.$size
            .sink { [weak self] _ in self?.write() }
            .store(in: &cancellables)
        HUDState.shared.$tailCollapsed
            .sink { [weak self] _ in self?.write() }
            .store(in: &cancellables)
        HUDSkinState.shared.$skin
            .sink { [weak self] _ in self?.write() }
            .store(in: &cancellables)

        write()
    }

    /// HUDController calls this whenever visibility / window id changes
    /// (Combine can't observe non-published mutations cleanly).
    public func touch() {
        write()
    }

    private func write() {
        let payload: [String: Any] = [
            "visible":  HUDController.shared.isVisible,
            "tab":      HUDState.shared.view.label.lowercased(),
            "size":     HUDState.shared.size.cliLabel,
            "skin":     HUDSkinState.shared.skin.rawValue,
            "tailCollapsed": HUDState.shared.tailCollapsed,
            "windowId": HUDController.shared.currentWindowId ?? 0,
            "ts":       Int(Date().timeIntervalSince1970 * 1000),
        ]
        guard let data = try? JSONSerialization.data(
            withJSONObject: payload,
            options: [.prettyPrinted, .sortedKeys]
        ) else { return }
        try? data.write(to: URL(fileURLWithPath: Self.path), options: .atomic)
    }
}

private extension HUDSize {
    var cliLabel: String {
        switch self {
        case .compact: return "compact"
        case .medium:  return "medium"
        case .large:   return "large"
        }
    }
}
