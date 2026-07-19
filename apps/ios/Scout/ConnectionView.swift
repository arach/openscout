import SwiftUI
import HudsonUI
import ScoutCapabilities
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
                ConnectionLogList(entries: model.connectionLog.entries)
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

struct ConnectionLogList: View {
    let entries: [ConnectionLogEntry]
    var emptySubtitle = "Route attempts and pairing events will appear here."

    var body: some View {
        if entries.isEmpty {
            HudEmptyState(title: "No log entries", subtitle: emptySubtitle, icon: "list.bullet.rectangle")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: HudSpacing.xs) {
                    ForEach(entries.reversed()) { entry in
                        entryRow(entry)
                    }
                }
                .padding(HudSpacing.md)
            }
        }
    }

    private func entryRow(_ entry: ConnectionLogEntry) -> some View {
        let tint = logEventColor(entry)
        return HStack(alignment: .top, spacing: HudSpacing.md) {
            RoundedRectangle(cornerRadius: HudRadius.tight)
                .fill(tint)
                .frame(width: HudStrokeWidth.bold)

            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                HStack(spacing: HudSpacing.sm) {
                    Text(logTime(entry))
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutInk.dim)

                    Text(entry.event.label)
                        .font(HudFont.mono(HudTextSize.xxs, weight: .bold))
                        .foregroundStyle(tint)

                    if let route = entry.route {
                        Text(route.label)
                            .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                            .foregroundStyle(ScoutInk.dim)
                    }

                    Spacer(minLength: 0)
                }

                Text(entry.message)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudPalette.surface))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(HudHairline.subtle, lineWidth: HudStrokeWidth.thin))
    }

    private func logEventColor(_ entry: ConnectionLogEntry) -> Color {
        switch entry.event {
        case .routeDisabled, .routeUnavailable, .reconnect, .network:
            return HudPalette.statusWarn
        default:
            break
        }
        switch entry.level {
        case .error:
            return HudPalette.statusError
        case .warning:
            return HudPalette.statusWarn
        case .success:
            return HudPalette.accent
        case .info:
            return entry.event == .lifecycle ? ScoutInk.dim : ScoutInk.muted
        }
    }

    private func logTime(_ entry: ConnectionLogEntry) -> String {
        (ScoutTimestamp.date(fromEpoch: TimeInterval(entry.tsMs)) ?? Date(timeIntervalSince1970: 0))
            .formatted(.dateTime.hour().minute().second())
    }
}
