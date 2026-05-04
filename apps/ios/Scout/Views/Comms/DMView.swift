import SwiftUI

struct DMView: View {
    let peerId: String

    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var messages: [CommsMessage] = []
    @State private var draft: String = ""
    @State private var isSending = false
    @FocusState private var composerFocused: Bool

    private var peer: CommsPeer {
        CommsSeed.peer(forId: peerId)
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
            messages = CommsSeed.messages(forPeerId: peerId)
        }
    }

    // MARK: - Title bar

    private var titleBar: some View {
        HStack(spacing: ScoutSpacing.md) {
            RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                .fill(ScoutColors.surfaceRaisedAdaptive)
                .frame(width: 28, height: 28)
                .overlay(
                    Text(peer.avatarInitial)
                        .font(ScoutTypography.code(12, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(peer.displayName)
                    .font(ScoutTypography.code(13, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)

                HStack(spacing: 4) {
                    Circle()
                        .fill(peer.isOnline ? ScoutColors.ledGreen : ScoutColors.textMuted)
                        .frame(width: 5, height: 5)

                    Text(peer.isOnline ? "online" : "offline")
                        .font(ScoutTypography.code(9, weight: .medium))
                        .foregroundStyle(ScoutColors.textMuted)

                    if peer.kind == .agent {
                        Text("·")
                            .foregroundStyle(ScoutColors.textMuted)
                        Text("agent")
                            .font(ScoutTypography.code(9, weight: .medium))
                            .foregroundStyle(ScoutColors.textMuted)
                    }
                }
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
                        .id("dm-bottom")
                }
            }
            .onChange(of: messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo("dm-bottom", anchor: .bottom)
                }
            }
            .task {
                proxy.scrollTo("dm-bottom", anchor: .bottom)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func messageRow(_ message: CommsMessage) -> some View {
        HStack {
            if message.isOutbound { Spacer(minLength: 60) }

            VStack(alignment: message.isOutbound ? .trailing : .leading, spacing: 3) {
                if !message.isOutbound {
                    Text(message.senderName)
                        .font(ScoutTypography.code(10, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                bubble(for: message)

                HStack(spacing: 4) {
                    Text(RelativeTime.string(from: message.createdAt))
                        .font(ScoutTypography.code(9))
                        .foregroundStyle(ScoutColors.textMuted)

                    if message.isOutbound {
                        deliveryGlyph(for: message.deliveryState)
                    }
                }
            }

            if !message.isOutbound { Spacer(minLength: 60) }
        }
        .padding(.horizontal, ScoutSpacing.lg)
    }

    private func bubble(for message: CommsMessage) -> some View {
        Group {
            if message.isOutbound {
                Text(message.body)
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: [ScoutColors.userBubbleStart, ScoutColors.userBubbleEnd],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                    }
            } else {
                Text(message.body)
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background {
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(ScoutColors.surfaceRaisedAdaptive)
                    }
            }
        }
    }

    // The "seen" tick lands before the full reply (a known UX gap), so we render
    // three distinct states: sent (single tick), seen (double tick, muted),
    // replied (double tick, accent). Sending shows a hairline progress dot.
    private func deliveryGlyph(for state: MessageDeliveryState) -> some View {
        Group {
            switch state {
            case .sending:
                ProgressView()
                    .controlSize(.mini)
                    .scaleEffect(0.6)
                    .frame(width: 12, height: 10)
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
            TextField("Message \(peer.displayName)", text: $draft, axis: .vertical)
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

        // Optimistic state machine: sending → sent → seen. Real broker wiring
        // arrives later; for now we honor the contract that "seen" precedes a
        // reply so the UI demonstrates the gap state explicitly.
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(350))
            updateDelivery(messageId: outbound.id, to: .sent)
            try? await Task.sleep(for: .milliseconds(900))
            updateDelivery(messageId: outbound.id, to: .seen)
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
