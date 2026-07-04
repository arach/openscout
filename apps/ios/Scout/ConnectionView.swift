import HudsonObservability
import SwiftUI
import HudsonUI
import ScoutIOSCore

/// Connection inspector: the live transport route (LAN / TSN / OSN), a reconnect
/// control, and the `ConnectionLog` — so it's always clear which path we
/// attempted and which one won.
struct ConnectionView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                statusSection
                    .padding(HudSpacing.xxl)
                Divider()
                    .overlay(HudHairline.subtle)
                HudLoggerView(
                    store: .shared,
                    title: "Connection",
                    showHeader: true,
                    emptySubtitle: "Route attempts and pairing events will appear here."
                )
            }
            .background(HudPalette.bg)
            .navigationTitle("Connection")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundStyle(HudPalette.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    // MARK: - Status

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HudSectionLabel("Status")
            HStack(spacing: HudSpacing.md) {
                HudStatusDot(color: model.statusTint, size: 8, pulses: model.statusPulses)
                Text(statusText)
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(HudPalette.ink)
                Spacer()
                HudButton("Reconnect", icon: "arrow.clockwise", style: .secondary) {
                    Task { await model.reconnect() }
                }
            }
            HudButton("Pair with a Mac", icon: "qrcode.viewfinder", style: .primary(.green)) {
                dismiss()
                model.showPairing = true
            }
            .padding(HudSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutSurface.inset))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard))
            routeLegend
        }
    }

    private var statusText: String {
        model.connectionStatusText
    }

    /// Reminds the operator of the path priority order.
    private var routeLegend: some View {
        HStack(spacing: HudSpacing.sm) {
            ForEach(["LAN", "TSN", "OSN"], id: \.self) { label in
                Text(label)
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(isActiveRoute(label) ? HudPalette.accent : ScoutInk.dim)
                if label != "OSN" {
                    Glyphic.arrow(.trailing, size: 12)
                        .foregroundStyle(ScoutInk.dim)
                }
            }
            Spacer()
            Text("priority order")
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
        }
    }

    private func isActiveRoute(_ label: String) -> Bool {
        if case .connected(let route) = model.connectionState { return route.label == label }
        return false
    }

}
