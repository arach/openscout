import Foundation

public enum ScoutServiceURLRelay {
    public static let notificationName = Notification.Name("app.openscout.scout.service-url")
    public static let openScoutNetworkAuthSavedNotificationName = Notification.Name("net.oscout.auth-saved")

    public static func userInfo(url: URL) -> [AnyHashable: Any] {
        ["url": url.absoluteString]
    }
}
