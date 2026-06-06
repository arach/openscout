import SwiftUI
import HudsonUI
import HudsonVoice
import ScoutIOSCore
#if canImport(UIKit)
import UIKit
#endif

/// App Settings — HudsonKit's `HudInspectorSettings` vertical-rail inspector.
/// The rail switches panels (CONNECTION / ROUTES / IDENTITY / ALERTS /
/// APPEARANCE / ADVANCED). Connection actions are live; other values
/// are scaffolded. Presented as a full page (fullScreenCover), so it carries
/// its own close via `onClose`.
struct AppSettingsView: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var tab = "CONNECTION"
    @State private var approvalsAlert = true
    @State private var copiedLogs = false

    private let tabIDs = ["CONNECTION", "ROUTES", "IDENTITY", "VOICE", "ALERTS", "APPEARANCE", "ADVANCED"]

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
            default:           connectionPanel
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
                .init("Last", value: latestLogMetric)
            ])
            HudInspectorSection("Actions") {
                HudInspectorActionRow("Reconnect", value: "Run", tone: .accent) { Task { await model.reconnect() } }
                HudInspectorActionRow("Pair with a Mac", value: "Scan", tone: .accent) { dismiss(); model.showPairing = true }
            }
            connectionLogSection
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
                HudInspectorToggleRow("LAN", isOn: lanBinding, valueOn: "Use", valueOff: "Skip", hint: "skip nearby relay")
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
                HudInspectorFieldRow("Connection log", value: latestLogMetric, hint: "\(model.connectionLog.entries.count) entries")
                #if canImport(UIKit)
                HudInspectorActionRow("Copy connection log", value: copiedLogs ? "Copied" : "Copy", tone: .accent) {
                    copyConnectionLog()
                }
                #endif
                HudInspectorActionRow("Clear connection log", value: "Clear", tone: .warn) {
                    model.connectionLog.clear()
                    copiedLogs = false
                }
            }
            HudInspectorSection("Build") {
                HudInspectorFieldRow("Version", value: "0.1.0", hint: "ScoutNext")
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

    // MARK: - Logs

    private var connectionLogSection: some View {
        HudInspectorSection("Connection log") {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                // A contained, terminal-style block rather than a stack of loud
                // inspector rows: dark recessed fill, hairline border, dense mono
                // lines (time · event · message), color-coded by level.
                VStack(alignment: .leading, spacing: 0) {
                    if recentConnectionLogEntries.isEmpty {
                        Text("No route attempts yet")
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(HudPalette.dim)
                            .padding(.vertical, 4)
                    } else {
                        ForEach(recentConnectionLogEntries) { entry in
                            logLine(entry)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, HudSpacing.sm)
                .padding(.horizontal, HudSpacing.md)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                        .fill(Color.black.opacity(0.4))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                        .strokeBorder(HudHairline.standard, lineWidth: HudStrokeWidth.thin)
                )

                #if canImport(UIKit)
                if !model.connectionLog.entries.isEmpty {
                    Button { copyConnectionLog() } label: {
                        Text(copiedLogs ? "COPIED" : "COPY LOG")
                            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                            .tracking(0.8)
                            .foregroundStyle(HudPalette.accent)
                    }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
                #endif
            }
            .padding(.vertical, HudSpacing.md)
        }
    }

    /// One terminal-style log line: `12:03:38  CONNECTED  Connected via TSN`.
    /// Time is quiet, the event is color-coded by level, the message tail-truncates.
    private func logLine(_ entry: ConnectionLogEntry) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Text(logTime(entry))
                .foregroundStyle(HudPalette.dim)
            Text(entry.event.label)
                .foregroundStyle(logEventColor(entry))
                .frame(width: 68, alignment: .leading)
            Text(compactLogMessage(entry))
                .foregroundStyle(HudPalette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(HudFont.mono(HudTextSize.micro))
        .padding(.vertical, 3)
    }

    /// Color the event token by severity — error/warn pop, a fresh connect reads
    /// accent, routine lifecycle chatter recedes to dim.
    private func logEventColor(_ entry: ConnectionLogEntry) -> Color {
        // Route enable/disable is logged at .info level, so color by level alone
        // would render it muted — make those events read as a warning regardless,
        // matching ConnectionView's event-aware coloring.
        switch entry.event {
        case .routeDisabled, .routeUnavailable: return HudPalette.statusWarn
        default: break
        }
        switch entry.level {
        case .error:   return HudPalette.statusError
        case .warning: return HudPalette.statusWarn
        case .success: return HudPalette.accent
        case .info:    return entry.event == .lifecycle ? HudPalette.dim : HudPalette.muted
        }
    }

    private var recentConnectionLogEntries: [ConnectionLogEntry] {
        Array(model.connectionLog.entries.suffix(8).reversed())
    }

    private var latestLogMetric: String {
        guard let entry = model.connectionLog.entries.last else { return "—" }
        return entry.event.label
    }

    private func logEntryTitle(_ entry: ConnectionLogEntry) -> String {
        "\(routeToken(entry.route)) \(entry.event.label)"
    }

    /// Inspector field rows are fixed-width and put the title and value on one
    /// line — a full relay URL in a log message ("Connected via TSN wss://arachs
    /// -mac-mini.tail1e8e67.ts.net:7889") would force the row, and the whole
    /// panel, wider than the screen. Drop the embedded ws(s):// URL entirely (the
    /// title's route token already says how we connected; the full URL lives in
    /// the Connection log and Copy log), then cap the length as a backstop.
    private func compactLogMessage(_ entry: ConnectionLogEntry) -> String {
        let compact = entry.message
            .split(separator: " ", omittingEmptySubsequences: false)
            .filter { !$0.hasPrefix("ws://") && !$0.hasPrefix("wss://") }
            .joined(separator: " ")
            .trimmingCharacters(in: CharacterSet(charactersIn: " :"))
        return compact.count > 32 ? String(compact.prefix(31)) + "…" : compact
    }

    private func logEntryHint(_ entry: ConnectionLogEntry) -> String {
        logTime(entry)
    }

    private func logTime(_ entry: ConnectionLogEntry) -> String {
        Date(timeIntervalSince1970: Double(entry.tsMs) / 1000)
            .formatted(.dateTime.hour().minute().second())
    }

    private func routeToken(_ route: TransportKind?) -> String {
        guard let route, !route.label.isEmpty else { return "SYS" }
        return route.label
    }

    private var connectionLogText: String {
        model.connectionLog.entries
            .map { entry in
                "[\(logTime(entry))] \(routeToken(entry.route)) \(entry.event.label) \(entry.message)"
            }
            .joined(separator: "\n")
    }

    private func copyConnectionLog() {
        #if canImport(UIKit)
        UIPasteboard.general.string = connectionLogText
        copiedLogs = true
        #endif
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

    private var lanBinding: Binding<Bool> {
        Binding(
            get: { model.lanRoutingEnabled },
            set: { model.setLANRoutingEnabled($0) }
        )
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
        var labels: [String] = []
        if model.lanRoutingEnabled { labels.append("LAN") }
        if model.tailnetRoutingEnabled { labels.append("TSN") }
        if model.openScoutNetworkRoutingEnabled { labels.append("OSN") }
        return labels.isEmpty ? "WAN only" : labels.joined(separator: " → ")
    }

    private func routeStatus(_ kind: TransportKind) -> String {
        let summary = model.savedRouteSummary
        let count = summary.routeCounts[kind] ?? 0
        guard count > 0 else { return "—" }
        if (summary.allowedRouteCounts[kind] ?? 0) == 0 { return "Off" }
        return count == 1 ? "Saved" : "\(count)"
    }
}
