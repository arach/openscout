import Foundation

public enum ScoutTerminalDeepLink {
    public static func routePath(from url: URL) -> String? {
        guard url.scheme?.lowercased() == "scout",
              url.host?.lowercased() == "terminal",
              let source = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else { return nil }

        let values = Dictionary(
            source.queryItems?.compactMap { item in
                item.value.map { (item.name, $0) }
            } ?? [],
            uniquingKeysWith: { first, _ in first }
        )
        guard let session = clean(values["session"]),
              let surface = clean(values["surface"]),
              surface.hasPrefix("tmux:") || surface.hasPrefix("zellij:")
        else { return nil }

        let requestedMode = clean(values["mode"])
        let mode = requestedMode == "observe" ? "observe" : "takeover"
        var target = URLComponents()
        target.path = "/terminal"
        target.queryItems = [
            URLQueryItem(name: "session", value: session),
            URLQueryItem(name: "surface", value: surface),
            URLQueryItem(name: "mode", value: mode),
        ]
        return target.string
    }

    private static func clean(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty,
              !trimmed.contains("\n"),
              !trimmed.contains("\r")
        else { return nil }
        return trimmed
    }
}
