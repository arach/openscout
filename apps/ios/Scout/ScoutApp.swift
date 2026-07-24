import HudsonObservability
import SwiftUI
import HudsonUI
import UIKit
import UserNotifications

private struct ScoutPushRoute: Sendable {
    let destination: String?
    let kind: String?
    let conversationId: String?
    let messageId: String?
    let itemId: String?
    let sessionId: String?
    let turnId: String?
    let blockId: String?
}

@MainActor
final class ScoutAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    private weak var model: AppModel?
    private var pendingNotificationRoute: ScoutPushRoute?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func bind(to model: AppModel) {
        self.model = model
        if let pendingNotificationRoute {
            deliver(pendingNotificationRoute)
            self.pendingNotificationRoute = nil
        }
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        model?.didRegisterForRemoteNotifications(deviceToken: deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: any Error
    ) {
        model?.didFailToRegisterForRemoteNotifications(error: error)
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .badge, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let scout = response.notification.request.content.userInfo["scout"] as? [String: Any]
        let route = ScoutPushRoute(
            destination: scout?["destination"] as? String,
            kind: scout?["kind"] as? String,
            conversationId: scout?["conversationId"] as? String,
            messageId: scout?["messageId"] as? String,
            itemId: scout?["itemId"] as? String,
            sessionId: scout?["sessionId"] as? String,
            turnId: scout?["turnId"] as? String,
            blockId: scout?["blockId"] as? String
        )
        await MainActor.run { [weak self] in
            self?.deliver(route)
        }
    }

    private func deliver(_ route: ScoutPushRoute) {
        guard route.destination == nil || route.destination == "inbox" else { return }
        if let model {
            model.handleRemoteNotification(
                kind: route.kind,
                conversationId: route.conversationId,
                messageId: route.messageId,
                itemId: route.itemId,
                sessionId: route.sessionId,
                turnId: route.turnId,
                blockId: route.blockId
            )
        } else {
            pendingNotificationRoute = route
        }
    }
}

/// Scout (SCO-061) — the next-gen, Hudson-first iOS app. Surfaces consume
/// the shared `ScoutCapabilities` layer through a `ScoutBrokerClient`. The
/// default source is the live encrypted `BridgeBrokerClient` (reusing the Mac
/// pairing already in the keychain); a Mock source remains for offline UI work.
@main
struct ScoutApp: App {
    @UIApplicationDelegateAdaptor(ScoutAppDelegate.self) private var appDelegate
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        HudLoggerSinks.install(HudLogStore.shared)
        HudLogger(category: "scout-ios").info("Scout iOS booted", metadata: ["state": "ready"])
    }

    var body: some Scene {
        WindowGroup {
            Group {
                switch model.phase {
                case .connect: ConnectScreen(model: model)
                case .shell:   RootView(model: model)
                }
            }
            .hudsonAppManifest(
                HudAppManifest(name: "Scout", version: "0.2.70", tint: .green, targetLabel: "Agent")
            )
            // Shared dictation controller — the composer and Settings both read
            // and drive the same on-device transcription state.
            .environment(model.dictation)
            .preferredColorScheme(.dark)
            // Pairing presents from both phases (Connect screen CTA and the
            // in-shell Connection sheet), so it lives at the app root.
            .sheet(isPresented: $model.showPairing) {
                PairingView(model: model)
            }
            // Camera-free pairing and native auth: scout://pair?payload=…
            // and scout://osn-auth?session=…
            .onOpenURL { url in
                Task { await model.handleDeepLink(url) }
            }
            .onChange(of: scenePhase) { _, phase in
                model.setScenePhase(phase)
            }
            .task {
                appDelegate.bind(to: model)
                await model.refreshPushNotificationAuthorization()
                await model.start()
            }
        }
    }
}
