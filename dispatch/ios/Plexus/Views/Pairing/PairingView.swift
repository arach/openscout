// PairingView — Welcome screen and QR scan flow for first connection.
//
// Shows Plexus branding, instructions, and a "Scan QR Code" button.
// After successful scan: connecting animation -> handshake -> transition to session list.

import SwiftUI
import AVFoundation

struct PairingView: View {
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection

    @State private var showingScanner = false
    @State private var pairingState: PairingState = .idle
    @State private var errorMessage: String?
    @State private var cameraPermission: CameraPermission = .unknown

    enum PairingState: Equatable {
        case idle
        case scanning
        case connecting
        case handshaking
        case success
        case failed(String)
    }

    enum CameraPermission {
        case unknown, granted, denied
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            branding
                .padding(.bottom, PlexusSpacing.xxl)

            stateContent
                .padding(.horizontal, PlexusSpacing.xxl)

            Spacer()

            instructions
                .padding(.bottom, PlexusSpacing.xxl)
        }
        .background(PlexusColors.backgroundAdaptive)
        .fullScreenCover(isPresented: $showingScanner) {
            scannerSheet
        }
        .onAppear {
            checkCameraPermission()
        }
        .onChange(of: connection.state) { _, newState in
            updatePairingState(from: newState)
        }
    }

    // MARK: - Branding

    private var branding: some View {
        VStack(spacing: PlexusSpacing.lg) {
            // App icon / logo
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [PlexusColors.accent.opacity(0.2), PlexusColors.accent.opacity(0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 100, height: 100)

                Image(systemName: "link.circle.fill")
                    .font(.system(size: 48, weight: .light))
                    .foregroundStyle(PlexusColors.accent)
                    .symbolRenderingMode(.hierarchical)
            }

            VStack(spacing: PlexusSpacing.sm) {
                Text("Plexus")
                    .font(.system(size: 34, weight: .bold, design: .default))
                    .foregroundStyle(PlexusColors.textPrimary)

                Text("Your AI agents, in your pocket")
                    .font(PlexusTypography.body(16))
                    .foregroundStyle(PlexusColors.textSecondary)
            }
        }
    }

    // MARK: - State Content

    @ViewBuilder
    private var stateContent: some View {
        switch pairingState {
        case .idle:
            scanButton

        case .scanning:
            EmptyView()

        case .connecting:
            connectingView(label: "Connecting to bridge...")

        case .handshaking:
            connectingView(label: "Establishing secure channel...")

        case .success:
            successView

        case .failed(let message):
            failedView(message: message)
        }
    }

    // MARK: - Scan Button

    private var scanButton: some View {
        VStack(spacing: PlexusSpacing.lg) {
            Button {
                startScanning()
            } label: {
                HStack(spacing: PlexusSpacing.md) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 20, weight: .medium))
                    Text("Scan QR Code")
                        .font(PlexusTypography.body(17, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, PlexusSpacing.lg)
                .background(PlexusColors.accent)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: PlexusRadius.lg, style: .continuous))
            }
            .accessibilityHint("Open the camera to scan a pairing QR code from your bridge")

            if cameraPermission == .denied {
                cameraPermissionWarning
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(PlexusTypography.body(14))
                    .foregroundStyle(PlexusColors.statusError)
                    .multilineTextAlignment(.center)
                    .transition(.opacity)
            }
        }
    }

    private var cameraPermissionWarning: some View {
        VStack(spacing: PlexusSpacing.sm) {
            Text("Camera access is required to scan QR codes.")
                .font(PlexusTypography.body(14))
                .foregroundStyle(PlexusColors.textSecondary)
                .multilineTextAlignment(.center)

            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .font(PlexusTypography.body(14, weight: .medium))
            .foregroundStyle(PlexusColors.accent)
        }
    }

    // MARK: - Connecting View

    private func connectingView(label: String) -> some View {
        VStack(spacing: PlexusSpacing.lg) {
            ProgressView()
                .controlSize(.large)
                .tint(PlexusColors.accent)

            Text(label)
                .font(PlexusTypography.body(16, weight: .medium))
                .foregroundStyle(PlexusColors.textSecondary)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
    }

    // MARK: - Success View

    private var successView: some View {
        VStack(spacing: PlexusSpacing.lg) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(PlexusColors.statusActive)
                .symbolEffect(.bounce, value: pairingState)

            Text("Connected!")
                .font(PlexusTypography.body(18, weight: .semibold))
                .foregroundStyle(PlexusColors.textPrimary)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.9)))
    }

    // MARK: - Failed View

    private func failedView(message: String) -> some View {
        VStack(spacing: PlexusSpacing.lg) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36))
                .foregroundStyle(PlexusColors.statusError)

            Text(message)
                .font(PlexusTypography.body(15))
                .foregroundStyle(PlexusColors.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                withAnimation {
                    pairingState = .idle
                    errorMessage = nil
                }
            } label: {
                Text("Try Again")
                    .font(PlexusTypography.body(15, weight: .semibold))
                    .foregroundStyle(PlexusColors.accent)
            }
        }
        .transition(.opacity)
    }

    // MARK: - Instructions

    private var instructions: some View {
        VStack(spacing: PlexusSpacing.sm) {
            Text("On your computer, run:")
                .font(PlexusTypography.caption(13))
                .foregroundStyle(PlexusColors.textMuted)

            Text("plexus bridge --pair")
                .font(PlexusTypography.code(14, weight: .medium))
                .foregroundStyle(PlexusColors.accent)
                .padding(.horizontal, PlexusSpacing.lg)
                .padding(.vertical, PlexusSpacing.sm)
                .background(PlexusColors.surfaceAdaptive)
                .clipShape(RoundedRectangle(cornerRadius: PlexusRadius.sm, style: .continuous))
                .textSelection(.enabled)

            Text("Then scan the QR code it displays.")
                .font(PlexusTypography.caption(13))
                .foregroundStyle(PlexusColors.textMuted)
        }
    }

    // MARK: - Scanner Sheet

    private var scannerSheet: some View {
        ZStack(alignment: .top) {
            QRScannerView { result in
                showingScanner = false

                switch result {
                case .success(let payload):
                    withAnimation {
                        pairingState = .connecting
                    }
                    Task {
                        do {
                            try await connection.connect(qrPayload: payload)
                        } catch {
                            await MainActor.run {
                                withAnimation {
                                    pairingState = .failed(error.localizedDescription)
                                }
                            }
                        }
                    }

                case .failure(let error):
                    withAnimation {
                        pairingState = .failed(error.localizedDescription)
                    }
                }
            }
            .ignoresSafeArea()

            // Dismiss button overlay
            HStack {
                Button {
                    showingScanner = false
                    pairingState = .idle
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 30))
                        .foregroundStyle(.white.opacity(0.8))
                        .symbolRenderingMode(.hierarchical)
                }
                .padding(.leading, PlexusSpacing.lg)
                .padding(.top, PlexusSpacing.xl)

                Spacer()
            }

            // Instruction text below viewfinder
            VStack {
                Spacer()
                Text("Point at the QR code on your terminal")
                    .font(PlexusTypography.body(15, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, PlexusSpacing.xl)
                    .padding(.vertical, PlexusSpacing.md)
                    .background(.ultraThinMaterial)
                    .clipShape(Capsule())
                    .padding(.bottom, 100)
            }
        }
    }

    // MARK: - Helpers

    private func startScanning() {
        switch cameraPermission {
        case .unknown:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor in
                    cameraPermission = granted ? .granted : .denied
                    if granted {
                        showingScanner = true
                        pairingState = .scanning
                    }
                }
            }
        case .granted:
            showingScanner = true
            pairingState = .scanning
        case .denied:
            // Warning is already shown inline
            break
        }
    }

    private func checkCameraPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            cameraPermission = .granted
        case .denied, .restricted:
            cameraPermission = .denied
        case .notDetermined:
            cameraPermission = .unknown
        @unknown default:
            cameraPermission = .unknown
        }
    }

    private func updatePairingState(from connectionState: ConnectionState) {
        withAnimation(.easeInOut(duration: 0.3)) {
            switch connectionState {
            case .connecting:
                pairingState = .connecting
            case .handshaking:
                pairingState = .handshaking
            case .connected:
                pairingState = .success
            case .failed(let error):
                pairingState = .failed(error.localizedDescription)
            case .disconnected, .reconnecting:
                break
            }
        }
    }
}

// MARK: - Preview

#Preview {
    PairingView()
        .environment(SessionStore.preview)
        .environment(ConnectionManager.preview())
        .preferredColorScheme(.dark)
}
