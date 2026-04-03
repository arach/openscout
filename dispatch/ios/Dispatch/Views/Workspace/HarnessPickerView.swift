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
}

struct HarnessPickerView: View {
    let projectName: String
    let projectPath: String
    let onSelect: (HarnessConfig) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var selectedHarness: Harness?
    @State private var selectedModel = ""

    private var launchModelOptions: [String] {
        DispatchModelCatalog.launchOptions(for: selectedHarness?.id)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Project header
                HStack(spacing: DispatchSpacing.md) {
                    Image(systemName: "folder.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(DispatchColors.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(projectName)
                            .font(DispatchTypography.body(16, weight: .semibold))
                            .foregroundStyle(DispatchColors.textPrimary)
                        Text(projectPath)
                            .font(DispatchTypography.code(12))
                            .foregroundStyle(DispatchColors.textMuted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer()
                }
                .padding(DispatchSpacing.lg)
                .background(DispatchColors.surfaceAdaptive)

                Divider().background(DispatchColors.divider)

                ScrollView {
                    VStack(spacing: DispatchSpacing.lg) {
                        // Harness selection
                        VStack(alignment: .leading, spacing: DispatchSpacing.sm) {
                            Text("Harness")
                                .font(DispatchTypography.caption(13, weight: .medium))
                                .foregroundStyle(DispatchColors.textMuted)

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
                            VStack(alignment: .leading, spacing: DispatchSpacing.sm) {
                                Text("Configuration")
                                    .font(DispatchTypography.caption(13, weight: .medium))
                                    .foregroundStyle(DispatchColors.textMuted)

                                if !launchModelOptions.isEmpty {
                                    modelPickerField
                                }
                            }
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    .padding(DispatchSpacing.lg)
                }

                // Launch button
                if let harness = selectedHarness {
                    VStack(spacing: 0) {
                        Divider().background(DispatchColors.divider)
                        Button {
                            onSelect(
                                HarnessConfig(
                                    harness: harness,
                                    model: selectedModel.trimmedNonEmpty
                                )
                            )
                            dismiss()
                        } label: {
                            HStack(spacing: DispatchSpacing.sm) {
                                Image(systemName: harness.icon)
                                    .font(.system(size: 14, weight: .semibold))
                                Text("Launch with \(harness.name)")
                                    .font(DispatchTypography.body(15, weight: .semibold))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(harness.color)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .padding(DispatchSpacing.lg)
                    }
                    .background(DispatchColors.backgroundAdaptive)
                    .transition(.move(edge: .bottom))
                }
            }
            .background(DispatchColors.backgroundAdaptive)
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
                        Label(DispatchModelLabel.displayText(for: model, fallback: model), systemImage: "checkmark")
                    } else {
                        Text(DispatchModelLabel.displayText(for: model, fallback: model))
                    }
                }
            }
        } label: {
            HStack(spacing: DispatchSpacing.sm) {
                Image(systemName: "cpu")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DispatchColors.textMuted)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Model")
                        .font(DispatchTypography.caption(11, weight: .semibold))
                        .foregroundStyle(DispatchColors.textMuted)
                    Text(selectedModel.isEmpty ? "Default" : DispatchModelLabel.displayText(for: selectedModel, fallback: selectedModel))
                        .font(DispatchTypography.code(14))
                        .foregroundStyle(DispatchColors.textPrimary)
                }

                Spacer()

                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DispatchColors.textMuted)
            }
            .padding(DispatchSpacing.md)
            .background(DispatchColors.surfaceAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(DispatchColors.border, lineWidth: 0.5)
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
            HStack(spacing: DispatchSpacing.md) {
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
                        .font(DispatchTypography.body(15, weight: .semibold))
                        .foregroundStyle(DispatchColors.textPrimary)
                    Text(harness.description)
                        .font(DispatchTypography.caption(13))
                        .foregroundStyle(DispatchColors.textSecondary)
                }

                Spacer()

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(harness.color)
                }
            }
            .padding(DispatchSpacing.md)
            .background(DispatchColors.surfaceRaisedAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: DispatchRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: DispatchRadius.md, style: .continuous)
                    .strokeBorder(isSelected ? harness.color.opacity(0.4) : DispatchColors.border, lineWidth: isSelected ? 1.5 : 0.5)
            )
        }
        .buttonStyle(.plain)
    }
}
