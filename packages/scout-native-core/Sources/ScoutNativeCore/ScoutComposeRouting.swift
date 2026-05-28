import Foundation

public struct ScoutComposeEnvelope: Equatable, Sendable {
    public let resolvedTarget: String
    public let body: String
    public let wireBody: String
    public let isDefaultTarget: Bool

    public init(
        resolvedTarget: String,
        body: String,
        wireBody: String,
        isDefaultTarget: Bool
    ) {
        self.resolvedTarget = resolvedTarget
        self.body = body
        self.wireBody = wireBody
        self.isDefaultTarget = isDefaultTarget
    }
}

public enum ScoutComposeRouting {
    public static let assistantHandle = "scoutbot"

    public static func envelope(
        body raw: String,
        targetHandle: String?,
        defaultTarget: String = assistantHandle
    ) -> ScoutComposeEnvelope? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        let normalizedDefault = normalizeHandle(defaultTarget) ?? assistantHandle
        let resolvedTarget = normalizeHandle(targetHandle) ?? normalizedDefault
        let cleanedBody = stripInBodyMentions(trimmed)
        let wireBody = "@\(resolvedTarget) \(cleanedBody)"

        return ScoutComposeEnvelope(
            resolvedTarget: resolvedTarget,
            body: cleanedBody,
            wireBody: wireBody,
            isDefaultTarget: normalizeHandle(targetHandle) == nil
        )
    }

    public static func normalizeHandle(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let bare = trimmed.hasPrefix("@") ? String(trimmed.dropFirst()) : trimmed
        let normalized = bare.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized.isEmpty ? nil : normalized
    }

    public static func stripInBodyMentions(_ body: String) -> String {
        let regex = try? NSRegularExpression(
            pattern: #"@([A-Za-z0-9][A-Za-z0-9._-]*)"#,
            options: []
        )
        guard let regex else { return body }
        let range = NSRange(body.startIndex..<body.endIndex, in: body)
        let cleaned = regex.stringByReplacingMatches(
            in: body,
            options: [],
            range: range,
            withTemplate: "$1"
        )
        return cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
