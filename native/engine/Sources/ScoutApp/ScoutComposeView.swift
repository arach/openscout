import ScoutCore
import SwiftUI

struct ScoutComposeView: View {
    @Bindable var viewModel: ScoutShellViewModel

    @State private var title = ""
    @State private var request = ""
    @State private var context = ""
    @State private var deliverable = ""
    @State private var selectedWorkflowID = ScoutWorkspaceSeed.workflowTemplates.first?.id ?? "agent-brief"
    @State private var targetAgentIDs = Set<String>()
    @State private var linkedNoteIDs = Set<UUID>()

    var body: some View {
        ScoutPage {
            ScoutPageHeader(
                eyebrow: "Compose",
                title: "Prompt Packets, Not Loose Text",
                subtitle: "Shape a serious agent brief with reusable workflow structure, linked notes, and a delivery path into relay.",
                actions: AnyView(
                    HStack(spacing: 10) {
                        Button("New Draft") {
                            viewModel.createDraft()
                            syncEditorFromSelection()
                        }
                        .buttonStyle(ScoutButtonStyle())

                        Button("Save Draft") {
                            saveCurrentDraft()
                        }
                        .buttonStyle(ScoutButtonStyle())
                        .disabled(viewModel.selectedDraft == nil)
                    }
                )
            )

            HSplitView {
                draftList
                    .frame(minWidth: 250, idealWidth: 290, maxWidth: 340)

                composeEditor
                    .frame(minWidth: 540)

                packetPreview
                    .frame(minWidth: 380, idealWidth: 420)
            }
            .frame(minHeight: 700)
        }
        .onAppear {
            syncEditorFromSelection()
        }
        .onChange(of: viewModel.selectedDraftID) { _, _ in
            syncEditorFromSelection()
        }
    }

    private var draftList: some View {
        ScoutSection(
            title: "Drafts",
            subtitle: "\(viewModel.drafts.count) saved briefs"
        ) {
            if viewModel.drafts.isEmpty {
                Text("No compose drafts yet. Create one from scratch or promote a note into compose.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(viewModel.drafts) { draft in
                            Button {
                                viewModel.selectedDraftID = draft.id
                            } label: {
                                DraftRow(
                                    draft: draft,
                                    workflowName: viewModel.workflow(id: draft.selectedWorkflowID)?.name ?? "Workflow",
                                    isSelected: viewModel.selectedDraftID == draft.id
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private var composeEditor: some View {
        ScoutSection(
            title: "Brief Builder",
            subtitle: "Invest in the brief once, then reuse it across agents and workflows."
        ) {
            if viewModel.selectedDraft == nil {
                Text("Select a draft to compose, or create a new one.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        TextField("Draft title", text: $title)
                            .textFieldStyle(.plain)
                            .font(.system(size: 21, weight: .medium))
                            .foregroundStyle(ScoutTheme.ink)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(ScoutTheme.surfaceStrong)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10)
                                            .strokeBorder(ScoutTheme.border, lineWidth: 1)
                                    )
                            )

                        ScoutEditor(
                            title: "Request",
                            placeholder: "What should the agent actually do?",
                            text: $request,
                            minHeight: 180,
                            usesMonospacedFont: true,
                            subtitle: "Tab indents. Shift-Tab outdents. Return carries list structure.",
                            showsLineNumbers: true,
                            showsStatusBar: true
                        )

                        ScoutEditor(
                            title: "Context",
                            placeholder: "Add product constraints, repo state, or anything the agent should know before acting.",
                            text: $context,
                            minHeight: 220,
                            usesMonospacedFont: true,
                            subtitle: "Use this for durable briefing context, prior decisions, and repo state.",
                            showsLineNumbers: true,
                            showsStatusBar: true
                        )

                        ScoutEditor(
                            title: "Deliverable",
                            placeholder: "Specify the artifact, behavior, or format you want back.",
                            text: $deliverable,
                            minHeight: 140,
                            usesMonospacedFont: true,
                            subtitle: "Define output shape, constraints, and what done looks like.",
                            showsLineNumbers: true,
                            showsStatusBar: true
                        )

                        workflowPicker
                        notePicker
                        agentPicker

                        HStack(spacing: 10) {
                            Button("Save Draft") {
                                saveCurrentDraft()
                            }
                            .buttonStyle(ScoutButtonStyle())

                            Button("Generate Packet") {
                                saveCurrentDraft()
                                viewModel.generateRunForSelectedDraft()
                            }
                            .buttonStyle(ScoutButtonStyle(tone: .primary))

                            Button("Send To Agents") {
                                sendPreviewPacket()
                            }
                            .buttonStyle(ScoutButtonStyle())
                        }
                    }
                }
            }
        }
    }

    private var packetPreview: some View {
        let previewRun = currentPreviewRun()

        return ScoutSection(
            title: "Packet Preview",
            subtitle: "The handoff that will be delivered into relay."
        ) {
            if let previewRun {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(previewRun.workflowName)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(ScoutTheme.ink)

                        Text(previewRun.targetAgentIDs.map { "@\($0)" }.joined(separator: ", "))
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(ScoutTheme.inkMuted)
                    }

                    ScrollView {
                        Text(previewRun.packet)
                            .font(.system(size: 12, weight: .regular, design: .monospaced))
                            .foregroundStyle(ScoutTheme.ink)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(minHeight: 280)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(ScoutTheme.surfaceStrong)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .strokeBorder(ScoutTheme.border, lineWidth: 1)
                            )
                    )

                    VStack(alignment: .leading, spacing: 10) {
                        ScoutSubsectionHeader("Workflow Steps")

                        ForEach(previewRun.steps) { step in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(step.title)
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(ScoutTheme.ink)

                                Text(step.output)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(ScoutTheme.inkSecondary)
                                    .textSelection(.enabled)
                            }
                            .padding(.bottom, 4)
                        }
                    }
                }
            } else {
                Text("Build a draft and choose a workflow to preview the final agent packet.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            }
        }
    }

    private var workflowPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScoutSubsectionHeader("Workflow Template")

            VStack(alignment: .leading, spacing: 10) {
                ForEach(viewModel.workflowTemplates) { workflow in
                    Button {
                        selectedWorkflowID = workflow.id
                        if targetAgentIDs.isEmpty {
                            targetAgentIDs = Set(workflow.defaultTargetAgentIDs)
                        }
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: workflow.systemImage)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(ScoutTheme.accent)
                                .frame(width: 18)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(workflow.name)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(ScoutTheme.ink)

                                Text(workflow.summary)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(ScoutTheme.inkSecondary)
                            }

                            Spacer()

                            if selectedWorkflowID == workflow.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(ScoutTheme.accent)
                            }
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(selectedWorkflowID == workflow.id ? ScoutTheme.selection : ScoutTheme.surfaceStrong)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .strokeBorder(ScoutTheme.border, lineWidth: 1)
                                )
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var notePicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScoutSubsectionHeader("Linked Notes", subtitle: "Attach durable context from the notes workspace.")

            ForEach(viewModel.notes) { note in
                Button {
                    if linkedNoteIDs.contains(note.id) {
                        linkedNoteIDs.remove(note.id)
                    } else {
                        linkedNoteIDs.insert(note.id)
                    }
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: linkedNoteIDs.contains(note.id) ? "checkmark.square.fill" : "square")
                            .foregroundStyle(linkedNoteIDs.contains(note.id) ? ScoutTheme.accent : ScoutTheme.inkMuted)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(note.title)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(ScoutTheme.ink)

                            Text(note.body)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(ScoutTheme.inkSecondary)
                                .lineLimit(2)
                        }

                        Spacer()
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(ScoutTheme.surfaceStrong)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .strokeBorder(ScoutTheme.border, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var agentPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScoutSubsectionHeader("Targets", subtitle: "Choose who this packet should reach.")
            FlowAgentPicker(agents: viewModel.agentProfiles, selection: $targetAgentIDs)
        }
    }

    private func syncEditorFromSelection() {
        guard let draft = viewModel.selectedDraft else {
            title = ""
            request = ""
            context = ""
            deliverable = ""
            selectedWorkflowID = ScoutWorkspaceSeed.workflowTemplates.first?.id ?? "agent-brief"
            targetAgentIDs = []
            linkedNoteIDs = []
            return
        }

        title = draft.title
        request = draft.request
        context = draft.context
        deliverable = draft.deliverable
        selectedWorkflowID = draft.selectedWorkflowID
        targetAgentIDs = Set(draft.targetAgentIDs)
        linkedNoteIDs = Set(draft.linkedNoteIDs)
    }

    private func saveCurrentDraft() {
        guard let draft = viewModel.selectedDraft else {
            return
        }

        viewModel.saveDraft(
            id: draft.id,
            title: title,
            request: request,
            context: context,
            deliverable: deliverable,
            workflowID: selectedWorkflowID,
            targetAgentIDs: Array(targetAgentIDs),
            linkedNoteIDs: Array(linkedNoteIDs)
        )
    }

    private func currentPreviewRun() -> ScoutWorkflowRun? {
        viewModel.previewRun(
            title: title,
            request: request,
            context: context,
            deliverable: deliverable,
            workflowID: selectedWorkflowID,
            targetAgentIDs: Array(targetAgentIDs),
            linkedNoteIDs: Array(linkedNoteIDs)
        )
    }

    private func sendPreviewPacket() {
        saveCurrentDraft()
        viewModel.generateRunForSelectedDraft()

        guard let run = viewModel.selectedWorkflowRun else {
            return
        }

        Task {
            await viewModel.sendRun(run.id)
        }
    }
}

private struct DraftRow: View {
    let draft: ScoutComposeDraft
    let workflowName: String
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(draft.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(ScoutTheme.ink)
                .lineLimit(1)

            Text(workflowName)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(ScoutTheme.inkMuted)

            Text(draft.request)
                .font(.system(size: 12))
                .foregroundStyle(ScoutTheme.inkSecondary)
                .lineLimit(3)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isSelected ? ScoutTheme.selection : ScoutTheme.surfaceStrong)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(isSelected ? ScoutTheme.accent.opacity(0.2) : ScoutTheme.border, lineWidth: 1)
                )
        )
    }
}
