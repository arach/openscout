import SwiftUI
import Foundation
import HudsonUI
import HudsonVoice
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
    /// Pop handler owned by the presenter, which clears its navigation binding.
    /// Driving the pop from the source of truth avoids the `dismiss()` +
    /// `navigationDestination(item:)` desync that re-pushes the view.
    var onClose: () -> Void = {}
    /// Read-only context for the app-wide protected-area status bar. The
    /// conversation still owns its data; Root only renders this compact label.
    var onStatusContextChange: (String?) -> Void = { _ in }

    @State private var projection = ConversationProjection()
    @State private var isStreaming = false
    @State private var loadPhase: LoadPhase = .loading
    @State private var composerText = ""
    @State private var isSending = false
    @State private var showSettings = false
    /// Messages sent from this device that haven't yet appeared in an
    /// authoritative snapshot. They render immediately (optimistic) and are
    /// reconciled out the moment the broker echoes them back.
    @State private var pending: [PendingUserSend] = []
    /// The post-send refresh loop. Comms conversations get no live session-event
    /// push, so we poll the snapshot until the reply lands.
    @State private var replyPoll: Task<Void, Never>?
    @Environment(HudDictation.self) private var voice
    @State private var micPulse = false
    @FocusState private var composerFocused: Bool

    private var turns: [TurnState] { projection.state?.turns ?? [] }

    /// Distinguishes the three reasons a transcript can be empty so the surface
    /// never renders an unexplained void: still fetching, loaded-but-no-history,
    /// or the snapshot RPC failed.
    private enum LoadPhase { case loading, loaded, failed }

    /// A message sent from this device that's awaiting its authoritative record.
    private struct PendingUserSend: Equatable {
        let id: String
        let text: String
        let startedAt: Int
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            transcript
        }
        .background(HudPalette.bg)
        .safeAreaInset(edge: .bottom) { composer }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: conversationId) { await run() }
        // Start warming the on-device model the moment you reach the conversation,
        // so Parakeet is hot well before the mic is ever tapped.
        .onAppear {
            voice.prepare()
            publishStatusContext()
        }
        // Only stop an active recording on the way out — let a background model
        // warm-up keep running to completion so it caches, instead of being
        // cancelled (and restarted from ~38%) on every visit.
        .onDisappear {
            if voice.isListening { voice.cancel() }
            replyPoll?.cancel()
            onStatusContextChange(nil)
        }
        .onChange(of: projection.state?.session) { _, _ in publishStatusContext() }
        .onChange(of: isStreaming) { _, _ in publishStatusContext() }
        .sheet(isPresented: $showSettings) {
            SessionSettingsView(
                client: client,
                conversationId: conversationId,
                title: title,
                harness: projection.state?.session.adapterType,
                model: projection.state?.session.model
            )
        }
    }

    // MARK: - Composer

    /// A self-contained, clearly-bounded input box (not a docked bar): rounded
    /// surface + hairline border so it reads as a field, growing from one line
    /// to at most three before scrolling internally.
    private var composer: some View {
        HStack(alignment: .bottom, spacing: HudSpacing.md) {
            micButton

            TextField(composerPlaceholder, text: $composerText, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...3)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(HudPalette.ink)
                .tint(HudPalette.accent)
                .focused($composerFocused)
                .onSubmit(send)
                .padding(.vertical, HudSpacing.xs)

            Button(action: send) {
                Glyphic.arrow(.top, size: 17)
                    .foregroundStyle(canSend ? HudPalette.bg : ScoutInk.muted)
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

    /// On-device dictation toggle (HudsonKit `HudDictation`: Parakeet via Vox,
    /// Apple Speech fallback). Listening pulses the accent ring; the live partial
    /// previews in the placeholder, and each final utterance appends to the field.
    private var micButton: some View {
        Button {
            voice.toggle()
        } label: {
            ZStack {
                if voice.isListening {
                    Circle()
                        .fill(HudPalette.accent.opacity(micPulse ? 0.22 : 0.08))
                        .frame(width: 28, height: 28)
                }
                MicGlyph()
                    .stroke(
                        micColor,
                        style: StrokeStyle(
                            lineWidth: voice.isListening ? 1.6 : 1.2,
                            lineCap: .round,
                            lineJoin: .round
                        )
                    )
                    .frame(width: 15, height: 15)
                    .opacity(isMicBusy && micPulse ? 0.5 : 1)
            }
            .frame(width: 28, height: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isSending)
        .onChange(of: voice.state) { _, newState in updatePulse(for: newState) }
        .onChange(of: voice.finalCount) { _, _ in
            let text = voice.finalText
            if !text.isEmpty { appendDictation(text) }
        }
    }

    private var isMicBusy: Bool {
        switch voice.state {
        case .transcribing, .preparing: return true
        case .idle, .listening, .unavailable: return false
        }
    }

    private var micColor: Color {
        switch voice.state {
        case .listening:                return HudPalette.accent
        case .transcribing, .preparing: return ScoutInk.muted
        case .unavailable:              return ScoutInk.dim.opacity(0.5)
        case .idle:                     return ScoutInk.muted
        }
    }

    private var composerPlaceholder: String {
        switch voice.state {
        case .listening:
            return voice.partialText.isEmpty ? "Listening…" : voice.partialText
        case .transcribing:
            return "Transcribing…"
        // The model warms silently in the background — no loading copy in the
        // composer. Preparing reads the same as idle.
        case .preparing, .idle, .unavailable:
            return "steer the agent…"
        }
    }

    private func appendDictation(_ text: String) {
        if composerText.isEmpty {
            composerText = text
        } else {
            composerText += " " + text
        }
    }

    private func updatePulse(for state: HudDictation.State) {
        micPulse = false
        switch state {
        case .listening:
            // Pulse ONLY while actively recording. Preparing/transcribing must not
            // mimic a hot mic — those read via the placeholder ("Preparing voice… N%")
            // and a static muted glyph, so a backgrounded model download never looks live.
            withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) {
                micPulse = true
            }
        case .idle, .transcribing, .preparing, .unavailable:
            break
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Button { onClose() } label: {
                Glyphic.chevron(.leading, size: 17)
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
                        .foregroundStyle(ScoutInk.muted)
                }
            }
            Spacer()
            // Only the active state earns a badge. Once you're inside a specific
            // agent, an "idle" tag is just noise — a settled agent reads as idle
            // by absence, so the header stays quiet until something's running.
            if isStreaming {
                HudBadge("streaming", tint: HudPalette.statusOk, dot: true)
            }
            Button { showSettings = true } label: {
                Glyphic(kind: .gear, size: 18)
                    .foregroundStyle(ScoutInk.muted)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.vertical, HudSpacing.lg)
    }

    // MARK: - Transcript

    @ViewBuilder
    private var transcript: some View {
        if turns.isEmpty {
            emptyState
        } else {
            transcriptScroll
        }
    }

    /// Shown when there's nothing to render — explains *why* rather than leaving a
    /// black void: a card-created or never-run agent legitimately has no history,
    /// which reads as "no messages yet" + the composer below; a failed fetch reads
    /// as an error you can retry.
    @ViewBuilder
    private var emptyState: some View {
        VStack {
            Spacer(minLength: 0)
            switch loadPhase {
            case .loading:
                HudEmptyState(title: "Loading conversation", icon: "ellipsis.bubble")
            case .failed:
                VStack(spacing: HudSpacing.lg) {
                    HudEmptyState(
                        title: "Couldn’t load conversation",
                        subtitle: "The bridge didn’t return a transcript for this session.",
                        icon: "exclamationmark.bubble"
                    )
                    HudButton("Retry", icon: "arrow.clockwise", style: .secondary) {
                        Task { await run() }
                    }
                }
            case .loaded:
                HudEmptyState(
                    title: "No messages yet",
                    subtitle: "Steer the agent below to begin.",
                    icon: "bubble.left.and.bubble.right"
                )
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var transcriptScroll: some View {
        GeometryReader { geo in
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: HudSpacing.xl) {
                        ForEach(turns) { turn in
                            TurnView(turn: turn, onAnswer: answer, onDecide: decide)
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

    private func publishStatusContext() {
        onStatusContextChange(statusContext)
    }

    private var statusContext: String? {
        guard let session = projection.state?.session else {
            return title.isEmpty ? nil : title
        }

        var parts: [String] = []
        if let project = projectName(from: session.cwd) {
            parts.append(project)
        }
        parts.append(session.adapterType)
        if let model = session.model?.trimmingCharacters(in: .whitespacesAndNewlines),
           !model.isEmpty {
            parts.append(model)
        }
        if isStreaming {
            parts.append("streaming")
        }
        return parts.joined(separator: " · ")
    }

    private func projectName(from cwd: String?) -> String? {
        guard let cwd = cwd?.trimmingCharacters(in: .whitespacesAndNewlines), !cwd.isEmpty else { return nil }
        return (cwd as NSString).lastPathComponent
    }

    private func run() async {
        loadPhase = .loading
        // Recover authoritative state, then fold live events on top — exactly
        // the snapshot-then-stream contract the projection is built around.
        do {
            let snapshot = try await client.snapshot(conversationId: conversationId)
            var p = ConversationProjection()
            p.applySnapshot(snapshot)
            projection = p
            // A snapshot can already carry an in-flight "working" turn — surface
            // it as streaming so the badge/working row show before any live event.
            isStreaming = snapshot.currentTurnId != nil
            publishStatusContext()
            loadPhase = .loaded
        } catch {
            // No authoritative snapshot. Surface the failure, but still attach to
            // the live stream so a session that's actively producing can populate.
            loadPhase = .failed
        }
        // Live events flip the badge on only when they actually arrive — a
        // static (already-settled) conversation stays "idle".
        for await event in client.conversationEvents(conversationId: conversationId, sinceSeq: projection.lastAppliedSeq) {
            isStreaming = true
            var p = projection
            p.apply(event)
            projection = p
            publishStatusContext()
        }
        isStreaming = false
        publishStatusContext()
    }

    private func send() {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        composerText = ""
        isSending = true

        // Fold the message into the transcript the instant you hit send. The
        // broker round-trip (and the snapshot that carries the real record) lands
        // moments later; until then this optimistic turn stands in for it.
        let outgoing = PendingUserSend(id: "local-\(UUID().uuidString)", text: text, startedAt: nowMs())
        pending.append(outgoing)
        insertOptimisticUserTurn(outgoing)

        replyPoll?.cancel()
        replyPoll = Task {
            _ = try? await client.send(PromptSpec(conversationId: conversationId, text: text))
            // Re-enable the composer as soon as the send is acknowledged — the
            // reply can keep streaming in while you queue the next message.
            isSending = false
            // Comms conversations get no live session-event push, so pull fresh
            // snapshots until the reply (and its "working…" turn) arrive.
            await pollForReply()
        }
    }

    /// Append a not-yet-acknowledged user message to the projection so it renders
    /// immediately. Synthesizes a minimal session if no snapshot has loaded yet,
    /// so a message sent into a still-loading conversation still shows.
    private func insertOptimisticUserTurn(_ outgoing: PendingUserSend) {
        var s = projection.state ?? SessionState(
            session: Session(id: conversationId, name: title, adapterType: "relay", status: .active)
        )
        let block = Block(
            id: "\(outgoing.id):body", turnId: outgoing.id,
            type: .text, status: .completed, index: 0, text: outgoing.text
        )
        s.turns.append(TurnState(
            id: outgoing.id, status: .completed,
            blocks: [BlockState(block: block, status: .completed)],
            startedAt: outgoing.startedAt, isUserTurn: true
        ))
        projection = ConversationProjection(state: s, lastAppliedSeq: projection.lastAppliedSeq)
        loadPhase = .loaded
    }

    /// Poll the authoritative snapshot until the agent's reply lands. Stops once
    /// the newest turn is the agent's and no working turn remains — or after a
    /// safety deadline so a silent/never-answering send can't poll forever.
    private func pollForReply() async {
        let deadline = Date().addingTimeInterval(120)
        var first = true
        while !Task.isCancelled && Date() < deadline {
            if !first { try? await Task.sleep(for: .milliseconds(1200)) }
            first = false
            guard let snap = try? await client.snapshot(conversationId: conversationId) else { continue }
            if Task.isCancelled { return }
            applyRefreshed(snap)
            if snap.currentTurnId == nil, let last = snap.turns.last, last.isUserTurn != true {
                return
            }
        }
    }

    /// Adopt a fresh snapshot, keeping any still-unacknowledged optimistic turns
    /// appended so a sent message never flickers out between the local insert and
    /// the broker echo. Only reassigns when the state actually changed, so an
    /// unchanged poll causes no re-render (and no scroll jump).
    private func applyRefreshed(_ snap: SessionState) {
        let snapUserTexts = Set(
            snap.turns
                .filter { $0.isUserTurn == true }
                .flatMap { $0.blocks.compactMap { $0.block.text } }
        )
        pending.removeAll { snapUserTexts.contains($0.text) }

        var merged = snap
        for outgoing in pending {
            let block = Block(
                id: "\(outgoing.id):body", turnId: outgoing.id,
                type: .text, status: .completed, index: 0, text: outgoing.text
            )
            merged.turns.append(TurnState(
                id: outgoing.id, status: .completed,
                blocks: [BlockState(block: block, status: .completed)],
                startedAt: outgoing.startedAt, isUserTurn: true
            ))
        }

        let candidate = ConversationProjection(state: merged, lastAppliedSeq: projection.lastAppliedSeq)
        if candidate.state != projection.state {
            projection = candidate
        }
        isStreaming = merged.currentTurnId != nil
        loadPhase = .loaded
        publishStatusContext()
    }

    private func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    private func answer(turnId: String, blockId: String, choice: [String]) {
        Task {
            _ = try? await client.answerQuestion(
                QuestionAnswerSpec(conversationId: conversationId, turnId: turnId, blockId: blockId, answer: choice)
            )
        }
    }

    private func decide(turnId: String, blockId: String, version: Int, decision: ActionDecisionSpec.Decision) {
        Task {
            _ = try? await client.decideAction(
                ActionDecisionSpec(conversationId: conversationId, turnId: turnId, blockId: blockId, decision: decision, version: version)
            )
        }
    }
}

// MARK: - Turn

private struct TurnView: View {
    let turn: TurnState
    let onAnswer: (_ turnId: String, _ blockId: String, _ choice: [String]) -> Void
    let onDecide: (_ turnId: String, _ blockId: String, _ version: Int, _ decision: ActionDecisionSpec.Decision) -> Void

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
                BlockView(blockState: blockState, isUser: isUser, turnId: turn.id, onAnswer: onAnswer, onDecide: onDecide)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // User turns read as neutral; the agent is the one accented voice.
    private var roleColor: Color { isUser ? ScoutInk.muted : HudPalette.accent }
}

// MARK: - Block

private struct BlockView: View {
    let blockState: BlockState
    let isUser: Bool
    let turnId: String
    let onAnswer: (_ turnId: String, _ blockId: String, _ choice: [String]) -> Void
    let onDecide: (_ turnId: String, _ blockId: String, _ version: Int, _ decision: ActionDecisionSpec.Decision) -> Void

    private var block: Block { blockState.block }

    var body: some View {
        switch block.type {
        case .text:
            // User vs agent differ by fill lightness, not hue. Markdown is parsed
            // into native styled blocks (emphasis, lists, headings, highlighted code).
            markupCard(block.text ?? "", fill: isUser ? HudSurface.inset : nil)
        case .reasoning:
            reasoning(block.text ?? "")
        case .action:
            actionCard
        case .question:
            questionCard
        case .error:
            textCard(block.message ?? "Error", fill: HudPalette.statusError.opacity(0.10), accent: HudPalette.statusError)
        case .file:
            textCard(block.name ?? "file", fill: nil)
        }
    }

    /// Plain single-string card — used for error/file blocks where the content
    /// is a literal message, not markdown.
    private func textCard(_ text: String, fill: Color?, accent: Color? = nil) -> some View {
        HudCard(padding: HudSpacing.lg, fill: fill) {
            Text(text.isEmpty ? "…" : text)
                .font(HudFont.ui(HudTextSize.md))
                .foregroundStyle(accent ?? HudPalette.ink)
                .lineSpacing(3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }

    /// Markdown-aware card for conversation text blocks — parses + renders
    /// emphasis, headings, lists, blockquotes, and highlighted code.
    private func markupCard(_ text: String, fill: Color?) -> some View {
        HudCard(padding: HudSpacing.lg, fill: fill) {
            MessageMarkupView(text: text)
        }
    }

    private func reasoning(_ text: String) -> some View {
        HStack(alignment: .top, spacing: HudSpacing.sm) {
            Rectangle().fill(ScoutInk.muted.opacity(0.5)).frame(width: 2)
            Text(text.isEmpty ? "thinking…" : text)
                .font(HudFont.ui(HudTextSize.xs))
                .italic()
                .foregroundStyle(ScoutInk.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var actionCard: some View {
        let action = block.action
        return HudCard(padding: HudSpacing.lg, fill: HudSurface.inset) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: actionIcon(action?.kind))
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(ScoutInk.muted)
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
                        .foregroundStyle(ScoutInk.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                if action?.status == .awaitingApproval, let approval = action?.approval {
                    approvalControls(approval)
                }
            }
        }
    }

    /// Approve / deny buttons shown only while an action awaits the operator.
    /// The decision carries `approval.version` so the bridge can reject a stale
    /// tap against an approval that already moved on.
    private func approvalControls(_ approval: ActionApproval) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            if let description = approval.description, !description.isEmpty {
                Text(description)
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(HudPalette.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: HudSpacing.sm) {
                if let risk = approval.risk {
                    HudBadge(risk.rawValue, tint: riskColor(risk), dot: false)
                }
                Spacer()
                HudButton("Deny", style: .secondary) {
                    onDecide(turnId, block.id, approval.version, .deny)
                }
                HudButton("Approve", style: .primary(.green)) {
                    onDecide(turnId, block.id, approval.version, .approve)
                }
            }
        }
        .padding(.top, HudSpacing.xs)
    }

    private func riskColor(_ risk: ApprovalRisk) -> Color {
        switch risk {
        case .low: return ScoutInk.muted
        case .medium: return HudPalette.statusWarn
        case .high: return HudPalette.statusError
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
                        .foregroundStyle(ScoutInk.muted)
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
        case .completed: return HudPalette.accent        // green == success
        case .running, .pending: return ScoutInk.muted
        case .failed: return HudPalette.statusError       // red == genuine failure
        case .awaitingApproval: return HudPalette.statusWarn  // amber == needs you
        }
    }
}

/// Compact cockpit mic glyph — a hand-drawn capsule body, pickup arc, and stand,
/// stroked so it can pick up the composer's recording/idle tint.
struct MicGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 14.0
        let sy = rect.height / 14.0
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }
        var path = Path()
        let body = CGRect(x: rect.minX + 5 * sx, y: rect.minY + 2 * sy, width: 4 * sx, height: 6.5 * sy)
        let radius = 2 * min(sx, sy)
        path.addRoundedRect(in: body, cornerSize: CGSize(width: radius, height: radius))
        path.move(to: p(4, 8.5))
        path.addQuadCurve(to: p(10, 8.5), control: p(7, 13.5))
        path.move(to: p(7, 11))
        path.addLine(to: p(7, 12.7))
        path.move(to: p(5, 12.7))
        path.addLine(to: p(9, 12.7))
        return path
    }
}
