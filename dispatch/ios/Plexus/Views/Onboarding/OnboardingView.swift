// OnboardingView — First-launch flow: value prop, permissions, model download.
//
// Three pages:
//   1. Welcome — what Plexus is, how to use it
//   2. Permissions — mic + speech recognition
//   3. Model — Parakeet download progress, Apple Speech fallback

import SwiftUI
import AVFoundation
import Speech

struct OnboardingView: View {
    @Binding var hasCompletedOnboarding: Bool
    @State private var page = 0

    var body: some View {
        TabView(selection: $page) {
            WelcomePage(onNext: { withAnimation { page = 1 } })
                .tag(0)
            ModelPage(onComplete: { withAnimation { page = 2 } })
                .tag(1)
            PermissionsPage(onNext: { hasCompletedOnboarding = true })
                .tag(2)
        }
        .tabViewStyle(.page(indexDisplayMode: .always))
        .indexViewStyle(.page(backgroundDisplayMode: .always))
        .background(PlexusColors.backgroundAdaptive)
        .interactiveDismissDisabled()
    }
}

// MARK: - Page 1: Welcome

private struct WelcomePage: View {
    let onNext: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: PlexusSpacing.xl) {
                // Icon
                ZStack {
                    Circle()
                        .fill(PlexusColors.accent.opacity(0.1))
                        .frame(width: 100, height: 100)
                    Image(systemName: "rectangle.connected.to.line.below")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(PlexusColors.accent)
                }

                VStack(spacing: PlexusSpacing.md) {
                    Text("Dispatch")
                        .font(PlexusTypography.body(32, weight: .bold))
                        .foregroundStyle(PlexusColors.textPrimary)

                    Text("Scout and your agents,\nright from your phone.")
                        .font(PlexusTypography.body(17))
                        .foregroundStyle(PlexusColors.textSecondary)
                        .multilineTextAlignment(.center)
                }

                // How it works
                VStack(alignment: .leading, spacing: PlexusSpacing.md) {
                    FeatureRow(icon: "mic.fill", text: "Voice or text input")
                    FeatureRow(icon: "lock.shield", text: "End-to-end encrypted")
                    FeatureRow(icon: "bolt.fill", text: "On-device transcription")
                    FeatureRow(icon: "puzzlepiece.extension", text: "Works with any AI agent")
                }
                .padding(.top, PlexusSpacing.lg)
            }

            Spacer()

            Button(action: onNext) {
                Text("Get Started")
                    .font(PlexusTypography.body(17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(PlexusColors.accent)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .padding(.horizontal, PlexusSpacing.xxl)
            .padding(.bottom, 60)
        }
    }
}

// MARK: - Page 2: Permissions

private struct PermissionsPage: View {
    let onNext: () -> Void

    @State private var micGranted: Bool?
    @State private var speechGranted: Bool?

    private var allGranted: Bool {
        micGranted == true && speechGranted == true
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: PlexusSpacing.xl) {
                ZStack {
                    Circle()
                        .fill(PlexusColors.accent.opacity(0.1))
                        .frame(width: 100, height: 100)
                    Image(systemName: "mic.badge.plus")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(PlexusColors.accent)
                }

                VStack(spacing: PlexusSpacing.md) {
                    Text("Permissions")
                        .font(PlexusTypography.body(28, weight: .bold))
                        .foregroundStyle(PlexusColors.textPrimary)

                    Text("Dispatch needs microphone access for voice input and speech recognition for transcription.")
                        .font(PlexusTypography.body(15))
                        .foregroundStyle(PlexusColors.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, PlexusSpacing.lg)
                }

                VStack(spacing: PlexusSpacing.md) {
                    PermissionRow(
                        icon: "mic.fill",
                        title: "Microphone",
                        subtitle: "For voice recording",
                        granted: micGranted
                    ) {
                        await requestMic()
                    }

                    PermissionRow(
                        icon: "waveform",
                        title: "Speech Recognition",
                        subtitle: "For on-device transcription",
                        granted: speechGranted
                    ) {
                        await requestSpeech()
                    }
                }
                .padding(.horizontal, PlexusSpacing.lg)
            }

            Spacer()

            Button(action: onNext) {
                Text(allGranted ? "Start Using Dispatch" : "Skip for Now")
                    .font(PlexusTypography.body(17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(allGranted ? PlexusColors.accent : PlexusColors.surfaceAdaptive)
                    .foregroundStyle(allGranted ? .white : PlexusColors.textSecondary)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(allGranted ? Color.clear : PlexusColors.border, lineWidth: 0.5)
                    )
            }
            .padding(.horizontal, PlexusSpacing.xxl)
            .padding(.bottom, 60)
        }
        .task {
            // Check existing status
            let micStatus = AVAudioApplication.shared.recordPermission
            micGranted = micStatus == .granted

            let speechStatus = SFSpeechRecognizer.authorizationStatus()
            speechGranted = speechStatus == .authorized
        }
    }

    private func requestMic() async {
        let granted = await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
        micGranted = granted
    }

    private func requestSpeech() async {
        let granted = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
        speechGranted = granted
    }
}

// MARK: - Page 3: Model Download

private struct ModelPage: View {
    let onComplete: () -> Void

    #if canImport(FluidAudio)
    @ObservedObject private var parakeet = ParakeetModelManager.shared
    #endif

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: PlexusSpacing.xl) {
                ZStack {
                    Circle()
                        .fill(PlexusColors.statusActive.opacity(0.1))
                        .frame(width: 100, height: 100)
                    Image(systemName: "cpu")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(PlexusColors.statusActive)
                }

                VStack(spacing: PlexusSpacing.md) {
                    Text("Voice Engine")
                        .font(PlexusTypography.body(28, weight: .bold))
                        .foregroundStyle(PlexusColors.textPrimary)

                    Text("Dispatch uses on-device AI for private speech-to-text. No data leaves your phone.")
                        .font(PlexusTypography.body(15))
                        .foregroundStyle(PlexusColors.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, PlexusSpacing.lg)
                }

                VStack(spacing: PlexusSpacing.md) {
                    // Apple Speech — always available
                    HStack(spacing: PlexusSpacing.md) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(PlexusColors.statusActive)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Apple Speech")
                                .font(PlexusTypography.body(15, weight: .medium))
                                .foregroundStyle(PlexusColors.textPrimary)
                            Text("Ready now — built into iOS")
                                .font(PlexusTypography.caption(13))
                                .foregroundStyle(PlexusColors.textSecondary)
                        }
                        Spacer()
                    }
                    .padding(PlexusSpacing.md)
                    .background(PlexusColors.surfaceAdaptive)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    // Parakeet — loading in background
                    #if canImport(FluidAudio)
                    HStack(spacing: PlexusSpacing.md) {
                        parakeetIcon

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Parakeet AI")
                                .font(PlexusTypography.body(15, weight: .medium))
                                .foregroundStyle(PlexusColors.textPrimary)
                            Text(parakeetSubtitle)
                                .font(PlexusTypography.caption(13))
                                .foregroundStyle(PlexusColors.textSecondary)
                        }
                        Spacer()
                    }
                    .padding(PlexusSpacing.md)
                    .background(PlexusColors.surfaceAdaptive)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    #endif
                }
                .padding(.horizontal, PlexusSpacing.lg)
            }

            Spacer()

            VStack(spacing: PlexusSpacing.sm) {
                #if canImport(FluidAudio)
                if !parakeet.isReady {
                    Text("Parakeet is loading in the background. You can start using Dispatch now.")
                        .font(PlexusTypography.caption(13))
                        .foregroundStyle(PlexusColors.textMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, PlexusSpacing.xxl)
                }
                #endif

                Button(action: onComplete) {
                    Text("Continue")
                        .font(PlexusTypography.body(17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(PlexusColors.accent)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .padding(.horizontal, PlexusSpacing.xxl)
            }
            .padding(.bottom, 60)
        }
    }

    #if canImport(FluidAudio)
    @ViewBuilder
    private var parakeetIcon: some View {
        switch parakeet.state {
        case .ready:
            Image(systemName: parakeet.isWarmedUp ? "checkmark.circle.fill" : "arrow.trianglehead.clockwise")
                .font(.system(size: 20))
                .foregroundStyle(parakeet.isWarmedUp ? PlexusColors.statusActive : PlexusColors.statusStreaming)
        case .downloading:
            ProgressView()
                .controlSize(.small)
        case .loading:
            ProgressView()
                .controlSize(.small)
        case .error:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(PlexusColors.statusError)
        default:
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 20))
                .foregroundStyle(PlexusColors.textMuted)
        }
    }

    private var parakeetSubtitle: String {
        switch parakeet.state {
        case .notDownloaded: "Waiting to download..."
        case .downloading(let p): "Downloading \(Int(p * 100))%..."
        case .downloaded: "Downloaded, loading..."
        case .loading: "Loading model..."
        case .ready: parakeet.isWarmedUp ? "Ready — on-device AI" : "Warming up..."
        case .error(let e): "Error: \(e)"
        }
    }
    #endif
}

// MARK: - Supporting Views

private struct FeatureRow: View {
    let icon: String
    let text: String

    var body: some View {
        HStack(spacing: PlexusSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(PlexusColors.accent)
                .frame(width: 28)
            Text(text)
                .font(PlexusTypography.body(15))
                .foregroundStyle(PlexusColors.textPrimary)
        }
    }
}

private struct PermissionRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let granted: Bool?
    let request: () async -> Void

    var body: some View {
        HStack(spacing: PlexusSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(statusColor)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(PlexusTypography.body(15, weight: .medium))
                    .foregroundStyle(PlexusColors.textPrimary)
                Text(subtitle)
                    .font(PlexusTypography.caption(13))
                    .foregroundStyle(PlexusColors.textSecondary)
            }

            Spacer()

            if granted == true {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(PlexusColors.statusActive)
            } else {
                Button("Allow") {
                    Task { await request() }
                }
                .font(PlexusTypography.body(14, weight: .semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(PlexusColors.accent)
                .foregroundStyle(.white)
                .clipShape(Capsule())
            }
        }
        .padding(PlexusSpacing.md)
        .background(PlexusColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var statusColor: Color {
        switch granted {
        case true: PlexusColors.statusActive
        case false: PlexusColors.statusError
        case nil: PlexusColors.textMuted
        default: PlexusColors.textMuted
        }
    }
}
