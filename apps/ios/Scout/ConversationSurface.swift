import SwiftUI
import Foundation
import PhotosUI
import UniformTypeIdentifiers
import HudsonUI
import HudsonVoice
import ScoutCapabilities
import ScoutIOSCore

private enum UserSendPhase: Equatable {
    case preparing
    case uploading
    case sending
    case posted
    case queued
    case dispatching
    case acknowledged
    case working
    case waiting
    case completed
    case recoverable(OutboundDeliveryState.RecoveryAction?, String?)
    case failed(String)
    case cancelled

    var label: String {
        switch self {
        case .preparing: return "Preparing…"
        case .uploading: return "Uploading attachments…"
        case .sending: return "Sending…"
        case .posted: return "Posted"
        case .queued: return "Queued for agent"
        case .dispatching: return "Starting agent…"
        case .acknowledged: return "Agent picked it up"
        case .working: return "Agent is working"
        case .waiting: return "Agent needs input"
        case .completed: return "Agent responded"
        case .recoverable(let action, let detail):
            if let detail, !detail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return detail
            }
            return action == .startReplacement
                ? "Session ended · start a new session to deliver"
                : "Message saved · retry delivery"
        case .failed(let detail):
            let trimmed = detail.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? "Send failed" : "Send failed: \(trimmed)"
        case .cancelled: return "Cancelled"
        }
    }

    var pulses: Bool {
        switch self {
        case .preparing, .uploading, .sending, .queued, .dispatching, .acknowledged, .working:
            return true
        case .posted, .waiting, .completed, .recoverable, .failed, .cancelled:
            return false
        }
    }

    var tint: Color {
        switch self {
        case .failed, .cancelled:
            return ScoutPalette.statusError
        case .waiting, .recoverable:
            return ScoutPalette.accent
        case .acknowledged, .working, .completed:
            return ScoutPalette.statusOk
        default:
            return ScoutInk.muted
        }
    }

    static func fromLifecycle(_ state: ConversationLifecycleState) -> UserSendPhase {
        switch state {
        case .queued: return .queued
        case .dispatching: return .dispatching
        case .acknowledged: return .acknowledged
        case .working: return .working
        case .waiting: return .waiting
        case .completed: return .completed
        case .failed: return .failed("")
        case .cancelled, .expired: return .cancelled
        }
    }
}

/// What a long press offers on one of your own turns.
///
/// Which of these appear depends on where the message actually IS, and that line
/// matters: a message still sitting on the phone can be pulled back whole, while
/// one the agent already has can only be redirected or stopped. "Cancel" means a
/// different act on each side of that line, so this menu never uses the word —
/// `discard` throws away something that never left, `stop` halts work already
/// under way.
private enum TurnAction: Identifiable {
    /// Still local — pull it back into the composer, attachments and all.
    case edit
    /// Still local — drop it and its saved outbound record.
    case discard
    /// The agent has it — interrupt the turn and hand it a new instruction.
    case steer
    /// The agent has it — interrupt the turn and leave it stopped.
    case stop

    var id: String { title }

    var title: String {
        switch self {
        case .edit:    return "Edit message"
        case .discard: return "Discard message"
        case .steer:   return "Steer the agent"
        case .stop:    return "Stop this turn"
        }
    }

    var icon: String {
        switch self {
        case .edit:    return "pencil"
        case .discard: return "trash"
        case .steer:   return "arrow.triangle.branch"
        case .stop:    return "stop.circle"
        }
    }

    var isDestructive: Bool {
        switch self {
        case .discard, .stop: return true
        case .edit, .steer:   return false
        }
    }
}

/// Conversation — the keystone surface. It owns no reduction logic of its own:
/// it loads a snapshot, then folds the live event stream through the shared
/// `ConversationProjection` (the exact reducer macOS uses) and renders the
/// resulting turns/blocks with Hudson atoms. A `HudMessageBar` drives the
/// `ControlCapability` write side.
struct ConversationSurface: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
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
    @State private var pendingAttachments: [ScoutComposerAttachment] = []
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var showPhotoPicker = false
    @State private var showFileImporter = false
    @State private var composerError: String?
    @State private var composerNotice: String?
    /// Stable id for a locally durable send attempt. It survives transport loss
    /// and is reused on retry so the broker can return the original delivery.
    @State private var outboundDraftId: String?
    @State private var showSettings = false
    /// Messages sent from this device that haven't yet appeared in an
    /// authoritative snapshot. They render immediately (optimistic) and are
    /// reconciled out the moment the broker echoes them back.
    @State private var pending: [PendingUserSend] = []
    /// Per-message send/dispatch feedback keyed by the optimistic
    /// `clientMessageId`, kept past broker acknowledgement until the agent reply
    /// or lifecycle terminal state makes the status obsolete.
    @State private var sendPhases: [String: UserSendPhase] = [:]
    @State private var sendFlightIdsByClientMessageId: [String: String] = [:]
    @State private var clientMessageIdsByFlightId: [String: String] = [:]
    /// The active send operation, including attachment upload and the bridge RPC.
    @State private var sendTask: Task<Void, Never>?
    /// The next send is a STEER — an interrupt carrying the instruction, not a
    /// message appended behind the running turn. Armed from a turn's long-press
    /// menu; the composer says so and offers a way out.
    @State private var steerArmed = false
    /// Owns the long-lived snapshot + event-stream loop so manual Retry cannot
    /// create duplicate stream consumers for the same conversation.
    @State private var runTask: Task<Void, Never>?
    /// Broker comms messages arrive as lightweight invalidations, not full
    /// session events. This task refreshes the snapshot when the bridge reports
    /// that the broker posted a message in this conversation.
    @State private var refreshTask: Task<Void, Never>?
    /// Broker invocation / delivery / flight lifecycle stream. This drives the
    /// visible "agent picked it up / working" status for a just-sent message.
    @State private var lifecycleTask: Task<Void, Never>?
    /// Broker message invalidations are best-effort over the relay connection.
    /// While a request is unsettled, periodically reconcile the authoritative
    /// snapshot so a reconnect cannot leave a persisted agent reply invisible.
    @State private var reconciliationTask: Task<Void, Never>?
    /// Held for the leave-the-screen teardown; the composer owns the dictation UI.
    @Environment(HudDictation.self) private var voice

    private var turns: [TurnState] { projection.state?.turns ?? [] }

    /// Distinguishes the three reasons a transcript can be empty so the surface
    /// never renders an unexplained void: still fetching, loaded-but-no-history,
    /// or the snapshot RPC failed.
    private enum LoadPhase { case loading, loaded, failed }

    /// A message sent from this device that's awaiting its authoritative record.
    private struct PendingUserSend: Equatable {
        let id: String
        let text: String
        let attachments: [ScoutComposerAttachment]
        let startedAt: Int

        var signature: String {
            let names = attachments.map { "\($0.mediaType):\($0.fileName)" }.joined(separator: "|")
            return "\(text)|\(names)"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            transcript
        }
        .background(ScoutPalette.bg)
        .safeAreaInset(edge: .bottom) { composer }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: conversationId) {
            await restoreOutboundDraft()
            restartRun()
        }
        .onAppear {
            publishStatusContext()
        }
        // Stop active capture and long-lived stream tasks when the conversation
        // leaves the screen.
        .onDisappear {
            if voice.isListening { voice.cancel() }
            sendTask?.cancel()
            runTask?.cancel()
            refreshTask?.cancel()
            lifecycleTask?.cancel()
            reconciliationTask?.cancel()
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

    /// The shared pill composer (ComposerKit) with this surface's params —
    /// pending attachments, the recovered-draft notice, and the session's
    /// runtime in the tools slot. No composer markup lives here: surfaces
    /// differ by what they pass, never by re-rolling the shell.
    private var composer: some View {
        ScoutMessageComposer(
            text: $composerText,
            // The resting placeholder used to say "Steer the agent…", which now
            // collides with an actual armed Steer mode. A plain message is a
            // plain message; steering is the thing you opt into.
            placeholder: steerArmed ? "Stop, and do this instead…" : "Message the agent…",
            rows: 1,
            onSend: send,
            canSend: canSend,
            sending: isSending,
            attach: ScoutComposerAttach(
                onPhoto: { showPhotoPicker = true },
                onFile: { showFileImporter = true }
            ),
            attachments: $pendingAttachments,
            error: composerError,
            notice: composerNoticeModel,
            density: .thread,
            appearance: .pill
        ) {
            ScoutRuntimeChip(
                harness: projection.state?.session.adapterType,
                model: projection.state?.session.model
            )
        }
        .background(ScoutPalette.bg)
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $selectedPhotoItems,
            maxSelectionCount: 8,
            matching: .images
        )
        .onChange(of: selectedPhotoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await addPhotos(items) }
        }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            addFiles(result)
        }
    }

    /// Armed steering states itself in the notice line and carries its own way
    /// out — a mode you can enter from a menu and cannot leave is a trap.
    private var composerNoticeModel: ScoutComposerNotice? {
        guard steerArmed else { return composerNotice.map { ScoutComposerNotice($0) } }
        return ScoutComposerNotice(
            composerNotice ?? "Steering — this stops the current turn and sends your new instruction.",
            actionLabel: "Cancel"
        ) {
            steerArmed = false
            composerNotice = nil
        }
    }

    private var canSend: Bool {
        (!composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingAttachments.isEmpty) && !isSending
    }

    @MainActor
    private func addPhotos(_ items: [PhotosPickerItem]) async {
        defer { selectedPhotoItems = [] }
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first { $0.conforms(to: .image) }
            let mediaType = type?.preferredMIMEType ?? "image/jpeg"
            let ext = type?.preferredFilenameExtension ?? (mediaType == "image/png" ? "png" : "jpg")
            pendingAttachments.append(
                ScoutComposerAttachment(data: data, mediaType: mediaType, fileName: "photo-\(pendingAttachments.count + 1).\(ext)")
            )
        }
    }

    private func addFiles(_ result: Result<[URL], Error>) {
        do {
            let urls = try result.get()
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url)
                let type = UTType(filenameExtension: url.pathExtension)
                let mediaType = type?.preferredMIMEType ?? "application/octet-stream"
                pendingAttachments.append(
                    ScoutComposerAttachment(data: data, mediaType: mediaType, fileName: url.lastPathComponent)
                )
            }
        } catch {
            composerError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Button { onClose() } label: {
                Glyphic.chevron(.leading, size: 17)
                    .foregroundStyle(ScoutPalette.ink)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(ScoutSurface.inset))
                    .overlay(Circle().stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.standard))
            }
            .buttonStyle(.plain)

            // The runtime lives on the composer's chip now — repeating the model
            // here was the same fact twice on one screen.
            Text(title)
                .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
            Spacer()
            // Only the active state earns a badge. Once you're inside a specific
            // agent, an "idle" tag is just noise — a settled agent reads as idle
            // by absence, so the header stays quiet until something's running.
            if isStreaming {
                HudBadge("streaming", tint: ScoutPalette.statusOk, dot: true)
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
                ScoutEmptyState(title: "Loading conversation", icon: "ellipsis.bubble")
            case .failed:
                VStack(spacing: HudSpacing.lg) {
                    ScoutEmptyState(
                        title: "Couldn’t load conversation",
                        subtitle: "The bridge didn’t return a transcript for this session.",
                        icon: "exclamationmark.bubble"
                    )
                    HudButton("Retry", icon: "arrow.clockwise", style: .secondary) {
                        restartRun()
                    }
                }
            case .loaded:
                ScoutEmptyState(
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
                            TurnView(
                                turn: turn,
                                sendPhase: sendPhase(for: turn),
                                actions: turnActions(for: turn),
                                onRecover: recoverDelivery,
                                onAnswer: answer,
                                onDecide: decide,
                                onAction: { perform($0, on: turn) }
                            )
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
        if animated && !reduceMotion {
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

    private func restartRun() {
        runTask?.cancel()
        refreshTask?.cancel()
        lifecycleTask?.cancel()
        reconciliationTask?.cancel()
        runTask = Task { await run() }
        refreshTask = Task { await runRefreshes() }
        lifecycleTask = Task { await runLifecycleUpdates() }
        reconciliationTask = Task { await runActiveReconciliation() }
    }

    private func run() async {
        loadPhase = .loading
        // Recover authoritative state, then fold live events on top — exactly
        // the snapshot-then-stream contract the projection is built around.
        do {
            let snapshot = try await client.snapshot(conversationId: conversationId)
            // Use the same merge path as broker invalidations so a snapshot that
            // arrives after an optimistic send cannot make that send flicker out.
            applyRefreshed(snapshot)
        } catch {
            // No authoritative snapshot. Surface the failure, but still attach to
            // the live stream so a session that's actively producing can populate.
            loadPhase = .failed
        }
        // Live events flip the badge on only when they actually arrive — a
        // static (already-settled) conversation stays "idle".
        for await event in client.conversationEvents(conversationId: conversationId, sinceSeq: projection.lastAppliedSeq) {
            var p = projection
            p.apply(event)
            projection = p
            isStreaming = p.state?.currentTurnId != nil
            publishStatusContext()
        }
        isStreaming = false
        publishStatusContext()
    }

    private func runRefreshes() async {
        for await _ in client.conversationRefreshes(conversationId: conversationId) {
            if Task.isCancelled { return }
            await refreshSnapshot()
        }
    }

    private func runLifecycleUpdates() async {
        for await update in client.conversationLifecycleUpdates(conversationId: conversationId) {
            if Task.isCancelled { return }
            applyLifecycleUpdate(update)
            await refreshSnapshot()
        }
    }

    private func runActiveReconciliation() async {
        while !Task.isCancelled {
            do {
                try await Task.sleep(for: .seconds(3))
            } catch {
                return
            }
            guard hasUnsettledWork else { continue }
            await refreshSnapshot()
        }
    }

    private var hasUnsettledWork: Bool {
        projection.state?.currentTurnId != nil || sendPhases.values.contains(where: \.pulses)
    }

    private func refreshSnapshot() async {
        guard let snap = try? await client.snapshot(conversationId: conversationId) else { return }
        if Task.isCancelled { return }
        applyRefreshed(snap)
    }

    private func send() {
        guard !isSending else { return }
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        let attachments = pendingAttachments
        guard !text.isEmpty || !attachments.isEmpty else { return }
        if steerArmed {
            steerSend(text)
            return
        }
        composerError = nil
        composerNotice = nil
        isSending = true
        let clientMessageId = outboundDraftId ?? "ios-\(UUID().uuidString)"

        sendTask = Task {
            do {
                try await OutboundDraftStore.shared.save(
                    OutboundDraftRecord(
                        id: clientMessageId,
                        conversationId: conversationId,
                        body: text,
                        attachments: attachments.map(\.upload)
                    )
                )
                try Task.checkCancellation()
                outboundDraftId = clientMessageId
                composerText = ""
                pendingAttachments = []
                let outgoing = PendingUserSend(
                    id: clientMessageId,
                    text: text,
                    attachments: attachments,
                    startedAt: nowMs()
                )
                pending.append(outgoing)
                sendPhases[clientMessageId] = attachments.isEmpty ? .sending : .preparing
                insertOptimisticUserTurn(outgoing)
                if !attachments.isEmpty {
                    sendPhases[clientMessageId] = .uploading
                }
                let hosted = try await upload(attachments)
                sendPhases[clientMessageId] = .sending
                let result = try await client.send(
                    PromptSpec(
                        conversationId: conversationId,
                        text: text,
                        attachments: hosted,
                        clientMessageId: clientMessageId
                    )
                )
                recordSendResult(result, clientMessageId: clientMessageId)
                let deliveryNeedsRecovery = result.delivery?.state == .recoverable
                if !deliveryNeedsRecovery {
                    try? await OutboundDraftStore.shared.remove(id: clientMessageId)
                }
                outboundDraftId = nil
                // Re-enable the composer as soon as the send is acknowledged —
                // the reply can keep streaming in while you queue the next message.
                isSending = false
                // Reconcile the optimistic turn immediately after the write ack.
                // Later user/agent broker messages arrive through
                // `conversationRefreshes`, which avoids an open-ended poll loop.
                await refreshSnapshot()
            } catch is CancellationError {
                isSending = false
            } catch {
                removeOptimisticSend(clientMessageId)
                composerText = text
                pendingAttachments = attachments
                outboundDraftId = clientMessageId
                composerError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                isSending = false
            }
        }
    }

    /// A steer is ONE call that stops the running turn and hands the agent what
    /// to do instead (`InterruptSpec.steerText`). It deliberately skips the
    /// outbound-draft and optimistic-turn machinery: that exists to make a
    /// queued message durable across a lost bridge, and a steer is only
    /// meaningful against the turn running right now — replaying one later would
    /// interrupt whatever happened to be running then.
    private func steerSend(_ text: String) {
        // `InterruptSpec` carries text and nothing else, so a steer cannot take
        // files. Say so rather than dropping them silently.
        guard pendingAttachments.isEmpty else {
            composerError = "A steer can't carry attachments — send them as a normal message instead."
            return
        }
        composerError = nil
        composerNotice = nil
        isSending = true
        sendTask = Task {
            do {
                _ = try await client.interrupt(
                    InterruptSpec(conversationId: conversationId, steerText: text)
                )
                composerText = ""
                steerArmed = false
                isSending = false
                await refreshSnapshot()
            } catch {
                isSending = false
                composerError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    // MARK: - Turn actions
    //
    // The menu is built from where the message actually is, never from a fixed
    // list with things greyed out. Two regimes, split by whether the payload has
    // left this phone:
    //
    //   STILL LOCAL  (preparing · uploading · sending · saved-for-retry) — the
    //     bytes are ours. Edit pulls the whole thing back into the composer,
    //     Discard drops it. Neither needs the broker's permission.
    //   AGENT HAS IT (queued · dispatching · acknowledged · working) — nothing
    //     can be un-said. Steer and Stop are both `interrupt`, differing only by
    //     whether a redirect rides along.
    //
    // A finished turn offers nothing: there is no work to stop and no message to
    // pull back, and an "Edit" that silently reposts would be a lie.

    private func turnActions(for turn: TurnState) -> [TurnAction] {
        guard turn.isUserTurn == true else {
            // The agent's own streaming turn is the most natural thing to press
            // when you want it to stop — it is the block you are watching move.
            // A settled agent turn has nothing to interrupt.
            return turn.status == .streaming ? [.steer, .stop] : []
        }
        switch sendPhase(for: turn) {
        case .preparing, .uploading, .sending:
            return turn.clientMessageId == nil ? [] : [.edit, .discard]
        case .recoverable:
            // Already surfaced as an inline Retry button; the menu adds the two
            // things that button cannot do.
            return turn.clientMessageId == nil ? [] : [.edit, .discard]
        case .queued, .dispatching, .acknowledged, .working:
            return [.steer, .stop]
        case .posted:
            // Delivered, nothing running against it yet that we know of — the
            // agent still owns it, so only the interrupt pair is honest.
            return [.steer, .stop]
        case .waiting, .completed, .failed, .cancelled, .none:
            return []
        }
    }

    private func perform(_ action: TurnAction, on turn: TurnState) {
        switch action {
        case .edit:
            guard let clientMessageId = turn.clientMessageId else { return }
            pullBack(clientMessageId, intoComposer: true)
        case .discard:
            guard let clientMessageId = turn.clientMessageId else { return }
            pullBack(clientMessageId, intoComposer: false)
        case .steer:
            // Arm the composer rather than opening a text prompt on top of the
            // transcript: the steer IS a message, and the operator already has
            // the one control on this screen that writes messages.
            steerArmed = true
            composerError = nil
            composerNotice = "Steering — this stops the current turn and sends the agent your new instruction."
        case .stop:
            stopCurrentTurn()
        }
    }

    /// Take an undelivered message back off the wire. `intoComposer` is the only
    /// difference between Edit and Discard — both cancel the in-flight send, drop
    /// the optimistic turn, and clear the saved outbound record.
    private func pullBack(_ clientMessageId: String, intoComposer: Bool) {
        sendTask?.cancel()
        sendTask = nil
        isSending = false
        composerError = nil
        Task {
            let draft = try? await OutboundDraftStore.shared.draft(id: clientMessageId)
            if intoComposer, let draft {
                composerText = draft.body
                pendingAttachments = draft.attachments.map { attachment in
                    ScoutComposerAttachment(
                        data: attachment.data,
                        mediaType: attachment.mediaType,
                        fileName: attachment.fileName ?? "attachment"
                    )
                }
                // Keep the id so re-sending reuses the same idempotency key
                // rather than racing a duplicate through behind it.
                outboundDraftId = clientMessageId
                composerNotice = "Pulled back for editing. Send when you're ready."
            } else {
                try? await OutboundDraftStore.shared.remove(id: clientMessageId)
                if outboundDraftId == clientMessageId { outboundDraftId = nil }
                composerNotice = "Message discarded."
            }
            removeOptimisticSend(clientMessageId)
            sendPhases[clientMessageId] = nil
        }
    }

    /// Stop whatever the agent is doing, with no redirect. Same call the steer
    /// path makes, minus the follow-up text.
    private func stopCurrentTurn() {
        composerError = nil
        composerNotice = "Stopping the current turn…"
        Task {
            do {
                _ = try await client.interrupt(InterruptSpec(conversationId: conversationId))
                composerNotice = "Stopped."
                await refreshSnapshot()
            } catch {
                composerNotice = nil
                composerError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func restoreOutboundDraft() async {
        guard composerText.isEmpty, pendingAttachments.isEmpty else { return }
        guard let draft = try? await OutboundDraftStore.shared.latest(conversationId: conversationId) else {
            return
        }
        outboundDraftId = draft.id
        composerText = draft.body
        pendingAttachments = draft.attachments.map { attachment in
            ScoutComposerAttachment(
                data: attachment.data,
                mediaType: attachment.mediaType,
                fileName: attachment.fileName ?? "attachment"
            )
        }
        composerNotice = "Recovered an unsent message. Review it and retry when ready."
    }

    private func recoverDelivery(
        clientMessageId: String,
        action: OutboundDeliveryState.RecoveryAction
    ) {
        switch action {
        case .retry:
            let hasCurrentDraft = !composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                || !pendingAttachments.isEmpty
            guard !hasCurrentDraft else {
                composerNotice = "Your current draft is still here. Send or clear it before retrying the saved message."
                return
            }
            Task {
                guard let draft = try? await OutboundDraftStore.shared.draft(id: clientMessageId) else {
                    composerNotice = "This message is already saved by Scout. Reopen it from the conversation to retry."
                    return
                }
                outboundDraftId = draft.id
                composerText = draft.body
                pendingAttachments = draft.attachments.map { attachment in
                    ScoutComposerAttachment(
                        data: attachment.data,
                        mediaType: attachment.mediaType,
                        fileName: attachment.fileName ?? "attachment"
                    )
                }
                composerNotice = "Retrying the saved message…"
                send()
            }
        case .startReplacement:
            preserveCurrentComposerIfNeeded()
            onClose()
        }
    }

    private func preserveCurrentComposerIfNeeded() {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty || !pendingAttachments.isEmpty else { return }
        let draft = OutboundDraftRecord(
            id: outboundDraftId ?? "ios-\(UUID().uuidString)",
            conversationId: conversationId,
            body: text,
            attachments: pendingAttachments.map(\.upload)
        )
        Task { try? await OutboundDraftStore.shared.save(draft) }
    }

    private func upload(_ attachments: [ScoutComposerAttachment]) async throws -> [MessageAttachment]? {
        guard !attachments.isEmpty else { return nil }
        var hosted: [MessageAttachment] = []
        for attachment in attachments {
            hosted.append(try await client.uploadAttachment(attachment.upload))
        }
        return hosted
    }

    private func recordSendResult(_ result: ControlResult, clientMessageId: String) {
        if let flightId = result.flightId?.trimmingCharacters(in: .whitespacesAndNewlines), !flightId.isEmpty {
            sendFlightIdsByClientMessageId[clientMessageId] = flightId
            clientMessageIdsByFlightId[flightId] = clientMessageId
        }
        if result.delivery?.state == .recoverable {
            sendPhases[clientMessageId] = .recoverable(result.delivery?.action, result.delivery?.detail)
        } else if let state = result.lifecycleState {
            sendPhases[clientMessageId] = UserSendPhase.fromLifecycle(state)
        } else if result.flightId != nil {
            sendPhases[clientMessageId] = .dispatching
        } else if result.messageId != nil {
            sendPhases[clientMessageId] = .posted
        }
    }

    private func applyLifecycleUpdate(_ update: ConversationLifecycleUpdate) {
        guard let clientMessageId = clientMessageId(for: update) else { return }
        if let flightId = update.flightId?.trimmingCharacters(in: .whitespacesAndNewlines), !flightId.isEmpty {
            sendFlightIdsByClientMessageId[clientMessageId] = flightId
            clientMessageIdsByFlightId[flightId] = clientMessageId
        }
        if update.state == .failed {
            sendPhases[clientMessageId] = .failed(update.error ?? update.summary ?? "")
        } else {
            sendPhases[clientMessageId] = UserSendPhase.fromLifecycle(update.state)
        }
    }

    private func clientMessageId(for update: ConversationLifecycleUpdate) -> String? {
        if let explicit = update.clientMessageId?.trimmingCharacters(in: .whitespacesAndNewlines), !explicit.isEmpty {
            return explicit
        }
        if let flightId = update.flightId?.trimmingCharacters(in: .whitespacesAndNewlines),
           let clientMessageId = clientMessageIdsByFlightId[flightId] {
            return clientMessageId
        }
        if let messageId = update.messageId?.trimmingCharacters(in: .whitespacesAndNewlines),
           let turn = projection.state?.turns.first(where: { $0.id == messageId || $0.clientMessageId == messageId }),
           let clientMessageId = turn.clientMessageId {
            return clientMessageId
        }
        return nil
    }

    private func sendPhase(for turn: TurnState) -> UserSendPhase? {
        guard turn.isUserTurn == true,
              let clientMessageId = turn.clientMessageId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !clientMessageId.isEmpty
        else { return nil }
        return sendPhases[clientMessageId]
    }

    private func removeOptimisticSend(_ clientMessageId: String) {
        pending.removeAll { $0.id == clientMessageId }
        sendPhases.removeValue(forKey: clientMessageId)
        if let flightId = sendFlightIdsByClientMessageId.removeValue(forKey: clientMessageId) {
            clientMessageIdsByFlightId.removeValue(forKey: flightId)
        }
        guard var state = projection.state else { return }
        state.turns.removeAll { turn in
            turn.id == clientMessageId && turn.clientMessageId == clientMessageId
        }
        projection = ConversationProjection(state: state, lastAppliedSeq: projection.lastAppliedSeq)
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
        let attachmentBlocks = optimisticAttachmentBlocks(for: outgoing)
        s.turns.append(TurnState(
            id: outgoing.id, status: .completed,
            blocks: [BlockState(block: block, status: .completed)] + attachmentBlocks,
            startedAt: outgoing.startedAt, isUserTurn: true, clientMessageId: outgoing.id
        ))
        projection = ConversationProjection(state: s, lastAppliedSeq: projection.lastAppliedSeq)
        loadPhase = .loaded
    }

    /// Adopt a fresh snapshot, keeping any still-unacknowledged optimistic turns
    /// appended so a sent message never flickers out between the local insert and
    /// the broker echo. Only reassigns when the state actually changed, so an
    /// unchanged poll causes no re-render (and no scroll jump).
    private func applyRefreshed(_ snap: SessionState) {
        let snapClientMessageIds = Set(
            snap.turns
                .filter { $0.isUserTurn == true }
                .compactMap { $0.clientMessageId?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        )
        pending.removeAll { outgoing in
            if snapClientMessageIds.contains(outgoing.id) { return true }
            // Compatibility with older bridges that do not yet echo clientMessageId:
            // only match recent user turns that have no id, so repeated text in the
            // historical page does not clear the wrong optimistic send.
            return snap.turns.contains { turn in
                guard turn.isUserTurn == true,
                      turn.clientMessageId == nil,
                      turn.startedAt >= outgoing.startedAt - 10_000
                else { return false }
                let text = turn.blocks.compactMap { $0.block.text }.joined(separator: "\n")
                let names = turn.blocks
                    .filter { $0.block.type == .file }
                    .map { "\($0.block.mimeType ?? ""):\($0.block.name ?? "")" }
                    .joined(separator: "|")
                return text == outgoing.text || "\(text)|\(names)" == outgoing.signature
            }
        }

        var merged = snap
        for outgoing in pending {
            let block = Block(
                id: "\(outgoing.id):body", turnId: outgoing.id,
                type: .text, status: .completed, index: 0, text: outgoing.text
            )
            merged.turns.append(TurnState(
                id: outgoing.id, status: .completed,
                blocks: [BlockState(block: block, status: .completed)] + optimisticAttachmentBlocks(for: outgoing),
                startedAt: outgoing.startedAt, isUserTurn: true, clientMessageId: outgoing.id
            ))
        }

        reconcileSendPhases(with: merged)

        let candidate = ConversationProjection(state: merged, lastAppliedSeq: projection.lastAppliedSeq)
        if candidate.state != projection.state {
            projection = candidate
        }
        isStreaming = merged.currentTurnId != nil
        loadPhase = .loaded
        publishStatusContext()
    }

    private func reconcileSendPhases(with state: SessionState) {
        if let currentTurnId = state.currentTurnId,
           currentTurnId.hasPrefix("flight:") {
            let flightId = String(currentTurnId.dropFirst("flight:".count))
            if let clientMessageId = clientMessageIdsByFlightId[flightId],
               sendPhases[clientMessageId] != .waiting {
                sendPhases[clientMessageId] = .working
            }
        }

        for clientMessageId in Array(sendPhases.keys) {
            guard let userIndex = state.turns.firstIndex(where: {
                $0.isUserTurn == true && $0.clientMessageId == clientMessageId
            }) else { continue }
            let laterAgentReply = state.turns.dropFirst(userIndex + 1).contains { turn in
                turn.isUserTurn != true && !turn.id.hasPrefix("flight:")
            }
            if laterAgentReply {
                sendPhases.removeValue(forKey: clientMessageId)
                if let flightId = sendFlightIdsByClientMessageId.removeValue(forKey: clientMessageId) {
                    clientMessageIdsByFlightId.removeValue(forKey: flightId)
                }
            }
        }
    }

    private func nowMs() -> Int { Int(Date().timeIntervalSince1970 * 1000) }

    private func optimisticAttachmentBlocks(for outgoing: PendingUserSend) -> [BlockState] {
        outgoing.attachments.enumerated().map { index, attachment in
            let block = Block(
                id: "\(outgoing.id):attachment:\(attachment.id.uuidString)",
                turnId: outgoing.id,
                type: .file,
                status: .completed,
                index: index + 1,
                mimeType: attachment.mediaType,
                name: attachment.fileName,
                data: attachment.data.base64EncodedString()
            )
            return BlockState(block: block, status: .completed)
        }
    }

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
    let sendPhase: UserSendPhase?
    /// What a long press offers here — empty when there is nothing honest to do,
    /// in which case no menu is attached at all rather than one that greys out.
    let actions: [TurnAction]
    let onRecover: (_ clientMessageId: String, _ action: OutboundDeliveryState.RecoveryAction) -> Void
    let onAnswer: (_ turnId: String, _ blockId: String, _ choice: [String]) -> Void
    let onDecide: (_ turnId: String, _ blockId: String, _ version: Int, _ decision: ActionDecisionSpec.Decision) -> Void
    let onAction: (TurnAction) -> Void

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
                        .foregroundStyle(ScoutPalette.statusError)
                }
            }
            ForEach(turn.blocks, id: \.block.id) { blockState in
                BlockView(blockState: blockState, isUser: isUser, turnId: turn.id, onAnswer: onAnswer, onDecide: onDecide)
            }
            if isUser, let sendPhase {
                VStack(alignment: .leading, spacing: HudSpacing.xs) {
                    HStack(spacing: HudSpacing.xs) {
                        HudStatusDot(color: sendPhase.tint, size: 5, pulses: sendPhase.pulses)
                        Text(sendPhase.label)
                            .font(HudFont.mono(HudTextSize.xxs))
                            .foregroundStyle(sendPhase.tint)
                            .lineLimit(2)
                    }
                    if case .recoverable(let action?, _) = sendPhase,
                       let clientMessageId = turn.clientMessageId {
                        Button(action == .retry ? "Retry delivery" : "Choose replacement") {
                            onRecover(clientMessageId, action)
                        }
                        .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                        .foregroundStyle(ScoutPalette.accent)
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, -HudSpacing.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        // Long press, not a row of buttons: steering and stopping are rare acts
        // on a surface that is mostly for reading, and a control per turn would
        // charge every message for something you do to one of them.
        .contentShape(Rectangle())
        .modifier(TurnActionMenu(actions: actions, onAction: onAction))
    }

    // User turns read as neutral; the agent is the one accented voice.
    private var roleColor: Color { isUser ? ScoutInk.muted : ScoutPalette.accent }
}

/// Attaches the long-press menu only when there is something to offer. A
/// `.contextMenu` with no items still arms the gesture and still lifts the row
/// on a long press, which reads as a broken control rather than as no control.
private struct TurnActionMenu: ViewModifier {
    let actions: [TurnAction]
    let onAction: (TurnAction) -> Void

    func body(content: Content) -> some View {
        if actions.isEmpty {
            content
        } else {
            content.contextMenu {
                ForEach(actions) { action in
                    Button(role: action.isDestructive ? .destructive : nil) {
                        onAction(action)
                    } label: {
                        Label(action.title, systemImage: action.icon)
                    }
                }
            }
        }
    }
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
            markupCard(block.text ?? "", fill: isUser ? ScoutSurface.inset : nil)
        case .reasoning:
            reasoning(block.text ?? "")
        case .action:
            actionCard
        case .question:
            questionCard
        case .error:
            textCard(block.message ?? "Error", fill: ScoutPalette.statusError.opacity(0.10), accent: ScoutPalette.statusError)
        case .file:
            attachmentCard
        }
    }

    private var attachmentCard: some View {
        let data = block.data.flatMap { Data(base64Encoded: $0) }
        let url = block.url ?? (block.data?.hasPrefix("http") == true ? block.data : nil)
        let attachment = MessageAttachment(
            id: block.id,
            mediaType: block.mimeType ?? "application/octet-stream",
            fileName: block.name,
            url: url
        )
        return MessageAttachmentCard(attachment: attachment, data: data)
    }

    /// Plain single-string card — used for error/file blocks where the content
    /// is a literal message, not markdown.
    private func textCard(_ text: String, fill: Color?, accent: Color? = nil) -> some View {
        HudCard(padding: HudSpacing.lg, fill: fill) {
            Text(text.isEmpty ? "…" : text)
                .font(HudFont.ui(HudTextSize.md))
                .foregroundStyle(accent ?? ScoutPalette.ink)
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
        return HudCard(padding: HudSpacing.lg, fill: ScoutSurface.inset) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: actionIcon(action?.kind))
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(ScoutInk.muted)
                    Text(actionTitle(action))
                        .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
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
                    .foregroundStyle(ScoutPalette.ink)
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
        case .medium: return ScoutPalette.statusWarn
        case .high: return ScoutPalette.statusError
        }
    }

    private var questionCard: some View {
        HudCard(padding: HudSpacing.lg, fill: ScoutPalette.statusWarn.opacity(0.08)) {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                if let header = block.header {
                    Text(header.uppercased())
                        .font(HudFont.mono(HudTextSize.xxs, weight: .bold))
                        .tracking(1.5)
                        .foregroundStyle(ScoutPalette.statusWarn)
                }
                Text(block.question ?? "")
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(ScoutPalette.ink)
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
        case .completed: return ScoutPalette.accent        // green == success
        case .running, .pending: return ScoutInk.muted
        case .failed: return ScoutPalette.statusError       // red == genuine failure
        case .awaitingApproval: return ScoutPalette.statusWarn  // amber == needs you
        }
    }
}
