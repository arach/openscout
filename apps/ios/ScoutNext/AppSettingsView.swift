import SwiftUI
import HudsonUI
#if canImport(UIKit)
import UIKit
#endif

/// App Settings — HudsonKit's `HudInspectorSettings` vertical-rail inspector.
/// The rail switches panels (CONNECTION / ROUTES / IDENTITY / ALERTS /
/// APPEARANCE / ADVANCED / ABOUT). Connection actions are live; other values
/// are scaffolded. Presented as a full page (fullScreenCover), so it carries
/// its own close via `onClose`.
struct AppSettingsView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var tab = "CONNECTION"
    @State private var tailscaleEnabled = true
    @State private var osnEnabled = false
    @State private var approvalsAlert = true

    private let tabIDs = ["CONNECTION", "ROUTES", "IDENTITY", "ALERTS", "APPEARANCE", "ADVANCED", "ABOUT"]

    var body: some View {
        HudInspectorSettings(
            title: "Scout · Settings",
            subtitle: "iOS app",
            tabs: tabIDs.map { HudInspectorTab(id: $0, label: $0.capitalized) },
            selection: $tab,
            onClose: { dismiss() }
        ) { tabID in
            switch tabID {
            case "CONNECTION": connectionPanel
            case "ROUTES":     routesPanel
            case "IDENTITY":   identityPanel
            case "ALERTS":     alertsPanel
            case "APPEARANCE": appearancePanel
            case "ADVANCED":   advancedPanel
            default:           aboutPanel
            }
        }
    }

    private var connectionPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Link") {
                HudInspectorFieldRow("Paired Mac", value: model.statusLabel, hint: "encrypted bridge")
                HudInspectorFieldRow("Transport", value: routeLabel, hint: "live route")
                HudInspectorFieldRow("Identity", value: model.hasTrustedBridge ? "Paired" : "None", hint: "trusted")
            }
            HudInspectorMetricStrip([
                .init("Route", value: routeLabel),
                .init("Status", value: statusShort),
                .init("Log", value: "\(model.connectionLog.entries.count)")
            ])
            HudInspectorSection("Actions") {
                HudInspectorActionRow("Reconnect", value: "Run", tone: .accent) { Task { await model.reconnect() } }
                HudInspectorActionRow("Pair with a Mac", value: "Scan", tone: .accent) { dismiss(); model.showPairing = true }
                HudInspectorActionRow("Forget this Mac", value: "Reset", tone: .warn) {}
            }
        }
    }

    private var routesPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Priority") {
                HudInspectorFieldRow("Order", value: "LAN → TSN → OSN", hint: "first reachable wins")
            }
            HudInspectorSection("Transports") {
                HudInspectorToggleRow("Tailscale", isOn: $tailscaleEnabled, valueOn: "On", valueOff: "Off", hint: "reach over your tailnet")
                HudInspectorToggleRow("OpenScout Net", isOn: $osnEnabled, valueOn: "On", valueOff: "Off", hint: "relay fallback off-LAN")
            }
        }
    }

    private var identityPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Device") {
                HudInspectorFieldRow("This device", value: deviceName, hint: "primary name")
                HudInspectorFieldRow("Public key", value: "eff2…117b", hint: "authenticates the bridge")
            }
        }
    }

    private var alertsPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Notifications") {
                HudInspectorToggleRow("Approval alerts", isOn: $approvalsAlert, valueOn: "On", valueOff: "Off", hint: "ping on a decision")
                HudInspectorFieldRow("Push", value: "Soon", hint: "needs entitlement")
            }
        }
    }

    private var appearancePanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Theme") {
                HudInspectorFieldRow("Appearance", value: "Dark", hint: "cockpit")
                HudInspectorFieldRow("Type scale", value: "Standard", hint: "row rhythm")
            }
        }
    }

    private var advancedPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Diagnostics") {
                HudInspectorFieldRow("Connection log", value: "\(model.connectionLog.entries.count)", hint: "route attempts")
                HudInspectorNavRow("Diagnostics") {}
            }
            HudInspectorSection("Danger") {
                HudInspectorActionRow("Reset all data", value: "Reset", tone: .warn) {}
            }
        }
    }

    private var aboutPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Build") {
                HudInspectorFieldRow("Version", value: "0.1.0", hint: "ScoutNext")
                HudInspectorNavRow("Acknowledgements") {}
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
