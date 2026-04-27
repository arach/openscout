// ActionBlockView — Renders action blocks (file_change, command, tool_call, subagent).
//
// Card-style presentation with status badge, icon per action kind,
// and collapsible output area in monospace.

import SwiftUI

struct ActionBlockView: View {
    let sessionId: String
    let block: Block

    @Environment(ConnectionManager.self) private var connection
    @State private var isOutputExpanded = false
    @State private var decisionPending: String?
    @State private var decisionError: String?
    @State private var isOpeningWebHandoff = false
    @State private var webHandoffError: String?
    @State private var fileChangeWebHandoff: BridgeWebSurface?

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

                if action.status == .awaitingApproval, let approval = action.approval {
                    approvalSection(action: action, approval: approval)
                }

                if !action.output.isEmpty {
                    outputSection(action: action)
                }
            }
            .scoutCard(padding: 0, cornerRadius: ScoutRadius.md)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Action: \(kindLabel)")
        } else {
            // Fallback for missing action data
            unknownActionCard
        }
    }

    // MARK: - Header

    private func header(action: Action) -> some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: kindIcon)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(ScoutColors.accent)
                .frame(width: 24, height: 24)

            Text(kindLabel)
                .font(ScoutTypography.caption(13, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)

            Spacer()

            statusBadge
        }
        .padding(.horizontal, ScoutSpacing.md)
        .padding(.vertical, ScoutSpacing.sm)
    }

    // MARK: - File Change

    private func fileChangeBody(action: Action) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
            if let path = action.path {
                HStack(spacing: ScoutSpacing.xs) {
                    Image(systemName: "doc.text")
                        .font(.system(size: 11))
                        .foregroundStyle(ScoutColors.textMuted)
                    Text(path)
                        .font(ScoutTypography.codeCaption)
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, ScoutSpacing.md)
            }

            if let diff = action.diff, !diff.isEmpty {
                diffView(diff)
                    .padding(.horizontal, ScoutSpacing.sm)
                    .padding(.vertical, ScoutSpacing.xs)
            }

            if canOpenFileChangeWebHandoff(action: action) {
                HStack(spacing: ScoutSpacing.sm) {
                    Button {
                        Task { await openFileChangeWebHandoff() }
                    } label: {
                        if isOpeningWebHandoff {
                            ProgressView()
                                .controlSize(.mini)
                        } else {
                            Label("Open Web Preview", systemImage: "macwindow")
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(isOpeningWebHandoff)

                    Spacer()
                }
                .padding(.horizontal, ScoutSpacing.md)

                if let webHandoffError {
                    Text(webHandoffError)
                        .font(ScoutTypography.caption(11, weight: .medium))
                        .foregroundStyle(ScoutColors.statusError)
                        .padding(.horizontal, ScoutSpacing.md)
                }
            }
        }
        .padding(.bottom, action.output.isEmpty ? ScoutSpacing.sm : 0)
        .fullScreenCover(item: $fileChangeWebHandoff) { handoff in
            BridgeWebHandoffView(surface: handoff)
        }
    }

    private func diffView(_ diff: String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(diff.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(ScoutTypography.code(12))
                        .foregroundStyle(diffLineColor(line))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, ScoutSpacing.sm)
                        .padding(.vertical, 1)
                        .background(diffLineBackground(line))
                }
            }
        }
        .frame(maxHeight: 200)
        .background(ScoutColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
    }

    private func diffLineColor(_ line: String) -> Color {
        if line.hasPrefix("+") { return ScoutColors.diffAdded }
        if line.hasPrefix("-") { return ScoutColors.diffRemoved }
        return ScoutColors.textSecondary
    }

    private func diffLineBackground(_ line: String) -> Color {
        if line.hasPrefix("+") { return ScoutColors.diffAdded.opacity(0.08) }
        if line.hasPrefix("-") { return ScoutColors.diffRemoved.opacity(0.08) }
        return .clear
    }

    // MARK: - Command

    private func commandBody(action: Action) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
            if let command = action.command {
                HStack(spacing: ScoutSpacing.xs) {
                    Text("$")
                        .font(ScoutTypography.code(13, weight: .bold))
                        .foregroundStyle(ScoutColors.accent)
                    Text(command)
                        .font(ScoutTypography.code(13))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(3)
                        .textSelection(.enabled)
                }
                .padding(.horizontal, ScoutSpacing.md)
            }

            if let exitCode = action.exitCode, exitCode != 0 {
                Text("Exit code: \(exitCode)")
                    .font(ScoutTypography.codeCaption)
                    .foregroundStyle(ScoutColors.statusError)
                    .padding(.horizontal, ScoutSpacing.md)
            }
        }
        .padding(.bottom, action.output.isEmpty ? ScoutSpacing.sm : 0)
    }

    // MARK: - Tool Call

    private func toolCallBody(action: Action) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
            if let toolName = action.toolName {
                HStack(spacing: ScoutSpacing.xs) {
                    Text(toolName)
                        .font(ScoutTypography.code(13, weight: .medium))
                        .foregroundStyle(ScoutColors.textPrimary)

                    if let toolCallId = action.toolCallId {
                        Text(toolCallId.prefix(8) + "...")
                            .font(ScoutTypography.codeCaption)
                            .foregroundStyle(ScoutColors.textMuted)
                    }
                }
                .padding(.horizontal, ScoutSpacing.md)
            }
        }
        .padding(.bottom, action.output.isEmpty ? ScoutSpacing.sm : 0)
    }

    // MARK: - Subagent

    private func subagentBody(action: Action) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: "arrow.triangle.branch")
                    .font(.system(size: 11))
                    .foregroundStyle(ScoutColors.textMuted)

                Text(action.agentName ?? action.agentId ?? "Subagent")
                    .font(ScoutTypography.body(14, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)
            }
            .padding(.horizontal, ScoutSpacing.md)

            if let prompt = action.prompt {
                Text(prompt)
                    .font(ScoutTypography.body(13))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(3)
                    .padding(.horizontal, ScoutSpacing.md)
            }
        }
        .padding(.bottom, action.output.isEmpty ? ScoutSpacing.sm : 0)
    }

    private func approvalSection(action: Action, approval: ActionApproval) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            Divider()
                .background(ScoutColors.divider)

            VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
                HStack(spacing: ScoutSpacing.xs) {
                    Image(systemName: "shield.lefthalf.filled")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(approvalTint(approval))
                    Text("Approval required")
                        .font(ScoutTypography.caption(12, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                    Spacer()
                    Text(approvalRiskLabel(approval))
                        .font(ScoutTypography.caption(11, weight: .medium))
                        .foregroundStyle(approvalTint(approval))
                }

                Text(approval.description?.isEmpty == false ? approval.description! : approvalFallbackDescription(action))
                    .font(ScoutTypography.body(13))
                    .foregroundStyle(ScoutColors.textSecondary)

                if let decisionError {
                    Text(decisionError)
                        .font(ScoutTypography.caption(11, weight: .medium))
                        .foregroundStyle(ScoutColors.statusError)
                }
            }
            .padding(.horizontal, ScoutSpacing.md)
            .padding(.top, ScoutSpacing.sm)

            HStack(spacing: ScoutSpacing.sm) {
                Button {
                    Task { await decide(approval: approval, decision: "approve") }
                } label: {
                    if decisionPending == "approve" {
                        ProgressView()
                            .controlSize(.mini)
                    } else {
                        Label("Approve", systemImage: "checkmark")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(ScoutColors.statusActive)
                .disabled(decisionPending != nil)

                Button {
                    Task { await decide(approval: approval, decision: "deny") }
                } label: {
                    if decisionPending == "deny" {
                        ProgressView()
                            .controlSize(.mini)
                    } else {
                        Label("Deny", systemImage: "xmark")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(decisionPending != nil)
            }
            .padding(.horizontal, ScoutSpacing.md)
            .padding(.bottom, action.output.isEmpty ? ScoutSpacing.sm : 0)
        }
    }

    // MARK: - Output Section

    private func outputSection(action: Action) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Divider()
                .background(ScoutColors.divider)

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isOutputExpanded.toggle()
                }
            } label: {
                HStack(spacing: ScoutSpacing.xs) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(ScoutColors.textMuted)
                        .rotationEffect(.degrees(isOutputExpanded ? 90 : 0))

                    Text("Output")
                        .font(ScoutTypography.caption(12, weight: .medium))
                        .foregroundStyle(ScoutColors.textMuted)

                    if isStreaming {
                        PulseIndicator()
                    }

                    Spacer()

                    let lineCount = action.output.components(separatedBy: "\n").count
                    Text("\(lineCount) line\(lineCount == 1 ? "" : "s")")
                        .font(ScoutTypography.caption(11))
                        .foregroundStyle(ScoutColors.textMuted)
                }
                .padding(.horizontal, ScoutSpacing.md)
                .padding(.vertical, ScoutSpacing.sm)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isOutputExpanded {
                ScrollView([.horizontal, .vertical], showsIndicators: true) {
                    Text(action.output)
                        .font(ScoutTypography.code(12))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .textSelection(.enabled)
                        .padding(ScoutSpacing.sm)
                }
                .frame(maxHeight: 240)
                .background(ScoutColors.surfaceAdaptive)
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
                .foregroundStyle(ScoutColors.textMuted)
                .accessibilityLabel("Pending")
        case .running:
            ProgressView()
                .controlSize(.mini)
                .tint(ScoutColors.accent)
                .accessibilityLabel("Running")
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(ScoutColors.statusActive)
                .accessibilityLabel("Completed")
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(ScoutColors.statusError)
                .accessibilityLabel("Failed")
        case .awaitingApproval:
            Image(systemName: "hand.raised.circle.fill")
                .font(.system(size: 13))
                .foregroundStyle(ScoutColors.statusStreaming)
                .accessibilityLabel("Awaiting approval")
        }
    }

    // MARK: - Unknown Action

    private var unknownActionCard: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "questionmark.square.dashed")
                .foregroundStyle(ScoutColors.textMuted)
            Text("Unknown action")
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .scoutCard()
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

    private func approvalFallbackDescription(_ action: Action) -> String {
        switch action.kind {
        case .command:
            return action.command ?? "Approve this command"
        case .fileChange:
            return action.path ?? "Approve this file change"
        case .toolCall:
            return action.toolName ?? "Approve this tool call"
        case .subagent:
            return action.agentName ?? action.agentId ?? "Approve this subagent request"
        }
    }

    private func approvalRiskLabel(_ approval: ActionApproval) -> String {
        switch approval.risk ?? .medium {
        case .low: return "Low risk"
        case .medium: return "Medium risk"
        case .high: return "High risk"
        }
    }

    private func approvalTint(_ approval: ActionApproval) -> Color {
        switch approval.risk ?? .medium {
        case .low: return ScoutColors.statusActive
        case .medium: return ScoutColors.statusStreaming
        case .high: return ScoutColors.statusError
        }
    }

    @MainActor
    private func decide(approval: ActionApproval, decision: String) async {
        decisionPending = decision
        decisionError = nil
        defer { decisionPending = nil }

        do {
            try await connection.decideAction(
                sessionId: sessionId,
                turnId: block.turnId,
                blockId: block.id,
                version: approval.version,
                decision: decision
            )
        } catch {
            decisionError = error.localizedDescription
        }
    }

    private func canOpenFileChangeWebHandoff(action: Action) -> Bool {
        connection.state == .connected
            && action.kind == .fileChange
            && action.path?.trimmedNonEmpty != nil
    }

    @MainActor
    private func openFileChangeWebHandoff() async {
        guard connection.state == .connected else { return }
        guard let host = connection.bridgeHost,
              let port = connection.bridgePort else {
            webHandoffError = "Reconnect to open the web preview."
            return
        }

        isOpeningWebHandoff = true
        defer { isOpeningWebHandoff = false }

        do {
            let handoff = try await connection.createWebHandoff(
                kind: .fileChange,
                sessionId: sessionId,
                turnId: block.turnId,
                blockId: block.id
            )
            guard let surface = BridgeWebSurface(handoff: handoff, host: host, port: port) else {
                webHandoffError = "Scout couldn't prepare this web preview right now."
                return
            }
            fileChangeWebHandoff = surface
            webHandoffError = nil
        } catch {
            webHandoffError = error.scoutUserFacingMessage
        }
    }
}

// MARK: - Preview

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            ActionBlockView(sessionId: "s1", block: Block(
                id: "1", turnId: "t1", type: .action, status: .completed, index: 0,
                action: Action(
                    kind: .command, status: .completed, output: "Build succeeded\n2 warnings",
                    command: "swift build -c release", exitCode: 0
                )
            ))

            ActionBlockView(sessionId: "s1", block: Block(
                id: "2", turnId: "t1", type: .action, status: .completed, index: 1,
                action: Action(
                    kind: .fileChange, status: .completed, output: "",
                    path: "src/auth/jwt.ts",
                    diff: "+import jwt from 'jsonwebtoken'\n+\n+export function sign(payload: object) {\n+  return jwt.sign(payload, SECRET)\n+}\n-// old session code"
                )
            ))

            ActionBlockView(sessionId: "s1", block: Block(
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
