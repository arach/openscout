// ActionBlockView — Renders action blocks (file_change, command, tool_call, subagent).
//
// Card-style presentation with status badge, icon per action kind,
// and collapsible output area in monospace.

import SwiftUI

struct ActionBlockView: View {
    let block: Block

    @State private var isOutputExpanded = false

    private var action: Action? { block.action }
    private var kind: ActionKind { action?.kind ?? .command }
    private var actionStatus: ActionStatus { action?.status ?? .pending }

    private var isStreaming: Bool {
        block.status == .streaming || block.status == .started
    }

    var body: some View {
        if let action {
            VStack(alignment: .leading, spacing: 0) {
                header(action: action)

                switch action.kind {
                case .fileChange:
                    fileChangeBody(action: action)
                case .command:
                    commandBody(action: action)
                case .toolCall:
                    toolCallBody(action: action)
                case .subagent:
                    subagentBody(action: action)
                }

                if !action.output.isEmpty {
                    outputSection(action: action)
                }
            }
            .plexusCard(padding: 0, cornerRadius: PlexusRadius.md)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Action: \(kindLabel)")
        } else {
            // Fallback for missing action data
            unknownActionCard
        }
    }

    // MARK: - Header

    private func header(action: Action) -> some View {
        HStack(spacing: PlexusSpacing.sm) {
            Image(systemName: kindIcon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PlexusColors.accent)
                .frame(width: 24, height: 24)

            Text(kindLabel)
                .font(PlexusTypography.caption(13, weight: .semibold))
                .foregroundStyle(PlexusColors.textPrimary)

            Spacer()

            statusBadge
        }
        .padding(.horizontal, PlexusSpacing.md)
        .padding(.vertical, PlexusSpacing.sm)
    }

    // MARK: - File Change

    private func fileChangeBody(action: Action) -> some View {
        VStack(alignment: .leading, spacing: PlexusSpacing.xs) {
            if let path = action.path {
                HStack(spacing: PlexusSpacing.xs) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 11))
                        .foregroundStyle(PlexusColors.textMuted)
                    Text(path)
                        .font(PlexusTypography.codeCaption)
                        .foregroundStyle(PlexusColors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, PlexusSpacing.md)
            }

            if let diff = action.diff, !diff.isEmpty {
                diffView(diff)
                    .padding(.horizontal, PlexusSpacing.sm)
                    .padding(.vertical, PlexusSpacing.xs)
            }
        }
        .padding(.bottom, action.output.isEmpty ? PlexusSpacing.sm : 0)
    }

    private func diffView(_ diff: String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(diff.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(PlexusTypography.code(12))
                        .foregroundStyle(diffLineColor(line))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, PlexusSpacing.sm)
                        .padding(.vertical, 1)
                        .background(diffLineBackground(line))
                }
            }
        }
        .frame(maxHeight: 200)
        .background(PlexusColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: PlexusRadius.sm, style: .continuous))
    }

    private func diffLineColor(_ line: String) -> Color {
        if line.hasPrefix("+") { return PlexusColors.diffAdded }
        if line.hasPrefix("-") { return PlexusColors.diffRemoved }
        return PlexusColors.textSecondary
    }

    private func diffLineBackground(_ line: String) -> Color {
        if line.hasPrefix("+") { return PlexusColors.diffAdded.opacity(0.08) }
        if line.hasPrefix("-") { return PlexusColors.diffRemoved.opacity(0.08) }
        return .clear
    }

    // MARK: - Command

    private func commandBody(action: Action) -> some View {
        VStack(alignment: .leading, spacing: PlexusSpacing.xs) {
            if let command = action.command {
                HStack(spacing: PlexusSpacing.xs) {
                    Text("$")
                        .font(PlexusTypography.code(13, weight: .bold))
                        .foregroundStyle(PlexusColors.accent)
                    Text(command)
                        .font(PlexusTypography.code(13))
                        .foregroundStyle(PlexusColors.textPrimary)
                        .lineLimit(3)
                        .textSelection(.enabled)
                }
                .padding(.horizontal, PlexusSpacing.md)
            }

            if let exitCode = action.exitCode, exitCode != 0 {
                Text("Exit code: \(exitCode)")
                    .font(PlexusTypography.codeCaption)
                    .foregroundStyle(PlexusColors.statusError)
                    .padding(.horizontal, PlexusSpacing.md)
            }
        }
        .padding(.bottom, action.output.isEmpty ? PlexusSpacing.sm : 0)
    }

    // MARK: - Tool Call

    private func toolCallBody(action: Action) -> some View {
        VStack(alignment: .leading, spacing: PlexusSpacing.xs) {
            if let toolName = action.toolName {
                HStack(spacing: PlexusSpacing.xs) {
                    Text(toolName)
                        .font(PlexusTypography.code(13, weight: .medium))
                        .foregroundStyle(PlexusColors.textPrimary)

                    if let toolCallId = action.toolCallId {
                        Text(toolCallId.prefix(8) + "...")
                            .font(PlexusTypography.codeCaption)
                            .foregroundStyle(PlexusColors.textMuted)
                    }
                }
                .padding(.horizontal, PlexusSpacing.md)
            }
        }
        .padding(.bottom, action.output.isEmpty ? PlexusSpacing.sm : 0)
    }

    // MARK: - Subagent

    private func subagentBody(action: Action) -> some View {
        VStack(alignment: .leading, spacing: PlexusSpacing.xs) {
            HStack(spacing: PlexusSpacing.sm) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.system(size: 11))
                    .foregroundStyle(PlexusColors.textMuted)

                Text(action.agentName ?? action.agentId ?? "Subagent")
                    .font(PlexusTypography.body(14, weight: .medium))
                    .foregroundStyle(PlexusColors.textPrimary)
            }
            .padding(.horizontal, PlexusSpacing.md)

            if let prompt = action.prompt {
                Text(prompt)
                    .font(PlexusTypography.body(13))
                    .foregroundStyle(PlexusColors.textSecondary)
                    .lineLimit(3)
                    .padding(.horizontal, PlexusSpacing.md)
            }
        }
        .padding(.bottom, action.output.isEmpty ? PlexusSpacing.sm : 0)
    }

    // MARK: - Output Section

    private func outputSection(action: Action) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
                .background(PlexusColors.divider)

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isOutputExpanded.toggle()
                }
            } label: {
                HStack(spacing: PlexusSpacing.xs) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(PlexusColors.textMuted)
                        .rotationEffect(.degrees(isOutputExpanded ? 90 : 0))

                    Text("Output")
                        .font(PlexusTypography.caption(12, weight: .medium))
                        .foregroundStyle(PlexusColors.textMuted)

                    if isStreaming {
                        PulseIndicator()
                    }

                    Spacer()

                    let lineCount = action.output.components(separatedBy: "\n").count
                    Text("\(lineCount) line\(lineCount == 1 ? "" : "s")")
                        .font(PlexusTypography.caption(11))
                        .foregroundStyle(PlexusColors.textMuted)
                }
                .padding(.horizontal, PlexusSpacing.md)
                .padding(.vertical, PlexusSpacing.sm)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isOutputExpanded {
                ScrollView([.horizontal, .vertical], showsIndicators: true) {
                    Text(action.output)
                        .font(PlexusTypography.code(12))
                        .foregroundStyle(PlexusColors.textSecondary)
                        .textSelection(.enabled)
                        .padding(PlexusSpacing.sm)
                }
                .frame(maxHeight: 240)
                .background(PlexusColors.surfaceAdaptive)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: - Status Badge

    @ViewBuilder
    private var statusBadge: some View {
        switch actionStatus {
        case .pending:
            Image(systemName: "clock")
                .font(.system(size: 11))
                .foregroundStyle(PlexusColors.textMuted)
                .accessibilityLabel("Pending")
        case .running:
            ProgressView()
                .controlSize(.mini)
                .tint(PlexusColors.accent)
                .accessibilityLabel("Running")
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(PlexusColors.statusActive)
                .accessibilityLabel("Completed")
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(PlexusColors.statusError)
                .accessibilityLabel("Failed")
        }
    }

    // MARK: - Unknown Action

    private var unknownActionCard: some View {
        HStack(spacing: PlexusSpacing.sm) {
            Image(systemName: "questionmark.square.dashed")
                .foregroundStyle(PlexusColors.textMuted)
            Text("Unknown action")
                .font(PlexusTypography.body(14))
                .foregroundStyle(PlexusColors.textSecondary)
        }
        .plexusCard()
    }

    // MARK: - Helpers

    private var kindIcon: String {
        guard let action else { return "questionmark.square" }
        switch action.kind {
        case .fileChange: return "doc.badge.gearshape"
        case .command: return "terminal"
        case .toolCall: return "wrench.and.screwdriver"
        case .subagent: return "person.2"
        }
    }

    private var kindLabel: String {
        guard let action else { return "Unknown" }
        switch action.kind {
        case .fileChange: return "File Change"
        case .command: return "Command"
        case .toolCall: return "Tool Call"
        case .subagent: return "Subagent"
        }
    }
}

// MARK: - Preview

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            ActionBlockView(block: Block(
                id: "1", turnId: "t1", type: .action, status: .completed, index: 0,
                action: Action(
                    kind: .command, status: .completed, output: "Build succeeded\n2 warnings",
                    command: "swift build -c release", exitCode: 0
                )
            ))

            ActionBlockView(block: Block(
                id: "2", turnId: "t1", type: .action, status: .completed, index: 1,
                action: Action(
                    kind: .fileChange, status: .completed, output: "",
                    path: "src/auth/jwt.ts",
                    diff: "+import jwt from 'jsonwebtoken'\n+\n+export function sign(payload: object) {\n+  return jwt.sign(payload, SECRET)\n+}\n-// old session code"
                )
            ))

            ActionBlockView(block: Block(
                id: "3", turnId: "t1", type: .action, status: .streaming, index: 2,
                action: Action(
                    kind: .toolCall, status: .running, output: "Searching...",
                    toolName: "Read", toolCallId: "tc_abc12345xyz"
                )
            ))
        }
        .padding()
    }
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}
