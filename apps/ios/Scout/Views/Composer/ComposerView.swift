// ComposerView — Voice-first input with tap-on/tap-off mic.
//
// Tray: [discovery] — [mic] — [keyboard]
// Mic toggles recording. After transcription, editable text field + send.
// Keyboard only when explicitly toggled.

import SwiftUI

struct ComposerSendRequest: Sendable {
    let text: String
    let model: String?
    let effort: String?
}

private struct SessionComposerPreferences: Codable, Sendable {
    var model: String?
    var effort: String
}

private final class SessionPreferenceStore: @unchecked Sendable {
    static let shared = SessionPreferenceStore()

    private let defaults = UserDefaults.standard
    private let keyPrefix = "dispatch.sessionComposerPreferences."

    private init() {}

    func load(sessionId: String) -> SessionComposerPreferences? {
        guard let data = defaults.data(forKey: storageKey(for: sessionId)) else { return nil }
        return try? JSONDecoder().decode(SessionComposerPreferences.self, from: data)
    }

    func save(model: String?, effort: String, sessionId: String) {
        let payload = SessionComposerPreferences(model: model, effort: effort)
        guard let data = try? JSONEncoder().encode(payload) else { return }
        defaults.set(data, forKey: storageKey(for: sessionId))
    }

    private func storageKey(for sessionId: String) -> String {
        keyPrefix + sessionId
    }
}

private enum ComposerEffort: String, CaseIterable, Identifiable {
    case low
    case medium
    case high

    var id: String { rawValue }

    var label: String {
        rawValue.capitalized
    }
}

struct ComposerView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    let sessionId: String
    var projectName: String? = nil
    var adapterType: String? = nil
    var currentModel: String? = nil
    var currentBranch: String? = nil
    var currentWorkspaceRoot: String? = nil
    let isConnected: Bool
    let isStreaming: Bool
    let onSend: (ComposerSendRequest) -> Void
    let onInterrupt: () -> Void
    var navigationLeftButton: AnyView? = nil

    @State private var text = ""
    @State private var showKeyboard = false
    @State private var showDiscovery = false
    @State private var selectedModel: String
    @State private var selectedEffort: ComposerEffort = .medium
    @State private var showBranchSheet = false
    @State private var branchDraft = ""
    @State private var branchSheetError: String?
    @State private var branchSessions: [MobileSessionSummary] = []
    @State private var isLoadingBranchSessions = false
    @State private var isOpeningBranchSession = false

    @State private var agentSuggestions: [MobileAgentSummary] = []
    @State private var mentionQuery: String?

    @StateObject private var voice = ScoutVoice()

    @State private var micState: MicButtonState = .idle
    @State private var lastError: String?
    @State private var justSent = false
    @State private var measuredTextHeight: CGFloat = Self.messageCompactTextHeight

    private var isRecording: Bool { micState == .recording }
    private var isTranscribing: Bool { micState == .transcribing }
    private var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var hasText: Bool { !trimmedText.isEmpty }
    private var canSendDraft: Bool { isConnected && hasText && !isTranscribing }
    private var showMessageField: Bool { hasText || showKeyboard }
    private var isSteeringActiveTurn: Bool { isStreaming }
    private var canInterruptTurn: Bool { isConnected && isSteeringActiveTurn && !isRecording && !isTranscribing }
    private var sendButtonShowsInterrupt: Bool { canInterruptTurn && !hasText }
    private var canActivatePrimaryAction: Bool { sendButtonShowsInterrupt || canSendDraft }
    private var composerPlaceholder: String {
        isSteeringActiveTurn ? "Follow up..." : "Ask anything..."
    }
    private var sendButtonAccessibilityLabel: String {
        if sendButtonShowsInterrupt {
            return "Stop active turn"
        }

        return isSteeringActiveTurn ? "Send follow-up" : "Send message"
    }
    private var sendButtonAccessibilityHint: String {
        if sendButtonShowsInterrupt {
            return "Interrupts the current turn. The microphone stays available for your next recording."
        }

        return isSteeringActiveTurn
            ? "Sends your draft into the live turn. Stop remains available in the compact control rail."
            : "Sends your message to the session."
    }
    private var sendButtonForegroundStyle: Color {
        canActivatePrimaryAction ? ScoutColors.textPrimary : ScoutColors.textMuted
    }
    private var sendButtonSymbolName: String {
        sendButtonShowsInterrupt ? "stop.fill" : "paperplane.fill"
    }

    // Keyboard button center = 14 (horizontal pad) + 24 (half of 48pt button) = 38pt from trailing edge
    private let sendButtonTrailing: CGFloat = 14 + 24 - 16 // 38 - half send button width

    private static let defaultModelLabel = "Default"
    private static let keepAliveTrigger = "extra keep alive please"
    private static let keepAliveReplacement = "use an Amphetamine-style keep alive so the Mac stays awake and Scout stays online"
    private static let keepAliveAppendix = "If this may run a while, use an Amphetamine-style keep alive so the Mac stays awake and Scout stays online."
    private static let messageCompactTextHeight: CGFloat = 28
    private static let messageExpandedMinTextHeight: CGFloat = 72
    private static let messageExpandedActiveTurnMinTextHeight: CGFloat = 60
    private static let messageExpandedMaxTextHeight: CGFloat = 168

    init(
        sessionId: String,
        projectName: String? = nil,
        adapterType: String? = nil,
        currentModel: String? = nil,
        currentBranch: String? = nil,
        currentWorkspaceRoot: String? = nil,
        isConnected: Bool,
        isStreaming: Bool,
        onSend: @escaping (ComposerSendRequest) -> Void,
        onInterrupt: @escaping () -> Void,
        navigationLeftButton: AnyView? = nil
    ) {
        let storedPreferences = SessionPreferenceStore.shared.load(sessionId: sessionId)
        self.sessionId = sessionId
        self.projectName = projectName
        self.adapterType = adapterType
        self.currentModel = currentModel
        self.currentBranch = currentBranch
        self.currentWorkspaceRoot = currentWorkspaceRoot
        self.isConnected = isConnected
        self.isStreaming = isStreaming
        self.onSend = onSend
        self.onInterrupt = onInterrupt
        self.navigationLeftButton = navigationLeftButton
        _selectedModel = State(initialValue: storedPreferences?.model?.trimmedNonEmpty ?? Self.defaultModelLabel)
        _selectedEffort = State(initialValue: ComposerEffort(rawValue: storedPreferences?.effort ?? "") ?? .medium)
    }

    var body: some View {
        VStack(spacing: 0) {
            if let lastError {
                Text(lastError)
                    .font(ScoutTypography.code(11))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .background(ScoutColors.surfaceAdaptive)
                    .onTapGesture { self.lastError = nil }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(for: .seconds(4))
                        withAnimation { self.lastError = nil }
                    }
            }

            // Message field — always visible
            messageField

            if shouldSuggestKeepAlive {
                keepAliveSuggestionStrip
            }

            if showsControlRail {
                controlRail
            }

            // @mention autocomplete
            if !agentSuggestions.isEmpty {
                mentionSuggestionsStrip
            }

            // Keyboard (only when explicitly toggled)
            if showKeyboard && !isRecording && !isTranscribing {
                ScoutKeyboardView(
                    text: $text,
                    dictationState: .idle,
                    onInsert: { char in text.append(char) },
                    onDelete: { if !text.isEmpty { text.removeLast() } },
                    onReturn: { text.append("\n") },
                    onVoice: { handleMicTap() },
                    onDismiss: { withAnimation { showKeyboard = false } }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            // Action Tray
            actionTray
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: showMessageField)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: showKeyboard)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: micState)
        .animation(.easeInOut(duration: 0.2), value: isStreaming)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $showDiscovery) {
            SessionDiscoveryView(projectFilter: projectName)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showBranchSheet) {
            branchSessionSheet
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .onChange(of: selectedModel) { _, _ in
            persistPreferences()
        }
        .onChange(of: selectedEffort) { _, _ in
            persistPreferences()
        }
        .onChange(of: text) { _, newText in
            let query = detectMentionQuery(in: newText)
            if mentionQuery != query {
                mentionQuery = query
                if query == nil { agentSuggestions = [] }
            }
        }
        .task(id: mentionQuery) {
            guard let query = mentionQuery else { return }
            guard let results = try? await connection.listMobileAgents(
                query: query.isEmpty ? nil : query,
                limit: 6
            ) else { return }
            agentSuggestions = results
        }
        .task {
            await voice.prepare()
        }
    }

    // MARK: - Action Tray

    private var actionTray: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                leftButton
                    .frame(width: ActionTrayMetrics.sideButtonSize, height: ActionTrayMetrics.sideButtonSize)
                Spacer()
                centerButton
                Spacer()
                rightButton
                    .frame(width: ActionTrayMetrics.sideButtonSize, height: ActionTrayMetrics.sideButtonSize)
            }
            .padding(.horizontal, ActionTrayMetrics.horizontalPadding)
            .padding(.top, ActionTrayMetrics.topPadding)
            .padding(.bottom, ActionTrayMetrics.bottomPadding)
        }
        .frame(maxWidth: .infinity)
        .background {
            composerSurface
                .ignoresSafeArea(edges: .bottom)
        }
    }

    // MARK: - Buttons

    @ViewBuilder
    private var leftButton: some View {
        if let navigationLeftButton {
            navigationLeftButton
        } else {
            BottomCircleButton(icon: "sparkle.magnifyingglass", isActive: showDiscovery) {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
                showDiscovery = true
            }
            .accessibilityLabel("Browse sessions")
        }
    }

    @ViewBuilder
    private var centerButton: some View {
        MicButton(
            state: currentMicState,
            onTap: handleMicTap,
            onLongPressStart: nil,
            onLongPressEnd: nil
        )
    }

    private var rightButton: some View {
        BottomCircleButton(
            icon: showKeyboard ? "keyboard.chevron.compact.down" : "keyboard",
            isActive: showKeyboard
        ) {
            withAnimation { showKeyboard.toggle() }
        }
        .accessibilityLabel(showKeyboard ? "Hide keyboard" : "Show keyboard")
    }

    // MARK: - Message Field (stacked card above action tray)

    private var messageTextMinHeight: CGFloat {
        hasText || showKeyboard
            ? (isSteeringActiveTurn ? Self.messageExpandedActiveTurnMinTextHeight : Self.messageExpandedMinTextHeight)
            : Self.messageCompactTextHeight
    }

    private var messageTextMaxHeight: CGFloat {
        hasText || showKeyboard
            ? Self.messageExpandedMaxTextHeight
            : Self.messageCompactTextHeight
    }

    private var messageFieldHeight: CGFloat {
        min(
            messageTextMaxHeight,
            max(messageTextMinHeight, measuredTextHeight)
        )
    }

    private var messageField: some View {
        HStack(alignment: .bottom, spacing: 0) {
            ScoutTextField(
                text: $text,
                measuredHeight: $measuredTextHeight,
                placeholder: composerPlaceholder,
                minHeight: messageTextMinHeight,
                maxHeight: messageTextMaxHeight
            )
                .frame(
                    maxWidth: .infinity,
                    minHeight: messageFieldHeight,
                    maxHeight: messageFieldHeight,
                    alignment: .topLeading
                )
                .padding(.leading, 16)
                .padding(.trailing, 8)
                .padding(.top, 2)

            Button {
                handlePrimaryAction()
            } label: {
                Image(systemName: sendButtonSymbolName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(sendButtonForegroundStyle)
                    .frame(width: 40, height: 40)
                    .background {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(.clear)
                            .glassEffect(.regular.interactive())
                    }
                    .scaleEffect(justSent ? 0.85 : 1.0)
            }
            .buttonStyle(.plain)
            .disabled(!canActivatePrimaryAction)
            .padding(.trailing, 14)
            .padding(.bottom, 0)
            .accessibilityLabel(sendButtonAccessibilityLabel)
            .accessibilityHint(sendButtonAccessibilityHint)
        }
        .padding(.top, 4)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .background {
            composerSurface
                .clipShape(
                    UnevenRoundedRectangle(
                        topLeadingRadius: 16,
                        bottomLeadingRadius: 0,
                        bottomTrailingRadius: 0,
                        topTrailingRadius: 16,
                        style: .continuous
                    )
                )
                .overlay {
                    UnevenRoundedRectangle(
                        topLeadingRadius: 16,
                        bottomLeadingRadius: 0,
                        bottomTrailingRadius: 0,
                        topTrailingRadius: 16,
                        style: .continuous
                    )
                    .strokeBorder(ScoutColors.border.opacity(0.4), lineWidth: 0.5)
                }
                .shadow(color: .black.opacity(0.04), radius: 2, y: -1)
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: messageFieldHeight)
        .animation(.easeInOut(duration: 0.15), value: canActivatePrimaryAction)
        .animation(.spring(response: 0.2, dampingFraction: 0.5), value: justSent)
    }

    private let composerSurface = Color(light: Color(white: 0.96), dark: Color(white: 0.09))

    private var controlRail: some View {
        HStack(spacing: 8) {
            if isSteeringActiveTurn && hasText {
                activeTurnBadge
                stopChip
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    if showsModelPicker {
                        modelPickerChip
                    } else if showReadOnlyModelChip {
                        readOnlyModelChip
                    }

                    if showsEffortPicker {
                        effortPickerChip
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
        .background { composerSurface }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ScoutColors.border.opacity(0.25))
                .frame(height: 0.5)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var activeTurnBadge: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(activeTurnBadgeColor)
                .frame(width: 7, height: 7)

            Text(activeTurnBadgeLabel)
                .font(ScoutTypography.code(10, weight: .semibold))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(ScoutColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
    }

    private var stopChip: some View {
        Button("STOP") {
            interruptActiveTurn()
        }
        .buttonStyle(.plain)
        .font(ScoutTypography.code(10, weight: .semibold))
        .foregroundStyle(canInterruptTurn ? ScoutColors.textPrimary : ScoutColors.textMuted)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(ScoutColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                .strokeBorder(ScoutColors.border.opacity(0.35), lineWidth: 0.5)
        }
        .disabled(!canInterruptTurn)
        .accessibilityLabel("Stop active turn")
        .accessibilityHint("Interrupts the current turn without affecting the draft you are composing.")
    }

    private var branchChip: some View {
        let chip = metadataChip(
            icon: "arrow.triangle.branch",
            title: "Branch",
            value: effectiveBranchLabel,
            isReadOnly: !canEditBranch
        )

        return Group {
            if canEditBranch {
                Button {
                    openBranchSheet()
                } label: {
                    chip
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Branch")
                .accessibilityValue(effectiveBranchLabel)
                .accessibilityHint("Opens branch controls for this workspace.")
            } else {
                chip
                    .accessibilityLabel("Current branch")
                    .accessibilityValue(effectiveBranchLabel)
            }
        }
    }

    private var branchSessionSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Open or resume a session for a specific branch.")
                            .font(ScoutTypography.body(14))
                            .foregroundStyle(ScoutColors.textSecondary)

                        TextField("main", text: $branchDraft)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .font(ScoutTypography.code(14))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 10)
                            .background(ScoutColors.surfaceAdaptive)
                            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
                    }

                    if let branchSheetError {
                        Text(branchSheetError)
                            .font(ScoutTypography.caption(12, weight: .medium))
                            .foregroundStyle(ScoutColors.statusError)
                    }

                    if isLoadingBranchSessions {
                        HStack(spacing: 10) {
                            ProgressView()
                                .controlSize(.small)
                            Text("Loading sessions for this workspace...")
                                .font(ScoutTypography.caption(12))
                                .foregroundStyle(ScoutColors.textMuted)
                        }
                    } else if !branchSessions.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Existing Sessions")
                                .font(ScoutTypography.caption(12, weight: .semibold))
                                .foregroundStyle(ScoutColors.textMuted)

                            ForEach(branchSessions, id: \.id) { session in
                                Button {
                                    resumeBranchSession(session.id)
                                } label: {
                                    HStack(spacing: 10) {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(session.currentBranch?.trimmedNonEmpty ?? "No branch")
                                                .font(ScoutTypography.code(12, weight: .medium))
                                                .foregroundStyle(ScoutColors.textPrimary)

                                            Text(session.title)
                                                .font(ScoutTypography.caption(12))
                                                .foregroundStyle(ScoutColors.textMuted)
                                                .lineLimit(1)
                                        }

                                        Spacer(minLength: 0)

                                        if session.id == sessionId {
                                            Text("CURRENT")
                                                .font(ScoutTypography.code(10, weight: .semibold))
                                                .foregroundStyle(ScoutColors.textMuted)
                                        } else {
                                            Text("OPEN")
                                                .font(ScoutTypography.code(10, weight: .semibold))
                                                .foregroundStyle(ScoutColors.textMuted)
                                        }
                                    }
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 10)
                                    .background(ScoutColors.surfaceAdaptive)
                                    .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
                                }
                                .buttonStyle(.plain)
                                .disabled(isOpeningBranchSession || session.id == sessionId)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 18)
            .background(ScoutColors.backgroundAdaptive)
            .navigationTitle("Branch")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        closeBranchSheet()
                    }
                    .disabled(isOpeningBranchSession)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(isOpeningBranchSession ? "Opening..." : "Open") {
                        Task { await openSelectedBranch() }
                    }
                    .disabled(!canOpenSelectedBranch)
                }
            }
            .task {
                await loadBranchSessions()
            }
        }
    }

    private var modelPickerChip: some View {
        Menu {
            ForEach(modelOptions, id: \.self) { model in
                Button {
                    selectedModel = model
                } label: {
                    if model == selectedModel {
                        Label(modelMenuLabel(for: model), systemImage: "checkmark")
                    } else {
                        Text(modelMenuLabel(for: model))
                    }
                }
            }
        } label: {
            metadataChip(icon: "cpu", title: "Model", value: effectiveModelLabel)
        }
    }

    private var readOnlyModelChip: some View {
        metadataChip(icon: "cpu", title: "Model", value: effectiveModelLabel, isReadOnly: true)
    }

    private var effortPickerChip: some View {
        Menu {
            ForEach(ComposerEffort.allCases) { effort in
                Button {
                    selectedEffort = effort
                } label: {
                    if effort == selectedEffort {
                        Label(effort.label, systemImage: "checkmark")
                    } else {
                        Text(effort.label)
                    }
                }
            }
        } label: {
            metadataChip(icon: "dial.medium", title: "Effort", value: selectedEffort.label)
        }
    }

    private func metadataChip(
        icon: String,
        title: String,
        value: String,
        isReadOnly: Bool = false
    ) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)
                .frame(width: 14)

            Text(value)
                .font(ScoutTypography.code(11, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
                .lineLimit(1)

            if !isReadOnly {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(ScoutColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
    }

    // MARK: - State

    private var currentMicState: MicButtonState {
        if isRecording { return .recording }
        if isTranscribing { return .transcribing }
        if !isConnected { return .disabled }
        return .idle
    }

    private var shouldSuggestKeepAlive: Bool {
        let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard normalized.contains(Self.keepAliveTrigger) else { return false }
        return !normalized.contains("amphetamine")
            && !normalized.contains("stay awake")
            && !normalized.contains("keep the mac awake")
    }

    private var keepAliveSuggestionStrip: some View {
        HStack(spacing: 8) {
            Text("Suggest Amphetamine-style keep alive")
                .font(ScoutTypography.code(11))
                .foregroundStyle(ScoutColors.textMuted)
                .lineLimit(1)

            Spacer(minLength: 0)

            Button("USE") {
                applyKeepAliveSuggestion()
            }
            .font(ScoutTypography.code(10, weight: .semibold))
            .foregroundStyle(ScoutColors.textPrimary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background {
            composerSurface
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ScoutColors.border.opacity(0.25))
                .frame(height: 0.5)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: - Mention Suggestions

    private var mentionSuggestionsStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(agentSuggestions, id: \.id) { agent in
                    Button {
                        completeMention(with: agent)
                    } label: {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(agent.state == "working" ? ScoutColors.ledGreen : ScoutColors.textMuted)
                                .frame(width: 6, height: 6)
                            Text("@\(agent.mentionHandle)")
                                .font(ScoutTypography.code(12, weight: .medium))
                                .foregroundStyle(ScoutColors.activityBlue)
                            Text(agent.title)
                                .font(ScoutTypography.code(11))
                                .foregroundStyle(ScoutColors.textSecondary)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(ScoutColors.surfaceAdaptive)
                        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                                .strokeBorder(ScoutColors.border.opacity(0.4), lineWidth: 0.5)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .frame(maxWidth: .infinity)
        .background { composerSurface }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ScoutColors.border.opacity(0.25))
                .frame(height: 0.5)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func detectMentionQuery(in text: String) -> String? {
        let lastToken = text.components(separatedBy: .whitespacesAndNewlines).last ?? ""
        guard lastToken.hasPrefix("@") else { return nil }
        return String(lastToken.dropFirst())
    }

    private func completeMention(with agent: MobileAgentSummary) {
        let handle = agent.mentionHandle
        let tokens = text.components(separatedBy: .whitespacesAndNewlines)
        guard let lastToken = tokens.last, lastToken.hasPrefix("@") else { return }
        if let range = text.range(of: lastToken, options: .backwards) {
            text.replaceSubrange(range, with: "@\(handle) ")
        }
        agentSuggestions = []
        mentionQuery = nil
    }

    // MARK: - Actions

    private func handlePrimaryAction() {
        if sendButtonShowsInterrupt {
            interruptActiveTurn()
            return
        }

        sendIfPossible()
    }

    private func sendIfPossible() {
        guard !trimmedText.isEmpty, isConnected, !isTranscribing else { return }
        let impact = UIImpactFeedbackGenerator(style: .light)
        impact.impactOccurred()
        onSend(
            ComposerSendRequest(
                text: trimmedText,
                model: composerModelOverride,
                effort: showsEffortPicker ? selectedEffort.rawValue : nil
            )
        )
        text = ""
        showKeyboard = false

        // Brief scale-bounce on the send button
        justSent = true
        Task {
            try? await Task.sleep(for: .milliseconds(150))
            justSent = false
        }
    }

    private func interruptActiveTurn() {
        guard canInterruptTurn else { return }
        let impact = UIImpactFeedbackGenerator(style: .medium)
        impact.impactOccurred()
        onInterrupt()
    }

    private var modelOptions: [String] {
        Self.modelOptions(for: adapterType, currentModel: currentModel)
    }

    private var showsModelPicker: Bool {
        ScoutModelCatalog.supportsComposerModelSelection(for: adapterType)
    }

    private var showReadOnlyModelChip: Bool {
        !showsModelPicker && currentModel?.trimmedNonEmpty != nil
    }

    private var showsControlRail: Bool {
        (isSteeringActiveTurn && hasText) || showsModelPicker || showReadOnlyModelChip || showsEffortPicker
    }

    private var showsEffortPicker: Bool {
        ScoutModelCatalog.supportsComposerEffortSelection(for: adapterType)
    }

    private var composerModelOverride: String? {
        guard showsModelPicker, selectedModel != Self.defaultModelLabel else { return nil }
        return selectedModel
    }

    private var effectiveModelLabel: String {
        let rawModel = selectedModel != Self.defaultModelLabel ? selectedModel : currentModel
        return ScoutModelLabel.displayText(for: rawModel, fallback: Self.defaultModelLabel)
    }

    private var sessionWorkspaceRoot: String? {
        currentWorkspaceRoot?.trimmedNonEmpty
    }

    private var canEditBranch: Bool {
        isConnected && sessionWorkspaceRoot != nil
    }

    private var effectiveBranchLabel: String {
        currentBranch?.trimmedNonEmpty ?? "No branch"
    }

    private var branchLaunchHarness: String? {
        guard let adapter = adapterType?.trimmedNonEmpty, adapter != "relay" else { return nil }
        return adapter
    }

    private var branchLaunchModel: String? {
        composerModelOverride ?? currentModel?.trimmedNonEmpty
    }

    private var activeTurnBadgeLabel: String {
        if isRecording {
            return "REC"
        }

        if isTranscribing {
            return "TEXT"
        }

        return "LIVE"
    }

    private var activeTurnBadgeColor: Color {
        if isRecording {
            return ScoutColors.statusError
        }

        if isTranscribing {
            return ScoutColors.accent
        }

        return ScoutColors.statusStreaming
    }

    private var canOpenSelectedBranch: Bool {
        canEditBranch && branchDraft.trimmedNonEmpty != nil && !isOpeningBranchSession
    }

    private func normalizedBranch(_ branch: String?) -> String? {
        branch?.trimmedNonEmpty?.lowercased()
    }

    private func openBranchSheet() {
        branchDraft = currentBranch?.trimmedNonEmpty ?? ""
        branchSheetError = nil
        branchSessions = []
        showBranchSheet = true
    }

    private func closeBranchSheet() {
        branchSheetError = nil
        showBranchSheet = false
    }

    @MainActor
    private func loadBranchSessions() async {
        guard showBranchSheet, let workspaceRoot = sessionWorkspaceRoot, isConnected else {
            branchSessions = []
            return
        }

        isLoadingBranchSessions = true
        defer { isLoadingBranchSessions = false }

        do {
            let sessions = try await connection.listMobileSessions()
            branchSessions = sessions
                .filter { $0.workspaceRoot?.trimmedNonEmpty == workspaceRoot }
                .sorted { lhs, rhs in
                    (lhs.lastMessageAt ?? 0) > (rhs.lastMessageAt ?? 0)
                }
        } catch {
            branchSheetError = error.scoutUserFacingMessage
            branchSessions = []
        }
    }

    @MainActor
    private func openSelectedBranch() async {
        guard let workspaceRoot = sessionWorkspaceRoot else { return }
        guard let targetBranch = branchDraft.trimmedNonEmpty else { return }

        branchSheetError = nil
        isOpeningBranchSession = true
        defer { isOpeningBranchSession = false }

        if normalizedBranch(targetBranch) == normalizedBranch(currentBranch) {
            closeBranchSheet()
            return
        }

        if let existing = branchSessions.first(where: {
            $0.id != sessionId && normalizedBranch($0.currentBranch) == normalizedBranch(targetBranch)
        }) {
            resumeBranchSession(existing.id)
            return
        }

        do {
            let handle = try await connection.createMobileSession(
                workspaceId: workspaceRoot,
                harness: branchLaunchHarness,
                branch: targetBranch,
                model: branchLaunchModel,
                forceNew: true
            )
            closeBranchSheet()
            router.replaceTop(.sessionDetail(sessionId: handle.session.conversationId))
        } catch {
            branchSheetError = error.scoutUserFacingMessage
        }
    }

    private func resumeBranchSession(_ targetSessionId: String) {
        guard targetSessionId != sessionId else { return }
        closeBranchSheet()
        router.replaceTop(.sessionDetail(sessionId: targetSessionId))
    }

    private func modelMenuLabel(for model: String) -> String {
        if model == Self.defaultModelLabel, let currentModel {
            let currentLabel = ScoutModelLabel.describe(currentModel)?.menuLabel
                ?? ScoutModelLabel.displayText(for: currentModel, fallback: currentModel)
            return "\(Self.defaultModelLabel) (\(currentLabel))"
        }

        return ScoutModelLabel.describe(model)?.menuLabel ?? model
    }

    private static func modelOptions(for adapterType: String?, currentModel: String?) -> [String] {
        var options = [defaultModelLabel]
        options.append(contentsOf: ScoutModelCatalog.composerOptions(for: adapterType))

        if let currentModel,
           !currentModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
           !options.contains(currentModel) {
            options.insert(currentModel, at: 1)
        }

        return options
    }

    private func handleMicTap() {
        switch micState {
        case .idle: startRecording()
        case .recording: stopRecording()
        case .transcribing, .disabled: break
        }
    }

    private func persistPreferences() {
        let modelOverride = composerModelOverride
        SessionPreferenceStore.shared.save(
            model: modelOverride,
            effort: selectedEffort.rawValue,
            sessionId: sessionId
        )
    }

    private func applyKeepAliveSuggestion() {
        if let range = text.range(of: Self.keepAliveTrigger, options: [.caseInsensitive, .diacriticInsensitive]) {
            text.replaceSubrange(range, with: Self.keepAliveReplacement)
        } else {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                text = Self.keepAliveAppendix
            } else if trimmed.hasSuffix(".") || trimmed.hasSuffix("!") || trimmed.hasSuffix("?") {
                text = "\(trimmed) \(Self.keepAliveAppendix)"
            } else {
                text = "\(trimmed). \(Self.keepAliveAppendix)"
            }
        }
        showKeyboard = true
    }

    private func startRecording() {
        micState = .recording
        showKeyboard = false
        lastError = nil

        Task {
            do {
                if !voice.isReady { await voice.prepare() }
                let granted = await voice.requestMicrophonePermission()
                guard granted else {
                    lastError = "Mic permission denied"
                    micState = .idle
                    return
                }
                try await voice.startRecording()
            } catch {
                lastError = "Recording failed: \(error.localizedDescription)"
                micState = .idle
            }
        }
    }

    private func stopRecording() {
        micState = .transcribing

        Task {
            do {
                let transcribed = try await voice.stopAndTranscribe()
                text = mergedDictationText(current: text, transcribed: transcribed)
                micState = .idle
            } catch ScoutVoice.VoiceError.recordingTooShort {
                lastError = "Recording too short (min 0.3s)"
                micState = .idle
            } catch {
                lastError = "Transcription: \(error.localizedDescription)"
                micState = .idle
            }
        }
    }

    private func mergedDictationText(current: String, transcribed: String) -> String {
        let appended = transcribed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !appended.isEmpty else { return current }
        guard !current.isEmpty else { return appended }

        if let lastScalar = current.unicodeScalars.last,
           CharacterSet.whitespacesAndNewlines.contains(lastScalar) {
            return current + appended
        }

        return current + " " + appended
    }
}

// MARK: - Previews

#Preview("Idle") {
    VStack {
        Spacer()
        ComposerView(
            sessionId: "s1", isConnected: true, isStreaming: false,
            onSend: { print("Send: \($0.text)") }, onInterrupt: {}
        )
    }
    .background(ScoutColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}
