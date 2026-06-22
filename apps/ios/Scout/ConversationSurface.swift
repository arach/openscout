import SwiftUI
import Foundation
import PhotosUI
import UniformTypeIdentifiers
import HudsonUI
import HudsonVoice
import ScoutCapabilities

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
        case .posted, .waiting, .completed, .failed, .cancelled:
            return false
        }
    }

    var tint: Color {
        switch self {
        case .failed, .cancelled:
            return HudPalette.statusError
        case .waiting:
            return HudPalette.accent
        case .acknowledged, .working, .completed:
            return HudPalette.statusOk
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
    @State private var pendingAttachments: [ScoutComposerAttachment] = []
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var showFileImporter = false
    @State private var composerError: String?
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
        .background(HudPalette.bg)
        .safeAreaInset(edge: .bottom) { composer }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: conversationId) { restartRun() }
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
            sendTask?.cancel()
            runTask?.cancel()
            refreshTask?.cancel()
            lifecycleTask?.cancel()
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
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            if !pendingAttachments.isEmpty {
                ComposerAttachmentStrip(attachments: pendingAttachments) { id in
                    pendingAttachments.removeAll { $0.id == id }
                }
            }
            if let composerError {
                Text(composerError)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(HudPalette.statusError)
                    .lineLimit(2)
            }
            HStack(alignment: .bottom, spacing: HudSpacing.md) {
                micButton
                attachPhotoButton
                attachFileButton

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
        }
        .padding(.horizontal, HudSpacing.lg)
        .padding(.bottom, HudSpacing.sm)
        .background(HudPalette.bg)
        .onChange(of: selectedPhotoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await addPhotos(items) }
        }
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            addFiles(result)
        }
    }

    private var canSend: Bool {
        (!composerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingAttachments.isEmpty) && !isSending
    }

    private var attachPhotoButton: some View {
        PhotosPicker(selection: $selectedPhotoItems, maxSelectionCount: 8, matching: .images) {
            Image(systemName: "photo")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutInk.muted)
                .frame(width: 28, height: 28)
        }
        .disabled(isSending)
    }

    private var attachFileButton: some View {
        Button { showFileImporter = true } label: {
            Image(systemName: "paperclip")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutInk.muted)
                .frame(width: 28, height: 28)
        }
        .buttonStyle(.plain)
        .disabled(isSending)
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
                        restartRun()
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
                            TurnView(
                                turn: turn,
                                sendPhase: sendPhase(for: turn),
                                onAnswer: answer,
                                onDecide: decide
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

    private func restartRun() {
        runTask?.cancel()
        refreshTask?.cancel()
        lifecycleTask?.cancel()
        runTask = Task { await run() }
        refreshTask = Task { await runRefreshes() }
        lifecycleTask = Task { await runLifecycleUpdates() }
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
        composerText = ""
        pendingAttachments = []
        composerError = nil
        isSending = true
        let clientMessageId = "ios-\(UUID().uuidString)"
        let outgoing = PendingUserSend(id: clientMessageId, text: text, attachments: attachments, startedAt: nowMs())
        pending.append(outgoing)
        sendPhases[clientMessageId] = attachments.isEmpty ? .sending : .preparing
        insertOptimisticUserTurn(outgoing)

        sendTask = Task {
            do {
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
                composerError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                isSending = false
            }
        }
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
        if let state = result.lifecycleState {
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
            if isUser, let sendPhase {
                HStack(spacing: HudSpacing.xs) {
                    HudStatusDot(color: sendPhase.tint, size: 5, pulses: sendPhase.pulses)
                    Text(sendPhase.label)
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(sendPhase.tint)
                        .lineLimit(1)
                }
                .padding(.top, -HudSpacing.xs)
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
