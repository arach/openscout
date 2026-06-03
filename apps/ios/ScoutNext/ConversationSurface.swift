import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Conversation — the keystone surface. It owns no reduction logic of its own:
/// it loads a snapshot, then folds the live event stream through the shared
/// `ConversationProjection` (the exact reducer macOS uses) and renders the
/// resulting turns/blocks with Hudson atoms. A `HudMessageBar` drives the
/// `ControlCapability` write side.
struct ConversationSurface: View {
    let client: any ScoutBrokerClient
    let conversationId: String
    let title: String

    @State private var projection = ConversationProjection()
    @State private var isStreaming = false
    @State private var composerText = ""
    @State private var isSending = false
    @FocusState private var composerFocused: Bool
    @Environment(\.dismiss) private var dismiss

    private var turns: [TurnState] { projection.state?.turns ?? [] }

    var body: some View {
        VStack(spacing: 0) {
            header
            transcript
        }
        .background(HudPalette.bg)
        .safeAreaInset(edge: .bottom) { composer }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: conversationId) { await run() }
    }

    // MARK: - Composer

    /// A self-contained, clearly-bounded input box (not a docked bar): rounded
    /// surface + hairline border so it reads as a field, growing from one line
    /// to at most three before scrolling internally.
    private var composer: some View {
        HStack(alignment: .bottom, spacing: HudSpacing.md) {
            TextField("steer the agent…", text: $composerText, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(HudPalette.ink)
                .tint(HudPalette.accent)
                .focused($composerFocused)
                .onSubmit(send)
                .padding(.vertical, HudSpacing.xs)

            Button(action: send) {
                Image(systemName: "arrow.up")
                    .font(HudFont.ui(HudTextSize.sm, weight: .bold))
                    .foregroundStyle(canSend ? HudPalette.bg : HudPalette.muted)
                    .frame(width: 28, height: 28)
                    .background(
                        Circle().fill(canSend ? HudPalette.accent : HudSurface.inset)
                    )
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.leading, HudSpacing.lg)
        .padding(.trailing, HudSpacing.sm)
        .padding(.vertical, HudSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(HudSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(composerFocused ? HudPalette.accent.opacity(0.6) : HudHairline.standard,
                        lineWidth: HudStrokeWidth.standard)
        )
        .padding(.horizontal, HudSpacing.lg)
        .padding(.bottom, HudSpacing.sm)
        .background(HudPalette.bg)
    }

    private var canSend: Bool {
        !composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Button { dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(HudSurface.inset))
                    .overlay(Circle().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard))
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                if let model = projection.state?.session.model {
                    Text(model)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.muted)
                }
            }
            Spacer()
            if isStreaming {
                HudBadge("streaming", tint: HudPalette.statusOk, dot: true)
            } else {
                HudBadge("idle", tint: HudPalette.muted, dot: true)
            }
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.vertical, HudSpacing.lg)
    }

    // MARK: - Transcript

    private var transcript: some View {
        GeometryReader { geo in
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: HudSpacing.xl) {
                        ForEach(turns) { turn in
                            TurnView(turn: turn, onAnswer: answer)
                                .id(turn.id)
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, HudSpacing.xxl)
                    .padding(.vertical, HudSpacing.lg)
                    // Bottom-align short threads against the composer; long
                    // threads exceed `minHeight` and scroll normally.
                    .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .bottomLeading)
                }
                .onAppear { scrollToBottom(proxy, animated: false) }
                .onChange(of: turns.last?.blocks.last?.block.text) { _, _ in scrollToBottom(proxy) }
                .onChange(of: turns.last?.blocks.count) { _, _ in scrollToBottom(proxy) }
                .onChange(of: turns.count) { _, _ in scrollToBottom(proxy) }
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool = true) {
        if animated {
            withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
        } else {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }

    // MARK: - Lifecycle

    private func run() async {
        // Recover authoritative state, then fold live events on top — exactly
        // the snapshot-then-stream contract the projection is built around.
        if let snapshot = try? await client.snapshot(conversationId: conversationId) {
            var p = ConversationProjection()
            p.applySnapshot(snapshot)
            projection = p
        }
        // Live events flip the badge on only when they actually arrive — a
        // static (already-settled) conversation stays "idle".
        for await event in client.conversationEvents(conversationId: conversationId, sinceSeq: projection.lastAppliedSeq) {
            isStreaming = true
            var p = projection
            p.apply(event)
            projection = p
        }
        isStreaming = false
    }

    private func send() {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        composerText = ""
        isSending = true
        Task {
            _ = try? await client.send(PromptSpec(conversationId: conversationId, text: text))
            isSending = false
        }
    }

    private func answer(turnId: String, blockId: String, choice: [String]) {
        Task {
            _ = try? await client.answerQuestion(
                QuestionAnswerSpec(conversationId: conversationId, turnId: turnId, blockId: blockId, answer: choice)
            )
        }
    }
}

// MARK: - Turn

private struct TurnView: View {
    let turn: TurnState
    let onAnswer: (_ turnId: String, _ blockId: String, _ choice: [String]) -> Void

    private var isUser: Bool { turn.isUserTurn == true }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack(spacing: HudSpacing.sm) {
                HudStatusDot(color: roleColor, size: 6, pulses: turn.status == .streaming)
                Text(isUser ? "YOU" : "AGENT")
                    .font(HudFont.mono(HudTextSize.xxs, weight: .bold))
                    .tracking(1.5)
                    .foregroundStyle(roleColor)
                if turn.status == .error {
                    Text("· error")
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(HudPalette.statusError)
                }
            }
            ForEach(turn.blocks, id: \.block.id) { blockState in
                BlockView(blockState: blockState, isUser: isUser, turnId: turn.id, onAnswer: onAnswer)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var roleColor: Color { isUser ? HudPalette.accent : HudPalette.statusOk }
}

// MARK: - Block

private struct BlockView: View {
    let blockState: BlockState
    let isUser: Bool
    let turnId: String
    let onAnswer: (_ turnId: String, _ blockId: String, _ choice: [String]) -> Void

    private var block: Block { blockState.block }

    var body: some View {
        switch block.type {
        case .text:
            textCard(block.text ?? "", tint: isUser ? HudPalette.accent : nil)
        case .reasoning:
            reasoning(block.text ?? "")
        case .action:
            actionCard
        case .question:
            questionCard
        case .error:
            textCard(block.message ?? "Error", tint: HudPalette.statusError)
        case .file:
            textCard(block.name ?? "file", tint: HudPalette.statusInfo)
        }
    }

    private func textCard(_ text: String, tint: Color?) -> some View {
        HudCard(padding: HudSpacing.lg, fill: tint.map { $0.opacity(0.10) }) {
            Text(text.isEmpty ? "…" : text)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(HudPalette.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }

    private func reasoning(_ text: String) -> some View {
        HStack(alignment: .top, spacing: HudSpacing.sm) {
            Rectangle().fill(HudPalette.muted.opacity(0.5)).frame(width: 2)
            Text(text.isEmpty ? "thinking…" : text)
                .font(HudFont.ui(HudTextSize.xs))
                .italic()
                .foregroundStyle(HudPalette.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var actionCard: some View {
        let action = block.action
        return HudCard(padding: HudSpacing.lg, fill: HudPalette.statusInfo.opacity(0.06)) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: actionIcon(action?.kind))
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(HudPalette.statusInfo)
                    Text(actionTitle(action))
                        .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1)
                    Spacer()
                    if let status = action?.status {
                        HudBadge(status.rawValue, tint: actionStatusColor(status), dot: status == .running)
                    }
                }
                if let output = action?.output, !output.isEmpty {
                    Text(output)
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(HudPalette.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var questionCard: some View {
        HudCard(padding: HudSpacing.lg, fill: HudPalette.statusWarn.opacity(0.08)) {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                if let header = block.header {
                    Text(header.uppercased())
                        .font(HudFont.mono(HudTextSize.xxs, weight: .bold))
                        .tracking(1.5)
                        .foregroundStyle(HudPalette.statusWarn)
                }
                Text(block.question ?? "")
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(HudPalette.ink)
                let answered = block.questionStatus == .answered
                let optionStyle: HudButtonStyle = answered ? .secondary : .primary(.amber)
                ForEach(block.options ?? [], id: \.label) { option in
                    HudButton(option.label, style: optionStyle) {
                        onAnswer(turnId, block.id, [option.label])
                    }
                    .disabled(answered)
                }
                if let answer = block.answer, !answer.isEmpty {
                    Text("answered: \(answer.joined(separator: ", "))")
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(HudPalette.muted)
                }
            }
        }
    }

    private func actionIcon(_ kind: ActionKind?) -> String {
        switch kind {
        case .command: return "terminal"
        case .fileChange: return "doc.text"
        case .toolCall: return "wrench.and.screwdriver"
        case .subagent: return "person.2"
        case .none: return "bolt"
        }
    }

    private func actionTitle(_ action: Action?) -> String {
        guard let action else { return "action" }
        switch action.kind {
        case .command: return action.command ?? "command"
        case .fileChange: return action.path ?? "file change"
        case .toolCall: return action.toolName ?? "tool call"
        case .subagent: return action.agentName ?? "subagent"
        }
    }

    private func actionStatusColor(_ status: ActionStatus) -> Color {
        switch status {
        case .completed: return HudPalette.statusOk
        case .running, .pending: return HudPalette.statusInfo
        case .failed: return HudPalette.statusError
        case .awaitingApproval: return HudPalette.statusWarn
        }
    }
}
