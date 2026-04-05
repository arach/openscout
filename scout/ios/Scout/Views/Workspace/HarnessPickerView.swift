// HarnessPickerView — Select an agentic harness for a project.
//
// Shows available agent runtimes (Claude Code, Codex, Aider, etc.)
// Same codebase, different agent — pick the lens.

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
            color: Color(red: 0.45, green: 0.65, blue: 1.0)
        ),
        Harness(
            id: "codex",
            name: "Codex",
            icon: "chevron.left.forwardslash.chevron.right",
            description: "OpenAI's coding agent",
            color: Color(red: 0.3, green: 0.85, blue: 0.5)
        ),
    ]
}

// MARK: - HarnessPickerView

/// Configuration for launching a session — harness + optional overrides.
struct HarnessConfig {
    let harness: Harness
    var model: String?
    var branch: String?
}

struct HarnessPickerView: View {
    let projectName: String
    let projectPath: String
    var projectBranch: String?
    let onSelect: (HarnessConfig) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var selectedHarness: Harness?
    @State private var selectedModel = ""

    private var launchModelOptions: [String] {
        ScoutModelCatalog.launchOptions(for: selectedHarness?.id)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Project header
                HStack(spacing: ScoutSpacing.md) {
                    Image(systemName: "folder.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(ScoutColors.accent)
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

                Divider().background(ScoutColors.divider)

                ScrollView {
                    VStack(spacing: ScoutSpacing.lg) {
                        // Harness selection
                        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
                            Text("Harness")
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

                        // Session config (visible when harness selected)
                        if selectedHarness != nil {
                            VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
                                Text("Configuration")
                                    .font(ScoutTypography.caption(13, weight: .medium))
                                    .foregroundStyle(ScoutColors.textMuted)

                                if !launchModelOptions.isEmpty {
                                    modelPickerField
                                }
                            }
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    .padding(ScoutSpacing.lg)
                }

                // Launch button
                if let harness = selectedHarness {
                    VStack(spacing: 0) {
                        Divider().background(ScoutColors.divider)
                        Button {
                            onSelect(
                                HarnessConfig(
                                    harness: harness,
                                    model: selectedModel.trimmedNonEmpty,
                                    branch: projectBranch?.trimmedNonEmpty
                                )
                            )
                            dismiss()
                        } label: {
                            HStack(spacing: ScoutSpacing.sm) {
                                Image(systemName: harness.icon)
                                    .font(.system(size: 14, weight: .semibold))
                                Text("Launch with \(harness.name)")
                                    .font(ScoutTypography.body(15, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(harness.color)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .padding(ScoutSpacing.lg)
                    }
                    .background(ScoutColors.backgroundAdaptive)
                    .transition(.move(edge: .bottom))
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
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(ScoutColors.border, lineWidth: 0.5)
            )
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
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(harness.color.opacity(isSelected ? 0.2 : 0.12))
                        .frame(width: 44, height: 44)
                    Image(systemName: harness.icon)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundStyle(harness.color)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(harness.name)
                        .font(ScoutTypography.body(15, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                    Text(harness.description)
                        .font(ScoutTypography.caption(13))
                        .foregroundStyle(ScoutColors.textSecondary)
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(harness.color)
                }
            }
            .padding(ScoutSpacing.md)
            .background(ScoutColors.surfaceRaisedAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                    .strokeBorder(isSelected ? harness.color.opacity(0.4) : ScoutColors.border, lineWidth: isSelected ? 1.5 : 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}
