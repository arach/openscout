// ComposerView — Voice-first input with tap-on/tap-off mic.
//
// Tray: [discovery] — [mic] — [keyboard]
// Mic toggles recording. After transcription, editable text field + send.
// Keyboard only when explicitly toggled.

import SwiftUI

struct ComposerView: View {
    let sessionId: String
    var projectName: String? = nil
    let isConnected: Bool
    let isStreaming: Bool
    let onSend: (String) -> Void
    let onInterrupt: () -> Void

    @State private var text = ""
    @State private var showKeyboard = false
    @State private var showDiscovery = false

    @StateObject private var voice = PlexusVoice()

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

    var body: some View {
        VStack(spacing: 0) {
            if let lastError {
                Text(lastError)
                    .font(PlexusTypography.caption(12, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .background(PlexusColors.statusError.opacity(0.85))
                    .onTapGesture { self.lastError = nil }
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .task {
                        try? await Task.sleep(for: .seconds(4))
                        withAnimation { self.lastError = nil }
                    }
            }

            // Message field — always visible
            messageField

            // Keyboard (only when explicitly toggled)
            if showKeyboard && !isRecording && !isTranscribing {
                PlexusKeyboardView(
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
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $showDiscovery) {
            SessionDiscoveryView(projectFilter: projectName)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
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
                .fill(
                    LinearGradient(
                        colors: [.white.opacity(0.12), .white.opacity(0.04), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(height: 1)
        }
        .background {
            Color.clear
                .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 0))
                .ignoresSafeArea(edges: .bottom)
        }
    }

    // MARK: - Buttons

    private var leftButton: some View {
        BottomCircleButton(icon: "sparkle.magnifyingglass", isActive: showDiscovery) {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            showDiscovery = true
        }
        .accessibilityLabel("Browse sessions")
    }

    @ViewBuilder
    private var centerButton: some View {
        if isStreaming {
            Button {
                onInterrupt()
            } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(PlexusColors.statusError)
                    .frame(width: 70, height: 70)
                    .background(PlexusColors.statusError.opacity(0.12))
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

    // Max height matches the action tray (~100pt)
    private let messageMaxHeight: CGFloat = 100

    private var messageField: some View {
        HStack(alignment: .top, spacing: 0) {
            PlexusTextField(text: $text, placeholder: "Ask anything...", maxHeight: messageMaxHeight - 16)
                .frame(maxHeight: messageMaxHeight - 16)
                .padding(.leading, 16)
                .padding(.trailing, 8)
                .padding(.top, 2)

            Button {
                sendIfPossible()
            } label: {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(canSend ? PlexusColors.textPrimary : PlexusColors.textSecondary)
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
            .accessibilityLabel("Send message")
        }
        .padding(.top, 8)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .background(
            UnevenRoundedRectangle(
                topLeadingRadius: 16,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: 16,
                style: .continuous
            )
            .fill(PlexusColors.surfaceAdaptive)
            .overlay(alignment: .top) {
                UnevenRoundedRectangle(
                    topLeadingRadius: 16,
                    bottomLeadingRadius: 0,
                    bottomTrailingRadius: 0,
                    topTrailingRadius: 16,
                    style: .continuous
                )
                .strokeBorder(
                    LinearGradient(
                        colors: [.white.opacity(0.15), .clear],
                        startPoint: .top,
                        endPoint: .bottom
                    ),
                    lineWidth: 0.5
                )
            }
            .shadow(color: .black.opacity(0.08), radius: 3, y: -1)
        )
        .animation(.easeInOut(duration: 0.15), value: canSend)
        .animation(.spring(response: 0.2, dampingFraction: 0.5), value: justSent)
    }

    // MARK: - State

    private var currentMicState: MicButtonState {
        if isRecording { return .recording }
        if isTranscribing { return .transcribing }
        if !isConnected { return .disabled }
        return .idle
    }

    // MARK: - Actions

    private func sendIfPossible() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, isConnected, !isStreaming else { return }
        let impact = UIImpactFeedbackGenerator(style: .light)
        impact.impactOccurred()
        onSend(trimmed)
        text = ""
        showKeyboard = false

        // Brief scale-bounce on the send button
        justSent = true
        Task {
            try? await Task.sleep(for: .milliseconds(150))
            justSent = false
        }
    }

    private func handleMicTap() {
        switch micState {
        case .idle: startRecording()
        case .recording: stopRecording()
        case .transcribing, .disabled: break
        }
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
            } catch PlexusVoice.VoiceError.recordingTooShort {
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
            onSend: { print("Send: \($0)") }, onInterrupt: {}
        )
    }
    .background(PlexusColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}
