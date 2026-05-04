import SwiftUI

struct ChannelView: View {
    let channelId: String

    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var messages: [CommsMessage] = []
    @State private var draft: String = ""
    @State private var isSending = false
    @State private var openThreadId: String?
    @FocusState private var composerFocused: Bool

    private var channel: (name: String, memberCount: Int) {
        CommsSeed.channel(forId: channelId)
    }

    var body: some View {
        VStack(spacing: 0) {
            titleBar

            Divider()
                .background(ScoutColors.divider)

            messageList

            Divider()
                .background(ScoutColors.divider)

            composer
        }
        .background(ScoutColors.backgroundAdaptive)
        .task {
            messages = CommsSeed.channelMessages(forId: channelId)
        }
        .sheet(item: Binding(
            get: { openThreadId.map(ThreadIdentifier.init) },
            set: { openThreadId = $0?.id }
        )) { wrapper in
            ThreadSheet(threadId: wrapper.id)
        }
    }

    // MARK: - Title bar

    private var titleBar: some View {
        HStack(spacing: ScoutSpacing.md) {
            Text("#")
                .font(ScoutTypography.code(15, weight: .bold))
                .foregroundStyle(ScoutColors.textSecondary)
                .frame(width: 28, height: 28, alignment: .center)
                .background(
                    RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                        .fill(ScoutColors.surfaceAdaptive)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(channel.name)
                    .font(ScoutTypography.code(13, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)

                Text("\(channel.memberCount) \(channel.memberCount == 1 ? "member" : "members")")
                    .font(ScoutTypography.code(9, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
            }

            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.sm)
        .background(ScoutColors.surfaceRaisedAdaptive)
    }

    // MARK: - Messages

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: ScoutSpacing.sm) {
                    Color.clear.frame(height: ScoutSpacing.md)

                    ForEach(messages) { message in
                        messageRow(message)
                            .id(message.id)
                    }

                    Color.clear.frame(height: ScoutSpacing.md)
                        .id("channel-bottom")
                }
            }
            .onChange(of: messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo("channel-bottom", anchor: .bottom)
                }
            }
            .task {
                proxy.scrollTo("channel-bottom", anchor: .bottom)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func messageRow(_ message: CommsMessage) -> some View {
        HStack(alignment: .top, spacing: ScoutSpacing.md) {
            avatar(for: message)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: ScoutSpacing.sm) {
                    Text(message.senderName)
                        .font(ScoutTypography.code(11, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)

                    Text(RelativeTime.string(from: message.createdAt))
                        .font(ScoutTypography.code(9))
                        .foregroundStyle(ScoutColors.textMuted)

                    if message.isOutbound {
                        deliveryGlyph(for: message.deliveryState)
                    }
                }

                Text(message.body)
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if let threadId = message.threadId, message.replyCount > 0 {
                    Button {
                        openThreadId = threadId
                    } label: {
                        HStack(spacing: 4) {
                            Text("↳")
                                .font(ScoutTypography.code(11, weight: .bold))
                                .foregroundStyle(ScoutColors.accent)
                            Text("\(message.replyCount) \(message.replyCount == 1 ? "reply" : "replies")")
                                .font(ScoutTypography.code(10, weight: .medium))
                                .foregroundStyle(ScoutColors.accent)
                        }
                        .padding(.horizontal, ScoutSpacing.sm)
                        .padding(.vertical, 3)
                        .background(
                            Capsule(style: .continuous)
                                .fill(ScoutColors.accent.opacity(0.12))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, ScoutSpacing.lg)
    }

    private func avatar(for message: CommsMessage) -> some View {
        let initial = message.senderName.first.map { String($0).uppercased() } ?? "?"
        return RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
            .fill(ScoutColors.surfaceRaisedAdaptive)
            .frame(width: 24, height: 24)
            .overlay(
                Text(initial)
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
            )
    }

    private func deliveryGlyph(for state: MessageDeliveryState) -> some View {
        Group {
            switch state {
            case .sending:
                ProgressView()
                    .controlSize(.mini)
                    .scaleEffect(0.55)
                    .frame(width: 10, height: 10)
            case .sent:
                Image(systemName: "checkmark")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            case .seen:
                Image(systemName: "checkmark.circle")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
            case .replied:
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(ScoutColors.accent)
            case .failed:
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(ScoutColors.ledRed)
            }
        }
    }

    // MARK: - Composer

    private var composer: some View {
        HStack(alignment: .bottom, spacing: ScoutSpacing.sm) {
            TextField("Message #\(channel.name)", text: $draft, axis: .vertical)
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textPrimary)
                .lineLimit(1...5)
                .focused($composerFocused)
                .padding(.horizontal, ScoutSpacing.md)
                .padding(.vertical, ScoutSpacing.sm)
                .background(
                    RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                        .fill(ScoutColors.surfaceRaisedAdaptive)
                )

            Button {
                send()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 26, weight: .regular))
                    .foregroundStyle(canSend ? ScoutColors.accent : ScoutColors.textMuted)
            }
            .disabled(!canSend)
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.sm)
        .background(ScoutColors.surfaceRaisedAdaptive)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isSending
    }

    private func send() {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        let outbound = CommsMessage(
            id: UUID().uuidString,
            senderId: "me",
            senderName: "You",
            body: trimmed,
            createdAt: Date(),
            deliveryState: .sending,
            isOutbound: true,
            replyCount: 0,
            threadId: nil
        )
        messages.append(outbound)
        draft = ""
        isSending = true

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(350))
            updateDelivery(messageId: outbound.id, to: .sent)
            isSending = false
        }
    }

    private func updateDelivery(messageId: String, to state: MessageDeliveryState) {
        guard let index = messages.firstIndex(where: { $0.id == messageId }) else { return }
        let existing = messages[index]
        messages[index] = CommsMessage(
            id: existing.id,
            senderId: existing.senderId,
            senderName: existing.senderName,
            body: existing.body,
            createdAt: existing.createdAt,
            deliveryState: state,
            isOutbound: existing.isOutbound,
            replyCount: existing.replyCount,
            threadId: existing.threadId
        )
    }
}

// MARK: - Thread sheet

private struct ThreadIdentifier: Identifiable, Hashable {
    let id: String
}

private struct ThreadSheet: View {
    let threadId: String

    @Environment(\.dismiss) private var dismiss

    @State private var replies: [CommsMessage] = []
    @State private var isLoading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    loadingState
                } else if let error {
                    errorState(error)
                } else if replies.isEmpty {
                    emptyState
                } else {
                    replyList
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(ScoutColors.backgroundAdaptive)
            .navigationTitle("Thread")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                        .font(ScoutTypography.code(12, weight: .semibold))
                }
            }
            .task {
                await loadThread()
            }
        }
    }

    // Threads live on the recipient's node, so opening one may require a remote
    // hop. The simulated delay surfaces that loading state in the UI today.
    private func loadThread() async {
        isLoading = true
        error = nil
        try? await Task.sleep(for: .milliseconds(450))
        replies = CommsSeed.threadReplies(forThreadId: threadId)
        isLoading = false
    }

    private var replyList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: ScoutSpacing.md) {
                Color.clear.frame(height: ScoutSpacing.md)

                ForEach(replies) { reply in
                    HStack(alignment: .top, spacing: ScoutSpacing.md) {
                        RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                            .fill(ScoutColors.surfaceRaisedAdaptive)
                            .frame(width: 24, height: 24)
                            .overlay(
                                Text(reply.senderName.first.map { String($0).uppercased() } ?? "?")
                                    .font(ScoutTypography.code(10, weight: .semibold))
                                    .foregroundStyle(ScoutColors.textPrimary)
                            )

                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: ScoutSpacing.sm) {
                                Text(reply.senderName)
                                    .font(ScoutTypography.code(11, weight: .semibold))
                                    .foregroundStyle(ScoutColors.textPrimary)
                                Text(RelativeTime.string(from: reply.createdAt))
                                    .font(ScoutTypography.code(9))
                                    .foregroundStyle(ScoutColors.textMuted)
                            }

                            Text(reply.body)
                                .font(ScoutTypography.body(14))
                                .foregroundStyle(ScoutColors.textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, ScoutSpacing.lg)
                }

                Color.clear.frame(height: ScoutSpacing.lg)
            }
        }
    }

    private var loadingState: some View {
        VStack(spacing: ScoutSpacing.md) {
            ProgressView()
            Text("Fetching thread from recipient node...")
                .font(ScoutTypography.code(11))
                .foregroundStyle(ScoutColors.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.md) {
            Text("NO REPLIES")
                .font(ScoutTypography.code(11, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)
            Text("This thread is empty.")
                .font(ScoutTypography.body(13))
                .foregroundStyle(ScoutColors.textSecondary)
        }
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: ScoutSpacing.md) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 22))
                .foregroundStyle(ScoutColors.ledRed)
            Text(message)
                .font(ScoutTypography.code(11))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }
}
