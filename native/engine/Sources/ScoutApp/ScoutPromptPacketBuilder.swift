import Foundation
import ScoutCore

enum ScoutPromptPacketBuilder {
    static func makeRun(
        draft: ScoutComposeDraft,
        workflow: ScoutWorkflowTemplate,
        notes: [ScoutNote],
        agents: [ScoutAgentProfile]
    ) -> ScoutWorkflowRun {
        let resolvedAgents = agents.filter { draft.targetAgentIDs.contains($0.id) }
        let packet = makePacket(
            draft: draft,
            workflow: workflow,
            notes: notes,
            agents: resolvedAgents
        )

        let contextOutput = notes.isEmpty ? "No linked notes were attached to this draft." : notes
            .map { note in
                """
                - \(note.title)
                  \(note.body)
                """
            }
            .joined(separator: "\n")

        let workflowOutput = workflow.sections
            .map { section in
                "• \(section.title): \(section.guidance)"
            }
            .joined(separator: "\n")

        let steps = [
            ScoutWorkflowRunStep(
                id: "context",
                title: "Collected Context",
                output: contextOutput
            ),
            ScoutWorkflowRunStep(
                id: "workflow",
                title: "Workflow Frame",
                output: workflowOutput
            ),
            ScoutWorkflowRunStep(
                id: "packet",
                title: "Agent Packet",
                output: packet
            ),
        ]

        return ScoutWorkflowRun(
            workflowID: workflow.id,
            workflowName: workflow.name,
            draftID: draft.id,
            title: draft.title,
            targetAgentIDs: draft.targetAgentIDs,
            packet: packet,
            steps: steps,
            state: .generated,
            createdAt: .now
        )
    }

    private static func makePacket(
        draft: ScoutComposeDraft,
        workflow: ScoutWorkflowTemplate,
        notes: [ScoutNote],
        agents: [ScoutAgentProfile]
    ) -> String {
        let targetLine = agents.isEmpty
            ? "No explicit agent targets selected."
            : agents.map { "@\($0.id) (\($0.role))" }.joined(separator: ", ")

        let noteBlock = notes.isEmpty ? "No linked notes." : notes
            .map { note in
                """
                ### \(note.title)
                \(note.body)
                """
            }
            .joined(separator: "\n\n")

        let guidanceBlock = workflow.sections
            .map { section in
                """
                ## \(section.title)
                \(section.guidance)
                """
            }
            .joined(separator: "\n\n")

        let outputBlock = workflow.outputGuidance
            .map { "- \($0)" }
            .joined(separator: "\n")

        return """
        # \(draft.title)

        Workflow: \(workflow.name)
        Targets: \(targetLine)

        ## Request
        \(draft.request)

        ## Additional Context
        \(nonEmptyBlock(draft.context))

        ## Deliverable
        \(nonEmptyBlock(draft.deliverable))

        ## Linked Notes
        \(noteBlock)

        \(guidanceBlock)

        ## Output Guidance
        \(outputBlock)
        """
    }

    private static func nonEmptyBlock(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "No extra detail provided." : trimmed
    }
}
