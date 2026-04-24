import SwiftUI

enum AppStoreScreenshotScenario: String, CaseIterable {
    case onboarding
    case home
    case sessions
    case timeline
}

struct AppStoreScreenshotConfig {
    let scenario: AppStoreScreenshotScenario

    static var current: AppStoreScreenshotConfig? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-ScoutScreenshotScenario"),
              arguments.indices.contains(index + 1),
              let scenario = AppStoreScreenshotScenario(rawValue: arguments[index + 1])
        else {
            return nil
        }

        return AppStoreScreenshotConfig(scenario: scenario)
    }
}

struct AppStoreScreenshotRootView: View {
    let scenario: AppStoreScreenshotScenario

    @State private var sessionStore: SessionStore
    @State private var inboxStore: InboxStore
    @State private var connectionManager: ConnectionManager
    @State private var router: ScoutRouter
    @State private var hasCompletedOnboarding = false

    init(scenario: AppStoreScreenshotScenario) {
        self.scenario = scenario
        let sessionStore = SessionStore.screenshotPreview()
        let inboxStore = InboxStore.screenshotPreview()
        let connectionManager = ConnectionManager.screenshotPreview(
            sessionStore: sessionStore,
            inboxStore: inboxStore,
            trustedBridge: scenario != .onboarding
        )
        let router = ScoutRouter()

        switch scenario {
        case .onboarding, .home:
            break
        case .sessions:
            router.push(.allSessions)
        case .timeline:
            router.push(.sessionDetail(sessionId: "s1"))
        }

        _sessionStore = State(initialValue: sessionStore)
        _inboxStore = State(initialValue: inboxStore)
        _connectionManager = State(initialValue: connectionManager)
        _router = State(initialValue: router)
    }

    var body: some View {
        Group {
            switch scenario {
            case .onboarding:
                OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
            case .home, .sessions, .timeline:
                ScoutNavigationShell()
                    .environment(router)
                    .environment(sessionStore)
                    .environment(inboxStore)
                    .environment(connectionManager)
            }
        }
        .preferredColorScheme(.light)
    }
}
