// ScoutApp — Entry point for the Scout iOS client.
//
// Creates and wires the core services (SessionStore, ConnectionManager)
// and injects them into the SwiftUI environment.

import SwiftUI
import os
import UserNotifications

private let bootLogger = Logger(subsystem: "com.openscout.scout", category: "Boot")

@main
struct ScoutApp: App {
    @UIApplicationDelegateAdaptor(ScoutAppDelegate.self) private var appDelegate
    private let screenshotConfig = AppStoreScreenshotConfig.current

    @State private var sessionStore: SessionStore
    @State private var inboxStore: InboxStore
    @State private var connectionManager: ConnectionManager
    @State private var notificationDelegate: ScoutNotificationDelegate
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var lastCrash: String?
    @State private var showSplash: Bool
    @AppStorage("scoutAppearance") private var appearanceMode: String = "system"

    init() {
        CrashCatcher.install()
        bootLogger.notice("Scout app launching")
        let store = SessionStore()
        let inbox = InboxStore()
        let notifications = ScoutNotificationDelegate()
        let manager = ConnectionManager(sessionStore: store, inboxStore: inbox)
        UNUserNotificationCenter.current().delegate = notifications
        bootLogger.notice("hasTrustedBridge=\(manager.hasTrustedBridge, privacy: .public), state=\(String(describing: manager.state), privacy: .public)")
        _sessionStore = State(initialValue: store)
        _inboxStore = State(initialValue: inbox)
        _connectionManager = State(initialValue: manager)
        _notificationDelegate = State(initialValue: notifications)
        _lastCrash = State(initialValue: CrashCatcher.consumeLastCrash())
        _showSplash = State(initialValue: Self.shouldShowSplash())
    }

    var body: some Scene {
        WindowGroup {
            if let screenshotConfig {
                AppStoreScreenshotRootView(scenario: screenshotConfig.scenario)
            } else {
                Group {
                    if showSplash {
                        SplashView(onFinished: {
                            withAnimation(.easeOut(duration: 0.35)) {
                                showSplash = false
                            }
                        })
                    } else if hasCompletedOnboarding {
                        ContentView()
                            .environment(sessionStore)
                            .environment(inboxStore)
                            .environment(connectionManager)
                            .transition(.opacity)
                    } else {
                        OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
                            .transition(.opacity)
                    }
                }
                .preferredColorScheme(resolvedColorScheme)
                .animation(.easeOut(duration: 0.35), value: showSplash)
                .onChange(of: hasCompletedOnboarding) {
                    if hasCompletedOnboarding, connectionManager.hasTrustedBridge {
                        Task { await connectionManager.reconnect() }
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .scoutDidRegisterRemotePushToken)) { notification in
                    guard let token = notification.userInfo?["deviceToken"] as? Data else { return }
                    connectionManager.handleRemotePushDeviceToken(token)
                }
                .onReceive(NotificationCenter.default.publisher(for: .scoutRemotePushRegistrationFailed)) { notification in
                    guard let error = notification.object as? Error else { return }
                    connectionManager.handleRemotePushRegistrationFailure(error)
                }
                .task {
                    await connectionManager.refreshPushRegistration()
                    // Start loading Parakeet immediately on app launch.
                    #if canImport(FluidAudio)
                    ScoutLog.voice.info("Preloading Parakeet model at app launch")
                    do {
                        try await ParakeetModelManager.shared.downloadAndLoad()
                        ScoutLog.voice.info("Parakeet ready")
                    } catch {
                        ScoutLog.voice.warning("Parakeet preload failed: \(error.localizedDescription)")
                    }
                    #endif
                }
                .alert("Crash Report", isPresented: .init(
                    get: { lastCrash != nil },
                    set: { if !$0 { lastCrash = nil } }
                )) {
                    Button("Copy") {
                        UIPasteboard.general.string = lastCrash
                        lastCrash = nil
                    }
                    Button("Dismiss", role: .cancel) { lastCrash = nil }
                } message: {
                    Text(lastCrash ?? "")
                }
            }
        }
    }

    private var resolvedColorScheme: ColorScheme? {
        switch appearanceMode {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    // Show the splash at most once per calendar day.
    private static func shouldShowSplash() -> Bool {
        let key = "lastSplashDate"
        let today = Calendar.current.startOfDay(for: Date())
        if let last = UserDefaults.standard.object(forKey: key) as? Date,
           Calendar.current.isDate(last, inSameDayAs: today) {
            return false
        }
        UserDefaults.standard.set(today, forKey: key)
        return true
    }
}
