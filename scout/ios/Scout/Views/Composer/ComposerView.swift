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
    let sessionId: String
    var projectName: String? = nil
    var adapterType: String? = nil
    var currentModel: String? = nil
    var currentBranch: String? = nil
    let isConnected: Bool
    let isStreaming: Bool
    let onSend: (ComposerSendRequest) -> Void
    let onInterrupt: () -> Void
    var navigationLeftButton: AnyView? = nil

    @State private var text = ""
    @State private var showKeyboard = false
    @State private var showDiscovery = false
    @State private var showMetadataStrip = false
    @State private var selectedModel: String
    @State private var selectedEffort: ComposerEffort = .medium

    @StateObject private var voice = ScoutVoice()

    @State private var micState: MicButtonState = .idle
    @State private var lastError: String?
    @State private var justSent = false

    private var isRecording: Bool { micState == .recording }
    private var isTranscribing: Bool { micState == .transcribing }
    private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var canSend: Bool { isConnected && hasText && !isStreaming }
    private var showMessageField: Bool { hasText || showKeyboard }

    // Keyboard button center = 14 (horizontal pad) + 24 (half of 48pt button) = 38pt from trailing edge
    private let sendButtonTrailing: CGFloat = 14 + 24 - 16 // 38 - half send button width

    private static let defaultModelLabel = "Default"
    private static let keepAliveTrigger = "extra keep alive please"
    private static let keepAliveReplacement = "use an Amphetamine-style keep alive so the Mac stays awake and Scout stays online"
    private static let keepAliveAppendix = "If this may run a while, use an Amphetamine-style keep alive so the Mac stays awake and Scout stays online."

    init(
        sessionId: String,
        projectName: String? = nil,
        adapterType: String? = nil,
        currentModel: String? = nil,
        currentBranch: String? = nil,
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
                    .font(ScoutTypography.caption(12, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .background(ScoutColors.statusError.opacity(0.85))
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

            if showMetadataStrip {
                metadataStrip
            } else {
                collapsedMetadataStrip
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
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: showMetadataStrip)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: micState)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $showDiscovery) {
            SessionDiscoveryView(projectFilter: projectName)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .onChange(of: selectedModel) { _, _ in
            persistPreferences()
        }
        .onChange(of: selectedEffort) { _, _ in
            persistPreferences()
        }
        .task {
            await voice.prepare()
        }
    }

    // MARK: - Action Tray

    private var actionTray: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                leftButton.frame(width: 48, height: 48)
                Spacer()
                centerButton
                Spacer()
                rightButton.frame(width: 48, height: 48)
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, -18)
        }
        .frame(maxWidth: .infinity)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ScoutColors.border.opacity(0.3))
                .frame(height: 0.5)
        }
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
        if isStreaming {
            Button {
                onInterrupt()
            } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(ScoutColors.statusError)
                    .frame(width: 70, height: 70)
                    .background(ScoutColors.statusError.opacity(0.12))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .transition(.scale.combined(with: .opacity))
        } else {
            MicButton(
                state: currentMicState,
                onTap: handleMicTap,
                onLongPressStart: nil,
                onLongPressEnd: nil
            )
        }
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

    private let messageExpandedHeight: CGFloat = 100
    private let messageCompactHeight: CGFloat = 48

    private var messageFieldHeight: CGFloat {
        hasText || showKeyboard ? messageExpandedHeight : messageCompactHeight
    }

    private var messageField: some View {
        HStack(alignment: .bottom, spacing: 0) {
            ScoutTextField(text: $text, placeholder: "Ask anything...", maxHeight: messageFieldHeight - 16)
                .frame(
                    maxWidth: .infinity,
                    minHeight: messageFieldHeight - 16,
                    maxHeight: messageFieldHeight - 16,
                    alignment: .topLeading
                )
                .padding(.leading, 16)
                .padding(.trailing, 8)
                .padding(.top, 4)

            Button {
                sendIfPossible()
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(canSend ? ScoutColors.textPrimary : ScoutColors.textSecondary)
                    .frame(width: 44, height: 44)
                    .background {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(.clear)
                            .glassEffect(.regular.interactive())
                    }
                    .scaleEffect(justSent ? 0.85 : 1.0)
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .padding(.trailing, 14)
            .padding(.bottom, 2)
            .accessibilityLabel("Send message")
        }
        .padding(.top, 8)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .simultaneousGesture(metadataDragGesture)
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
        .animation(.easeInOut(duration: 0.15), value: canSend)
        .animation(.spring(response: 0.2, dampingFraction: 0.5), value: justSent)
    }

    /// Clean solid surface — white in light, near-black in dark
    private let composerSurface = Color(light: .white, dark: Color(white: 0.12))

    private var metadataStrip: some View {
        VStack(spacing: 10) {
            Capsule()
                .fill(ScoutColors.textMuted.opacity(0.3))
                .frame(width: 30, height: 4)
                .padding(.top, 4)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    if showsModelPicker {
                        modelPickerChip
                    } else if showReadOnlyModelChip {
                        readOnlyModelChip
                    }

                    if showsEffortPicker {
                        effortPickerChip
                    }

                    branchChip
                }
                .padding(.horizontal, 14)
            }
            .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity)
        .background { composerSurface }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ScoutColors.border.opacity(0.25))
                .frame(height: 0.5)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .simultaneousGesture(metadataDragGesture)
    }

    private var collapsedMetadataStrip: some View {
        Button {
            withAnimation {
                showMetadataStrip = true
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "chevron.up")
                    .font(.system(size: 10, weight: .semibold))
                Text(collapsedMetadataSummary)
                    .font(ScoutTypography.caption(12, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(ScoutColors.textMuted)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
        }
        .buttonStyle(.plain)
        .background { composerSurface }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(ScoutColors.border.opacity(0.25))
                .frame(height: 0.5)
        }
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .simultaneousGesture(metadataDragGesture)
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
            metadataChip(
                icon: "cpu",
                title: "Model",
                value: effectiveModelLabel,
                accent: ScoutColors.accent
            )
        }
    }

    private var readOnlyModelChip: some View {
        metadataChip(
            icon: "cpu",
            title: "Model",
            value: effectiveModelLabel,
            accent: ScoutColors.textPrimary,
            isReadOnly: true
        )
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
            metadataChip(
                icon: "dial.medium",
                title: "Effort",
                value: selectedEffort.label,
                accent: ScoutColors.textPrimary
            )
        }
    }

    private var branchChip: some View {
        metadataChip(
            icon: "arrow.triangle.branch",
            title: "Branch",
            value: currentBranch ?? "Unavailable",
            accent: currentBranch == nil ? ScoutColors.textMuted : ScoutColors.textPrimary,
            isReadOnly: true
        )
    }

    private func metadataChip(
        icon: String,
        title: String,
        value: String,
        accent: Color,
        isReadOnly: Bool = false
    ) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(accent)
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 1) {
                Text(title.uppercased())
                    .font(ScoutTypography.caption(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                Text(value)
                    .font(ScoutTypography.code(12, weight: .medium))
                    .foregroundStyle(isReadOnly ? accent : ScoutColors.textPrimary)
                    .lineLimit(1)
            }

            if !isReadOnly {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(ScoutColors.textMuted)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(ScoutColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(ScoutColors.border, lineWidth: 0.5)
        )
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
        HStack(spacing: 10) {
            Image(systemName: "bolt.badge.clock")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(ScoutColors.accent)

            Text("Suggest Amphetamine-style keep alive")
                .font(ScoutTypography.caption(12, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
                .lineLimit(1)

            Spacer(minLength: 0)

            Button("Use") {
                applyKeepAliveSuggestion()
            }
            .font(ScoutTypography.caption(12, weight: .semibold))
            .foregroundStyle(ScoutColors.accent)
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

    // MARK: - Actions

    private func sendIfPossible() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, isConnected, !isStreaming else { return }
        let impact = UIImpactFeedbackGenerator(style: .light)
        impact.impactOccurred()
        onSend(
            ComposerSendRequest(
                text: trimmed,
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

    private var modelOptions: [String] {
        Self.modelOptions(for: adapterType, currentModel: currentModel)
    }

    private var showsModelPicker: Bool {
        ScoutModelCatalog.supportsComposerModelSelection(for: adapterType)
    }

    private var showReadOnlyModelChip: Bool {
        !showsModelPicker && currentModel?.trimmedNonEmpty != nil
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

    private var collapsedMetadataSummary: String {
        [
            showsModelPicker || showReadOnlyModelChip ? effectiveModelLabel : nil,
            showsEffortPicker ? selectedEffort.label : nil,
            currentBranch ?? "No branch",
        ]
        .compactMap { $0 }
        .joined(separator: " • ")
    }

    private var metadataDragGesture: some Gesture {
        DragGesture(minimumDistance: 16)
            .onEnded { value in
                let vertical = value.translation.height
                guard abs(vertical) > abs(value.translation.width) else { return }
                if vertical > 18, showMetadataStrip {
                    withAnimation {
                        showMetadataStrip = false
                    }
                } else if vertical < -18, !showMetadataStrip {
                    withAnimation {
                        showMetadataStrip = true
                    }
                }
            }
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
                text = transcribed
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
