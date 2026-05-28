import SwiftUI

struct ScoutAssistantView: View {
    @Environment(ConnectionManager.self) private var connection

    @State private var assistantAgent: MobileAgentSummary?
    @State private var conversationId: String?
    @State private var snapshot: SessionState?
    @State private var pendingMessages: [ScoutAssistantMessage] = []
    @State private var draft = ""
    @State private var sendError: String?
    @State private var isLoading = false
    @State private var isSending = false
    @FocusState private var composerFocused: Bool

    private let replyPollTimeout: TimeInterval = 75
    private static let slashCommands: [ScoutAssistantSlashCommand] = [
        ScoutAssistantSlashCommand(
            name: "help",
            arguments: nil,
            summary: "Show Scoutbot commands.",
            systemImage: "questionmark.circle"
        ),
        ScoutAssistantSlashCommand(
            name: "agents",
            arguments: nil,
            summary: "List known agents.",
            systemImage: "person.2"
        ),
        ScoutAssistantSlashCommand(
            name: "status",
            arguments: nil,
            summary: "Summarize fleet activity.",
            systemImage: "waveform.path.ecg"
        ),
        ScoutAssistantSlashCommand(
            name: "recent",
            arguments: "@agent",
            summary: "Show recent agent messages.",
            systemImage: "clock"
        ),
        ScoutAssistantSlashCommand(
            name: "doing",
            arguments: "@agent",
            summary: "Show active agent work.",
            systemImage: "bolt"
        ),
        ScoutAssistantSlashCommand(
            name: "flight",
            arguments: "id",
            summary: "Inspect a flight.",
            systemImage: "paperplane"
        )
    ]

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var messages: [ScoutAssistantMessage] {
        snapshotMessages + pendingMessages
    }

    private var messageScrollSignature: String {
        messages
            .map { "\($0.id):\($0.body.count):\($0.deliveryState.scrollKey)" }
            .joined(separator: "|")
    }

    private var slashCommandQuery: String? {
        guard draft.hasPrefix("/") else { return nil }
        let query = draft.dropFirst()
        guard !query.contains(where: { $0.isWhitespace }) else { return nil }
        return String(query).lowercased()
    }

    private var slashCommandSuggestions: [ScoutAssistantSlashCommand] {
        guard let query = slashCommandQuery else { return [] }
        if query.isEmpty {
            return Self.slashCommands
        }
        return Self.slashCommands
            .filter { command in
                command.name.hasPrefix(query)
                    || command.usage.lowercased().contains(query)
                    || command.summary.lowercased().contains(query)
            }
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            Divider()
                .background(ScoutColors.divider)

            messageList

            if let sendError {
                errorBanner(sendError)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            if !slashCommandSuggestions.isEmpty {
                slashCommandSuggestionsStrip
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            composer
                .padding(.bottom, 72)
        }
        .background(ScoutColors.backgroundAdaptive)
        .task {
            await loadAssistant()
        }
        .onChange(of: connection.state) { _, state in
            guard state == .connected else { return }
            Task { await loadAssistant() }
        }
    }

    private var header: some View {
        HStack(spacing: ScoutSpacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                    .fill(ScoutColors.surfaceRaisedAdaptive)
                    .frame(width: 34, height: 34)

                Image(systemName: "sparkles")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(ScoutColors.accent)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text("Scoutbot")
                    .font(ScoutTypography.body(15, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)

                HStack(spacing: 5) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 6, height: 6)

                    Text(statusText)
                        .font(ScoutTypography.code(10, weight: .medium))
                        .foregroundStyle(ScoutColors.textMuted)
                }
            }

            Spacer()

            Button {
                Task { await refreshSnapshot(showErrors: true) }
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!isConnected || isLoading)
            .accessibilityLabel("Refresh Scoutbot")
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.top, ScoutSpacing.lg)
        .padding(.bottom, ScoutSpacing.sm)
        .background(ScoutColors.surfaceRaisedAdaptive)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: ScoutSpacing.sm) {
                    Color.clear.frame(height: ScoutSpacing.md)

                    if messages.isEmpty {
                        emptyState
                    } else {
                        ForEach(messages) { message in
                            messageRow(message)
                                .id(message.id)
                        }
                    }

                    Color.clear
                        .frame(height: ScoutSpacing.lg)
                        .id("assistant-bottom")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messageScrollSignature) { _, _ in
                scrollToBottom(proxy, animated: true)
            }
            .task {
                scrollToBottom(proxy, animated: false)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.md) {
            if isLoading {
                ProgressView()
                    .controlSize(.regular)
                    .tint(ScoutColors.accent)
            } else {
                Image(systemName: "sparkles")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }

            Text(emptyStateText)
                .font(ScoutTypography.body(14, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, ScoutSpacing.xxl)
        .padding(.top, 96)
    }

    private func messageRow(_ message: ScoutAssistantMessage) -> some View {
        HStack(alignment: .bottom) {
            if message.isOutbound {
                Spacer(minLength: 54)
            }

            VStack(alignment: message.isOutbound ? .trailing : .leading, spacing: 4) {
                if !message.isOutbound {
                    Text("Scoutbot")
                        .font(ScoutTypography.code(9, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                bubble(message)

                HStack(spacing: 5) {
                    Text(RelativeTime.string(from: message.createdAt))
                        .font(ScoutTypography.code(9))
                        .foregroundStyle(ScoutColors.textMuted)

                    if message.isOutbound {
                        deliveryGlyph(message.deliveryState)
                    }
                }
            }

            if !message.isOutbound {
                Spacer(minLength: 54)
            }
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.xs)
    }

    private func bubble(_ message: ScoutAssistantMessage) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: ScoutSpacing.sm) {
            if message.deliveryState == .working {
                ProgressView()
                    .controlSize(.mini)
                    .scaleEffect(0.78)
                    .tint(ScoutColors.accent)
            }

            Text(message.body)
                .font(ScoutTypography.body(13))
                .foregroundStyle(message.isOutbound ? .white : ScoutColors.textPrimary)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 7)
        .background {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(message.isOutbound ? AnyShapeStyle(userBubbleGradient) : AnyShapeStyle(ScoutColors.surfaceRaisedAdaptive))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.white.opacity(message.isOutbound ? 0.08 : 0.02), lineWidth: 0.5)
        }
    }

    private var slashCommandSuggestionsStrip: some View {
        VStack(spacing: 0) {
            ForEach(Array(slashCommandSuggestions.enumerated()), id: \.element.id) { index, command in
                Button {
                    completeSlashCommand(command)
                } label: {
                    HStack(spacing: ScoutSpacing.md) {
                        Image(systemName: command.systemImage)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(ScoutColors.textMuted)
                            .frame(width: 18)

                        Text(command.usage)
                            .font(ScoutTypography.code(12, weight: .semibold))
                            .foregroundStyle(ScoutColors.textPrimary)
                            .lineLimit(1)

                        Text(command.summary)
                            .font(ScoutTypography.caption(11))
                            .foregroundStyle(ScoutColors.textMuted)
                            .lineLimit(1)

                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(command.usage)
                .accessibilityHint(command.summary)

                if index < slashCommandSuggestions.count - 1 {
                    Rectangle()
                        .fill(ScoutColors.divider)
                        .frame(height: 0.5)
                        .padding(.leading, 42)
                }
            }
        }
        .background(ScoutColors.surfaceRaisedAdaptive)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ScoutColors.border.opacity(0.25))
                .frame(height: 0.5)
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: ScoutSpacing.sm) {
            TextField("Message Scoutbot", text: $draft, axis: .vertical)
                .font(ScoutTypography.body(15))
                .foregroundStyle(ScoutColors.textPrimary)
                .lineLimit(1...5)
                .focused($composerFocused)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.sentences)
                .padding(.horizontal, ScoutSpacing.md)
                .padding(.vertical, 9)
                .background {
                    RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                        .fill(ScoutColors.surfaceAdaptive)
                }

            Button {
                Task { await sendMessage() }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 29, weight: .regular))
                    .foregroundStyle(canSend ? ScoutColors.accent : ScoutColors.textMuted)
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.sm)
        .background {
            Color.clear
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 0))
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ScoutColors.border.opacity(0.18))
                .frame(height: 0.5)
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        let action = {
            proxy.scrollTo("assistant-bottom", anchor: .bottom)
        }
        if animated {
            withAnimation(.easeOut(duration: 0.18), action)
        } else {
            action()
        }
    }

    private func completeSlashCommand(_ command: ScoutAssistantSlashCommand) {
        draft = command.insertionText
        composerFocused = true
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold))
            Text(message)
                .font(ScoutTypography.caption(12, weight: .medium))
                .lineLimit(2)
            Spacer()
            Button {
                withAnimation { sendError = nil }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.sm)
        .background(ScoutColors.ledRed.opacity(0.88))
    }

    private var canSend: Bool {
        isConnected
            && !isSending
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var emptyStateText: String {
        if !isConnected { return "Scout is offline." }
        if isLoading { return "Loading Scoutbot." }
        if assistantAgent == nil { return "Scoutbot is unavailable." }
        return "Scoutbot is ready."
    }

    private var statusText: String {
        if !isConnected { return "offline" }
        if isLoading { return "loading" }
        return assistantAgent?.statusLabel.lowercased() ?? "ready"
    }

    private var statusColor: Color {
        if !isConnected { return ScoutColors.ledRed }
        if isLoading { return ScoutColors.ledAmber }
        switch assistantAgent?.state {
        case "working": return ScoutColors.ledAmber
        case "offline": return ScoutColors.textMuted
        default: return ScoutColors.ledGreen
        }
    }

    private var userBubbleGradient: LinearGradient {
        LinearGradient(
            colors: [ScoutColors.userBubbleStart, ScoutColors.userBubbleEnd],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var snapshotMessages: [ScoutAssistantMessage] {
        guard let snapshot else { return [] }
        return snapshot.turns.compactMap { turn in
            let body = turn.blocks
                .map(\.block)
                .sorted { $0.index < $1.index }
                .compactMap { block in
                    block.text?.trimmedNonEmpty ?? block.message?.trimmedNonEmpty
                }
                .joined(separator: "\n\n")
                .trimmedNonEmpty

            guard let body else { return nil }
            return ScoutAssistantMessage(
                id: turn.id,
                body: body,
                createdAt: Date(timeIntervalSince1970: Double(turn.startedAt) / 1000.0),
                isOutbound: turn.isUserTurn == true,
                deliveryState: turn.status == .streaming ? .working : .sent
            )
        }
    }

    @MainActor
    private func loadAssistant() async {
        guard isConnected else {
            snapshot = nil
            assistantAgent = nil
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let agent = try await resolveScoutbotAgent()
            assistantAgent = agent
            conversationId = agent.sessionId ?? agent.id
            await refreshSnapshot(showErrors: false)
        } catch {
            sendError = error.scoutUserFacingMessage
        }
    }

    @MainActor
    @discardableResult
    private func refreshSnapshot(showErrors: Bool) async -> Bool {
        guard isConnected else { return false }

        do {
            let id = conversationId ?? assistantAgent?.sessionId ?? assistantAgent?.id ?? "scoutbot"
            snapshot = try await connection.getSnapshot(id, limit: 80)
            return true
        } catch {
            if isMissingConversation(error) {
                snapshot = nil
                return true
            }
            if showErrors {
                sendError = error.scoutUserFacingMessage
            }
            return false
        }
    }

    @MainActor
    private func sendMessage() async {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, isConnected, !isSending else { return }

        draft = ""
        sendError = nil
        isSending = true

        let optimisticId = "local-\(UUID().uuidString)"
        pendingMessages.append(
            ScoutAssistantMessage(
                id: optimisticId,
                body: body,
                createdAt: Date(),
                isOutbound: true,
                deliveryState: .sending
            )
        )

        do {
            let sendStartedAt = Date()
            let agent: MobileAgentSummary
            if let existingAgent = assistantAgent {
                agent = existingAgent
            } else {
                agent = try await resolveScoutbotAgent()
            }
            assistantAgent = agent
            let result = try await connection.sendDirectMessage(
                agentId: agent.id,
                body: body,
                harness: nil
            )
            conversationId = result.conversationId
            updatePendingMessage(id: optimisticId, deliveryState: .sent)

            if await refreshSnapshot(showErrors: false) {
                pendingMessages.removeAll { $0.id == optimisticId }
            }

            await pollForReply(startedAfter: sendStartedAt)
        } catch {
            updatePendingMessage(id: optimisticId, deliveryState: .failed)
            sendError = error.scoutUserFacingMessage
        }

        isSending = false
    }

    @MainActor
    private func pollForReply(startedAfter sendDate: Date) async {
        let deadline = Date().addingTimeInterval(replyPollTimeout)
        while Date() < deadline {
            try? await Task.sleep(for: .milliseconds(900))
            guard await refreshSnapshot(showErrors: false) else { continue }
            if latestAssistantMessageDate(after: sendDate) != nil {
                return
            }
            if snapshot?.currentTurnId == nil && latestAssistantMessageDate(after: sendDate.addingTimeInterval(-2)) != nil {
                return
            }
        }
    }

    private func latestAssistantMessageDate(after date: Date) -> Date? {
        snapshotMessages
            .filter { !$0.isOutbound && $0.deliveryState != .working && $0.createdAt >= date }
            .map(\.createdAt)
            .max()
    }

    private func updatePendingMessage(id: String, deliveryState: ScoutAssistantMessage.DeliveryState) {
        guard let index = pendingMessages.firstIndex(where: { $0.id == id }) else { return }
        pendingMessages[index].deliveryState = deliveryState
    }

    private func deliveryGlyph(_ state: ScoutAssistantMessage.DeliveryState) -> some View {
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
            case .working:
                EmptyView()
            case .failed:
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(ScoutColors.ledRed)
            }
        }
    }

    private func resolveScoutbotAgent() async throws -> MobileAgentSummary {
        let exactMatches = try await connection.listMobileAgents(query: "scoutbot", limit: 20)
        if let exact = exactMatches.first(where: isScoutbotAgent) {
            return exact
        }

        let scoutMatches = try await connection.listMobileAgents(query: "scout", limit: 50)
        if let scout = scoutMatches.first(where: isScoutbotAgent) {
            return scout
        }

        throw ConnectionError.rpcError(
            code: -32602,
            message: "Scoutbot is not registered on your Mac yet."
        )
    }

    private func isScoutbotAgent(_ agent: MobileAgentSummary) -> Bool {
        let id = agent.id.lowercased()
        let title = agent.title.lowercased()
        let selector = agent.resolvedSelector?.lowercased()
        let defaultSelector = agent.defaultSelector?.lowercased()

        return id == "scoutbot"
            || selector == "scoutbot"
            || selector == "@scoutbot"
            || defaultSelector == "scoutbot"
            || defaultSelector == "@scoutbot"
            || title == "scoutbot"
            || title == "scout"
    }

    private func isMissingConversation(_ error: Error) -> Bool {
        error.scoutUserFacingMessage.localizedCaseInsensitiveContains("Unknown mobile session")
            || error.localizedDescription.localizedCaseInsensitiveContains("Unknown mobile session")
    }
}

private struct ScoutAssistantMessage: Identifiable, Equatable {
    enum DeliveryState: Equatable {
        case sending
        case sent
        case working
        case failed

        var scrollKey: String {
            switch self {
            case .sending: return "sending"
            case .sent: return "sent"
            case .working: return "working"
            case .failed: return "failed"
            }
        }
    }

    let id: String
    let body: String
    let createdAt: Date
    let isOutbound: Bool
    var deliveryState: DeliveryState
}

private struct ScoutAssistantSlashCommand: Identifiable, Equatable {
    let name: String
    let arguments: String?
    let summary: String
    let systemImage: String

    var id: String { name }

    var usage: String {
        if let arguments {
            return "/\(name) \(arguments)"
        }
        return "/\(name)"
    }

    var insertionText: String {
        arguments == nil ? "/\(name)" : "/\(name) "
    }
}
