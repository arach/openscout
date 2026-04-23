// HarnessPickerView — Select an agentic harness for a project.
//
// Shows available agent runtimes (Claude Code, Codex, etc.), model selection,
// existing sessions for the workspace, and always offers "New Session".

import SwiftUI

// MARK: - Harness Definition

struct Harness: Identifiable, Hashable {
    let id: String          // adapter identifier sent to bridge
    let name: String        // display name
    let icon: String        // SF Symbol
    let description: String // one-liner
    let color: Color        // accent for the card

    static let builtIn: [Harness] = [
        Harness(
            id: "claude-code",
            name: "Claude Code",
            icon: "terminal",
            description: "Anthropic's agentic coding CLI",
            color: ScoutColors.accent
        ),
        Harness(
            id: "codex",
            name: "Codex",
            icon: "chevron.left.forwardslash.chevron.right",
            description: "OpenAI's coding agent",
            color: ScoutColors.accent
        ),
    ]
}

// MARK: - HarnessConfig

/// Configuration for launching a session — harness + optional overrides.
struct HarnessConfig {
    let harness: Harness
    var model: String?
    var branch: String?
    var worktree: Bool = false
}

// MARK: - Callback types

enum SessionAction {
    case createNew(HarnessConfig)
    case resume(sessionId: String)
}

// MARK: - HarnessPickerView

struct HarnessPickerView: View {
    let projectName: String
    let projectPath: String
    var projectBranch: String?
    let onAction: (SessionAction) -> Void

    // Legacy convenience initializer for create-only callers
    init(projectName: String, projectPath: String, projectBranch: String? = nil, onSelect: @escaping (HarnessConfig) -> Void) {
        self.projectName = projectName
        self.projectPath = projectPath
        self.projectBranch = projectBranch
        self.onAction = { action in
            if case .createNew(let config) = action {
                onSelect(config)
            }
        }
    }

    init(projectName: String, projectPath: String, projectBranch: String? = nil, onAction: @escaping (SessionAction) -> Void) {
        self.projectName = projectName
        self.projectPath = projectPath
        self.projectBranch = projectBranch
        self.onAction = onAction
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var store

    @State private var selectedHarness: Harness?
    @State private var selectedModel = ""

    private var launchModelOptions: [String] {
        ScoutModelCatalog.launchOptions(for: selectedHarness?.id)
    }

    /// Existing sessions that match this workspace.
    private var existingSessions: [SessionSummary] {
        let pathComponent = URL(fileURLWithPath: projectPath).lastPathComponent.lowercased()
        return store.summaries
            .filter { summary in
                // Match by project name or workspace root
                if let project = summary.project?.lowercased(), project == pathComponent {
                    return true
                }
                return false
            }
            .sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Project header
                projectHeader

                Divider().background(ScoutColors.divider)

                ScrollView {
                    VStack(spacing: ScoutSpacing.lg) {
                        // Existing sessions for this workspace
                        if !existingSessions.isEmpty {
                            existingSessionsSection
                        }

                        // Harness selection
                        harnessSection

                        // Model picker (visible when harness selected)
                        if selectedHarness != nil {
                            configSection
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    .padding(ScoutSpacing.lg)
                }

                // Launch button
                if let harness = selectedHarness {
                    launchButton(harness: harness)
                }
            }
            .background(ScoutColors.backgroundAdaptive)
            .navigationTitle("Open Project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .animation(.spring(response: 0.3, dampingFraction: 0.85), value: selectedHarness?.id)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - Project Header

    private var projectHeader: some View {
        HStack(spacing: ScoutSpacing.md) {
            Image(systemName: "folder.fill")
                .font(.system(size: 15))
                .foregroundStyle(ScoutColors.textMuted)
            VStack(alignment: .leading, spacing: 2) {
                Text(projectName)
                    .font(ScoutTypography.body(16, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
                Text(projectPath)
                    .font(ScoutTypography.code(12))
                    .foregroundStyle(ScoutColors.textMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let branch = projectBranch?.trimmedNonEmpty {
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 10, weight: .medium))
                        Text(branch)
                            .font(ScoutTypography.code(12))
                    }
                    .foregroundStyle(ScoutColors.textSecondary)
                }
            }
            Spacer()
        }
        .padding(ScoutSpacing.lg)
        .background(ScoutColors.surfaceAdaptive)
    }

    // MARK: - Existing Sessions

    private var existingSessionsSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            Text("Active Sessions")
                .font(ScoutTypography.caption(13, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            ForEach(existingSessions) { summary in
                Button {
                    onAction(.resume(sessionId: summary.sessionId))
                    dismiss()
                } label: {
                    HStack(spacing: ScoutSpacing.md) {
                        Image(systemName: AdapterIcon.systemName(for: summary.adapterType))
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(ScoutColors.textMuted)
                            .frame(width: 24)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(summary.name)
                                .font(ScoutTypography.body(14, weight: .medium))
                                .foregroundStyle(ScoutColors.textPrimary)
                                .lineLimit(1)

                            HStack(spacing: ScoutSpacing.xs) {
                                if summary.currentTurnStatus == "streaming" {
                                    PulseIndicator()
                                    Text("Working")
                                        .font(ScoutTypography.caption(11, weight: .medium))
                                        .foregroundStyle(ScoutColors.statusStreaming)
                                } else {
                                    Text("\(summary.turnCount) turns")
                                        .font(ScoutTypography.caption(11))
                                        .foregroundStyle(ScoutColors.textMuted)
                                    Text("·")
                                        .foregroundStyle(ScoutColors.textMuted)
                                    Text(RelativeTime.string(from: summary.lastActivityAt))
                                        .font(ScoutTypography.caption(11))
                                        .foregroundStyle(ScoutColors.textMuted)
                                }
                            }
                        }

                        Spacer()

                        Text("RESUME")
                            .font(ScoutTypography.code(10, weight: .semibold))
                            .foregroundStyle(ScoutColors.textMuted)
                    }
                    .padding(ScoutSpacing.md)
                    .background(ScoutColors.surfaceRaisedAdaptive)
                    .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Harness Selection

    private var harnessSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            Text("New Session")
                .font(ScoutTypography.caption(13, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            ForEach(Harness.builtIn) { harness in
                HarnessCard(
                    harness: harness,
                    isSelected: selectedHarness?.id == harness.id
                ) {
                    withAnimation(.easeInOut(duration: 0.15)) {
                        selectedHarness = harness
                        selectedModel = ""
                    }
                }
            }
        }
    }

    // MARK: - Configuration

    private var configSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            Text("Configuration")
                .font(ScoutTypography.caption(13, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            if !launchModelOptions.isEmpty {
                modelPickerField
            }
        }
    }

    // MARK: - Launch Button

    private func launchButton(harness: Harness) -> some View {
        VStack(spacing: 0) {
            Divider().background(ScoutColors.divider)
            Button {
                onAction(
                    .createNew(HarnessConfig(
                        harness: harness,
                        model: selectedModel.trimmedNonEmpty,
                        branch: projectBranch?.trimmedNonEmpty
                    ))
                )
                dismiss()
            } label: {
                HStack(spacing: ScoutSpacing.sm) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 14, weight: .semibold))
                    Text("New Session with \(harness.name)")
                        .font(ScoutTypography.body(15, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(ScoutColors.textPrimary)
                .foregroundStyle(ScoutColors.backgroundAdaptive)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .padding(ScoutSpacing.lg)
        }
        .background(ScoutColors.backgroundAdaptive)
        .transition(.move(edge: .bottom))
    }
}

// MARK: - Config Field

private extension HarnessPickerView {
    var modelPickerField: some View {
        Menu {
            Button {
                selectedModel = ""
            } label: {
                if selectedModel.isEmpty {
                    Label("Default", systemImage: "checkmark")
                } else {
                    Text("Default")
                }
            }

            ForEach(launchModelOptions, id: \.self) { model in
                Button {
                    selectedModel = model
                } label: {
                    if selectedModel == model {
                        Label(ScoutModelLabel.displayText(for: model, fallback: model), systemImage: "checkmark")
                    } else {
                        Text(ScoutModelLabel.displayText(for: model, fallback: model))
                    }
                }
            }
        } label: {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: "cpu")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Model")
                        .font(ScoutTypography.caption(11, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                    Text(selectedModel.isEmpty ? "Default" : ScoutModelLabel.displayText(for: selectedModel, fallback: selectedModel))
                        .font(ScoutTypography.code(14))
                        .foregroundStyle(ScoutColors.textPrimary)
                }

                Spacer()

                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .padding(ScoutSpacing.md)
            .background(ScoutColors.surfaceAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        }
    }
}

// MARK: - Harness Card

private struct HarnessCard: View {
    let harness: Harness
    var isSelected = false
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: harness.icon)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(harness.name)
                        .font(ScoutTypography.code(14, weight: .medium))
                        .foregroundStyle(ScoutColors.textPrimary)
                    Text(harness.description)
                        .font(ScoutTypography.caption(12))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                }
            }
            .padding(ScoutSpacing.md)
            .background(isSelected ? ScoutColors.surfaceAdaptive : ScoutColors.surfaceRaisedAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}
