import Foundation

public enum ScoutServiceURLRelay {
    public static let notificationName = Notification.Name("com.openscout.services.url")

    public static func userInfo(url: URL) -> [AnyHashable: Any] {
        ["url": url.absoluteString]
    }
}
