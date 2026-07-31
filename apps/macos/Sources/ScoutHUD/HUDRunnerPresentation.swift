import Foundation

/// The keyboard contract shared by the HUD runner's state, views, controller,
/// and tests.
///
/// Suggestions use a combobox-style interaction: the search field keeps focus,
/// arrows move the active descendant, Return commits it, and forward Tab commits
/// it before advancing to the message. Suggestion rows therefore do not lengthen
/// the primary Tab path as the project catalog grows.
enum HUDRunnerKeyboardContract {
    static let visibleProjectSuggestionCount = 3
    static let dictationShortcutLabel = "⌘D"
}

enum HUDRunnerDisclosure: Equatable, Sendable {
    case none
    case projectChoices
    case projectSearch
    case runtimeChoices
    case runtimeConfiguration
    case route

    var isExpanded: Bool { self != .none }
}

struct HUDRunnerFocusRequest: Equatable {
    let revision: UInt
    let target: HUDRunnerFocusTarget
}

enum HUDRunnerFocusTarget: Hashable {
    case projectSummary
    case runtimeSummary
    case disclosureBack
    case projectSearch
    case projectChoice(String)
    case browseDirectory
    case runtimeChoice(String)
    case runtimeTweaks(String)
    case runtimeModel(String, String)
    case runtimeEffort(String, String)
    case runtimePickerClose
    case configureRuntime
    case harness
    case model
    case version
    case effort
    case route
    case persistence
    case agentName
    case displayName
    case disclosureDone
    case applyRuntime
    case instructions
    case attachment(UUID)
    case reference(String)
    case attach
    case voice
    case create

    static func visibleOrder(
        disclosure: HUDRunnerDisclosure,
        projectChoiceIDs: [String] = [],
        runtimeChoiceIDs: [String] = [],
        attachmentIDs: [UUID] = [],
        referenceIDs: [String] = []
    ) -> [HUDRunnerFocusTarget] {
        var result: [HUDRunnerFocusTarget]
        var trailing: [HUDRunnerFocusTarget] = []
        switch disclosure {
        case .none:
            result = [.projectSummary]
        case .projectChoices:
            result = [.disclosureBack]
            result += projectChoiceIDs.map(Self.projectChoice)
            result.append(.projectSearch)
        case .projectSearch:
            // The input owns its listbox. Arrow keys reach every visible
            // suggestion; Tab must leave the combobox instead of walking rows.
            result = [.projectSearch]
            trailing = [.browseDirectory, .disclosureBack]
        case .runtimeChoices:
            result = [.disclosureBack]
            result += runtimeChoiceIDs.map(Self.runtimeChoice)
            result.append(.configureRuntime)
        case .runtimeConfiguration:
            result = [
                .disclosureBack,
                .harness,
                .model,
                .version,
                .effort,
                .route,
                .applyRuntime,
            ]
        case .route:
            result = [
                .disclosureBack,
                .persistence,
                .agentName,
                .displayName,
                .disclosureDone,
            ]
        }

        // The fast lane is project → message → runtime → create. Supporting
        // controls remain in the same wrapping focus loop after the primary
        // action, and keep direct shortcuts where one exists.
        result.append(.instructions)
        result += [.runtimeSummary, .create, .voice, .attach]
        result += attachmentIDs.map(Self.attachment)
        result += referenceIDs.map(Self.reference)
        result += trailing
        return result
    }
}

struct HUDRunnerRuntimePreset: Codable, Equatable, Hashable, Identifiable, Sendable {
    let harness: String
    let model: String
    let effort: String

    var id: String {
        [harness, model, effort].joined(separator: "\u{1F}")
    }

    var familyID: String {
        [harness, model].joined(separator: "\u{1F}")
    }
}

struct HUDRunnerProjectUsage: Codable, Equatable, Sendable {
    var useCount: Int
    var lastUsedOrdinal: UInt64
}

struct HUDRunnerRecentHistory: Codable, Equatable, Sendable {
    static let capacity = 3
    private static let projectUsageCapacity = 64

    private(set) var projectIDs: [String] = []
    private(set) var runtimePresets: [HUDRunnerRuntimePreset] = []
    private(set) var projectUsage: [String: HUDRunnerProjectUsage] = [:]
    private var nextProjectOrdinal: UInt64 = 0

    private enum CodingKeys: String, CodingKey {
        case projectIDs
        case runtimePresets
        case projectUsage
        case nextProjectOrdinal
    }

    init() {}

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        projectIDs = try container.decodeIfPresent([String].self, forKey: .projectIDs) ?? []
        runtimePresets = try container.decodeIfPresent(
            [HUDRunnerRuntimePreset].self,
            forKey: .runtimePresets
        ) ?? []
        projectUsage = try container.decodeIfPresent(
            [String: HUDRunnerProjectUsage].self,
            forKey: .projectUsage
        ) ?? [:]
        nextProjectOrdinal = try container.decodeIfPresent(
            UInt64.self,
            forKey: .nextProjectOrdinal
        ) ?? projectUsage.values.map(\.lastUsedOrdinal).max() ?? 0

        // History written before usage scoring only contains an MRU list.
        // Seed it without inventing extra frequency so upgrades retain order.
        if projectUsage.isEmpty {
            for id in projectIDs.reversed() {
                nextProjectOrdinal &+= 1
                projectUsage[id] = HUDRunnerProjectUsage(
                    useCount: 1,
                    lastUsedOrdinal: nextProjectOrdinal
                )
            }
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(projectIDs, forKey: .projectIDs)
        try container.encode(runtimePresets, forKey: .runtimePresets)
        try container.encode(projectUsage, forKey: .projectUsage)
        try container.encode(nextProjectOrdinal, forKey: .nextProjectOrdinal)
    }

    mutating func recordProject(_ id: String) {
        let value = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        projectIDs.removeAll { $0 == value }
        projectIDs.insert(value, at: 0)
        projectIDs = Array(projectIDs.prefix(Self.capacity))

        nextProjectOrdinal &+= 1
        var usage = projectUsage[value] ?? HUDRunnerProjectUsage(
            useCount: 0,
            lastUsedOrdinal: 0
        )
        if usage.useCount < Int.max {
            usage.useCount += 1
        }
        usage.lastUsedOrdinal = nextProjectOrdinal
        projectUsage[value] = usage
        trimProjectUsageIfNeeded()
    }

    mutating func recordRuntime(_ preset: HUDRunnerRuntimePreset) {
        guard !preset.harness.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        runtimePresets.removeAll { $0.familyID == preset.familyID }
        runtimePresets.insert(preset, at: 0)
        runtimePresets = Array(runtimePresets.prefix(Self.capacity))
    }

    mutating func prune(
        validProjectIDs: Set<String>,
        isRuntimeValid: (HUDRunnerRuntimePreset) -> Bool
    ) {
        projectIDs = projectIDs.filter(validProjectIDs.contains)
        projectUsage = projectUsage.filter { validProjectIDs.contains($0.key) }
        runtimePresets = runtimePresets.filter(isRuntimeValid)
    }

    /// Project ids ranked by a reciprocal-rank blend of recency (65%) and
    /// successful-use frequency (35%). Rank blending keeps the scale stable as
    /// counts grow and lets a familiar project survive one newer one-off task.
    var rankedProjectIDs: [String] {
        let ids = Array(projectUsage.keys)
        let recent = ids.sorted { lhs, rhs in
            let left = projectUsage[lhs]?.lastUsedOrdinal ?? 0
            let right = projectUsage[rhs]?.lastUsedOrdinal ?? 0
            if left != right { return left > right }
            return lhs < rhs
        }
        let frequent = ids.sorted { lhs, rhs in
            let left = projectUsage[lhs] ?? HUDRunnerProjectUsage(
                useCount: 0,
                lastUsedOrdinal: 0
            )
            let right = projectUsage[rhs] ?? HUDRunnerProjectUsage(
                useCount: 0,
                lastUsedOrdinal: 0
            )
            if left.useCount != right.useCount { return left.useCount > right.useCount }
            if left.lastUsedOrdinal != right.lastUsedOrdinal {
                return left.lastUsedOrdinal > right.lastUsedOrdinal
            }
            return lhs < rhs
        }
        let recentRanks = Dictionary(uniqueKeysWithValues: recent.enumerated().map {
            ($0.element, $0.offset)
        })
        let frequencyRanks = Dictionary(uniqueKeysWithValues: frequent.enumerated().map {
            ($0.element, $0.offset)
        })

        return ids.sorted { lhs, rhs in
            let leftScore = Self.rankScore(
                recency: recentRanks[lhs] ?? ids.count,
                frequency: frequencyRanks[lhs] ?? ids.count
            )
            let rightScore = Self.rankScore(
                recency: recentRanks[rhs] ?? ids.count,
                frequency: frequencyRanks[rhs] ?? ids.count
            )
            if leftScore != rightScore { return leftScore > rightScore }
            let leftRecent = projectUsage[lhs]?.lastUsedOrdinal ?? 0
            let rightRecent = projectUsage[rhs]?.lastUsedOrdinal ?? 0
            if leftRecent != rightRecent { return leftRecent > rightRecent }
            return lhs < rhs
        }
    }

    func projectUsageLabel(for id: String) -> String? {
        guard let usage = projectUsage[id] else { return nil }
        if projectIDs.first == id {
            return "RECENT"
        }
        let highestCount = projectUsage.values.map(\.useCount).max() ?? 0
        if usage.useCount > 1, usage.useCount == highestCount {
            return "\(usage.useCount) TASKS"
        }
        return nil
    }

    private static func rankScore(recency: Int, frequency: Int) -> Double {
        0.65 / Double(recency + 1) + 0.35 / Double(frequency + 1)
    }

    private mutating func trimProjectUsageIfNeeded() {
        guard projectUsage.count > Self.projectUsageCapacity else { return }
        let keep = Set(rankedProjectIDs.prefix(Self.projectUsageCapacity))
        projectUsage = projectUsage.filter { keep.contains($0.key) }
    }
}
