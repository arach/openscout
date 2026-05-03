// PairingView — Welcome screen and QR scan flow for first connection.
//
// Shows Scout branding, instructions, and a "Scan QR Code" button.
// After successful scan: connecting animation -> handshake -> transition to session list.

import SwiftUI
import AVFoundation

struct PairingView: View {
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection

    @AppStorage("scout.tsn.enabled") private var tsnEnabled = true
    @AppStorage("scout.osn.enabled") private var osnEnabled = false

    @State private var showingScanner = false
    @State private var showingOSNDiscovery = false
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
                .padding(.bottom, ScoutSpacing.xxl)

            stateContent
                .padding(.horizontal, ScoutSpacing.xxl)

            Spacer()

            instructions
                .padding(.bottom, ScoutSpacing.xxl)
        }
        .background(ScoutColors.backgroundAdaptive)
        .fullScreenCover(isPresented: $showingScanner) {
            scannerSheet
        }
        .sheet(isPresented: $showingOSNDiscovery) {
            NavigationStack {
                OSNDiscoveryView()
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Done") { showingOSNDiscovery = false }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
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
        VStack(spacing: ScoutSpacing.lg) {
            // App icon / logo
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [ScoutColors.accent.opacity(0.2), ScoutColors.accent.opacity(0.05)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 100, height: 100)

                Image(systemName: "link.circle.fill")
                    .font(.system(size: 48, weight: .light))
                    .foregroundStyle(ScoutColors.accent)
                    .symbolRenderingMode(.hierarchical)
            }

            VStack(spacing: ScoutSpacing.sm) {
                Text("Scout")
                    .font(.system(size: 34, weight: .bold, design: .default))
                    .foregroundStyle(ScoutColors.textPrimary)

                Text("Your AI agents, in your pocket")
                    .font(ScoutTypography.body(16))
                    .foregroundStyle(ScoutColors.textSecondary)
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
        VStack(spacing: ScoutSpacing.lg) {
            Button {
                startScanning()
            } label: {
                HStack(spacing: ScoutSpacing.md) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 20, weight: .medium))
                    Text("Scan QR Code")
                        .font(ScoutTypography.body(17, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, ScoutSpacing.lg)
                .background(ScoutColors.accent)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
            }
            .accessibilityHint("Open the camera to scan a pairing QR code from your bridge")

            Button {
                showingOSNDiscovery = true
            } label: {
                HStack(spacing: ScoutSpacing.md) {
                    Image(systemName: "point.3.connected.trianglepath.dotted")
                        .font(.system(size: 17, weight: .medium))
                    Text("Find via OSN")
                        .font(ScoutTypography.body(15, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, ScoutSpacing.md)
                .background(ScoutColors.surfaceRaisedAdaptive)
                .foregroundStyle(ScoutColors.textPrimary)
                .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                        .strokeBorder(ScoutColors.border, lineWidth: 0.5)
                )
            }
            .buttonStyle(.plain)

            routeModes

            if cameraPermission == .denied {
                cameraPermissionWarning
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.statusError)
                    .multilineTextAlignment(.center)
                    .transition(.opacity)
            }
        }
    }

    private var routeModes: some View {
        HStack(spacing: ScoutSpacing.sm) {
            PairingRouteToken(label: "LAN", active: true)
            PairingRouteToken(label: "TSN", active: tsnEnabled)
            PairingRouteToken(label: "OSN", active: osnEnabled)
        }
    }

    private var cameraPermissionWarning: some View {
        VStack(spacing: ScoutSpacing.sm) {
            Text("Camera access is required to scan QR codes.")
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)

            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .font(ScoutTypography.body(14, weight: .medium))
            .foregroundStyle(ScoutColors.accent)
        }
    }

    // MARK: - Connecting View

    private func connectingView(label: String) -> some View {
        VStack(spacing: ScoutSpacing.lg) {
            ProgressView()
                .controlSize(.large)
                .tint(ScoutColors.accent)

            Text(label)
                .font(ScoutTypography.body(16, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
    }

    // MARK: - Success View

    private var successView: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 48))
                .foregroundStyle(ScoutColors.statusActive)
                .symbolEffect(.bounce, value: pairingState)

            Text("Connected!")
                .font(ScoutTypography.body(18, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)
        }
        .transition(.opacity.combined(with: .scale(scale: 0.9)))
    }

    // MARK: - Failed View

    private func failedView(message: String) -> some View {
        VStack(spacing: ScoutSpacing.lg) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36))
                .foregroundStyle(ScoutColors.statusError)

            Text(message)
                .font(ScoutTypography.body(15))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)

            Button {
                withAnimation {
                    pairingState = .idle
                    errorMessage = nil
                }
            } label: {
                Text("Try Again")
                    .font(ScoutTypography.body(15, weight: .semibold))
                    .foregroundStyle(ScoutColors.accent)
            }
        }
        .transition(.opacity)
    }

    // MARK: - Instructions

    private var instructions: some View {
        VStack(spacing: ScoutSpacing.sm) {
            Text("On your computer, run the current pairing command:")
                .font(ScoutTypography.caption(13))
                .foregroundStyle(ScoutColors.textMuted)

            Text("scout pair")
                .font(ScoutTypography.code(14, weight: .medium))
                .foregroundStyle(ScoutColors.accent)
                .padding(.horizontal, ScoutSpacing.lg)
                .padding(.vertical, ScoutSpacing.sm)
                .background(ScoutColors.surfaceAdaptive)
                .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
                .textSelection(.enabled)

            Text("Then scan the QR code in Scout.")
                .font(ScoutTypography.caption(13))
                .foregroundStyle(ScoutColors.textMuted)
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
                .padding(.leading, ScoutSpacing.lg)
                .padding(.top, ScoutSpacing.xl)

                Spacer()
            }

            // Instruction text below viewfinder
            VStack {
                Spacer()
                Text("Point at the QR code on your terminal")
                    .font(ScoutTypography.body(15, weight: .medium))
                    .foregroundStyle(.white)
                    .padding(.horizontal, ScoutSpacing.xl)
                    .padding(.vertical, ScoutSpacing.md)
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

private struct PairingRouteToken: View {
    let label: String
    let active: Bool

    var body: some View {
        Text(label)
            .font(ScoutTypography.code(11, weight: .semibold))
            .foregroundStyle(active ? ScoutColors.textPrimary : ScoutColors.textMuted)
            .frame(minWidth: 42)
            .padding(.vertical, ScoutSpacing.xs)
            .background(active ? ScoutColors.textPrimary.opacity(0.08) : ScoutColors.surfaceAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
    }
}

// MARK: - Preview

#Preview {
    PairingView()
        .environment(SessionStore.preview)
        .environment(ConnectionManager.preview())
        .preferredColorScheme(.dark)
}
