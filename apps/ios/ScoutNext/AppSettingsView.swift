import SwiftUI
import HudsonUI

/// App Settings — global configuration built from the HudSettings* family with a
/// HudSettingsQuickNav jump-scroller. Connection folds in here; most rows are
/// scaffolded for now (the nav and shape are the point — values fill in later).
struct AppSettingsView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    // Placeholder local state until these bind to real settings.
    @State private var tailscaleEnabled = true
    @State private var osnEnabled = false
    @State private var approvalsAlert = true
    @State private var theme = "Dark"

    private let anchors: [HudSettingsQuickNav.Item] = [
        .init(icon: "antenna.radiowaves.left.and.right", label: "Connection", anchor: "CONNECTION"),
        .init(icon: "point.3.connected.trianglepath.dotted", label: "Routes", anchor: "ROUTES"),
        .init(icon: "person.badge.key", label: "Identity", anchor: "IDENTITY"),
        .init(icon: "bell", label: "Alerts", anchor: "NOTIFICATIONS"),
        .init(icon: "paintbrush", label: "Appearance", anchor: "APPEARANCE"),
        .init(icon: "wrench.and.screwdriver", label: "Advanced", anchor: "ADVANCED"),
        .init(icon: "info.circle", label: "About", anchor: "ABOUT"),
    ]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                        HudSettingsQuickNav(items: anchors, proxy: proxy)
                        connectionSection
                        routesSection
                        identitySection
                        notificationsSection
                        appearanceSection
                        advancedSection
                        aboutSection
                    }
                    .padding(HudSpacing.xxl)
                }
                .background(HudPalette.bg)
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(HudPalette.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var connectionSection: some View {
        HudSettingsSection("CONNECTION") {
            HudSettingsRow(icon: "desktopcomputer", iconColor: HudTint.green.color, title: "Paired Mac", subtitle: model.statusLabel) {
                HudBadge(model.statusLabel, tint: model.statusTint, dot: true)
            }
            HudSettingsRow(icon: "arrow.clockwise", iconColor: HudTint.cyan.color, title: "Reconnect", subtitle: "Re-establish the encrypted link", onTap: {
                Task { await model.reconnect() }
            })
            HudSettingsRow(icon: "qrcode.viewfinder", iconColor: HudTint.amber.color, title: "Pair with a Mac", subtitle: "Scan or paste a fresh pairing link", onTap: {
                dismiss(); model.showPairing = true
            })
        }
    }

    private var routesSection: some View {
        HudSettingsSection("ROUTES") {
            HudSettingsRow(icon: "network", iconColor: HudTint.teal.color, title: "Priority", subtitle: "LAN → Tailscale → OSN") {
                Text("LAN")
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(HudPalette.accent)
            }
            HudSettingsControlRow(title: "Tailscale", subtitle: "Reach the Mac over your tailnet", icon: "shield.lefthalf.filled", iconColor: HudTint.blue.color) {
                Toggle("", isOn: $tailscaleEnabled).labelsHidden().tint(HudPalette.accent)
            }
            HudSettingsControlRow(title: "OpenScout Net", subtitle: "Relay fallback when off-LAN", icon: "globe", iconColor: HudTint.cyan.color) {
                Toggle("", isOn: $osnEnabled).labelsHidden().tint(HudPalette.accent)
            }
        }
    }

    private var identitySection: some View {
        HudSettingsSection("IDENTITY") {
            HudSettingsRow(icon: "iphone", iconColor: HudTint.violet.color, title: "This device", subtitle: deviceName)
            HudSettingsRow(icon: "key", iconColor: HudTint.amber.color, title: "Public key", subtitle: "Used to authenticate with the bridge") {
                Text("eff2…117b")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(HudPalette.muted)
            }
        }
    }

    private var notificationsSection: some View {
        HudSettingsSection("NOTIFICATIONS") {
            HudSettingsControlRow(title: "Approval alerts", subtitle: "Ping when an agent needs a decision", icon: "bell.badge", iconColor: HudTint.amber.color) {
                Toggle("", isOn: $approvalsAlert).labelsHidden().tint(HudPalette.accent)
            }
            HudSettingsRow(icon: "app.badge", iconColor: HudTint.pink.color, title: "Push notifications", subtitle: "Requires pairing entitlement") {
                HudBadge("soon", tint: HudPalette.muted)
            }
        }
    }

    private var appearanceSection: some View {
        HudSettingsSection("APPEARANCE") {
            HudSettingsRow(icon: "moon.stars", iconColor: HudTint.cyan.color, title: "Theme", subtitle: "Matches the cockpit") {
                Text(theme).font(HudFont.mono(HudTextSize.xs)).foregroundStyle(HudPalette.muted)
            }
            HudSettingsRow(icon: "textformat.size", iconColor: HudTint.teal.color, title: "Type scale", subtitle: "Standard")
        }
    }

    private var advancedSection: some View {
        HudSettingsSection("ADVANCED") {
            HudSettingsRow(icon: "list.bullet.rectangle", iconColor: HudTint.blue.color, title: "Connection log", subtitle: "\(model.connectionLog.entries.count) entries", onTap: {})
            HudSettingsRow(icon: "stethoscope", iconColor: HudTint.teal.color, title: "Diagnostics", onTap: {})
            HudSettingsRow(icon: "trash", iconColor: HudPalette.statusError, title: "Forget this Mac", subtitle: "Clear pairing and start over", onTap: {})
        }
    }

    private var aboutSection: some View {
        HudSettingsSection("ABOUT") {
            HudSettingsRow(icon: "number", iconColor: HudPalette.muted, title: "Version") {
                Text("0.1.0").font(HudFont.mono(HudTextSize.xs)).foregroundStyle(HudPalette.muted)
            }
            HudSettingsRow(icon: "doc.text", iconColor: HudPalette.muted, title: "Acknowledgements", onTap: {})
        }
    }

    private var deviceName: String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #else
        return "ScoutNext"
        #endif
    }
}

#if canImport(UIKit)
import UIKit
#endif
