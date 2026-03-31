// KeyComponents — Individual key button views for PlexusKeyboardView.
//
// All keys use iOS 26 Liquid Glass (.glassEffect) for interactive surfaces.
// Haptic feedback on press. Accent popover on long-press for letter keys.

import SwiftUI

// MARK: - Key Style

enum KeyStyle {
    case standard   // Letter/character keys
    case special    // Shift, 123, ABC toggles
    case accent     // Voice, return — uses PlexusColors.accent
    case delete     // Delete key
}

// MARK: - CharKey (generic character/label button)

struct CharKey: View {
    let label: String
    var style: KeyStyle = .standard
    var height: CGFloat = 42
    let onTap: () -> Void

    @State private var isPressed = false

    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(.system(size: fontSize, weight: fontWeight))
                .foregroundStyle(foregroundColor)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .background { keyBackground }
                .contentShape(Rectangle())
        }
        .buttonStyle(KeyPressStyle())
    }

    private var fontSize: CGFloat {
        label.count > 1 ? 14 : 22
    }

    private var fontWeight: Font.Weight {
        label.count > 1 ? .medium : .regular
    }

    private var foregroundColor: Color {
        switch style {
        case .standard: .white
        case .special: PlexusColors.textSecondary
        case .accent: .white
        case .delete: .white
        }
    }

    @ViewBuilder
    private var keyBackground: some View {
        switch style {
        case .standard:
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(.white.opacity(0.08))
                .glassEffect(.regular.interactive())
        case .special:
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(.white.opacity(0.04))
                .glassEffect(.regular.interactive())
        case .accent:
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(PlexusColors.accent)
        case .delete:
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(.white.opacity(0.04))
                .glassEffect(.regular.interactive())
        }
    }
}

// MARK: - LetterKey (with accent long-press)

struct LetterKey: View {
    let label: String
    var accents: [String]?
    var height: CGFloat = 42
    let onInsert: (String) -> Void

    @State private var showAccents = false
    @State private var selectedAccent: String?

    var body: some View {
        ZStack(alignment: .top) {
            Button {
                onInsert(label)
            } label: {
                Text(label)
                    .font(.system(size: 22))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .frame(height: height)
                    .background {
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .fill(.white.opacity(0.08))
                            .glassEffect(.regular.interactive())
                    }
                    .contentShape(Rectangle())
            }
            .buttonStyle(KeyPressStyle())
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.4)
                    .onEnded { _ in
                        guard accents != nil else { return }
                        showAccents = true
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    }
            )

            // Accent popover
            if showAccents, let accents {
                accentPopover(accents)
                    .offset(y: -height - 8)
                    .transition(.scale(scale: 0.8, anchor: .bottom).combined(with: .opacity))
                    .zIndex(10)
            }
        }
        .animation(.spring(response: 0.2, dampingFraction: 0.8), value: showAccents)
        .onChange(of: showAccents) { _, showing in
            if !showing, let accent = selectedAccent {
                onInsert(accent)
                selectedAccent = nil
            }
        }
    }

    private func accentPopover(_ accents: [String]) -> some View {
        HStack(spacing: 2) {
            ForEach(accents, id: \.self) { accent in
                Button {
                    selectedAccent = accent
                    showAccents = false
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } label: {
                    Text(accent)
                        .font(.system(size: 22))
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 42)
                        .background {
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .fill(selectedAccent == accent
                                    ? PlexusColors.accent
                                    : .white.opacity(0.12)
                                )
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(.ultraThinMaterial)
                .shadow(color: .black.opacity(0.3), radius: 8, y: 2)
        }
        .onTapGesture {} // Capture taps to prevent dismissal
        .background {
            // Dismiss overlay
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { showAccents = false }
                .frame(width: 1000, height: 1000)
        }
    }
}

// MARK: - ShiftKey

struct ShiftKey: View {
    let isShifted: Bool
    let isCapsLock: Bool
    let onTap: () -> Void
    let onDoubleTap: () -> Void

    var body: some View {
        Button {
            onTap()
        } label: {
            Image(systemName: shiftIcon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(isShifted ? .white : PlexusColors.textSecondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(isShifted ? .white.opacity(0.15) : .white.opacity(0.04))
                        .glassEffect(.regular.interactive())
                }
        }
        .buttonStyle(KeyPressStyle())
        .onTapGesture(count: 2) { onDoubleTap() }
        .accessibilityLabel(isCapsLock ? "Caps lock on" : isShifted ? "Shift on" : "Shift")
    }

    private var shiftIcon: String {
        if isCapsLock { return "capslock.fill" }
        if isShifted { return "shift.fill" }
        return "shift"
    }
}

// MARK: - DeleteKey

struct DeleteKey: View {
    let onDelete: () -> Void

    @State private var isDeleting = false
    @State private var deleteTimer: Timer?

    var body: some View {
        Button {
            onDelete()
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } label: {
            Image(systemName: "delete.left")
                .font(.system(size: 18, weight: .regular))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(.white.opacity(0.04))
                        .glassEffect(.regular.interactive())
                }
        }
        .buttonStyle(KeyPressStyle())
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.3)
                .onEnded { _ in
                    startRepeatingDelete()
                }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onEnded { _ in
                    stopRepeatingDelete()
                }
        )
        .accessibilityLabel("Delete")
    }

    private func startRepeatingDelete() {
        stopRepeatingDelete()
        deleteTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { _ in
            Task { @MainActor in
                onDelete()
            }
        }
    }

    private func stopRepeatingDelete() {
        deleteTimer?.invalidate()
        deleteTimer = nil
    }
}

// MARK: - SpaceKey

struct SpaceKey: View {
    var height: CGFloat = 42
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text("space")
                .font(.system(size: 14, weight: .regular))
                .foregroundStyle(PlexusColors.textSecondary)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .background {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(.white.opacity(0.08))
                        .glassEffect(.regular.interactive())
                }
        }
        .buttonStyle(KeyPressStyle())
        .accessibilityLabel("Space")
    }
}

// MARK: - VoiceKey (prominent mic button)

struct VoiceKey: View {
    let state: DictationState
    let onTap: () -> Void

    @State private var glowPulsing = false

    var body: some View {
        Button(action: {
            onTap()
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        }) {
            ZStack {
                // Recording glow
                if state == .recording {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(PlexusColors.statusError)
                        .blur(radius: 8)
                        .opacity(glowPulsing ? 0.5 : 0.2)
                }

                // Button face
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(buttonColor)
                    .overlay(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .strokeBorder(borderColor, lineWidth: 0.5)
                    )

                // Icon
                voiceIcon
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .buttonStyle(KeyPressStyle())
        .animation(
            .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
            value: glowPulsing
        )
        .onChange(of: state) { _, newState in
            glowPulsing = newState == .recording
        }
        .accessibilityLabel(accessLabel)
    }

    @ViewBuilder
    private var voiceIcon: some View {
        switch state {
        case .idle:
            Image(systemName: "mic.fill")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.white)
        case .recording:
            RoundedRectangle(cornerRadius: 3)
                .fill(.white)
                .frame(width: 14, height: 14)
        case .processing:
            Image(systemName: "waveform")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.white)
                .symbolEffect(.variableColor.iterative, options: .repeating)
        }
    }

    private var buttonColor: Color {
        switch state {
        case .idle: PlexusColors.accent
        case .recording: PlexusColors.statusError
        case .processing: PlexusColors.statusStreaming
        }
    }

    private var borderColor: Color {
        switch state {
        case .idle: PlexusColors.accent.opacity(0.4)
        case .recording: PlexusColors.statusError.opacity(0.4)
        case .processing: PlexusColors.statusStreaming.opacity(0.4)
        }
    }

    private var accessLabel: String {
        switch state {
        case .idle: "Start dictation"
        case .recording: "Stop dictation"
        case .processing: "Processing speech"
        }
    }
}

// MARK: - ReturnKey

struct ReturnKey: View {
    var height: CGFloat = 42
    let onReturn: () -> Void

    var body: some View {
        Button {
            onReturn()
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        } label: {
            Image(systemName: "return")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .background {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(PlexusColors.accent)
                }
        }
        .buttonStyle(KeyPressStyle())
        .accessibilityLabel("Return")
    }
}

// MARK: - Key Press Button Style

/// Provides a subtle scale + opacity press effect for all keys.
struct KeyPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1.0)
            .opacity(configuration.isPressed ? 0.7 : 1.0)
            .animation(.spring(response: 0.15, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

// MARK: - Previews

#Preview("Key Components") {
    VStack(spacing: 16) {
        HStack(spacing: 8) {
            CharKey(label: "A", height: 42) {}
            CharKey(label: "123", style: .special, height: 42) {}
            CharKey(label: ".", height: 42) {}
        }

        HStack(spacing: 8) {
            ShiftKey(isShifted: false, isCapsLock: false, onTap: {}, onDoubleTap: {})
                .frame(width: 42, height: 42)
            ShiftKey(isShifted: true, isCapsLock: false, onTap: {}, onDoubleTap: {})
                .frame(width: 42, height: 42)
            ShiftKey(isShifted: true, isCapsLock: true, onTap: {}, onDoubleTap: {})
                .frame(width: 42, height: 42)
            DeleteKey(onDelete: {})
                .frame(width: 42, height: 42)
        }

        HStack(spacing: 8) {
            VoiceKey(state: .idle, onTap: {})
                .frame(width: 52, height: 44)
            VoiceKey(state: .recording, onTap: {})
                .frame(width: 52, height: 44)
            VoiceKey(state: .processing, onTap: {})
                .frame(width: 52, height: 44)
            ReturnKey(height: 44, onReturn: {})
                .frame(width: 52, height: 44)
        }

        SpaceKey(height: 44) {}
    }
    .padding()
    .background(PlexusColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}
