import Foundation
import ScoutCore

enum ScoutWorkspaceSeed {
    static let defaultAgents: [ScoutAgentProfile] = [
        ScoutAgentProfile(
            id: "scout",
            name: "Scout",
            role: "Operator agent",
            summary: "General-purpose execution partner for shipping product work.",
            systemImage: "scope"
        ),
        ScoutAgentProfile(
            id: "builder",
            name: "Builder",
            role: "Implementation agent",
            summary: "Turns briefs into code changes, migrations, and runnable patches.",
            systemImage: "hammer"
        ),
        ScoutAgentProfile(
            id: "reviewer",
            name: "Reviewer",
            role: "Quality agent",
            summary: "Pressure-tests plans, catches regressions, and tightens delivery quality.",
            systemImage: "checkmark.seal"
        ),
        ScoutAgentProfile(
            id: "research",
            name: "Research",
            role: "Discovery agent",
            summary: "Finds missing context, source material, and supporting evidence.",
            systemImage: "magnifyingglass"
        ),
    ]

    static let workflowTemplates: [ScoutWorkflowTemplate] = [
        ScoutWorkflowTemplate(
            id: "agent-brief",
            name: "Agent Brief",
            summary: "Turn loose product or engineering notes into a crisp build brief for one or more agents.",
            systemImage: "text.badge.star",
            category: "Prompting",
            defaultTargetAgentIDs: ["scout", "builder"],
            sections: [
                ScoutWorkflowTemplateSection(
                    id: "objective",
                    title: "Objective",
                    guidance: "State the outcome in one sentence and avoid implementation trivia unless it changes the task."
                ),
                ScoutWorkflowTemplateSection(
                    id: "context",
                    title: "Context",
                    guidance: "Fold in the most relevant notes, constraints, and current repo reality."
                ),
                ScoutWorkflowTemplateSection(
                    id: "deliverable",
                    title: "Deliverable",
                    guidance: "Be explicit about the artifact or product behavior you want back."
                ),
                ScoutWorkflowTemplateSection(
                    id: "guardrails",
                    title: "Guardrails",
                    guidance: "Name risks, boundaries, and any product principles the agent should preserve."
                ),
            ],
            outputGuidance: [
                "Return a concise implementation plan before major edits.",
                "Call out blockers instead of hiding them.",
                "Prefer direct code changes over speculative recommendations.",
            ]
        ),
        ScoutWorkflowTemplate(
            id: "brain-dump-to-plan",
            name: "Brain Dump to Plan",
            summary: "Convert scattered thoughts into a staged product or engineering plan with visible priorities.",
            systemImage: "sparkles.rectangle.stack",
            category: "Planning",
            defaultTargetAgentIDs: ["scout", "research"],
            sections: [
                ScoutWorkflowTemplateSection(
                    id: "signal",
                    title: "Signal Extraction",
                    guidance: "Separate goals, worries, and concrete asks from the raw notes."
                ),
                ScoutWorkflowTemplateSection(
                    id: "priorities",
                    title: "Priority Stack",
                    guidance: "Group the work into now, next, and later so the agent has an execution order."
                ),
                ScoutWorkflowTemplateSection(
                    id: "execution",
                    title: "Execution Shape",
                    guidance: "Frame the first real slice of work so it is shippable without waiting on the full roadmap."
                ),
            ],
            outputGuidance: [
                "Organize the response into phases with clear sequencing.",
                "Surface open questions separately from committed work.",
                "Keep the first slice small enough to build now.",
            ]
        ),
        ScoutWorkflowTemplate(
            id: "compose-reply",
            name: "Compose Reply",
            summary: "Draft a response, update, or handoff message in the voice of a thoughtful operator.",
            systemImage: "square.and.arrow.up.badge.clock",
            category: "Compose",
            defaultTargetAgentIDs: ["reviewer"],
            sections: [
                ScoutWorkflowTemplateSection(
                    id: "audience",
                    title: "Audience",
                    guidance: "Clarify who the reply is for and what they already know."
                ),
                ScoutWorkflowTemplateSection(
                    id: "tone",
                    title: "Tone",
                    guidance: "Keep the writing direct, confident, and useful. Avoid fluff."
                ),
                ScoutWorkflowTemplateSection(
                    id: "payload",
                    title: "Payload",
                    guidance: "Make sure the reply answers the actual question and closes the loop."
                ),
            ],
            outputGuidance: [
                "Write in a way that can be sent with minimal editing.",
                "Prefer concrete dates, names, and actions over abstractions.",
            ]
        ),
        ScoutWorkflowTemplate(
            id: "issue-triage",
            name: "Issue Triage",
            summary: "Take raw bug or support notes and package them into an actionable triage brief.",
            systemImage: "exclamationmark.bubble",
            category: "Operations",
            defaultTargetAgentIDs: ["builder", "reviewer"],
            sections: [
                ScoutWorkflowTemplateSection(
                    id: "symptom",
                    title: "Observed Symptom",
                    guidance: "Describe the failure the way an end user or operator would experience it."
                ),
                ScoutWorkflowTemplateSection(
                    id: "repro",
                    title: "Reproduction",
                    guidance: "Capture the shortest trustworthy path to reproduce or investigate."
                ),
                ScoutWorkflowTemplateSection(
                    id: "expected",
                    title: "Expected Outcome",
                    guidance: "State the correct behavior and how to know the fix is complete."
                ),
            ],
            outputGuidance: [
                "Separate evidence from assumptions.",
                "Call out missing repro details explicitly.",
                "End with suggested next steps for the assigned agent.",
            ]
        ),
    ]

    static func snapshot(now: Date = .now) -> ScoutWorkspaceSnapshot {
        let seedNote = ScoutNote(
            title: "What OpenScout should offer end users",
            body: """
            Focus the shell around real agent interaction, not placeholder chrome.

            - Notes should become reusable context, not dead text.
            - Compose should help shape prompts, workflows, and handoffs to agents.
            - Workflows should package repeated prompting patterns.
            - Agent interaction should feel local, inspectable, and grounded in files.
            """,
            tags: ["product", "agents", "ux"],
            linkedAgentIDs: ["scout", "builder"],
            createdAt: now,
            updatedAt: now
        )

        let seedDraft = ScoutComposeDraft(
            title: "Shore up the agent interaction surface",
            request: "Turn the attached notes into a build-ready brief for expanding OpenScout beyond the scaffold.",
            context: "Prioritize notes, compose, workflows, and relay-driven interaction. Keep the shell native, but make prompt assembly and agent handoff feel first-class.",
            deliverable: "A phased implementation plan with the first slice small enough to build immediately.",
            selectedWorkflowID: "agent-brief",
            targetAgentIDs: ["scout", "builder"],
            linkedNoteIDs: [seedNote.id],
            state: .ready,
            createdAt: now,
            updatedAt: now
        )

        return ScoutWorkspaceSnapshot(
            notes: [seedNote],
            drafts: [seedDraft],
            agents: defaultAgents,
            workflowRuns: [],
            lastUpdatedAt: now
        )
    }
}
