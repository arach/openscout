import SwiftUI
import HudsonUI
import HudsonUICapture   // HudQRScanner moved here in the optional-iOS-features split
#if canImport(UIKit)
import UIKit
#endif

/// Pair with a Mac by scanning the QR it shows in the desktop app. On a valid
/// scan we run the Noise XX handshake, persist the trusted bridge to the
/// keychain, and stay connected — subsequent launches reconnect via IK.
struct PairingView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var isScanning = true
    @State private var status: String?
    @State private var pairingTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: HudSpacing.xl) {
                    discoverySection
                    scannerSection
                    pasteSection
                    statusSection
                }
                .padding(.top, HudSpacing.xl)
                .padding(.bottom, HudSpacing.xxxl)
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
        .task {
            await model.refreshPairingDiscoveryTargets()
        }
        .onDisappear {
            pairingTask?.cancel()
            pairingTask = nil
            isScanning = false
        }
    }

    private var isFailure: Bool {
        if case .failed = model.connectionState { return true }
        return false
    }

    private var discoveryBusy: Bool {
        model.isRefreshingLanPairTargets
            || model.isRefreshingTailnetPairTargets
            || model.isRefreshingOpenScoutNetworkPairTargets
    }

    private var isPairing: Bool { pairingTask != nil }

    private var discoverySection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack {
                sectionLabel("DISCOVERED MACS")
                Spacer()
                Button {
                    Task { await model.refreshPairingDiscoveryTargets() }
                } label: {
                    if discoveryBusy {
                        ProgressView().controlSize(.mini).tint(ScoutInk.muted)
                    } else {
                        HStack(spacing: HudSpacing.xxs) {
                            Image(systemName: "arrow.clockwise")
                            Text("Rescan")
                        }
                        .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                        .foregroundStyle(ScoutInk.muted)
                    }
                }
                .buttonStyle(.plain)
                .disabled(discoveryBusy || isPairing)
            }

            discoveryRows
        }
        .padding(.horizontal, HudSpacing.xxl)
    }

    @ViewBuilder private var discoveryRows: some View {
        VStack(spacing: 0) {
            ForEach(model.lanPairTargets) { target in
                DiscoveryPairRow(
                    name: target.displayName,
                    detail: model.lanPairAwaitingApproval && model.lanPairingTargetId == target.id
                        ? "waiting for approval · \(target.hostName)"
                        : target.detail,
                    badge: model.lanPairAwaitingApproval && model.lanPairingTargetId == target.id ? "WAITING" : "PAIR",
                    isActive: true,
                    isBusy: model.lanPairingTargetId == target.id,
                    isDisabled: isPairing || model.lanPairingTargetId != nil
                ) {
                    startPairing { await handleLanTarget(target) }
                }
            }

            ForEach(model.tailnetPairTargets) { target in
                let awaiting = model.tailnetPairAwaitingApproval && model.tailnetPairingTargetId == target.id
                DiscoveryPairRow(
                    name: target.displayName,
                    detail: awaiting ? "waiting for approval · \(target.dnsName)" : target.detail,
                    badge: awaiting ? "WAITING" : "PAIR",
                    isActive: target.isOnline,
                    isBusy: model.tailnetPairingTargetId == target.id,
                    isDisabled: isPairing || !target.isOnline || model.tailnetPairingTargetId != nil
                ) {
                    startPairing { await handleTailnetTarget(target) }
                }
            }

            ForEach(model.openScoutNetworkPairTargets) { target in
                DiscoveryPairRow(
                    name: target.displayName,
                    detail: target.detail,
                    badge: "PAIR",
                    isActive: true,
                    isBusy: model.openScoutNetworkPairingTargetId == target.id,
                    isDisabled: isPairing || model.openScoutNetworkPairingTargetId != nil
                ) {
                    startPairing { await handleOpenScoutNetworkTarget(target) }
                }
            }
        }

        if model.lanPairTargets.isEmpty
            && model.tailnetPairTargets.isEmpty
            && model.openScoutNetworkPairTargets.isEmpty {
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                if discoveryBusy {
                    HStack(spacing: HudSpacing.sm) {
                        ProgressView().controlSize(.small).tint(HudPalette.accent)
                        Text("Looking for pairable Macs…")
                            .font(HudFont.ui(HudTextSize.sm))
                            .foregroundStyle(ScoutInk.muted)
                    }
                } else {
                    Text("No pairable Macs found yet.")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutInk.dim)
                }
                tailnetDiscoveryReadout
                if let error = model.tailnetPairError {
                    Text("Tailnet: \(error)")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(HudPalette.statusError)
                        .lineLimit(2)
                }
                if let error = model.openScoutNetworkPairError {
                    Text("OpenScout Network: \(error)")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(HudPalette.statusError)
                        .lineLimit(2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private var tailnetDiscoveryReadout: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Tailnet scan")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(ScoutInk.dim)
            Text(tailnetDiscoveryText)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.muted)
                .lineLimit(3)
        }
        .padding(.top, HudSpacing.xs)
    }

    private var tailnetDiscoveryText: String {
        if !model.hasTrustedBridge {
            return "Pair one Mac first; the phone asks that Mac for your Tailnet peers."
        }
        if let status = model.tailnetPairProbeStatus {
            let anchors = model.tailnetPairDiscoveryHosts.isEmpty
                ? "no anchors"
                : model.tailnetPairDiscoveryHosts.joined(separator: ", ")
            return "\(status) · \(anchors)"
        }
        if model.tailnetPairDiscoveryHosts.isEmpty {
            return "No saved Tailnet relay host yet."
        }
        return "Ready to scan via \(model.tailnetPairDiscoveryHosts.joined(separator: ", "))"
    }

    private var scannerSection: some View {
        VStack(spacing: HudSpacing.md) {
            sectionLabel("QR FALLBACK")
                .frame(maxWidth: .infinity, alignment: .leading)

            Text("Scan the pairing QR shown in Scout on your Mac.")
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutInk.muted)
                .multilineTextAlignment(.center)

            HudQRScanner(isActive: isScanning) { code in
                guard isScanning else { return }
                startPairing { await handle(code) }
            }
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(HudPalette.accent.opacity(0.5), lineWidth: HudStrokeWidth.standard)
            )
        }
        .padding(.horizontal, HudSpacing.xxl)
    }

    @ViewBuilder private var pasteSection: some View {
        #if canImport(UIKit)
        HudButton("Paste pairing link", icon: "doc.on.clipboard", style: .secondary) {
            guard let pasted = UIPasteboard.general.string, !pasted.isEmpty else {
                status = "No pairing link on clipboard."
                return
            }
            startPairing { await handleLink(pasted) }
        }
        .padding(.horizontal, HudSpacing.xxl)
        #endif
    }

    @ViewBuilder private var statusSection: some View {
        if let status {
            VStack(spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.sm) {
                    if case .connecting = model.connectionState {
                        ProgressView().controlSize(.small).tint(HudPalette.accent)
                    }
                    Text(status)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(isFailure ? HudPalette.statusError : ScoutInk.muted)
                }
                if isFailure {
                    HudButton("Scan again", icon: "qrcode.viewfinder", style: .secondary) {
                        pairingTask?.cancel()
                        pairingTask = nil
                        self.status = nil
                        isScanning = true
                    }
                }
            }
        }
    }

    private func sectionLabel(_ value: String) -> some View {
        Text(value)
            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            .tracking(1.0)
            .foregroundStyle(ScoutInk.dim)
    }

    @MainActor
    private func startPairing(_ operation: @escaping @MainActor () async -> Void) {
        pairingTask?.cancel()
        isScanning = false
        pairingTask = Task { @MainActor in
            await operation()
            pairingTask = nil
        }
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

    private func handleLink(_ link: String) async {
        status = "Pairing…"
        let ok = await model.pairFromLink(link)
        if ok {
            dismiss()
        } else {
            status = {
                if case .failed(let message) = model.connectionState { return message }
                return "Pairing failed"
            }()
        }
    }

    private func handleLanTarget(_ target: AppModel.LanPairTarget) async {
        status = "Pairing with \(target.displayName)…"
        let ok = await model.pairWithLanTarget(target)
        if ok {
            dismiss()
        } else {
            status = model.lanPairError ?? "Pairing failed"
        }
    }

    private func handleTailnetTarget(_ target: AppModel.TailnetPairTarget) async {
        status = "Pairing with \(target.displayName)…"
        let ok = await model.pairWithTailnetTarget(target)
        if ok {
            dismiss()
        } else {
            status = model.tailnetPairError ?? "Pairing failed"
        }
    }

    private func handleOpenScoutNetworkTarget(_ target: AppModel.OpenScoutNetworkPairTarget) async {
        status = "Pairing with \(target.displayName)…"
        let ok = await model.pairWithOpenScoutNetworkTarget(target)
        if ok {
            dismiss()
        } else {
            status = model.openScoutNetworkPairError ?? "Pairing failed"
        }
    }
}

private struct DiscoveryPairRow: View {
    let name: String
    let detail: String
    let badge: String
    let isActive: Bool
    let isBusy: Bool
    let isDisabled: Bool
    let onPair: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: HudSpacing.sm) {
            HudStatusDot(color: isActive ? HudPalette.accent : ScoutInk.dim, size: 7, pulses: isActive)
                .frame(width: 12)

            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(HudFont.ui(HudTextSize.md))
                    .foregroundStyle(isActive ? HudPalette.ink : ScoutInk.muted)
                    .lineLimit(1)
                Text(detail)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: HudSpacing.md)

            Button(action: onPair) {
                Text(isBusy && badge == "PAIR" ? "PAIRING" : badge)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(isActive ? HudPalette.accent : ScoutInk.dim)
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, HudSpacing.xxs)
                    .overlay(
                        Capsule()
                            .strokeBorder(
                                HudSurface.tintBorder(isActive ? HudPalette.accent : ScoutInk.dim),
                                lineWidth: HudStrokeWidth.thin
                            )
                    )
            }
            .buttonStyle(.plain)
            .disabled(isDisabled)
        }
        .frame(height: HudLayout.rowHeightRegular)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HudHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name), \(detail)")
        .accessibilityAddTraits(.isButton)
    }
}
