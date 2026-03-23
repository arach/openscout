import ScoutCore
import SwiftUI

struct ScoutWorkflowsView: View {
    @Bindable var viewModel: ScoutShellViewModel
    @State private var selectedTemplateID = ScoutWorkspaceSeed.workflowTemplates.first?.id ?? "agent-brief"

    var body: some View {
        ScoutPage {
            ScoutPageHeader(
                eyebrow: "Workflows",
                title: "Prompting Patterns You Can Reuse",
                subtitle: "Borrow the best non-voice part of Talkie: reusable workflow structures that turn raw input into better downstream actions."
            )

            HSplitView {
                templateList
                    .frame(minWidth: 260, idealWidth: 310, maxWidth: 360)

                templateDetail
                    .frame(minWidth: 420)

                runHistory
                    .frame(minWidth: 360, idealWidth: 400)
            }
            .frame(minHeight: 640)
        }
    }

    private var templateList: some View {
        ScoutSection(
            title: "Library",
            subtitle: "\(viewModel.workflowTemplates.count) bundled templates"
        ) {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(viewModel.workflowTemplates) { template in
                        Button {
                            selectedTemplateID = template.id
                        } label: {
                            WorkflowTemplateRow(
                                template: template,
                                isSelected: selectedTemplateID == template.id
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var templateDetail: some View {
        let template = viewModel.workflow(id: selectedTemplateID)

        return ScoutSection(
            title: "Selected Workflow",
            subtitle: "Use these as structured prompt builders, not as hard-coded product logic."
        ) {
            if let template {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        Image(systemName: template.systemImage)
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(ScoutTheme.accent)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(template.name)
                                .font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(ScoutTheme.ink)

                            Text(template.summary)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(ScoutTheme.inkSecondary)
                        }
                    }

                    ScoutSubsection(title: "Sections") {
                        ForEach(template.sections) { section in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(section.title)
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(ScoutTheme.ink)

                                Text(section.guidance)
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(ScoutTheme.inkSecondary)
                            }
                            .padding(.bottom, 6)
                        }
                    }

                    ScoutSubsection(title: "Output Guidance") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(template.outputGuidance, id: \.self) { item in
                                Text("• \(item)")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(ScoutTheme.inkSecondary)
                            }
                        }
                    }

                    Button("Use In Compose") {
                        viewModel.createDraft(forWorkflowID: template.id)
                        viewModel.selectedRoute = .console
                    }
                    .buttonStyle(ScoutButtonStyle(tone: .primary))
                }
            } else {
                Text("Choose a workflow template from the library.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            }
        }
    }

    private var runHistory: some View {
        ScoutSection(
            title: "Recent Runs",
            subtitle: "Generated packets stay inspectable after they are sent."
        ) {
            if viewModel.workflowRuns.isEmpty {
                Text("No workflow runs yet. Generate a packet from Compose to start building history.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(viewModel.workflowRuns) { run in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(run.title)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(ScoutTheme.ink)

                                    Spacer()

                                    Text(run.state.title)
                                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                                        .foregroundStyle(run.state == .delivered ? ScoutTheme.accent : ScoutTheme.inkMuted)
                                }

                                Text(run.workflowName)
                                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                                    .foregroundStyle(ScoutTheme.inkMuted)

                                Text(run.packet)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(ScoutTheme.inkSecondary)
                                    .lineLimit(5)
                                    .textSelection(.enabled)
                            }
                            .padding(12)
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
                    }
                }
            }
        }
    }
}

private struct WorkflowTemplateRow: View {
    let template: ScoutWorkflowTemplate
    let isSelected: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: template.systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(ScoutTheme.accent)
                .frame(width: 18)

            VStack(alignment: .leading, spacing: 4) {
                Text(template.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ScoutTheme.ink)

                Text(template.summary)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
                    .lineLimit(3)
            }

            Spacer()
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
