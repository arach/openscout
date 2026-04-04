// MicButton — Central 70pt microphone button for the action tray.
//
// Ported from Talkie's ActionDock record button pattern.
// Dual interaction: tap to toggle recording, long-press (0.2s) for push-to-talk.
// States: idle, recording, transcribing, disabled.
// Glow ring with spring animation and pulsing blur.
// Haptic feedback on all state transitions.
//
// Also includes BottomCircleButton — the 48pt side button with
// iOS 26 Liquid Glass and pre-iOS 26 chrome metallic fallback.

import SwiftUI

// MARK: - Mic State

enum MicButtonState: Equatable, Hashable {
    case idle
    case recording
    case transcribing
    case disabled
}

// MARK: - MicButton (70pt center)

struct MicButton: View {
    let state: MicButtonState
    let onTap: () -> Void
    var onLongPressStart: (() -> Void)?
    var onLongPressEnd: (() -> Void)?

    @State private var glowPulsing = false
    @State private var isPressed = false

    private let buttonSize: CGFloat = 70
    private let glowSize: CGFloat = 72

    var body: some View {
        ZStack {
            // Glow ring (recording state only)
            if state == .recording {
                glowRing
            }

            // Main circle
            Circle()
                .fill(buttonFillColor)
                .frame(width: buttonSize, height: buttonSize)
                .overlay(
                    Circle()
                        .strokeBorder(buttonBorderColor, lineWidth: 1)
                )

            // Icon
            buttonIcon
        }
        .frame(width: buttonSize + 20, height: buttonSize + 20)
        .scaleEffect(scaleValue)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: state)
        .animation(.spring(response: 0.25, dampingFraction: 0.6), value: isPressed)
        .contentShape(Circle().size(width: buttonSize + 20, height: buttonSize + 20))
        .onTapGesture {
            guard state != .disabled, state != .transcribing else { return }
            let impact = UIImpactFeedbackGenerator(style: .medium)
            impact.impactOccurred()
            onTap()
        }
        .onLongPressGesture(minimumDuration: 0.2, pressing: { pressing in
            if pressing {
                guard state == .idle else { return }
                isPressed = true
                let impact = UIImpactFeedbackGenerator(style: .heavy)
                impact.impactOccurred()
                onLongPressStart?()
            } else {
                if isPressed {
                    isPressed = false
                    onLongPressEnd?()
                }
            }
        }, perform: {})
        .accessibilityElement()
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint(accessibilityHint)
        .accessibilityAddTraits(.isButton)
        .accessibilityRemoveTraits(state == .disabled ? .isButton : [])
    }

    // MARK: - Glow Ring (Talkie pattern: blurred circle + pulsing)

    private var glowRing: some View {
        ZStack {
            // Outer diffuse glow
            Circle()
                .fill(DispatchColors.statusError)
                .frame(width: glowSize + 12, height: glowSize + 12)
                .blur(radius: 18)
                .opacity(glowPulsing ? 0.4 : 0.15)

            // Inner sharp glow
            Circle()
                .fill(DispatchColors.statusError)
                .frame(width: glowSize, height: glowSize)
                .blur(radius: 12)
                .opacity(glowPulsing ? 0.55 : 0.25)
        }
        .animation(
            .easeInOut(duration: 0.9).repeatForever(autoreverses: true),
            value: glowPulsing
        )
        .onAppear { glowPulsing = true }
        .onDisappear { glowPulsing = false }
    }

    // MARK: - Scale

    private var scaleValue: CGFloat {
        if isPressed { return 1.12 }
        if state == .recording { return 1.05 }
        return 1.0
    }

    // MARK: - Icon

    @ViewBuilder
    private var buttonIcon: some View {
        switch state {
        case .idle:
            Image(systemName: "mic.fill")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(.white)
                .transition(.scale.combined(with: .opacity))

        case .recording:
            // Stop square (Talkie ActionDock pattern)
            RoundedRectangle(cornerRadius: 4)
                .fill(Color.white)
                .frame(width: 22, height: 22)
                .transition(.scale.combined(with: .opacity))

        case .transcribing:
            Image(systemName: "waveform")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(.white)
                .symbolEffect(.variableColor.iterative, options: .repeating)
                .transition(.scale.combined(with: .opacity))

        case .disabled:
            Image(systemName: "mic.slash")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(.white.opacity(0.5))
                .transition(.scale.combined(with: .opacity))
        }
    }

    // MARK: - Colors

    // Talkie-style warm red for the mic button — pops against dark backgrounds
    private static let micColor = Color(red: 1.0, green: 0.23, blue: 0.19) // #FF3B30

    private var buttonFillColor: Color {
        switch state {
        case .idle:         Self.micColor
        case .recording:    Self.micColor
        case .transcribing: DispatchColors.statusStreaming
        case .disabled:     DispatchColors.textMuted.opacity(0.3)
        }
    }

    private var buttonBorderColor: Color {
        switch state {
        case .idle:         Self.micColor.opacity(0.4)
        case .recording:    Self.micColor.opacity(0.6)
        case .transcribing: DispatchColors.statusStreaming.opacity(0.4)
        case .disabled:     DispatchColors.textMuted.opacity(0.15)
        }
    }

    // MARK: - Accessibility

    private var accessibilityLabel: String {
        switch state {
        case .idle:         "Microphone"
        case .recording:    "Stop recording"
        case .transcribing: "Transcribing audio"
        case .disabled:     "Microphone unavailable"
        }
    }

    private var accessibilityHint: String {
        switch state {
        case .idle:         "Tap to start voice recording, or hold for push-to-talk"
        case .recording:    "Tap to stop recording and transcribe"
        case .transcribing: "Please wait while audio is being transcribed"
        case .disabled:     "Voice input is not available"
        }
    }
}

// MARK: - BottomCircleButton (Talkie ActionDock pattern)

/// 48pt side button with iOS 26 Liquid Glass and pre-iOS 26 chrome metallic fallback.
/// Used for attachment (left) and keyboard toggle (right) in the action tray.
struct BottomCircleButton: View {
    let icon: String
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(isActive ? DispatchColors.textPrimary : DispatchColors.textSecondary)
                .frame(width: 44, height: 44)
                .background {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(.clear)
                        .glassEffect(.regular.interactive())
                }
        }
        .buttonStyle(.plain)
    }

}

// MARK: - Previews

#Preview("Mic - All States") {
    VStack(spacing: 32) {
        ForEach(
            [MicButtonState.idle, .recording, .transcribing, .disabled],
            id: \.self
        ) { micState in
            VStack(spacing: 8) {
                MicButton(state: micState, onTap: {})

                Text(String(describing: micState))
                    .font(DispatchTypography.caption(11))
                    .foregroundStyle(DispatchColors.textMuted)
            }
        }
    }
    .padding()
    .background(DispatchColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}

#Preview("BottomCircleButton") {
    HStack(spacing: 24) {
        BottomCircleButton(icon: "paperclip.circle", isActive: false) {}
        BottomCircleButton(icon: "keyboard", isActive: false) {}
        BottomCircleButton(icon: "keyboard.chevron.compact.down", isActive: true) {}
        BottomCircleButton(icon: "xmark", isActive: false) {}
    }
    .padding()
    .background(DispatchColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}
