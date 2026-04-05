// ScoutApp — Entry point for the Scout iOS client.
//
// Creates and wires the core services (SessionStore, ConnectionManager)
// and injects them into the SwiftUI environment.

import SwiftUI
import os

private let bootLogger = Logger(subsystem: "com.openscout.scout", category: "Boot")

@main
struct ScoutApp: App {

    @State private var sessionStore: SessionStore
    @State private var connectionManager: ConnectionManager
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var lastCrash: String?
    @State private var showSplash = true

    init() {
        CrashCatcher.install()
        bootLogger.notice("Scout app launching")
        let store = SessionStore()
        let manager = ConnectionManager(sessionStore: store)
        bootLogger.notice("hasTrustedBridge=\(manager.hasTrustedBridge, privacy: .public), state=\(String(describing: manager.state), privacy: .public)")
        _sessionStore = State(initialValue: store)
        _connectionManager = State(initialValue: manager)
        _lastCrash = State(initialValue: CrashCatcher.consumeLastCrash())
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if showSplash {
                    SplashView()
                        .transition(.opacity)
                } else if hasCompletedOnboarding {
                    ContentView()
                        .environment(sessionStore)
                        .environment(connectionManager)
                        .transition(.opacity)
                } else {
                    OnboardingView(hasCompletedOnboarding: $hasCompletedOnboarding)
                        .transition(.opacity)
                }
            }
            .animation(.easeOut(duration: 0.35), value: showSplash)
            .onChange(of: hasCompletedOnboarding) {
                if hasCompletedOnboarding, connectionManager.hasTrustedBridge {
                    Task { await connectionManager.reconnect() }
                }
            }
            .task {
                try? await Task.sleep(for: .seconds(1.2))
                showSplash = false
            }
            .task {
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
