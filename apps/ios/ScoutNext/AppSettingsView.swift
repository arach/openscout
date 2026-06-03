import SwiftUI
import HudsonUI
#if canImport(UIKit)
import UIKit
#endif

/// App Settings — the vertical-rail settings shell. The rotated tab rail switches
/// panels (CONNECTION / ROUTES / IDENTITY / ALERTS / APPEARANCE / ADVANCED /
/// ABOUT); each panel shows green key→value rows, stat tiles, and tinted action
/// affordances. Connection actions are live; other values are scaffolded.
struct AppSettingsView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var tab = "CONNECTION"
    @State private var tailscaleEnabled = true
    @State private var osnEnabled = false
    @State private var approvalsAlert = true

    private let tabs = ["CONNECTION", "ROUTES", "IDENTITY", "ALERTS", "APPEARANCE", "ADVANCED", "ABOUT"]

    var body: some View {
        SettingsShell(app: "SCOUT", context: "iOS APP", tabs: tabs, selection: $tab, panel: { panel }, onDone: { dismiss() })
    }

    @ViewBuilder private var panel: some View {
        switch tab {
        case "CONNECTION": connectionPanel
        case "ROUTES":     routesPanel
        case "IDENTITY":   identityPanel
        case "ALERTS":     alertsPanel
        case "APPEARANCE": appearancePanel
        case "ADVANCED":   advancedPanel
        default:           aboutPanel
        }
    }

    private var connectionPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · CONNECTION") {
            SettingsGroup("LINK") {
                SettingsValueRow(title: "Paired Mac", subtitle: "encrypted bridge", value: model.statusLabel, valueTint: model.statusTint)
                SettingsValueRow(title: "Transport", subtitle: "live route", value: routeLabel)
                SettingsValueRow(title: "Identity", subtitle: "trusted", value: model.hasTrustedBridge ? "Paired" : "None")
            }
            SettingsStatTiles(tiles: [("ROUTE", routeLabel), ("STATUS", statusShort), ("LOG", "\(model.connectionLog.entries.count)")])
            SettingsGroup("ACTIONS") {
                SettingsValueRow(title: "Reconnect", subtitle: "re-establish the link", value: "RUN", onTap: { Task { await model.reconnect() } })
                SettingsValueRow(title: "Pair with a Mac", subtitle: "scan or paste a link", value: "SCAN", onTap: { dismiss(); model.showPairing = true })
                SettingsValueRow(title: "Forget this Mac", subtitle: "clear pairing", value: "RESET", valueTint: HudTint.amber.color, onTap: {})
            }
        }
    }

    private var routesPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · ROUTES") {
            SettingsGroup("PRIORITY") {
                SettingsValueRow(title: "Order", subtitle: "first reachable wins", value: "LAN → TSN → OSN")
            }
            SettingsGroup("TRANSPORTS") {
                SettingsValueRow(title: "Tailscale", subtitle: "reach over your tailnet", value: tailscaleEnabled ? "ON" : "OFF", valueTint: tailscaleEnabled ? HudTint.green.color : HudPalette.muted, onTap: { tailscaleEnabled.toggle() })
                SettingsValueRow(title: "OpenScout Net", subtitle: "relay fallback off-LAN", value: osnEnabled ? "ON" : "OFF", valueTint: osnEnabled ? HudTint.green.color : HudPalette.muted, onTap: { osnEnabled.toggle() })
            }
        }
    }

    private var identityPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · IDENTITY") {
            SettingsGroup("DEVICE") {
                SettingsValueRow(title: "This device", subtitle: "primary name", value: deviceName, valueTint: HudPalette.ink)
                SettingsValueRow(title: "Public key", subtitle: "authenticates the bridge", value: "eff2…117b", valueTint: HudPalette.muted)
            }
        }
    }

    private var alertsPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · ALERTS") {
            SettingsGroup("NOTIFICATIONS") {
                SettingsValueRow(title: "Approval alerts", subtitle: "ping on a decision", value: approvalsAlert ? "ON" : "OFF", valueTint: approvalsAlert ? HudTint.green.color : HudPalette.muted, onTap: { approvalsAlert.toggle() })
                SettingsValueRow(title: "Push", subtitle: "needs entitlement", value: "SOON", valueTint: HudPalette.muted)
            }
        }
    }

    private var appearancePanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · APPEARANCE") {
            SettingsGroup("THEME") {
                SettingsValueRow(title: "Appearance", subtitle: "cockpit", value: "Dark")
                SettingsValueRow(title: "Type scale", subtitle: "row rhythm", value: "Standard")
            }
        }
    }

    private var advancedPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · ADVANCED") {
            SettingsGroup("DIAGNOSTICS") {
                SettingsValueRow(title: "Connection log", subtitle: "route attempts", value: "\(model.connectionLog.entries.count)", valueTint: HudPalette.ink, onTap: {})
                SettingsValueRow(title: "Diagnostics", subtitle: "anonymized", value: "OPEN", onTap: {})
            }
            SettingsGroup("DANGER") {
                SettingsValueRow(title: "Reset all data", subtitle: "cannot be undone", value: "RESET", valueTint: HudPalette.statusError, onTap: {})
            }
        }
    }

    private var aboutPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · ABOUT") {
            SettingsGroup("BUILD") {
                SettingsValueRow(title: "Version", subtitle: "ScoutNext", value: "0.1.0", valueTint: HudPalette.ink)
                SettingsValueRow(title: "Acknowledgements", value: "VIEW", onTap: {})
            }
        }
    }

    private var routeLabel: String {
        if case .connected(let route) = model.connectionState { return route.label }
        return "—"
    }

    private var statusShort: String {
        switch model.connectionState {
        case .connected: return "Live"
        case .connecting: return "…"
        case .failed: return "Off"
        case .idle: return "Idle"
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
