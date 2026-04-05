// RecordingIndicator — Visual feedback shown above the dock while recording.
//
// Adapted from Talkie's push-to-talk overlay and RecordingView patterns.
//
// Recording (tap mode):   waveform, duration, "Tap to stop"
// Recording (push mode):  waveform, duration, "RELEASE TO SEND"
// Transcribing:           spinner with "Transcribing..." label

import SwiftUI

// MARK: - Recording Phase

enum RecordingPhase: Equatable {
    case recording(isPushToTalk: Bool)
    case transcribing
}

// MARK: - Recording Indicator

struct RecordingIndicator: View {
    let phase: RecordingPhase
    let duration: TimeInterval
    var audioLevels: [Float] = []

    var body: some View {
        Group {
            switch phase {
            case .recording(let isPushToTalk):
                recordingContent(isPushToTalk: isPushToTalk)
            case .transcribing:
                transcribingContent
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, DispatchSpacing.md)
        .padding(.vertical, DispatchSpacing.md)
        .background(DispatchColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: DispatchRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DispatchRadius.lg, style: .continuous)
                .strokeBorder(borderColor, lineWidth: 0.5)
        )
        .accessibilityElement(children: .combine)
    }

    private var borderColor: Color {
        switch phase {
        case .recording: DispatchColors.statusError.opacity(0.3)
        case .transcribing: DispatchColors.statusStreaming.opacity(0.3)
        }
    }

    // MARK: - Recording Content

    private func recordingContent(isPushToTalk: Bool) -> some View {
        VStack(spacing: DispatchSpacing.sm) {
            // Waveform visualization
            LiveWaveformBars(levels: audioLevels)
                .frame(height: 36)

            HStack(spacing: DispatchSpacing.sm) {
                // Pulsing red dot
                PulsingDot()

                // Duration
                Text(formattedDuration)
                    .font(DispatchTypography.code(14, weight: .medium))
                    .foregroundStyle(DispatchColors.textPrimary)
                    .monospacedDigit()
                    .contentTransition(.numericText())

                Text("  ·  ")
                    .foregroundStyle(DispatchColors.textMuted)

                // Mode hint
                Text(isPushToTalk ? "RELEASE TO SEND" : "Tap to stop")
                    .font(DispatchTypography.caption(11, weight: .medium))
                    .tracking(isPushToTalk ? 1 : 0)
                    .foregroundStyle(DispatchColors.textMuted)

                Spacer()
            }
        }
        .accessibilityLabel("Recording, \(formattedDuration)")
        .accessibilityHint(isPushToTalk
            ? "Release to stop recording and send"
            : "Tap the microphone button to stop recording"
        )
    }

    // MARK: - Transcribing Content

    private var transcribingContent: some View {
        HStack(spacing: DispatchSpacing.sm) {
            ProgressView()
                .controlSize(.small)
                .tint(DispatchColors.statusStreaming)

            Text("Transcribing...")
                .font(DispatchTypography.body(14, weight: .medium))
                .foregroundStyle(DispatchColors.textSecondary)

            Spacer()
        }
        .accessibilityLabel("Transcribing audio")
    }

    // MARK: - Formatting

    private var formattedDuration: String {
        let totalSeconds = Int(duration)
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// MARK: - Pulsing Red Dot

private struct PulsingDot: View {
    @State private var pulsing = false

    var body: some View {
        Circle()
            .fill(DispatchColors.statusError)
            .frame(width: 10, height: 10)
            .shadow(color: DispatchColors.statusError.opacity(0.6), radius: pulsing ? 6 : 2)
            .scaleEffect(pulsing ? 1.15 : 0.85)
            .animation(
                .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                value: pulsing
            )
            .onAppear { pulsing = true }
    }
}

// MARK: - Live Waveform Bars (driven by real audio levels)

struct LiveWaveformBars: View {
    let levels: [Float]

    private let barCount = 32
    private let barSpacing: CGFloat = 2.5
    private let barWidth: CGFloat = 3
    private let minHeight: CGFloat = 3
    private let maxHeight: CGFloat = 36

    var body: some View {
        HStack(spacing: barSpacing) {
            ForEach(0..<barCount, id: \.self) { index in
                let level = levelForBar(at: index)
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(DispatchColors.statusError.opacity(0.6 + Double(level) * 0.4))
                    .frame(
                        width: barWidth,
                        height: minHeight + CGFloat(level) * (maxHeight - minHeight)
                    )
                    .animation(.easeOut(duration: 0.08), value: level)
            }
        }
    }

    private func levelForBar(at index: Int) -> Float {
        guard !levels.isEmpty else {
            // Idle shimmer when no levels yet
            return 0.1 + Float.random(in: 0...0.15)
        }

        // Map bar index to level array
        let fraction = Float(index) / Float(barCount)
        let levelIndex = Int(fraction * Float(levels.count - 1))
        let clampedIndex = min(max(levelIndex, 0), levels.count - 1)
        return levels[clampedIndex]
    }
}

// MARK: - Static Waveform Bars (randomized animation fallback)

struct WaveformBars: View {
    private let barCount = 7
    @State private var animating = false

    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(0..<barCount, id: \.self) { index in
                WaveformBar(
                    index: index,
                    animating: animating
                )
            }
        }
        .frame(height: 24)
        .onAppear { animating = true }
    }
}

private struct WaveformBar: View {
    let index: Int
    let animating: Bool

    private var minHeight: CGFloat { 4 }
    private var maxHeight: CGFloat {
        let heights: [CGFloat] = [12, 18, 10, 22, 14, 20, 16]
        return heights[index % heights.count]
    }

    private var delay: Double {
        Double(index) * 0.08
    }

    @State private var currentHeight: CGFloat = 4

    var body: some View {
        RoundedRectangle(cornerRadius: 1.5)
            .fill(DispatchColors.statusError.opacity(0.7))
            .frame(width: 3, height: currentHeight)
            .onChange(of: animating) { _, isAnimating in
                if isAnimating { startAnimating() }
            }
            .onAppear {
                if animating { startAnimating() }
            }
    }

    private func startAnimating() {
        withAnimation(
            .easeInOut(duration: 0.4 + Double.random(in: 0...0.3))
            .repeatForever(autoreverses: true)
            .delay(delay)
        ) {
            currentHeight = maxHeight
        }
    }
}

// MARK: - Preview

#Preview("Recording - Tap Mode") {
    VStack(spacing: 24) {
        RecordingIndicator(
            phase: .recording(isPushToTalk: false),
            duration: 5,
            audioLevels: (0..<50).map { _ in Float.random(in: 0.05...0.8) }
        )

        RecordingIndicator(
            phase: .recording(isPushToTalk: true),
            duration: 3,
            audioLevels: (0..<30).map { _ in Float.random(in: 0.1...0.9) }
        )

        RecordingIndicator(phase: .transcribing, duration: 12)
    }
    .padding()
    .background(DispatchColors.backgroundAdaptive)
    .preferredColorScheme(.dark)
}
