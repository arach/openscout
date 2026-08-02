import SwiftUI
import HudsonUI
import ScoutCapabilities
import ScoutIOSCore

/// Notifications — the destination behind the alerts.
///
/// Home's needs-you band is a precedence layer: it shows what wants you right
/// now and empties the moment nothing does. That leaves no answer to "what did
/// the fleet ask me an hour ago, and what became of it" — the Mac's inbox is a
/// projection of what is pending, not a log. So this is a place, not a tab:
/// the `NotificationsStore` ledger, reachable from the masthead bell and the
/// Home lane header, with attention still living on Home.
///
/// Two states per entry, the pair worth triaging on:
///   · seen / unseen — a leading accent tick, cleared when the entry is opened.
///   · how it ended  — approved / denied / answered when THIS device made the
///     call; resolved elsewhere / cleared when the item merely stopped being
///     pending on the Mac. An outcome we didn't witness is never named.
struct NotificationsSurface: View {
    let model: AppModel
    /// Correlation id from an opened push — the ledger opens on that entry.
    var focusItemId: String?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scoutLayout) private var layout

    @State private var scope: NotificationsStore.Scope = .open
    @State private var path: [Destination] = []
    @State private var isRefreshing = false
    @State private var didFocus = false

    private enum Destination: Hashable {
        case entry(String)
        case conversation(machineId: String, sessionId: String, title: String)
    }

    private var store: NotificationsStore { model.notifications }

    private var rows: [ScoutNotification] { store.entries(scope) }

    /// The third chip exists only once something has been filed — an empty
    /// scope is a choice you have to read and reject on every visit.
    private var scopes: [NotificationsStore.Scope] {
        store.archivedCount > 0 ? [.open, .all, .archived] : [.open, .all]
    }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                header
                content
            }
            .background(ScoutPalette.bg.ignoresSafeArea())
            .navigationBarHidden(true)
            .navigationDestination(for: Destination.self) { destination in
                switch destination {
                case .entry(let id):
                    NotificationDetailView(
                        model: model,
                        entryId: id,
                        onOpenConversation: { entry in
                            path.append(.conversation(
                                machineId: entry.machineId,
                                sessionId: entry.sessionId,
                                title: entry.sessionName.isEmpty ? "Conversation" : entry.sessionName
                            ))
                        }
                    )
                case .conversation(let machineId, let sessionId, let title):
                    ConversationSurface(
                        client: model.client(forMachineId: machineId) ?? model.client,
                        conversationId: sessionId,
                        title: title,
                        onClose: { if !path.isEmpty { path.removeLast() } }
                    )
                }
            }
        }
        .task {
            await refresh()
            focusIfNeeded()
        }
    }

    // MARK: - Chrome

    private var header: some View {
        VStack(spacing: 0) {
            HStack(spacing: HudSpacing.md) {
                Button { dismiss() } label: {
                    Glyphic.chevron(.leading, size: 13)
                        .foregroundStyle(ScoutInk.muted)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(ScoutSurface.inset))
                        .overlay(Circle().stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close notifications")

                VStack(alignment: .leading, spacing: 1) {
                    Text("Notifications")
                        .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                        .foregroundStyle(ScoutVibe.ink)
                    Text(subtitle)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(ScoutInk.dim)
                }

                Spacer(minLength: 0)

                if store.unseenCount > 0 {
                    Button { store.markAllSeen() } label: {
                        Text("Mark all read")
                            .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                            .tracking(1)
                            .textCase(.uppercase)
                            .foregroundStyle(ScoutInk.muted)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, layout.surfacePadding)
            .padding(.vertical, HudSpacing.sm)

            Rectangle()
                .fill(ScoutHairline.standard)
                .frame(height: HudStrokeWidth.thin)
        }
    }

    private var subtitle: String {
        let open = store.openCount
        let waiting = open == 1 ? "1 waiting on you" : "\(open) waiting on you"
        return "\(waiting) · \(store.keptCount) kept"
    }

    /// Scope, not a filter bar — and it decides the ROW FORM, not just the
    /// contents: Open is the triage queue (full cards, decisions inline), All
    /// and Archived are the log (preview cards, nothing left to decide).
    private var scopeBar: some View {
        HStack(spacing: HudSpacing.xs) {
            ForEach(scopes, id: \.rawValue) { candidate in
                let selected = candidate == scope
                let count = store.entries(candidate).count
                Button { scope = candidate } label: {
                    HStack(spacing: HudSpacing.xs) {
                        Text(scopeLabel(candidate).uppercased())
                            .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                            .tracking(1.2)
                            .foregroundStyle(selected ? ScoutPalette.ink : ScoutInk.dim)
                        Text("\(count)")
                            .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                            .monospacedDigit()
                            .foregroundStyle(selected ? ScoutVibe.accent : ScoutInk.dim)
                    }
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, 4)
                    .background(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(selected ? ScoutSurface.raised : ScoutSurface.inset)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .stroke(selected ? ScoutInk.dim : ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(scopeLabel(candidate)) notifications, \(count)")
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
    }

    private func scopeLabel(_ scope: NotificationsStore.Scope) -> String {
        switch scope {
        case .open: return "Open"
        case .all: return "All"
        case .archived: return "Archived"
        }
    }

    // MARK: - Body

    private var content: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                scopeBar

                if rows.isEmpty {
                    emptyState
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, entry in
                            if index > 0 {
                                Rectangle()
                                    .fill(ScoutHairline.subtle)
                                    .frame(height: HudStrokeWidth.thin)
                                    .padding(.leading, HudSpacing.xl)
                            }
                            // Open triages (full card, decisions inline); the
                            // log previews (two lines, one file-away control).
                            if scope == .open {
                                NotificationRow(
                                    model: model,
                                    entry: entry,
                                    onOpen: { open(entry) },
                                    onAnswer: { open(entry) },
                                    onOpenChat: { openConversation(entry) }
                                )
                            } else {
                                NotificationPreviewRow(
                                    entry: entry,
                                    onOpen: { open(entry) },
                                    onFile: {
                                        if entry.isArchived {
                                            store.unarchive(id: entry.id)
                                        } else {
                                            store.archive(id: entry.id)
                                        }
                                    }
                                )
                            }
                        }
                    }
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ScoutVibe.card)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

                    if scope != .open {
                        Text("Kept on this iPhone · 30 days")
                            .font(HudFont.mono(HudTextSize.micro))
                            .tracking(0.8)
                            .textCase(.uppercase)
                            .foregroundStyle(ScoutInk.dim)
                            .frame(maxWidth: .infinity)
                            .padding(.top, HudSpacing.sm)
                    }
                }
            }
            .padding(.horizontal, layout.surfacePadding)
            .padding(.top, HudSpacing.md)
            .padding(.bottom, HudSpacing.xxl)
        }
        .refreshable { await refresh() }
    }

    /// Two different empty beats, and the difference matters: an all-clear is a
    /// claim that things WERE settled. A ledger that has never held anything
    /// says so instead.
    @ViewBuilder
    private var emptyState: some View {
        let settledEverything = scope == .open && store.keptCount > 0
        VStack(spacing: HudSpacing.sm) {
            Glyphic(kind: settledEverything ? .check : .inbox, size: 26)
                .foregroundStyle(settledEverything ? ScoutVibe.accent : ScoutSignalSurface.neutralSignal)
            Text(emptyTitle(settledEverything))
                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                .foregroundStyle(ScoutVibe.ink)
            Text(emptySubtitle(settledEverything))
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(ScoutInk.muted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 52)
    }

    private func emptyTitle(_ settledEverything: Bool) -> String {
        if scope == .archived { return "Nothing archived" }
        return settledEverything ? "Nothing waiting on you" : "No notifications yet"
    }

    private func emptySubtitle(_ settledEverything: Bool) -> String {
        if scope == .archived { return "filed alerts land here" }
        return settledEverything ? "every alert has been settled" : "alerts your Macs raise land here"
    }

    private func open(_ entry: ScoutNotification) {
        store.markSeen(id: entry.id)
        path.append(.entry(entry.id))
    }

    private func openConversation(_ entry: ScoutNotification) {
        store.markSeen(id: entry.id)
        path.append(.conversation(
            machineId: entry.machineId,
            sessionId: entry.sessionId,
            title: entry.sessionName.isEmpty ? "Conversation" : entry.sessionName
        ))
    }

    // MARK: - Data

    private func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        await model.refreshNotifications()
    }

    /// Land on the entry an opened push referred to, once — after the first
    /// read, so an alert that arrived while the app was asleep resolves to a
    /// real ledger row rather than a bare stub.
    private func focusIfNeeded() {
        guard !didFocus, let focusItemId else { return }
        didFocus = true
        guard let entry = store.entries.first(where: { $0.itemId == focusItemId }) else { return }
        store.markSeen(id: entry.id)
        scope = entry.isOpen ? .open : .all
        path.append(.entry(entry.id))
    }
}

// MARK: - Row

/// One ledger entry. Open rows hold the ink and carry their decision inline —
/// clearing the queue is the point of the destination. Settled rows recede a
/// step and read as a log underneath.
private struct NotificationRow: View {
    let model: AppModel
    let entry: ScoutNotification
    let onOpen: () -> Void
    /// Answering needs the prompt and a field, so a question row hands off to
    /// the entry page rather than pretending to answer from a list.
    let onAnswer: () -> Void
    /// A conversation ask is answered by replying, so its row goes straight to
    /// the thread — the same place Home's needs-you card lands.
    let onOpenChat: () -> Void

    @State private var decision = NotificationDecision()

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: HudSpacing.sm) {
                SeenTick(entry: entry)

                VStack(alignment: .leading, spacing: 3) {
                    NotificationMetaLine(entry: entry)

                    Text(entry.title)
                        .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                        .foregroundStyle(ScoutVibe.ink)
                        .lineLimit(1)

                    if !entry.summary.isEmpty, entry.summary != entry.title {
                        Text(entry.summary)
                            .font(HudFont.ui(HudTextSize.sm))
                            .foregroundStyle(ScoutInk.muted)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                    }

                    if let payload = entry.payloadLine {
                        NotificationPayload(text: payload, risk: entry.risk, emphasized: true)
                            .padding(.top, 4)
                    }

                    NotificationActions(
                        model: model,
                        entry: entry,
                        decision: $decision,
                        compact: true,
                        onAnswer: onAnswer,
                        onOpenChat: onOpenChat
                    )
                    .padding(.top, 5)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(NotificationsStore.kindLabel(entry.kind)). \(entry.title)")
    }
}

/// The LOG row (All / Archived) — a preview summary card. Two lines and a state
/// tag: kind · session · age over the title. No summary, no payload, no
/// decision controls, because a settled entry has nothing left to decide and
/// the log reads faster when every row is the same height. Still-pending
/// entries keep the ink: All is a mixed list, and "this one is still waiting on
/// you" has to survive the compression. The full text is one tap away.
private struct NotificationPreviewRow: View {
    let entry: ScoutNotification
    let onOpen: () -> Void
    let onFile: () -> Void

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            Button(action: onOpen) {
                HStack(alignment: .center, spacing: HudSpacing.sm) {
                    SeenTick(entry: entry)
                    VStack(alignment: .leading, spacing: 2) {
                        NotificationMetaLine(entry: entry)
                        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                            Text(entry.title)
                                .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                                .foregroundStyle(entry.isOpen ? ScoutVibe.ink : ScoutInk.muted)
                                .lineLimit(1)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            // Pending entries simply have an empty state
                            // column — nothing has settled yet.
                            if !entry.isOpen {
                                NotificationStateTag(entry: entry)
                            }
                        }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Button(action: onFile) {
                Glyphic(kind: entry.isArchived ? .arrow : .inbox, size: 13)
                    .rotationEffect(.degrees(entry.isArchived ? -90 : 0))
                    .foregroundStyle(ScoutInk.dim)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(entry.isArchived ? "Unarchive" : "Archive")
        }
        .padding(.leading, HudSpacing.md)
        .padding(.trailing, HudSpacing.sm)
        .padding(.vertical, HudSpacing.sm)
    }
}

/// Leading gutter: an accent tick for unseen, a hairline stub once seen. The
/// column keeps its width either way so titles stay aligned down the list.
private struct SeenTick: View {
    let entry: ScoutNotification

    var body: some View {
        RoundedRectangle(cornerRadius: 1.5, style: .continuous)
            .fill(entry.isUnseen ? ScoutVibe.accent : ScoutVibe.hairline)
            .frame(width: 3)
            .frame(maxHeight: .infinity)
    }
}

// MARK: - Shared parts

private struct NotificationMetaLine: View {
    let entry: ScoutNotification

    var body: some View {
        HStack(spacing: HudSpacing.xs) {
            Text(kindTag.uppercased())
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .tracking(0.9)
                .foregroundStyle(entry.isOpen ? ScoutInk.muted : ScoutInk.dim)
            if !entry.sessionName.isEmpty {
                Text(entry.sessionName)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: HudSpacing.xs)
            if let age = ScoutTimestamp.relativeAge(since: entry.createdAt) {
                Text(age)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutInk.dim)
                    .monospacedDigit()
            }
        }
    }

    private var kindTag: String {
        switch entry.kind {
        case "approval": return "approval"
        case "question": return "question"
        case "failed_action": return "failed"
        case "failed_turn": return "turn failed"
        case "session_error": return "session error"
        case "native_attention": return "attention"
        default: return "alert"
        }
    }
}

/// The payload the push deliberately withheld — the command, path, or first
/// error line. Risk reads through contrast (HIGH goes ink-bright), not a second
/// hue; this app spends exactly one accent.
private struct NotificationPayload: View {
    let text: String
    let risk: String
    var emphasized: Bool

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            Text(text)
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(emphasized ? ScoutVibe.ink : ScoutInk.dim)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            if risk != "low" {
                Text(risk.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .tracking(0.6)
                    .foregroundStyle(risk == "high" ? ScoutVibe.ink : ScoutInk.dim)
            }
        }
        .padding(.horizontal, HudSpacing.sm)
        .padding(.vertical, 5)
        .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(ScoutSurface.inset))
        .overlay(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
        )
    }
}

/// How it ended, in one mono tag. Ours (sent, or cleared from this device)
/// takes the ink; an outcome we only inferred stays dim and unnamed.
private struct NotificationStateTag: View {
    let entry: ScoutNotification

    var body: some View {
        Text(NotificationsStore.stateLabel(entry).uppercased())
            .font(HudFont.mono(HudTextSize.micro, weight: .bold))
            .tracking(0.9)
            .foregroundStyle(entry.state.isOurs ? ScoutInk.muted : ScoutInk.dim)
            .lineLimit(1)
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .overlay(
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .stroke(entry.state.isOurs ? ScoutVibe.hairline : ScoutHairline.subtle,
                            lineWidth: HudStrokeWidth.thin)
            )
    }
}

/// Transient state for one entry's decision — deliberately view-local, so a
/// failure reads as "that send failed, try again" rather than being recorded in
/// the ledger as an outcome that never happened.
private struct NotificationDecision {
    var isSubmitting = false
    var error: String?
    var answer = ""
}

/// Every action an OPEN entry has, in one row.
///
/// Approve / Deny send a real decision. Answer needs the prompt and a field, so
/// from the list it hands off to the entry page rather than pretending to
/// answer from a row. Dismiss is the third rank — text weight, pushed to the
/// far edge — because it must never be a mis-tap on Approve: it clears YOUR
/// queue and sends the agent nothing, which is exactly what its label says.
/// An approval the Mac gave us no coordinates for has no working decision, so
/// it shows none — only Dismiss.
private struct NotificationActions: View {
    let model: AppModel
    let entry: ScoutNotification
    @Binding var decision: NotificationDecision
    var compact = false
    var onAnswer: () -> Void = {}
    var onOpenChat: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(spacing: HudSpacing.sm) {
                primaryActions
                if compact {
                    Spacer(minLength: HudSpacing.sm)
                    dismissButton
                }
            }

            if let error = decision.error {
                Text(error)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutVibe.amber)
            }
        }
    }

    @ViewBuilder
    private var primaryActions: some View {
        if entry.isConversationAsk {
            Button(action: onOpenChat) {
                Text("Open chat")
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.bg)
                    .padding(.horizontal, HudSpacing.md)
                    .padding(.vertical, 5)
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ScoutVibe.accent)
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else if entry.isDecidableApproval {
            decisionButton("Deny", prominent: false) { await decide(.deny) }
            decisionButton("Approve", prominent: true) { await decide(.approve) }
        } else if entry.isAnswerableQuestion {
            if compact {
                Button(action: onAnswer) {
                    Text("Answer")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutPalette.bg)
                        .padding(.horizontal, HudSpacing.md)
                        .padding(.vertical, 5)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ScoutVibe.accent)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                answerField
            }
        }
    }

    private var dismissButton: some View {
        Button { model.notifications.dismiss(id: entry.id) } label: {
            Text("Dismiss")
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutInk.dim)
                .padding(.vertical, 5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Clears it from your queue. Sends the agent nothing.")
    }

    @ViewBuilder
    private var answerField: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            TextField("Answer", text: $decision.answer, axis: .vertical)
                .font(HudFont.ui(HudTextSize.sm))
                .textFieldStyle(.plain)
                .lineLimit(1...5)
                .padding(HudSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ScoutSurface.inset)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
                )
            decisionButton("Send answer", prominent: true) { await submitAnswer() }
                .disabled(decision.answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private func decisionButton(
        _ title: String,
        prominent: Bool,
        action: @escaping () async -> Void
    ) -> some View {
        Button { Task { await action() } } label: {
            Text(title)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(prominent ? ScoutPalette.bg : ScoutInk.muted)
                .padding(.horizontal, HudSpacing.md)
                .padding(.vertical, 5)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(prominent ? ScoutVibe.accent : ScoutSurface.inset)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(prominent ? .clear : ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(decision.isSubmitting)
        .opacity(decision.isSubmitting ? 0.5 : 1)
    }

    private func decide(_ value: ActionDecisionSpec.Decision) async {
        guard let client = model.client(forMachineId: entry.machineId),
              let turnId = entry.turnId,
              let blockId = entry.blockId,
              let version = entry.version else {
            decision.error = "Connect to \(entry.machineName.isEmpty ? "the paired Mac" : entry.machineName) to decide."
            return
        }
        decision.isSubmitting = true
        decision.error = nil
        defer { decision.isSubmitting = false }
        do {
            _ = try await client.decideAction(ActionDecisionSpec(
                conversationId: entry.sessionId,
                turnId: turnId,
                blockId: blockId,
                decision: value,
                version: version
            ))
            model.notifications.record(value == .approve ? .approved : .denied, id: entry.id)
        } catch {
            decision.error = "Couldn't send the decision. Refresh and try again."
        }
    }

    private func submitAnswer() async {
        let value = decision.answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        guard let client = model.client(forMachineId: entry.machineId),
              let turnId = entry.turnId,
              let blockId = entry.blockId else {
            decision.error = "Connect to \(entry.machineName.isEmpty ? "the paired Mac" : entry.machineName) to answer."
            return
        }
        decision.isSubmitting = true
        decision.error = nil
        defer { decision.isSubmitting = false }
        do {
            _ = try await client.answerQuestion(QuestionAnswerSpec(
                conversationId: entry.sessionId,
                turnId: turnId,
                blockId: blockId,
                answer: [value]
            ))
            model.notifications.record(.answered, id: entry.id)
            decision.answer = ""
        } catch {
            decision.error = "Couldn't send the answer. Refresh and try again."
        }
    }
}

// MARK: - Detail

/// One notification, opened. This is where the full text lands: the APNs alert
/// carries only a correlation id by design (prompts, commands, paths, and error
/// bodies never transit Apple), so the body is read from the Mac and kept here.
/// Below the decision sits a provenance readout in the Instrument voice —
/// state, which Mac raised it, which conversation, when it arrived.
private struct NotificationDetailView: View {
    let model: AppModel
    let entryId: String
    var onOpenConversation: (ScoutNotification) -> Void

    @Environment(\.scoutLayout) private var layout
    @State private var decision = NotificationDecision()

    private var entry: ScoutNotification? { model.notifications.entry(id: entryId) }

    var body: some View {
        ScrollView {
            if let entry {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    NotificationMetaLine(entry: entry)

                    Text(entry.title)
                        .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                        .foregroundStyle(ScoutVibe.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    if !entry.summary.isEmpty, entry.summary != entry.title {
                        Text(entry.summary)
                            .font(HudFont.ui(HudTextSize.base))
                            .foregroundStyle(ScoutInk.muted)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let detail = entry.detail?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !detail.isEmpty, detail != entry.summary {
                        Text(detail)
                            .font(HudFont.mono(HudTextSize.xs))
                            .foregroundStyle(ScoutVibe.ink)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(HudSpacing.md)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ScoutSurface.inset)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
                            )
                    }

                    if entry.isOpen {
                        NotificationActions(
                            model: model,
                            entry: entry,
                            decision: $decision,
                            onOpenChat: { onOpenConversation(entry) }
                        )
                    }

                    triage(entry)
                    provenance(entry)

                    // An open ask already leads with "Open chat"; a second
                    // button to the same place is noise.
                    if !entry.sessionId.isEmpty, !(entry.isOpen && entry.isConversationAsk) {
                        Button { onOpenConversation(entry) } label: {
                            HStack(spacing: HudSpacing.xs) {
                                Text("Open conversation")
                                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                                Glyphic.chevron(.trailing, size: 11)
                            }
                            .foregroundStyle(ScoutVibe.ink)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, HudSpacing.sm)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ScoutSurface.raised)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
                            )
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, layout.surfacePadding)
                .padding(.vertical, HudSpacing.lg)
            } else {
                ScoutEmptyState(
                    title: "Notification unavailable",
                    subtitle: "This entry is no longer in the ledger.",
                    icon: "bell.slash"
                )
                .padding(HudSpacing.xxl)
            }
        }
        .background(ScoutPalette.bg.ignoresSafeArea())
        .navigationTitle("Notification")
        .navigationBarTitleDisplayMode(.inline)
    }

    /// The triage pair, set apart from the decision controls by its own rule so
    /// a Dismiss is never a mis-tap on an Approve. Each says what it does in
    /// the line beside it — Dismiss sends the agent nothing, and Archive is
    /// reversible, so neither has to be guessed at.
    @ViewBuilder
    private func triage(_ entry: ScoutNotification) -> some View {
        let store = model.notifications
        VStack(spacing: 0) {
            Rectangle()
                .fill(ScoutHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
                .padding(.bottom, HudSpacing.sm)
            HStack(spacing: HudSpacing.md) {
                Button {
                    if entry.isOpen {
                        store.dismiss(id: entry.id)
                    } else if entry.isArchived {
                        store.unarchive(id: entry.id)
                    } else {
                        store.archive(id: entry.id)
                    }
                } label: {
                    Text(entry.isOpen ? "Dismiss" : (entry.isArchived ? "Unarchive" : "Archive"))
                        .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                        .foregroundStyle(ScoutInk.muted)
                        .padding(.horizontal, HudSpacing.md)
                        .padding(.vertical, 5)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                Text(entry.isOpen
                     ? "clears your queue · sends nothing"
                     : (entry.isArchived ? "back into the log" : "out of the log, still recoverable"))
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutInk.dim)
                Spacer(minLength: 0)
            }
        }
    }

    /// Stat readouts, not boxes: a dot-led key on the left, the value right —
    /// the Instrument grammar the inspector uses elsewhere.
    private func provenance(_ entry: ScoutNotification) -> some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(ScoutHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
                .padding(.bottom, HudSpacing.sm)
            provenanceRow("state", value: stateValue(entry), accent: entry.isOpen)
            if !entry.machineName.isEmpty {
                provenanceRow("raised by", value: entry.machineName)
            }
            if !entry.sessionName.isEmpty {
                provenanceRow("conversation", value: entry.sessionName)
            }
            if let age = ScoutTimestamp.relativeAge(since: entry.arrivedAt) {
                provenanceRow("arrived", value: age)
            }
        }
    }

    private func stateValue(_ entry: ScoutNotification) -> String {
        let label = NotificationsStore.stateLabel(entry)
        guard let qualifier = NotificationsStore.stateQualifier(entry) else { return label }
        return "\(label) · \(qualifier)"
    }

    private func provenanceRow(_ key: String, value: String, accent: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
            Text(key.uppercased())
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .tracking(0.9)
                .foregroundStyle(ScoutInk.dim)
            Spacer(minLength: HudSpacing.sm)
            Text(value)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(accent ? ScoutVibe.accent : ScoutInk.muted)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .padding(.vertical, 3)
    }
}

// MARK: - Entry content helpers

private extension ScoutNotification {
    /// The one line worth showing inline from the payload — a command, a path,
    /// or the first line of an error body.
    var payloadLine: String? {
        guard let detail = detail?.trimmingCharacters(in: .whitespacesAndNewlines),
              !detail.isEmpty, detail != summary else { return nil }
        return detail.split(separator: "\n", maxSplits: 1).first.map(String.init)
    }
}
