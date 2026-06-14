import SwiftUI
import HudsonUI
#if canImport(UIKit)
import UIKit
#endif

/// First-run gate. Shown when no bridge is trusted yet.
///
/// The nicest path is front and center: if a Scout Mac is advertising on the
/// same Wi-Fi (Bonjour `_scout-pair._tcp`), it shows up under "On your network"
/// and a single tap pairs over the LAN — no QR, no clipboard. Scanning a QR and
/// pasting a link stay as fallbacks, and "Continue without pairing" enters the
/// shell unconnected so Settings is reachable first (surfaces stay empty — no
/// fabricated data). Once paired, `AppModel.phase` flips to `.shell`.
struct ConnectScreen: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            brand
            Spacer()

            VStack(spacing: HudSpacing.xl) {
                lanSection
                openScoutNetworkSection
                actionStack
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.bottom, HudSpacing.xxxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HudPalette.bg)
        .task {
            // First browse trips the iOS Local Network prompt (empty until
            // granted) — one gentle retry self-heals once the user allows it.
            await model.refreshLanPairTargets()
            if model.lanPairTargets.isEmpty {
                try? await Task.sleep(for: .seconds(1.5))
                await model.refreshLanPairTargets()
            }
            if model.isOpenScoutNetworkSignedIn {
                await model.refreshOpenScoutNetworkPairTargets()
            }
        }
    }

    private var brand: some View {
        VStack(spacing: HudSpacing.lg) {
            ScoutMark()
                .frame(width: 56, height: 56)
                .foregroundStyle(HudPalette.accent)

            VStack(spacing: HudSpacing.xs) {
                Text("Scout")
                    .font(HudFont.ui(HudTextSize.xxl, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                Text("Connect to your Mac to see your fleet.")
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(ScoutInk.muted)
                    .multilineTextAlignment(.center)
            }
        }
    }

    // MARK: - On your network (LAN)

    @ViewBuilder private var lanSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            lanHeader
            if !model.lanPairTargets.isEmpty {
                VStack(spacing: 0) {
                    ForEach(model.lanPairTargets) { target in
                        LanPairTargetRow(
                            target: target,
                            isPairing: model.lanPairingTargetId == target.id,
                            onPair: { Task { await model.pairWithLanTarget(target) } }
                        )
                    }
                }
                if let error = model.lanPairError {
                    Text(error)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(HudPalette.statusError)
                }
            } else if model.isRefreshingLanPairTargets {
                HStack(spacing: HudSpacing.sm) {
                    ProgressView().controlSize(.small).tint(HudPalette.accent)
                    Text("Looking for your Mac on this network…")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutInk.muted)
                    Spacer()
                }
            } else {
                Text("No Macs found nearby. Make sure Scout is open on your Mac and you’re on the same Wi-Fi.")
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(ScoutInk.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var lanHeader: some View {
        HStack {
            Text("ON YOUR NETWORK")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(1.0)
                .foregroundStyle(ScoutInk.dim)
            Spacer()
            Button {
                Task { await model.refreshLanPairTargets() }
            } label: {
                if model.isRefreshingLanPairTargets {
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
            .disabled(model.isRefreshingLanPairTargets)
        }
    }

    // MARK: - OpenScout Network

    private var openScoutNetworkSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            openScoutNetworkHeader
            if !model.isOpenScoutNetworkSignedIn {
                VStack(alignment: .leading, spacing: HudSpacing.sm) {
                    Text("Sign in with GitHub to find Macs publishing through OpenScout Network.")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutInk.dim)
                        .fixedSize(horizontal: false, vertical: true)
                    HudButton("Sign in with GitHub", icon: "person.crop.circle.badge.checkmark", style: .secondary) {
                        model.openOpenScoutNetworkLogin()
                    }
                    .frame(maxWidth: .infinity)
                }
            } else if !model.openScoutNetworkPairTargets.isEmpty {
                VStack(spacing: 0) {
                    ForEach(model.openScoutNetworkPairTargets) { target in
                        OpenScoutNetworkPairTargetRow(
                            target: target,
                            isPairing: model.openScoutNetworkPairingTargetId == target.id,
                            onPair: { Task { await model.pairWithOpenScoutNetworkTarget(target) } }
                        )
                    }
                }
            } else if model.isRefreshingOpenScoutNetworkPairTargets {
                HStack(spacing: HudSpacing.sm) {
                    ProgressView().controlSize(.small).tint(HudPalette.accent)
                    Text("Checking OpenScout Network…")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutInk.muted)
                    Spacer()
                }
            } else if let error = model.openScoutNetworkPairError {
                Text(error)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(HudPalette.statusError)
            } else {
                Text("No Macs are publishing through OpenScout Network.")
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(ScoutInk.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var openScoutNetworkHeader: some View {
        HStack {
            Text("OPENSCOUT NETWORK")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(1.0)
                .foregroundStyle(ScoutInk.dim)
            Spacer()
            if model.isOpenScoutNetworkSignedIn {
                Button {
                    Task { await model.refreshOpenScoutNetworkPairTargets() }
                } label: {
                    if model.isRefreshingOpenScoutNetworkPairTargets {
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
                .disabled(model.isRefreshingOpenScoutNetworkPairTargets)
            }
        }
    }

    // MARK: - Fallbacks

    private var actionStack: some View {
        VStack(spacing: HudSpacing.md) {
            if case .failed(let message) = model.connectionState,
               model.hasTrustedBridge == false,
               model.lanPairingTargetId == nil,
               model.lanPairError == nil {
                Text(message)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(HudPalette.statusError)
                    .multilineTextAlignment(.center)
            }

            if model.lanPairTargets.isEmpty {
                // No Mac on the LAN — QR is the primary way in.
                HudButton("Pair with your Mac", icon: "qrcode.viewfinder", style: .primary(.green)) {
                    model.showPairing = true
                }
                .frame(maxWidth: .infinity)

                #if canImport(UIKit)
                // Camera-free fallback: paste the link the Mac copied.
                HudButton("Paste pairing link", icon: "doc.on.clipboard", style: .secondary) {
                    if let pasted = UIPasteboard.general.string, !pasted.isEmpty {
                        Task { await model.pairFromLink(pasted) }
                    }
                }
                .frame(maxWidth: .infinity)
                #endif
            } else {
                // A Mac is offered above; QR is just the off-network fallback.
                HudButton("Scan a QR instead", icon: "qrcode.viewfinder", style: .secondary) {
                    model.showPairing = true
                }
                .frame(maxWidth: .infinity)
            }

            Button { model.continueWithoutPairing() } label: {
                HStack(spacing: HudSpacing.xs) {
                    Text("Continue without pairing")
                    Glyphic.arrow(.trailing, size: 13)
                }
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutInk.muted)
            }
            .buttonStyle(.plain)
            .padding(.top, HudSpacing.xs)
        }
    }
}

// MARK: - LAN target row

/// One Scout Mac found on the local network. Always freshly discovered, so it
/// reads as live (pulsing accent dot); a tap pairs over the LAN.
private struct LanPairTargetRow: View {
    let target: AppModel.LanPairTarget
    let isPairing: Bool
    let onPair: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: HudSpacing.sm) {
            HudStatusDot(color: HudPalette.accent, size: 7, pulses: true)
                .frame(width: 12)

            VStack(alignment: .leading, spacing: 2) {
                Text(target.displayName)
                    .font(HudFont.ui(HudTextSize.md))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                Text(target.detail)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: HudSpacing.md)

            Button(action: onPair) {
                Text(isPairing ? "PAIRING" : "PAIR")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(HudPalette.accent)
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, HudSpacing.xxs)
                    .overlay(
                        Capsule()
                            .strokeBorder(HudSurface.tintBorder(HudPalette.accent), lineWidth: HudStrokeWidth.thin)
                    )
            }
            .buttonStyle(.plain)
            .disabled(isPairing)
        }
        .frame(height: HudLayout.rowHeightRegular)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HudHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(target.displayName), \(target.detail)")
        .accessibilityAddTraits(.isButton)
    }
}

private struct OpenScoutNetworkPairTargetRow: View {
    let target: AppModel.OpenScoutNetworkPairTarget
    let isPairing: Bool
    let onPair: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: HudSpacing.sm) {
            HudStatusDot(color: HudPalette.accent, size: 7, pulses: true)
                .frame(width: 12)

            VStack(alignment: .leading, spacing: 2) {
                Text(target.displayName)
                    .font(HudFont.ui(HudTextSize.md))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                Text(target.detail)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: HudSpacing.md)

            Button(action: onPair) {
                Text(isPairing ? "PAIRING" : "PAIR")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(HudPalette.accent)
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, HudSpacing.xxs)
                    .overlay(
                        Capsule()
                            .strokeBorder(HudSurface.tintBorder(HudPalette.accent), lineWidth: HudStrokeWidth.thin)
                    )
            }
            .buttonStyle(.plain)
            .disabled(isPairing)
        }
        .frame(height: HudLayout.rowHeightRegular)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HudHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(target.displayName), \(target.detail)")
        .accessibilityAddTraits(.isButton)
    }
}

/// The Scout cockpit glyph — a hand-drawn reticle (preferred over SF Symbols for
/// the cockpit aesthetic). A ring with a centered cross and a gap at the top.
private struct ScoutMark: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let r = min(rect.width, rect.height) / 2
        // Ring with a small gap at top.
        p.addArc(center: c, radius: r, startAngle: .degrees(-70), endAngle: .degrees(250), clockwise: false)
        // Crosshair ticks.
        let t = r * 0.42
        p.move(to: CGPoint(x: c.x, y: c.y - t)); p.addLine(to: CGPoint(x: c.x, y: c.y + t))
        p.move(to: CGPoint(x: c.x - t, y: c.y)); p.addLine(to: CGPoint(x: c.x + t, y: c.y))
        return p.strokedPath(.init(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
    }
}
