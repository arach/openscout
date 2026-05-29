import AppKit

@MainActor
final class OpenScoutActivationCoordinator {
    static let shared = OpenScoutActivationCoordinator()

    private var surfaceVisibilityProviders: [(id: String, isVisible: () -> Bool)] = []

    private init() {}

    func registerSurface(id: String, isVisible: @escaping () -> Bool) {
        guard !surfaceVisibilityProviders.contains(where: { $0.id == id }) else {
            return
        }
        surfaceVisibilityProviders.append((id: id, isVisible: isVisible))
    }

    func refresh() {
        let hasVisibleWindow = surfaceVisibilityProviders.contains { provider in
            provider.isVisible()
        }
        let desired: NSApplication.ActivationPolicy = hasVisibleWindow ? .regular : .accessory
        guard NSApp.activationPolicy() != desired else {
            return
        }
        NSApp.setActivationPolicy(desired)
        if desired == .regular {
            NSApp.activate(ignoringOtherApps: true)
        }
    }
}
