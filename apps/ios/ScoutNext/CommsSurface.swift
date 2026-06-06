import SwiftUI
import UIKit
import HudsonUI
import HudsonVoice
import ScoutCapabilities

/// Comms — the operator's window into the mesh: shared **Channels** and 1:1
/// **Direct Messages** with agents. A grouped, glanceable list (last message +
/// who + age + unread) that pushes into a thread where the operator posts as
/// themselves. Shares the broker client; reloads when the bridge connects.
struct CommsSurface: View {
    let client: any ScoutBrokerClient
    var reloadToken: Int = 0

    @State private var conversations: [CommsConversation] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var route: CommsConversation?
    /// Lowercased display names of agents the broker reports as live — drives the
    /// row's "working" spinner. A real signal, refreshed on every load.
    @State private var liveAgents: Set<String> = []

    var body: some View {
        ScrollView {
            if isLoading {
                HudEmptyState(title: "Loading comms", icon: "bubble.left.and.bubble.right")
                    .frame(maxWidth: .infinity)
                    .padding(.top, HudSpacing.huge)
                    .padding(HudSpacing.xxl)
            } else if conversations.isEmpty {
                HudEmptyState(
                    title: "No conversations",
                    subtitle: "Channels and DMs with your agents will appear here.",
                    icon: "bubble.left.and.bubble.right"
                )
                .frame(maxWidth: .infinity)
                .padding(.top, HudSpacing.huge)
                .padding(HudSpacing.xxl)
            } else {
                // One list: channels and DMs interleave by recency. The `#`
                // glyph is the only thing that says "channel" — no section split.
                LazyVStack(spacing: 0) {
                    HudField("Search conversations", text: $searchText, icon: "magnifyingglass")
                        .padding(.horizontal, HudSpacing.xxl)
                        .padding(.top, HudSpacing.lg)
                        .padding(.bottom, HudSpacing.lg)
                    ForEach(Array(filtered.enumerated()), id: \.element.id) { index, convo in
                        CommsRow(
                            conversation: convo,
                            client: client,
                            showDivider: index < filtered.count - 1,
                            liveAgents: liveAgents
                        ) { route = convo }
                    }
                }
            }
        }
        .refreshable { await load() }
        .task(id: reloadToken) { await load() }
        .navigationDestination(item: $route) { convo in
            CommsThreadView(
                client: client,
                conversation: convo,
                onClose: { route = nil },
                onRead: { await markRead(convo.id) }
            )
        }
    }

    /// Opening a thread clears its unread badge: drop the count locally so the row
    /// is already caught up when the operator pops back, then tell the broker to
    /// advance the operator's read cursor. Best-effort — a failed write just means
    /// the badge returns on the next list pull.
    private func markRead(_ conversationId: String) async {
        if let idx = conversations.firstIndex(where: { $0.id == conversationId }),
           conversations[idx].unreadCount != 0 {
            conversations[idx].unreadCount = 0
        }
        _ = try? await client.markConversationRead(conversationId: conversationId)
    }

    // MARK: - Filtering

    private var filtered: [CommsConversation] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return conversations }
        return conversations.filter { c in
            ([c.title, c.lastMessagePreview, c.lastMessageAuthor].compactMap { $0?.lowercased() }
                + c.participants.map { $0.lowercased() })
                .contains { $0.contains(q) }
        }
    }

    private func load() async {
        isLoading = true
        var rows = (try? await client.listConversations(kind: nil, limit: 100)) ?? []
        #if DEBUG
        if rows.isEmpty, ProcessInfo.processInfo.environment["SCOUTNEXT_DEMO"] == "1" {
            rows = CommsSurface.demoConversations()
        }
        #endif
        conversations = rows.sorted { ($0.lastMessageAt ?? .distantPast) > ($1.lastMessageAt ?? .distantPast) }
        // Live-agent set powers the "working" spinner — match a conversation's
        // counterpart against agents the broker currently reports as live.
        let agents = (try? await client.listAgents(query: nil, limit: 60)) ?? []
        liveAgents = Set(agents.filter { $0.state == .live }.map { $0.title.lowercased() })
        isLoading = false
    }
}

// MARK: - Conversation row

private struct CommsRow: View {
    let conversation: CommsConversation
    let client: any ScoutBrokerClient
    var showDivider: Bool = true
    var liveAgents: Set<String> = []
    let onTap: () -> Void

    private var isChannel: Bool {
        conversation.kind == .channel || conversation.kind == .system
    }

    private var unread: Bool { conversation.unreadCount > 0 }

    /// Only channels/threads/groups/system carry a leading type glyph. DMs (the
    /// vast majority) used to reserve a blank slot here, which just shoved every
    /// title ~one glyph off the content margin for a column that drew nothing —
    /// so they now render with no leading element and the title sits flush left.
    private var showsTypeGlyph: Bool {
        switch conversation.kind {
        case .direct, .unknown: return false
        default: return true
        }
    }

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 0) {
                HStack(spacing: HudSpacing.md) {
                    // Left: conversation TYPE — a hand-drawn glyph, the list's
                    // rhythm — but only when it actually marks something.
                    if showsTypeGlyph {
                        CommsTypeGlyph(kind: conversation.kind)
                            .foregroundStyle(HudPalette.muted)
                    }

                    Text(displayTitle)
                        .font(HudFont.ui(HudTextSize.md, weight: unread ? .semibold : .medium))
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        // Fixed ~third-of-screen column: names never dominate, and a
                        // constant width lines the status separators up in a column.
                        .frame(width: 140, alignment: .leading)

                    // Middle: STATUS — separates the name from the detail AND says
                    // what kind the detail is. Idle keeps a faint middot so the
                    // name | detail split never wobbles.
                    CommsStatusGlyph(status: status)
                        .frame(width: 16)

                    if let preview = previewText {
                        Text(preview)
                            .font(HudFont.ui(HudTextSize.sm))
                            .foregroundStyle(HudPalette.muted)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        Spacer(minLength: 0)
                    }

                    if let age = relativeAge(conversation.lastMessageAt) {
                        Text(age)
                            .font(HudFont.mono(HudTextSize.xs))
                            .monospacedDigit()
                            .foregroundStyle(HudPalette.muted)
                    }
                    if unread {
                        Text("\(conversation.unreadCount)")
                            .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(HudPalette.bg)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(HudPalette.accent))
                    }
                }
                .padding(.horizontal, HudSpacing.xxl)
                .padding(.vertical, HudSpacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
                // Unread rows lift on a faint *neutral* tint — standout without
                // turning the screen green.
                .background(unread ? HudPalette.ink.opacity(0.05) : Color.clear)
                // …and carry a slim accent rail at the leading edge for priority.
                .overlay(alignment: .leading) {
                    if unread {
                        RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                            .fill(HudPalette.accent)
                            .frame(width: 3)
                            .padding(.vertical, HudSpacing.lg)
                            .padding(.leading, HudSpacing.sm)
                    }
                }

                if showDivider {
                    Rectangle()
                        .fill(HudPalette.ink.opacity(0.06))
                        .frame(height: 0.5)
                        // Inset under the name (past the type glyph) for a list read.
                        .padding(.leading, HudSpacing.huge + HudSpacing.md)
                }
            }
        }
        .buttonStyle(.plain)
        // Glance → peek → open. Long-press floats a card with the FULL (un-clipped)
        // name + the last few messages, so the capped name is one press from legible.
        .contextMenu {
            Button { onTap() } label: { Label("Open", systemImage: "bubble.left.and.bubble.right") }
            Button {
                UIPasteboard.general.string = displayTitle
            } label: {
                Label("Copy name", systemImage: "doc.on.doc")
            }
        } preview: {
            CommsPeekCard(client: client, conversation: conversation, fullTitle: displayTitle)
        }
    }

    /// Live status, drawn as the name↔detail separator. Every branch maps to a
    /// real signal — no content sniffing:
    ///   ask      — last message is a declared `[ask:…]` to you (needs you)
    ///   working  — the counterpart agent is currently live (broker agent state)
    ///   awaiting — you spoke last, waiting on them
    private var status: CommsStatus {
        if let raw = conversation.lastMessagePreview?
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
           raw.hasPrefix("[ask:") {
            return .ask
        }
        if let who = conversation.participants.first?.lowercased(), liveAgents.contains(who) {
            return .working
        }
        if let author = conversation.lastMessageAuthor,
           author.caseInsensitiveCompare("You") == .orderedSame {
            return .awaiting
        }
        return .idle
    }

    private var displayTitle: String {
        // DMs read by the counterpart, not the auto-generated title.
        isChannel ? conversation.title : (conversation.participants.first ?? conversation.title)
    }

    private var previewText: String? {
        guard let raw = conversation.lastMessagePreview, !raw.isEmpty else {
            return isChannel ? "No messages yet" : nil
        }
        let cleaned = CommsRow.cleanPreview(raw)
        // Prefix the speaker only when it adds something — i.e. not when the DM
        // counterpart is just talking under their own name.
        if let author = conversation.lastMessageAuthor, !author.isEmpty, author != displayTitle {
            return "\(author): \(cleaned)"
        }
        return cleaned
    }

    /// Drop our own routing envelope — leading `[ask:f-…]` / `[tag:…]` machine
    /// signatures — so the row shows the human sentence first.
    static func cleanPreview(_ s: String) -> String {
        var t = s
        if let r = t.range(of: "^\\s*(\\[[^\\]]*\\]\\s*)+", options: .regularExpression) {
            t.removeSubrange(r)
        }
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Peek card (long-press preview)

/// The floating preview behind a long-press: the full, un-clipped name + a kind
/// subtitle + the last few messages. Loads recent messages on demand so the peek
/// is a real glance into the thread, not just a bigger name.
private struct CommsPeekCard: View {
    let client: any ScoutBrokerClient
    let conversation: CommsConversation
    let fullTitle: String

    @State private var recent: [CommsMessage] = []
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(fullTitle)
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(2)
                if let subtitle {
                    Text(subtitle)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.muted)
                        .lineLimit(1)
                }
            }

            Rectangle().fill(HudPalette.ink.opacity(0.08)).frame(height: 0.5)

            if recent.isEmpty {
                Text(loaded ? "No messages yet" : "Loading…")
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(HudPalette.muted)
            } else {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    ForEach(recent) { message in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(message.authorLabel)
                                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                                .foregroundStyle(message.isOperator ? HudPalette.accent : HudPalette.muted)
                            Text(message.body)
                                .font(HudFont.ui(HudTextSize.sm))
                                .foregroundStyle(HudPalette.ink)
                                .lineLimit(3)
                                .multilineTextAlignment(.leading)
                        }
                    }
                }
            }
        }
        .padding(HudSpacing.xl)
        .frame(width: 300, alignment: .leading)
        .background(HudPalette.bg)
        .task {
            // oldest → newest; take the latest few for the peek.
            let msgs = (try? await client.conversationMessages(conversationId: conversation.id, limit: 24)) ?? []
            recent = Array(msgs.suffix(3))
            loaded = true
        }
    }

    private var subtitle: String? {
        switch conversation.kind {
        case .channel, .system: return conversation.topic ?? "channel"
        case .group: return conversation.participants.joined(separator: ", ")
        default: return "direct message"
        }
    }
}

// MARK: - Semantic glyphs

/// Conversation-type glyph (left of the name): a hand-drawn mark — not an SF
/// Symbol — only for the kinds where it earns its space. `#` channel · `•••`
/// group (dots = headcount) · `↳` thread · `✳` system. DMs are the majority and
/// a dot-per-row encodes nothing, so they get a blank slot — the column stays
/// reserved (names align) but isn't a wall of dots. Inherits the foreground ink.
private struct CommsTypeGlyph: View {
    let kind: CommsConversation.Kind

    var body: some View {
        Group {
            switch kind {
            case .channel:
                HashGlyph().stroke(style: Self.stroke)
            case .thread:
                ThreadGlyph().stroke(style: Self.stroke)
            case .system:
                AsteriskGlyph().stroke(style: Self.stroke)
            case .group:
                HStack(spacing: 2) {
                    ForEach(0..<3, id: \.self) { _ in Circle().frame(width: 3.5, height: 3.5) }
                }
            case .direct, .unknown:
                Color.clear
            }
        }
        .frame(width: 15, height: 15)
    }

    private static let stroke = StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round)
}

/// The conversation's live status, drawn as the name↔detail separator.
private enum CommsStatus { case ask, working, awaiting, idle }

/// Renders the separator: a real status glyph when there's something to say,
/// else a faint middot. Accent only on "needs you" and "working"; the rest
/// stays neutral so the list doesn't go green.
private struct CommsStatusGlyph: View {
    let status: CommsStatus

    var body: some View {
        switch status {
        case .ask:
            Text("?")
                .font(HudFont.mono(HudTextSize.sm, weight: .bold))
                .foregroundStyle(HudPalette.accent)
        case .working:
            BrailleSpinner()
                .foregroundStyle(HudPalette.accent)
        case .awaiting:
            Text("›")
                .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(HudPalette.muted)
        case .idle:
            Text("·")
                .font(HudFont.mono(HudTextSize.sm, weight: .bold))
                .foregroundStyle(HudPalette.dim)
        }
    }
}

/// CLI braille spinner — an agent that's live right now. `TimelineView` drives
/// the frame cycle off the clock, so there's no stored timer to manage.
private struct BrailleSpinner: View {
    private static let frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    private static let interval: TimeInterval = 0.09

    var body: some View {
        TimelineView(.periodic(from: .now, by: Self.interval)) { context in
            let step = Int(context.date.timeIntervalSinceReferenceDate / Self.interval)
            let frame = Self.frames[((step % Self.frames.count) + Self.frames.count) % Self.frames.count]
            Text(frame).font(HudFont.mono(HudTextSize.sm))
        }
    }
}

// MARK: - Glyph shapes (hand-drawn, not SF Symbols)

private struct HashGlyph: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let w = r.width, h = r.height
        // Two faintly-slanted verticals…
        p.move(to: CGPoint(x: w * 0.42, y: h * 0.16)); p.addLine(to: CGPoint(x: w * 0.34, y: h * 0.84))
        p.move(to: CGPoint(x: w * 0.70, y: h * 0.16)); p.addLine(to: CGPoint(x: w * 0.62, y: h * 0.84))
        // …crossed by two horizontals.
        p.move(to: CGPoint(x: w * 0.18, y: h * 0.40)); p.addLine(to: CGPoint(x: w * 0.84, y: h * 0.40))
        p.move(to: CGPoint(x: w * 0.16, y: h * 0.62)); p.addLine(to: CGPoint(x: w * 0.82, y: h * 0.62))
        return p
    }
}

private struct ThreadGlyph: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let w = r.width, h = r.height
        // Down then a turn to the right…
        p.move(to: CGPoint(x: w * 0.30, y: h * 0.16))
        p.addLine(to: CGPoint(x: w * 0.30, y: h * 0.52))
        p.addQuadCurve(to: CGPoint(x: w * 0.50, y: h * 0.70), control: CGPoint(x: w * 0.30, y: h * 0.70))
        p.addLine(to: CGPoint(x: w * 0.82, y: h * 0.70))
        // …with an arrowhead.
        p.move(to: CGPoint(x: w * 0.66, y: h * 0.54))
        p.addLine(to: CGPoint(x: w * 0.84, y: h * 0.70))
        p.addLine(to: CGPoint(x: w * 0.66, y: h * 0.86))
        return p
    }
}

private struct AsteriskGlyph: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let c = CGPoint(x: r.midX, y: r.midY)
        let rad = min(r.width, r.height) * 0.42
        for i in 0..<3 {
            let a = Double(i) * .pi / 3
            let dx = cos(a) * rad, dy = sin(a) * rad
            p.move(to: CGPoint(x: c.x - dx, y: c.y - dy))
            p.addLine(to: CGPoint(x: c.x + dx, y: c.y + dy))
        }
        return p
    }
}

// MARK: - Interactive swipe-to-go-back

/// Re-enables `UINavigationController`'s left-edge interactive pop gesture, which
/// iOS disables whenever a screen hides the system back button. Scoped: it grabs
/// the gesture's delegate while the host screen is on-stack and only allows the
/// swipe when there's something to pop.
private struct InteractivePopGestureEnabler: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> PopGestureController { PopGestureController() }
    func updateUIViewController(_ controller: PopGestureController, context: Context) {}
}

private final class PopGestureController: UIViewController, UIGestureRecognizerDelegate {
    override func didMove(toParent parent: UIViewController?) {
        super.didMove(toParent: parent)
        navigationController?.interactivePopGestureRecognizer?.delegate = self
        navigationController?.interactivePopGestureRecognizer?.isEnabled = true
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        (navigationController?.viewControllers.count ?? 0) > 1
    }
}

// MARK: - Thread

/// One conversation's messages + a composer. Operator posts land right-aligned
/// and accented; agents/system land left with an author label. Bodies render
/// through `MessageMarkupView` so code and markdown read correctly.
struct CommsThreadView: View {
    let client: any ScoutBrokerClient
    let conversation: CommsConversation
    let onClose: () -> Void
    /// Called once the thread is on screen so the list can clear the unread badge
    /// and the broker can advance the operator's read cursor. Defaults to a no-op.
    var onRead: () async -> Void = {}

    @State private var messages: [CommsMessage] = []
    @State private var isLoading = true
    @State private var composerText = ""
    @State private var isSending = false
    @Environment(HudDictation.self) private var voice
    @State private var micPulse = false
    @FocusState private var composerFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            transcript
        }
        .background(HudPalette.bg)
        .navigationBarBackButtonHidden(true)
        // Hiding the system back button (for our custom chevron) also disables
        // the native left-edge swipe-to-go-back. Re-enable it so the chevron is
        // optional, not the only way out of a thread.
        .background(InteractivePopGestureEnabler())
        .safeAreaInset(edge: .bottom) { composer }
        .task { await load(); await onRead() }
        .onAppear { voice.prepare() }
        .onDisappear { if voice.isListening { voice.cancel() } }
    }

    // MARK: Header

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
                Text(threadTitle)
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                if let sub = threadSubtitle {
                    Text(sub)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.muted)
                        .lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.vertical, HudSpacing.lg)
    }

    private var threadTitle: String {
        switch conversation.kind {
        case .channel, .system: return "# \(conversation.title)"
        default: return conversation.participants.first ?? conversation.title
        }
    }

    private var threadSubtitle: String? {
        switch conversation.kind {
        case .channel, .system:
            return conversation.topic ?? "channel"
        case .group:
            return conversation.participants.joined(separator: ", ")
        default:
            return "direct message"
        }
    }

    // MARK: Transcript

    private var transcript: some View {
        GeometryReader { geo in
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: HudSpacing.lg) {
                        if isLoading {
                            HudEmptyState(title: "Loading", icon: "bubble.left.and.bubble.right")
                                .frame(maxWidth: .infinity)
                                .padding(.top, HudSpacing.huge)
                        } else if messages.isEmpty {
                            HudEmptyState(
                                title: "No messages yet",
                                subtitle: "Say something to get the thread going.",
                                icon: "bubble.left"
                            )
                            .frame(maxWidth: .infinity)
                            .padding(.top, HudSpacing.huge)
                        } else {
                            ForEach(messages) { message in
                                CommsBubble(message: message).id(message.id)
                            }
                        }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(.horizontal, HudSpacing.xxl)
                    .padding(.vertical, HudSpacing.lg)
                    .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .bottomLeading)
                }
                .onChange(of: messages.count) { _, _ in
                    withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onChange(of: isLoading) { _, _ in proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
    }

    // MARK: Composer

    private var composer: some View {
        HStack(alignment: .bottom, spacing: HudSpacing.md) {
            micButton

            TextField(composerPlaceholder, text: $composerText, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...4)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(HudPalette.ink)
                .tint(HudPalette.accent)
                .focused($composerFocused)
                .onSubmit(send)
                .padding(.vertical, HudSpacing.xs)

            Button(action: send) {
                Glyphic.arrow(.top, size: 17)
                    .foregroundStyle(canSend ? HudPalette.bg : HudPalette.muted)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(canSend ? HudPalette.accent : HudSurface.inset))
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.leading, HudSpacing.lg)
        .padding(.trailing, HudSpacing.sm)
        .padding(.vertical, HudSpacing.sm)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(HudSurface.inset))
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
                    .stroke(micColor, style: StrokeStyle(lineWidth: voice.isListening ? 1.6 : 1.2, lineCap: .round, lineJoin: .round))
                    .frame(width: 15, height: 15)
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

    private var micColor: Color {
        switch voice.state {
        case .listening: return HudPalette.accent
        case .transcribing, .preparing: return HudPalette.muted
        case .unavailable: return HudPalette.dim.opacity(0.5)
        case .idle: return HudPalette.muted
        }
    }

    private var composerPlaceholder: String {
        switch voice.state {
        case .listening: return voice.partialText.isEmpty ? "Listening…" : voice.partialText
        case .transcribing: return "Transcribing…"
        case .preparing, .idle, .unavailable: return composerPrompt
        }
    }

    private var composerPrompt: String {
        switch conversation.kind {
        case .channel, .system: return "Message # \(conversation.title)…"
        default: return "Message \(conversation.participants.first ?? "agent")…"
        }
    }

    private func appendDictation(_ text: String) {
        composerText = composerText.isEmpty ? text : composerText + " " + text
    }

    private func updatePulse(for state: HudDictation.State) {
        micPulse = false
        if case .listening = state {
            withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) { micPulse = true }
        }
    }

    // MARK: Data

    private func load() async {
        isLoading = true
        var rows = (try? await client.conversationMessages(conversationId: conversation.id, limit: 200)) ?? []
        #if DEBUG
        if rows.isEmpty, ProcessInfo.processInfo.environment["SCOUTNEXT_DEMO"] == "1" {
            rows = CommsSurface.demoMessages(for: conversation)
        }
        #endif
        messages = rows
        isLoading = false
    }

    private func send() {
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        composerText = ""
        isSending = true
        // Optimistic echo so the operator sees their post immediately.
        let optimistic = CommsMessage(
            id: "local-\(UUID().uuidString)",
            conversationId: conversation.id,
            actorId: "operator",
            authorLabel: "You",
            authorKind: .person,
            body: text,
            createdAt: Date(),
            isOperator: true
        )
        messages.append(optimistic)
        Task {
            _ = try? await client.postMessage(conversationId: conversation.id, body: text, replyTo: nil)
            // Re-pull to reconcile the optimistic echo with the broker's record
            // (and surface any agent reply that already landed).
            if let fresh = try? await client.conversationMessages(conversationId: conversation.id, limit: 200), !fresh.isEmpty {
                messages = fresh
            }
            isSending = false
        }
    }
}

// MARK: - Message bubble

private struct CommsBubble: View {
    let message: CommsMessage

    var body: some View {
        HStack {
            if message.isOperator { Spacer(minLength: HudSpacing.huge) }
            VStack(alignment: message.isOperator ? .trailing : .leading, spacing: HudSpacing.xs) {
                if !message.isOperator {
                    HStack(spacing: HudSpacing.sm) {
                        Text(message.authorLabel)
                            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                            .foregroundStyle(authorColor)
                        Text(timeLabel)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(HudPalette.dim)
                    }
                }
                MessageMarkupView(text: message.body)
                    .padding(.horizontal, HudSpacing.lg)
                    .padding(.vertical, HudSpacing.md)
                    .background(
                        RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                            .fill(message.isOperator ? HudPalette.accent.opacity(0.16) : HudSurface.inset)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                            .stroke(message.isOperator ? HudPalette.accent.opacity(0.4) : HudHairline.subtle,
                                    lineWidth: HudStrokeWidth.standard)
                    )
            }
            if !message.isOperator { Spacer(minLength: HudSpacing.huge) }
        }
    }

    private var authorColor: Color {
        switch message.authorKind {
        case .agent: return HudPalette.accent
        case .system: return HudPalette.muted
        default: return HudPalette.ink
        }
    }

    private var timeLabel: String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: message.createdAt)
    }
}

// MARK: - Shared helpers

/// Compact relative age ("now" / "3m" / "2h" / "1d") for a row's right edge.
private func relativeAge(_ date: Date?) -> String? {
    guard let date else { return nil }
    let s = max(0, Int(Date().timeIntervalSince(date)))
    if s < 60 { return "now" }
    if s < 3600 { return "\(s / 60)m" }
    if s < 86_400 { return "\(s / 3600)h" }
    return "\(s / 86_400)d"
}

#if DEBUG
extension CommsSurface {
    /// Synthetic comms (DEBUG, `SCOUTNEXT_DEMO=1` only) so the surface can be
    /// seen on the simulator before the broker serves `mobile/comms/*`. Never ships.
    static func demoConversations() -> [CommsConversation] {
        let now = Date()
        return [
            CommsConversation(
                id: "channel.shared", kind: .channel, title: "shared",
                topic: "fleet-wide coordination",
                lastMessagePreview: "shipping the projects-first Home now — machine rail looks great",
                lastMessageAuthor: "broker-smith",
                lastMessageAt: now.addingTimeInterval(-90), messageCount: 42, unreadCount: 3
            ),
            CommsConversation(
                id: "channel.voice", kind: .channel, title: "voice",
                topic: "TTS + dictation",
                lastMessagePreview: "Parakeet warm-up no longer cancels on thread exit",
                lastMessageAuthor: "tail-tuner",
                lastMessageAt: now.addingTimeInterval(-1_500), messageCount: 11, unreadCount: 0
            ),
            CommsConversation(
                id: "dm.operator.broker-smith", kind: .direct, title: "broker-smith",
                participants: ["broker-smith"],
                lastMessagePreview: "Done — mobile/comms routes are wired in both mirrors.",
                lastMessageAuthor: "broker-smith",
                lastMessageAt: now.addingTimeInterval(-300), messageCount: 8, unreadCount: 1
            ),
            CommsConversation(
                id: "dm.operator.tail-tuner", kind: .direct, title: "tail-tuner",
                participants: ["tail-tuner"],
                lastMessagePreview: "You: can you confirm the firehose still streams?",
                lastMessageAuthor: "You",
                lastMessageAt: now.addingTimeInterval(-3_400), messageCount: 5, unreadCount: 0
            ),
        ]
    }

    static func demoMessages(for conversation: CommsConversation) -> [CommsMessage] {
        let now = Date()
        let other = conversation.participants.first ?? "broker-smith"
        return [
            CommsMessage(id: "d1", conversationId: conversation.id, actorId: other,
                         authorLabel: other, authorKind: .agent,
                         body: "Picking up the **comms surface** now. Channels + DMs, operator posts as you.",
                         createdAt: now.addingTimeInterval(-600)),
            CommsMessage(id: "d2", conversationId: conversation.id, actorId: "operator",
                         authorLabel: "You", authorKind: .person,
                         body: "Nice. Make sure code blocks render right:\n```swift\nlet x = 1\n```",
                         createdAt: now.addingTimeInterval(-540), isOperator: true),
            CommsMessage(id: "d3", conversationId: conversation.id, actorId: other,
                         authorLabel: other, authorKind: .agent,
                         body: "They do — `MessageMarkupView` handles fences + highlighting. Shipping it.",
                         createdAt: now.addingTimeInterval(-120)),
        ]
    }
}
#endif
