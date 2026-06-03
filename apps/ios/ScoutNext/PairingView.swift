import SwiftUI
import HudsonUI

/// Pair with a Mac by scanning the QR it shows in the desktop app. On a valid
/// scan we run the Noise XX handshake, persist the trusted bridge to the
/// keychain, and stay connected — subsequent launches reconnect via IK.
struct PairingView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var isScanning = true
    @State private var status: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: HudSpacing.xl) {
                Text("Scan the pairing QR shown in Scout on your Mac.")
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(HudPalette.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, HudSpacing.xxl)

                HudQRScanner(isActive: isScanning) { code in
                    guard isScanning else { return }
                    isScanning = false
                    Task { await handle(code) }
                }
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                        .stroke(HudPalette.accent.opacity(0.5), lineWidth: HudStrokeWidth.standard)
                )
                .padding(.horizontal, HudSpacing.xxl)

                if let status {
                    HStack(spacing: HudSpacing.sm) {
                        if case .connecting = model.connectionState {
                            ProgressView().controlSize(.small).tint(HudPalette.accent)
                        }
                        Text(status)
                            .font(HudFont.mono(HudTextSize.xs))
                            .foregroundStyle(isFailure ? HudPalette.statusError : HudPalette.muted)
                    }
                    if isFailure {
                        HudButton("Scan again", icon: "qrcode.viewfinder", style: .secondary) {
                            self.status = nil
                            isScanning = true
                        }
                    }
                }
                Spacer()
            }
            .padding(.top, HudSpacing.xxl)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(HudPalette.bg)
            .navigationTitle("Pair with Mac")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { dismiss() }
                        .foregroundStyle(HudPalette.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var isFailure: Bool {
        if case .failed = model.connectionState { return true }
        return false
    }

    private func handle(_ code: String) async {
        status = "Pairing…"
        let ok = await model.pair(scanned: code)
        if ok {
            dismiss()
        } else {
            status = {
                if case .failed(let message) = model.connectionState { return message }
                return "Pairing failed"
            }()
        }
    }
}
