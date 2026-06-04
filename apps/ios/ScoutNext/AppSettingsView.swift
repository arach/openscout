import SwiftUI
import HudsonUI
import HudsonVoice
import ScoutIOSCore
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
    @State private var approvalsAlert = true

    private let tabIDs = ["CONNECTION", "ROUTES", "IDENTITY", "VOICE", "ALERTS", "APPEARANCE", "ADVANCED", "ABOUT"]

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
            case "VOICE":      voicePanel
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
                HudInspectorFieldRow("Order", value: routeOrderLabel, hint: "first reachable wins")
            }
            HudInspectorSection("Saved routes") {
                HudInspectorFieldRow("LAN", value: routeStatus(.lan), hint: "nearby")
                HudInspectorFieldRow("Tailscale", value: routeStatus(.tailnet), hint: "tailnet")
                HudInspectorFieldRow("OpenScout Net", value: routeStatus(.oscout), hint: "managed relay")
            }
            HudInspectorSection("Transports") {
                HudInspectorToggleRow("Tailscale", isOn: tailnetBinding, valueOn: "On", valueOff: "Off", hint: "reach over your tailnet")
                HudInspectorToggleRow("OpenScout Net", isOn: osnBinding, valueOn: "On", valueOff: "Off", hint: "relay fallback off-LAN")
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

    // MARK: - Voice

    private var voicePanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Transcription") {
                HudInspectorCycleRow(
                    "Engine",
                    selection: Binding(
                        get: { model.dictation.preference.rawValue },
                        set: { raw in
                            if let pref = HudDictation.Preference(rawValue: raw) {
                                model.setVoicePreference(pref)
                            }
                        }
                    ),
                    choices: HudDictation.Preference.allCases.map {
                        HudInspectorChoice(id: $0.rawValue, title: $0.title)
                    },
                    hint: "Parakeet on-device, Apple fallback"
                )
            }
            HudInspectorMetricStrip([
                .init("Engine", value: voiceEngineLabel),
                .init("Model", value: voiceModelShort),
                .init("Warm", value: voiceWarmLabel)
            ], distribution: .spread)
            HudInspectorSection("On-device model") {
                HudInspectorFieldRow("Parakeet", value: voiceModelStatus, hint: "parakeet-tdt-0.6b-v3")
                if model.dictation.preference != .apple && !model.dictation.modelReady {
                    HudInspectorActionRow("Download & warm", value: "Run", tone: .accent) {
                        model.dictation.prepare()
                    }
                }
                HudInspectorFieldRow("Fallback", value: "Apple Speech", hint: "instant, while Parakeet warms")
            }
        }
        .task { await model.dictation.refreshStatus() }
    }

    /// The engine that will actually run given the preference + readiness.
    private var voiceEngineLabel: String {
        switch model.dictation.preference {
        case .apple: return "Apple"
        case .auto, .parakeet: return model.dictation.modelReady ? "Parakeet" : "Apple"
        }
    }

    /// Apple Speech has no model to warm, so "warm" is n/a when it's the engine.
    private var voiceWarmLabel: String {
        if model.dictation.preference == .apple { return "n/a" }
        return model.dictation.modelReady ? "Yes" : "No"
    }

    private var voiceModelShort: String {
        if case .preparing(let progress) = model.dictation.state { return "\(Int(progress * 100))%" }
        if model.dictation.modelReady { return "Ready" }
        return model.dictation.modelInstalled ? "On disk" : "—"
    }

    private var voiceModelStatus: String {
        if case .preparing(let progress) = model.dictation.state { return "Downloading \(Int(progress * 100))%" }
        if model.dictation.modelReady { return "Ready" }
        if model.dictation.modelInstalled { return "Downloaded" }
        return model.dictation.preference == .apple ? "Off" : "Not downloaded"
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

    private var tailnetBinding: Binding<Bool> {
        Binding(
            get: { model.tailnetRoutingEnabled },
            set: { model.setTailnetRoutingEnabled($0) }
        )
    }

    private var osnBinding: Binding<Bool> {
        Binding(
            get: { model.openScoutNetworkRoutingEnabled },
            set: { model.setOpenScoutNetworkRoutingEnabled($0) }
        )
    }

    private var routeOrderLabel: String {
        var labels = ["LAN"]
        if model.tailnetRoutingEnabled { labels.append("TSN") }
        if model.openScoutNetworkRoutingEnabled { labels.append("OSN") }
        return labels.joined(separator: " → ")
    }

    private func routeStatus(_ kind: TransportKind) -> String {
        let summary = model.savedRouteSummary
        let count = summary.routeCounts[kind] ?? 0
        guard count > 0 else { return "—" }
        if (summary.allowedRouteCounts[kind] ?? 0) == 0 { return "Off" }
        return count == 1 ? "Saved" : "\(count)"
    }
}
