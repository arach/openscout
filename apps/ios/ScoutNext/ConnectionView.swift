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
            ScrollView {
                VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                    statusSection
                    logSection
                }
                .padding(HudSpacing.xxl)
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
            .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(HudSurface.inset))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard))
            routeLegend
        }
    }

    private var statusText: String {
        switch model.connectionState {
        case .idle: return "Not connected"
        case .connecting: return "Connecting…"
        case .connected(let route): return "Connected via \(route.label)"
        case .failed(let message): return message
        }
    }

    /// Reminds the operator of the path priority order.
    private var routeLegend: some View {
        HStack(spacing: HudSpacing.sm) {
            ForEach(["LAN", "TSN", "OSN"], id: \.self) { label in
                Text(label)
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(isActiveRoute(label) ? HudPalette.accent : HudPalette.dim)
                if label != "OSN" {
                    Image(systemName: "arrow.right")
                        .font(HudFont.ui(HudTextSize.micro))
                        .foregroundStyle(HudPalette.dim)
                }
            }
            Spacer()
            Text("priority order")
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(HudPalette.dim)
        }
    }

    private func isActiveRoute(_ label: String) -> Bool {
        if case .connected(let route) = model.connectionState { return route.label == label }
        return false
    }

    // MARK: - Log

    private var logSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack {
                HudSectionLabel("Log · \(model.connectionLog.entries.count)")
                Spacer()
                if !model.connectionLog.entries.isEmpty {
                    Button("Clear") { model.connectionLog.clear() }
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(HudPalette.muted)
                }
            }
            if model.connectionLog.entries.isEmpty {
                HudEmptyState(title: "No connection activity yet", icon: "dot.radiowaves.left.and.right")
            } else {
                VStack(alignment: .leading, spacing: HudSpacing.xs) {
                    ForEach(model.connectionLog.entries.reversed()) { entry in
                        logRow(entry)
                    }
                }
            }
        }
    }

    private func logRow(_ entry: ConnectionLogEntry) -> some View {
        HStack(alignment: .top, spacing: HudSpacing.sm) {
            if let route = entry.route, !route.label.isEmpty {
                Text(route.label)
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(HudPalette.accent)
                    .frame(width: 34, alignment: .leading)
            } else {
                Text("·")
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(HudPalette.dim)
                    .frame(width: 34, alignment: .leading)
            }
            Text(entry.message)
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(levelColor(entry.level))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 2)
    }

    private func levelColor(_ level: ConnectionLogLevel) -> Color {
        switch level {
        case .info: return HudPalette.muted
        case .success: return HudPalette.accent
        case .warning: return HudPalette.statusWarn
        case .error: return HudPalette.statusError
        }
    }
}
