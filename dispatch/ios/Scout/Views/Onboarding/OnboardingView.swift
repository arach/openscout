// OnboardingView — First-launch flow: value prop, permissions, model download.
//
// Three pages:
//   1. Welcome — what Scout is, how to use it
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
        .background(DispatchColors.backgroundAdaptive)
        .interactiveDismissDisabled()
    }
}

// MARK: - Page 1: Welcome

private struct WelcomePage: View {
    let onNext: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: DispatchSpacing.xl) {
                // Icon
                ZStack {
                    Circle()
                        .fill(DispatchColors.accent.opacity(0.1))
                        .frame(width: 100, height: 100)
                    Image(systemName: "rectangle.connected.to.line.below")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(DispatchColors.accent)
                }

                VStack(spacing: DispatchSpacing.md) {
                    Text("Scout")
                        .font(DispatchTypography.body(32, weight: .bold))
                        .foregroundStyle(DispatchColors.textPrimary)

                    Text("Scout and your agents,\nright from your phone.")
                        .font(DispatchTypography.body(17))
                        .foregroundStyle(DispatchColors.textSecondary)
                        .multilineTextAlignment(.center)
                }

                // How it works
                VStack(alignment: .leading, spacing: DispatchSpacing.md) {
                    FeatureRow(icon: "mic.fill", text: "Voice or text input")
                    FeatureRow(icon: "lock.shield", text: "End-to-end encrypted")
                    FeatureRow(icon: "bolt.fill", text: "On-device transcription")
                    FeatureRow(icon: "puzzlepiece.extension", text: "Works with any AI agent")
                }
                .padding(.top, DispatchSpacing.lg)
            }

            Spacer()

            Button(action: onNext) {
                Text("Get Started")
                    .font(DispatchTypography.body(17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(DispatchColors.accent)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .padding(.horizontal, DispatchSpacing.xxl)
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

            VStack(spacing: DispatchSpacing.xl) {
                ZStack {
                    Circle()
                        .fill(DispatchColors.accent.opacity(0.1))
                        .frame(width: 100, height: 100)
                    Image(systemName: "mic.badge.plus")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(DispatchColors.accent)
                }

                VStack(spacing: DispatchSpacing.md) {
                    Text("Permissions")
                        .font(DispatchTypography.body(28, weight: .bold))
                        .foregroundStyle(DispatchColors.textPrimary)

                    Text("Scout needs microphone access for voice input and speech recognition for transcription.")
                        .font(DispatchTypography.body(15))
                        .foregroundStyle(DispatchColors.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, DispatchSpacing.lg)
                }

                VStack(spacing: DispatchSpacing.md) {
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
                .padding(.horizontal, DispatchSpacing.lg)
            }

            Spacer()

            Button(action: onNext) {
                Text(allGranted ? "Start Using Scout" : "Skip for Now")
                    .font(DispatchTypography.body(17, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(allGranted ? DispatchColors.accent : DispatchColors.surfaceAdaptive)
                    .foregroundStyle(allGranted ? .white : DispatchColors.textSecondary)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(allGranted ? Color.clear : DispatchColors.border, lineWidth: 0.5)
                    )
            }
            .padding(.horizontal, DispatchSpacing.xxl)
            .padding(.bottom, 60)
        }
        .task {
            // Check existing status
            micGranted = PermissionAuthorizations.microphoneGranted()
            speechGranted = PermissionAuthorizations.speechGranted()
        }
    }

    @MainActor
    private func requestMic() async {
        micGranted = await PermissionAuthorizations.requestMicrophone()
    }

    @MainActor
    private func requestSpeech() async {
        speechGranted = await PermissionAuthorizations.requestSpeechRecognition()
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

            VStack(spacing: DispatchSpacing.xl) {
                ZStack {
                    Circle()
                        .fill(DispatchColors.statusActive.opacity(0.1))
                        .frame(width: 100, height: 100)
                    Image(systemName: "cpu")
                        .font(.system(size: 44, weight: .light))
                        .foregroundStyle(DispatchColors.statusActive)
                }

                VStack(spacing: DispatchSpacing.md) {
                    Text("Voice Engine")
                        .font(DispatchTypography.body(28, weight: .bold))
                        .foregroundStyle(DispatchColors.textPrimary)

                    Text("Scout uses on-device AI for private speech-to-text. No data leaves your phone.")
                        .font(DispatchTypography.body(15))
                        .foregroundStyle(DispatchColors.textSecondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, DispatchSpacing.lg)
                }

                VStack(spacing: DispatchSpacing.md) {
                    // Apple Speech — always available
                    HStack(spacing: DispatchSpacing.md) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(DispatchColors.statusActive)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Apple Speech")
                                .font(DispatchTypography.body(15, weight: .medium))
                                .foregroundStyle(DispatchColors.textPrimary)
                            Text("Ready now — built into iOS")
                                .font(DispatchTypography.caption(13))
                                .foregroundStyle(DispatchColors.textSecondary)
                        }
                        Spacer()
                    }
                    .padding(DispatchSpacing.md)
                    .background(DispatchColors.surfaceAdaptive)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    // Parakeet — loading in background
                    #if canImport(FluidAudio)
                    HStack(spacing: DispatchSpacing.md) {
                        parakeetIcon

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Parakeet AI")
                                .font(DispatchTypography.body(15, weight: .medium))
                                .foregroundStyle(DispatchColors.textPrimary)
                            Text(parakeetSubtitle)
                                .font(DispatchTypography.caption(13))
                                .foregroundStyle(DispatchColors.textSecondary)
                        }
                        Spacer()
                    }
                    .padding(DispatchSpacing.md)
                    .background(DispatchColors.surfaceAdaptive)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    #endif
                }
                .padding(.horizontal, DispatchSpacing.lg)
            }

            Spacer()

            VStack(spacing: DispatchSpacing.sm) {
                #if canImport(FluidAudio)
                if !parakeet.isReady {
                    Text("Parakeet is loading in the background. You can start using Scout now.")
                        .font(DispatchTypography.caption(13))
                        .foregroundStyle(DispatchColors.textMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, DispatchSpacing.xxl)
                }
                #endif

                Button(action: onComplete) {
                    Text("Continue")
                        .font(DispatchTypography.body(17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(DispatchColors.accent)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .padding(.horizontal, DispatchSpacing.xxl)
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
                .foregroundStyle(parakeet.isWarmedUp ? DispatchColors.statusActive : DispatchColors.statusStreaming)
        case .downloading:
            ProgressView()
                .controlSize(.small)
        case .loading:
            ProgressView()
                .controlSize(.small)
        case .error:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 20))
                .foregroundStyle(DispatchColors.statusError)
        default:
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 20))
                .foregroundStyle(DispatchColors.textMuted)
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
        HStack(spacing: DispatchSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(DispatchColors.accent)
                .frame(width: 28)
            Text(text)
                .font(DispatchTypography.body(15))
                .foregroundStyle(DispatchColors.textPrimary)
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
        HStack(spacing: DispatchSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(statusColor)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(DispatchTypography.body(15, weight: .medium))
                    .foregroundStyle(DispatchColors.textPrimary)
                Text(subtitle)
                    .font(DispatchTypography.caption(13))
                    .foregroundStyle(DispatchColors.textSecondary)
            }

            Spacer()

            if granted == true {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 22))
                    .foregroundStyle(DispatchColors.statusActive)
            } else {
                Button("Allow") {
                    Task { await request() }
                }
                .font(DispatchTypography.body(14, weight: .semibold))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(DispatchColors.accent)
                .foregroundStyle(.white)
                .clipShape(Capsule())
            }
        }
        .padding(DispatchSpacing.md)
        .background(DispatchColors.surfaceAdaptive)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var statusColor: Color {
        switch granted {
        case true: DispatchColors.statusActive
        case false: DispatchColors.statusError
        case nil: DispatchColors.textMuted
        default: DispatchColors.textMuted
        }
    }
}
