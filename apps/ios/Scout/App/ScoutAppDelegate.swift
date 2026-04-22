import Foundation
import UIKit

final class ScoutAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        NotificationCenter.default.post(
            name: .scoutDidRegisterRemotePushToken,
            object: nil,
            userInfo: ["deviceToken": deviceToken]
        )
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: any Error
    ) {
        NotificationCenter.default.post(
            name: .scoutRemotePushRegistrationFailed,
            object: error
        )
    }
}

extension Notification.Name {
    static let scoutDidRegisterRemotePushToken = Notification.Name("scoutDidRegisterRemotePushToken")
    static let scoutRemotePushRegistrationFailed = Notification.Name("scoutRemotePushRegistrationFailed")
}
