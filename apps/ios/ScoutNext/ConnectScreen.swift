import SwiftUI
import HudsonUI
#if canImport(UIKit)
import UIKit
#endif

/// First-run gate. Shown when no bridge is trusted yet. A single primary CTA
/// opens the QR scanner (the camera never auto-presents); a "Continue without
/// pairing" escape hatch enters the shell unconnected so Settings is reachable
/// before pairing (surfaces stay empty — no fabricated data). Once paired,
/// `AppModel.phase` flips to `.shell`.
struct ConnectScreen: View {
    @Bindable var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: HudSpacing.lg) {
                ScoutMark()
                    .frame(width: 56, height: 56)
                    .foregroundStyle(HudPalette.accent)

                VStack(spacing: HudSpacing.xs) {
                    HStack(spacing: HudSpacing.sm) {
                        Text("Scout")
                            .font(HudFont.ui(HudTextSize.xxl, weight: .semibold))
                            .foregroundStyle(HudPalette.ink)
                        Text("NEXT")
                            .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                            .tracking(2)
                            .foregroundStyle(HudPalette.accent)
                    }
                    Text("Connect to your Mac to see your fleet.")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(HudPalette.muted)
                        .multilineTextAlignment(.center)
                }
            }

            Spacer()

            VStack(spacing: HudSpacing.md) {
                if case .failed(let message) = model.connectionState, model.hasTrustedBridge == false {
                    Text(message)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.statusError)
                        .multilineTextAlignment(.center)
                }

                HudButton("Pair with your Mac", icon: "qrcode.viewfinder", style: .primary(.green)) {
                    model.showPairing = true
                }
                .frame(maxWidth: .infinity)

                #if canImport(UIKit)
                // Camera-free path: paste the pairing link the Mac copied
                // (also how pairing works on the camera-less simulator).
                HudButton("Paste pairing link", icon: "doc.on.clipboard", style: .secondary) {
                    if let pasted = UIPasteboard.general.string, !pasted.isEmpty {
                        Task { await model.pairFromLink(pasted) }
                    }
                }
                .frame(maxWidth: .infinity)
                #endif

                Button { model.continueWithoutPairing() } label: {
                    HStack(spacing: HudSpacing.xs) {
                        Text("Continue without pairing")
                        Image(systemName: "arrow.right")
                    }
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(HudPalette.muted)
                }
                .buttonStyle(.plain)
                .padding(.top, HudSpacing.xs)
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.bottom, HudSpacing.xxxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HudPalette.bg)
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
