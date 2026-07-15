import Foundation

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
    case dismiss

    static func visibleOrder(
        disclosure: HUDRunnerDisclosure,
        projectChoiceIDs: [String] = [],
        runtimeChoiceIDs: [String] = [],
        attachmentIDs: [UUID] = [],
        referenceIDs: [String] = []
    ) -> [HUDRunnerFocusTarget] {
        var result: [HUDRunnerFocusTarget]
        switch disclosure {
        case .none:
            result = [.projectSummary, .runtimeSummary]
        case .projectChoices:
            result = [.disclosureBack]
            result += projectChoiceIDs.map(Self.projectChoice)
            result.append(.projectSearch)
        case .projectSearch:
            result = [.disclosureBack, .projectSearch, .browseDirectory]
            result += projectChoiceIDs.map(Self.projectChoice)
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

        result.append(.instructions)
        result += attachmentIDs.map(Self.attachment)
        result += referenceIDs.map(Self.reference)
        result += [.attach, .voice, .create, .dismiss]
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
}

struct HUDRunnerRecentHistory: Codable, Equatable, Sendable {
    static let capacity = 3

    private(set) var projectIDs: [String] = []
    private(set) var runtimePresets: [HUDRunnerRuntimePreset] = []

    mutating func recordProject(_ id: String) {
        let value = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        projectIDs.removeAll { $0 == value }
        projectIDs.insert(value, at: 0)
        projectIDs = Array(projectIDs.prefix(Self.capacity))
    }

    mutating func recordRuntime(_ preset: HUDRunnerRuntimePreset) {
        guard !preset.harness.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        runtimePresets.removeAll { $0.id == preset.id }
        runtimePresets.insert(preset, at: 0)
        runtimePresets = Array(runtimePresets.prefix(Self.capacity))
    }

    mutating func prune(
        validProjectIDs: Set<String>,
        isRuntimeValid: (HUDRunnerRuntimePreset) -> Bool
    ) {
        projectIDs = projectIDs.filter(validProjectIDs.contains)
        runtimePresets = runtimePresets.filter(isRuntimeValid)
    }
}
