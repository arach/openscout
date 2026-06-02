import Foundation

public enum ScoutNativeAppIdentity {
    public static let productName = "Scout"
    public static let targetLabel = "Agent"

    public static func version(from bundle: Bundle = .main, fallback: String = "0.1.0") -> String {
        let value = bundle.infoDictionary?["CFBundleShortVersionString"] as? String
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let trimmed, !trimmed.isEmpty else { return fallback }
        return trimmed
    }
}
