import Foundation
import ScoutCapabilities

/// Pure initiation draft shared by every macOS entry point. UI surfaces can
/// prefill any field, then call `spec()` to get the exact `/api/sessions`
/// contract without duplicating request-building rules.
public struct ScoutSessionDraft: Identifiable, Equatable {
    public enum Mode: Hashable, Sendable {
        case fresh
        case continueContext
    }

    public enum Target: Equatable, Sendable {
        case agent(ScoutAgent)
        case project
    }

    public let id: UUID
    public var title: String
    public var target: Target
    public var projectPath: String
    public var mode: Mode
    public var instructions: String
    public var fromMessageId: String?
    public var fromConversationId: String?
    public var seedSourceName: String?
    public var seedPreview: String?
    public var attachments: [MessageAttachment]
    public var harness: String?
    public var model: String?
    public var reasoningEffort: String
    public var agentName: String
    public var displayName: String
    public var agentPersistence: String

    public init(
        id: UUID = UUID(),
        title: String,
        target: Target,
        projectPath: String,
        mode: Mode = .fresh,
        instructions: String = "",
        fromMessageId: String? = nil,
        fromConversationId: String? = nil,
        seedSourceName: String? = nil,
        seedPreview: String? = nil,
        attachments: [MessageAttachment] = [],
        harness: String? = nil,
        model: String? = nil,
        reasoningEffort: String = "medium",
        agentName: String = "",
        displayName: String = "",
        agentPersistence: String = "sticky"
    ) {
        self.id = id
        self.title = title
        self.target = target
        self.projectPath = projectPath
        self.mode = mode
        self.instructions = instructions
        self.fromMessageId = fromMessageId
        self.fromConversationId = fromConversationId
        self.seedSourceName = seedSourceName
        self.seedPreview = seedPreview
        self.attachments = attachments
        self.harness = harness
        self.model = model
        self.reasoningEffort = reasoningEffort
        self.agentName = agentName
        self.displayName = displayName
        self.agentPersistence = agentPersistence
    }

    public var agent: ScoutAgent? {
        if case let .agent(agent) = target { return agent }
        return nil
    }

    /// Continuing full harness context is possible only when the selected
    /// roster agent exposes a concrete resumable harness session id.
    public var canContinue: Bool {
        trimmedNonEmpty(agent?.harnessSessionId) != nil
    }

    public func spec() -> SessionInitiationSpec {
        let targetSpec: SessionInitiationSpec.Target = switch target {
        case .agent(let agent):
            .init(agentId: agent.id)
        case .project:
            .init(projectPath: trimmedNonEmpty(projectPath))
        }

        let sessionMode: SessionInitiationSpec.SessionMode = {
            if mode == .continueContext { return .existing }
            return .new
        }()
        let execution = SessionInitiationSpec.Execution(
            harness: trimmedNonEmpty(harness),
            model: trimmedNonEmpty(model),
            reasoningEffort: trimmedNonEmpty(reasoningEffort),
            session: sessionMode,
            targetSessionId: mode == .continueContext ? trimmedNonEmpty(agent?.harnessSessionId) : nil
        )

        let agentSpec: SessionInitiationSpec.Agent? = {
            guard case .project = target else { return nil }
            let handle = trimmedNonEmpty(agentName)
            return .init(
                persistence: trimmedNonEmpty(agentPersistence) ?? "sticky",
                handle: handle,
                displayName: handle == nil ? nil : trimmedNonEmpty(displayName)
            )
        }()

        return SessionInitiationSpec(
            target: targetSpec,
            execution: execution,
            agent: agentSpec,
            seed: .init(
                instructions: trimmedNonEmpty(instructions),
                fromMessageId: trimmedNonEmpty(fromMessageId),
                fromConversationId: trimmedNonEmpty(fromConversationId),
                attachments: attachments.isEmpty ? nil : attachments
            )
        )
    }
}

private func trimmedNonEmpty(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty else {
        return nil
    }
    return trimmed
}
