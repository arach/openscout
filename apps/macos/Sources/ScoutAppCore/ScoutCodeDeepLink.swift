import Foundation

/// `scout://{path}` deep links for the code browser / file viewer.
///
/// Accepted forms:
/// - `scout://openscout`
/// - `scout://openscout/packages/web/foo.ts`
/// - `scout://openscout/foo.ts?wt=comms&line=12&endLine=20`
/// - `scout:///Users/art/dev/openscout/foo.ts`
/// - `scout://file/Users/art/dev/openscout/foo.ts`
/// - `scout://code/openscout/foo.ts` (legacy host)
public enum ScoutCodeDeepLink {
    /// Hosts owned by other Scout surfaces — never treated as project slugs.
    public static let reservedHosts: Set<String> = [
        "hud",
        "asks",
        "tail",
        "terminal",
        "services",
        "pair",
        "osn-auth",
        "notification",
        "code",
        "file",
    ]

    public struct Target: Equatable, Sendable {
        public var root: String?
        public var file: String?
        public var project: String?
        public var path: String?
        public var wt: String?
        public var line: Int?
        public var endLine: Int?

        public init(
            root: String? = nil,
            file: String? = nil,
            project: String? = nil,
            path: String? = nil,
            wt: String? = nil,
            line: Int? = nil,
            endLine: Int? = nil
        ) {
            self.root = root
            self.file = file
            self.project = project
            self.path = path
            self.wt = wt
            self.line = line
            self.endLine = endLine
        }
    }

    /// Parse a `scout://` code deep link. Returns nil for other hosts / garbage.
    public static func parse(_ url: URL) -> Target? {
        guard url.scheme?.lowercased() == "scout" else { return nil }
        let host = (url.host ?? "").lowercased()
        let segments = url.pathComponents.filter { $0 != "/" }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let values = Dictionary(
            query.compactMap { item in item.value.map { (item.name, $0) } },
            uniquingKeysWith: { first, _ in first }
        )
        let line = positiveLine(values["line"])
        let rawEnd = positiveLine(values["endLine"])
        let endLine = line.flatMap { start in
            rawEnd.flatMap { end in end >= start ? end : nil }
        }
        let wt = clean(values["wt"])

        // Absolute: scout:///Users/... or scout://file/Users/...
        if host.isEmpty || host == "file" {
            guard !segments.isEmpty else {
                // scout://code?root=&file= style is handled under host==code;
                // empty absolute path is not a code link.
                return nil
            }
            let absolute = "/" + segments.joined(separator: "/")
            let root = clean(values["root"]) ?? absolute
            let file = clean(values["file"]) ?? absolute
            return Target(root: root, file: file, wt: wt, line: line, endLine: endLine)
        }

        // Legacy: scout://code/<project>/[path...]
        if host == "code" {
            if segments.isEmpty {
                return Target(
                    root: clean(values["root"]),
                    file: clean(values["file"]),
                    project: clean(values["project"]),
                    path: clean(values["path"]),
                    wt: wt,
                    line: line,
                    endLine: endLine
                )
            }
            let project = segments[0]
            let rel = segments.count > 1
                ? segments.dropFirst().joined(separator: "/")
                : nil
            return Target(project: project, path: rel, wt: wt, line: line, endLine: endLine)
        }

        if reservedHosts.contains(host) {
            return nil
        }

        // Primary form: scout://{project}/[path...]
        let project = url.host ?? host
        let rel = segments.isEmpty ? nil : segments.joined(separator: "/")
        return Target(project: project, path: rel, wt: wt, line: line, endLine: endLine)
    }

    /// Embed query items for the code web surface.
    public static func queryItems(for target: Target) -> [URLQueryItem] {
        var items: [URLQueryItem] = []
        if let project = target.project, !project.isEmpty {
            items.append(URLQueryItem(name: "project", value: project))
        }
        if let path = target.path, !path.isEmpty {
            items.append(URLQueryItem(name: "path", value: path))
        }
        if let root = target.root, !root.isEmpty {
            items.append(URLQueryItem(name: "root", value: root))
        }
        if let file = target.file, !file.isEmpty {
            items.append(URLQueryItem(name: "file", value: file))
        }
        if let wt = target.wt, !wt.isEmpty {
            items.append(URLQueryItem(name: "wt", value: wt))
        }
        if let line = target.line {
            items.append(URLQueryItem(name: "line", value: String(line)))
        }
        if let endLine = target.endLine {
            items.append(URLQueryItem(name: "endLine", value: String(endLine)))
        }
        return items
    }

    /// Format a shareable `scout://{path}` link. Prefers the project form.
    public static func format(_ target: Target) -> String {
        var params = URLComponents()
        var query: [URLQueryItem] = []
        if let wt = target.wt, !wt.isEmpty {
            query.append(URLQueryItem(name: "wt", value: wt))
        }
        if let line = target.line {
            query.append(URLQueryItem(name: "line", value: String(line)))
        }
        if let endLine = target.endLine {
            query.append(URLQueryItem(name: "endLine", value: String(endLine)))
        }
        params.queryItems = query.isEmpty ? nil : query
        let suffix: String = {
            guard let items = params.queryItems, !items.isEmpty else { return "" }
            return "?" + items.map { item in
                let name = item.name
                let value = item.value?.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                return "\(name)=\(value)"
            }.joined(separator: "&")
        }()

        if let project = target.project, !project.isEmpty {
            let encodedProject = project.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? project
            if let path = target.path, !path.isEmpty {
                let encodedPath = path
                    .split(separator: "/")
                    .map { segment in
                        String(segment).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String(segment)
                    }
                    .joined(separator: "/")
                return "scout://\(encodedProject)/\(encodedPath)\(suffix)"
            }
            return "scout://\(encodedProject)\(suffix)"
        }

        if let absolute = target.file ?? target.root, !absolute.isEmpty {
            let normalized = absolute.hasPrefix("/") ? absolute : "/\(absolute)"
            let encoded = normalized
                .split(separator: "/", omittingEmptySubsequences: false)
                .map { segment in
                    if segment.isEmpty { return "" }
                    return String(segment).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String(segment)
                }
                .joined(separator: "/")
            return "scout://\(encoded)\(suffix)"
        }

        return "scout://code\(suffix)"
    }

    private static func clean(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty
        else { return nil }
        return trimmed
    }

    private static func positiveLine(_ value: String?) -> Int? {
        guard let value, let parsed = Int(value), parsed > 0 else { return nil }
        return parsed
    }
}
