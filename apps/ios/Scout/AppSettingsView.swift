import HudsonObservability
import SwiftUI
import HudsonUI
import HudsonVoice
import ScoutCapabilities
import ScoutIOSCore
#if canImport(UIKit)
import UIKit
#endif

/// App Settings — HudsonKit's `HudInspectorSettings` vertical-rail inspector.
/// The rail switches panels (CONNECTION / ROUTES / IDENTITY / ALERTS /
/// APPEARANCE / ADVANCED). Connection actions are live; other values
/// are scaffolded. Presented as a full page (fullScreenCover), so it carries
/// its own close via `onClose`.
enum AppSettingsContext: String, Equatable {
    case home = "HOME"
    case agents = "AGENTS"
    case tail = "TAIL"
    case comms = "COMMS"
    case terminal = "TERMINAL"
    case new = "NEW"
    case lanes = "LANES"
    case dispatch = "DISPATCH"

    var tabID: String { rawValue }
}

struct AppSettingsView: View {
    @Bindable var model: AppModel
    let context: AppSettingsContext
    @Bindable var terminalDiagnostics: TerminalDiagnosticsModel
    @Environment(\.dismiss) private var dismiss

    @State private var tab: String
    @AppStorage(ScoutTone.storageKey) private var tone = ScoutTone.default.rawValue
    @State private var approvalsAlert = true
    @State private var renamingMachine: AppModel.PairedMachine?
    @State private var renameText = ""
    @State private var copiedLogs = false
    @State private var showingLogViewer = false
    @State private var showingRequestLogViewer = false
    @State private var copiedTerminalDiagnostics = false

    private var tabIDs: [String] {
        [context.tabID, "CONNECTION", "ROUTES", "IDENTITY", "VOICE", "ALERTS", "APPEARANCE", "ADVANCED"]
    }

    init(
        model: AppModel,
        context: AppSettingsContext,
        terminalDiagnostics: TerminalDiagnosticsModel
    ) {
        self.model = model
        self.context = context
        self.terminalDiagnostics = terminalDiagnostics
        _tab = State(initialValue: context.tabID)
    }

    var body: some View {
        HudInspectorSettings(
            title: "Scout · Settings",
            subtitle: "iOS app",
            tabs: tabIDs.map { HudInspectorTab(id: $0, label: $0.capitalized) },
            selection: $tab,
            onClose: { dismiss() }
        ) { tabID in
            switch tabID {
            case context.tabID: contextPanel
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
        .task(id: tab) {
            if tab == "ROUTES" {
                await model.refreshTailnetPairTargets()
            }
        }
        .task(id: context) {
            guard context == .terminal else { return }
            terminalDiagnostics.surfaceState = .settings
            while !Task.isCancelled {
                await terminalDiagnostics.refreshHostStatus(using: model.client)
                try? await Task.sleep(for: .seconds(2))
            }
        }
        .onDisappear {
            if context == .terminal {
                terminalDiagnostics.surfaceState = .visible
            }
        }
        .sheet(isPresented: $showingLogViewer) {
            ConnectionLogViewer(model: model, copiedLogs: $copiedLogs)
        }
        .sheet(isPresented: $showingRequestLogViewer) {
            BrokerRequestLogViewer(log: BrokerRequestLog.shared)
        }
        .alert(
            "Rename Mac",
            isPresented: Binding(
                get: { renamingMachine != nil },
                set: { if !$0 { renamingMachine = nil } }
            )
        ) {
            TextField("Name", text: $renameText)
            Button("Save") {
                if let machine = renamingMachine {
                    model.renameMachine(id: machine.id, to: renameText)
                }
                renamingMachine = nil
            }
            Button("Cancel", role: .cancel) { renamingMachine = nil }
        } message: {
            Text("Set a name for this Mac. Macs reached over the mesh can't report their own name, so this is how you label them.")
        }
    }

    /// Open the rename alert seeded with the machine's current label.
    private func beginRename(_ machine: AppModel.PairedMachine) {
        renameText = machine.name
        renamingMachine = machine
    }

    private var connectionPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            // The Macs you've paired, then the clear way to add another. This is
            // the "add a Mac" entry point — a labeled list + a prominent CTA,
            // not a lone Scan action buried under Reconnect.
            HudInspectorSection("Macs") {
                if model.pairedMachines.isEmpty {
                    HudInspectorFieldRow("No Macs paired", value: "—", hint: "pair to begin")
                } else {
                    ForEach(model.pairedMachines) { machine in
                        MacConnectionRow(
                            machine: machine,
                            value: machineState(machine),
                            hint: machineHint(machine),
                            onSelect: { Task { await model.connect(toMachineId: machine.id) } },
                            onForget: { model.forgetMachine(id: machine.id) },
                            onRename: { beginRename(machine) }
                        )
                    }
                }
                HudInspectorActionRow("Add a Mac", value: "Scan", tone: .accent) {
                    dismiss(); model.showPairing = true
                }
            }
            HudInspectorSection("Link") {
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
            }
            connectionLogSection
        }
    }

    @ViewBuilder
    private var contextPanel: some View {
        switch context {
        case .terminal:
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    terminalTroubleshootingPanel
                }
            }
        case .tail:
            surfaceContextPanel(
                title: "Tail",
                rows: [
                    ("Source", "Recent activity", "all reachable Macs"),
                    ("Window", "50 events", "historical snapshot + live updates"),
                    ("Refresh", "5 seconds", "poll interval"),
                    ("Follow", "Automatic", "detach when you scroll away")
                ]
            )
        case .home:
            surfaceContextPanel(
                title: "Home",
                rows: [
                    ("Source", "Fleet snapshot", "projects, agents, and recent activity"),
                    ("Connection", statusShort, routeLabel)
                ]
            )
        case .agents:
            surfaceContextPanel(
                title: "Agents",
                rows: [
                    ("Source", "Fleet agents", "reachable Macs"),
                    ("Connection", statusShort, routeLabel)
                ]
            )
        case .comms:
            surfaceContextPanel(
                title: "Comms",
                rows: [
                    ("Source", "Broker messages", "current fleet route"),
                    ("Connection", statusShort, routeLabel)
                ]
            )
        case .new:
            surfaceContextPanel(
                title: "New",
                rows: [
                    ("Target", "Focused Mac", "new session routing"),
                    ("Connection", statusShort, routeLabel)
                ]
            )
        case .lanes, .dispatch:
            surfaceContextPanel(
                title: context == .lanes ? "Lanes" : "Dispatch",
                rows: [
                    ("Source", "Scout Web", "paired Mac embed"),
                    ("Connection", statusShort, routeLabel)
                ]
            )
        }
    }

    private func surfaceContextPanel(
        title: String,
        rows: [(label: String, value: String, hint: String)]
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection(title) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    HudInspectorFieldRow(row.label, value: row.value, hint: row.hint)
                }
            }
            HudInspectorSection("About") {
                HudInspectorFieldRow(
                    "Context",
                    value: "Active surface",
                    hint: "shared app settings remain available in the rail"
                )
            }
        }
    }

    private var terminalTroubleshootingPanel: some View {
        Group {
            HudInspectorSection("Connection") {
                HudInspectorFieldRow("Bridge", value: statusShort, hint: routeLabel)
                HudInspectorFieldRow(
                    "Provisioning",
                    value: terminalDiagnostics.provisioningState.rawValue,
                    hint: terminalDiagnostics.provisioningDetail ?? "device SSH key"
                )
                HudInspectorFieldRow(
                    "SSH",
                    value: terminalDiagnostics.sshState.rawValue,
                    hint: compactTerminalHint(terminalDiagnostics.sshDetail) ?? "PTY transport"
                )
                HudInspectorFieldRow(
                    "Endpoint",
                    value: terminalDiagnostics.endpoint ?? "—",
                    hint: terminalDiagnostics.routeHost ?? "not resolved"
                )
                HudInspectorFieldRow(
                    "Host key",
                    value: terminalDiagnostics.hostKeyPinned ? "Pinned" : "Missing",
                    hint: "ed25519 fingerprint"
                )
            }

            HudInspectorSection("Shell") {
                HudInspectorFieldRow(
                    "Shell",
                    value: terminalDiagnostics.hostStatus?.shellExecutable ?? "/bin/zsh",
                    hint: "login shell"
                )
                HudInspectorFieldRow(
                    "Wrapper",
                    value: terminalWrapperValue,
                    hint: terminalWrapperHint
                )
                HudInspectorFieldRow(
                    "Session",
                    value: terminalDiagnostics.hostStatus?.sessionName ?? "scout",
                    hint: terminalWrapperSessionHint
                )
                HudInspectorFieldRow(
                    "Pane",
                    value: terminalHostPaneValue,
                    hint: terminalDiagnostics.hostStatus?.paneCommand ?? "current command unavailable"
                )
                if let error = terminalDiagnostics.hostStatusError {
                    HudInspectorFieldRow("Host probe", value: "Failed", hint: compactTerminalHint(error) ?? error)
                }
            }

            HudInspectorSection("Renderer") {
                HudInspectorFieldRow(
                    "Surface",
                    value: terminalDiagnostics.surfaceState.rawValue,
                    hint: terminalRendererHint
                )
                HudInspectorFieldRow("PTY grid", value: terminalPTYGrid, hint: terminalCellSize)
                HudInspectorFieldRow(
                    "Parsed text",
                    value: terminalRendererTextValue,
                    hint: terminalRendererTextHint
                )
                HudInspectorFieldRow(
                    "Input",
                    value: terminalDiagnostics.keyboardHeight > 0 ? "Hosted" : "Not mounted",
                    hint: terminalKeyboardHint
                )
                VStack(alignment: .leading, spacing: 3) {
                    if terminalDiagnostics.rendererDiagnostics.isEmpty {
                        Text("Renderer diagnostics have not reported yet.")
                            .foregroundStyle(ScoutInk.dim)
                    } else {
                        ForEach(Array(terminalDiagnostics.rendererDiagnostics.enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .foregroundStyle(ScoutInk.muted)
                        }
                    }
                }
                .font(HudFont.mono(HudTextSize.micro))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(HudSpacing.md)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                        .fill(Color.black.opacity(0.4))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                        .strokeBorder(HudHairline.standard, lineWidth: HudStrokeWidth.thin)
                )
                #if canImport(UIKit)
                HudInspectorActionRow(
                    "Copy terminal diagnostics",
                    value: copiedTerminalDiagnostics ? "Copied" : "Copy",
                    tone: .accent
                ) {
                    UIPasteboard.general.string = terminalDiagnosticText
                    copiedTerminalDiagnostics = true
                }
                #endif
            }

            HudInspectorActionRow("Refresh terminal status", value: "Run", tone: .accent) {
                Task { await terminalDiagnostics.refreshHostStatus(using: model.client) }
            }
        }
    }

    private var terminalWrapperValue: String {
        guard let status = terminalDiagnostics.hostStatus else {
            return terminalDiagnostics.hostStatusError == nil ? "Checking…" : "Unavailable"
        }
        guard status.wrapperInstalled else { return "Missing" }
        return status.sessionExists ? "Ready" : "No session"
    }

    private var terminalWrapperHint: String {
        guard let status = terminalDiagnostics.hostStatus else { return "tmux status probe" }
        return status.wrapperInstalled ? status.wrapperKind : "tmux is not available in the login PATH"
    }

    private var terminalWrapperSessionHint: String {
        guard let status = terminalDiagnostics.hostStatus else { return "persistent wrapper" }
        guard status.sessionExists else { return "session does not exist" }
        return "\(status.attachedClients) attached client\(status.attachedClients == 1 ? "" : "s")"
    }

    private var terminalHostPaneValue: String {
        guard let status = terminalDiagnostics.hostStatus,
              let columns = status.paneColumns,
              let rows = status.paneRows else { return "—" }
        return "\(columns)×\(rows)"
    }

    private var terminalPTYGrid: String {
        guard let columns = terminalDiagnostics.ptyColumns,
              let rows = terminalDiagnostics.ptyRows else { return "—" }
        return "\(columns)×\(rows)"
    }

    private var terminalCellSize: String {
        guard let width = terminalDiagnostics.cellWidthPixels,
              let height = terminalDiagnostics.cellHeightPixels else { return "renderer has not sized the PTY" }
        return "cell \(width)×\(height) px"
    }

    private var terminalRendererHint: String {
        terminalDiagnostics.rendererDiagnostics.isEmpty ? "Ghostty has not reported geometry" : "Ghostty geometry available below"
    }

    private var terminalRendererTextValue: String {
        let count = terminalDiagnostics.rendererVisibleText.count
        return count == 0 ? "Empty" : "\(count) chars"
    }

    private var terminalRendererTextHint: String {
        let lines = terminalDiagnostics.rendererVisibleText
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        guard let first = lines.first(where: { !$0.isEmpty }) else {
            return "no visible cells parsed"
        }
        return String(first.prefix(100))
    }

    private var terminalKeyboardHint: String {
        guard terminalDiagnostics.keyboardHeight > 0 else { return "system keyboard is disabled" }
        return "custom keyboard · \(Int(terminalDiagnostics.keyboardHeight.rounded())) pt"
    }

    private func compactTerminalHint(_ value: String?) -> String? {
        guard let value else { return nil }
        let compact = value.replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !compact.isEmpty else { return nil }
        return String(compact.prefix(140))
    }

    private var terminalDiagnosticText: String {
        let host = terminalDiagnostics.hostStatus
        var lines = [
            "Scout Terminal diagnostics",
            "bridge: \(statusShort) via \(routeLabel)",
            "surface: \(terminalDiagnostics.surfaceState.rawValue)",
            "provisioning: \(terminalDiagnostics.provisioningState.rawValue)",
            "ssh: \(terminalDiagnostics.sshState.rawValue)",
            "endpoint: \(terminalDiagnostics.endpoint ?? "—")",
            "host key: \(terminalDiagnostics.hostKeyPinned ? "pinned" : "missing")",
            "pty grid: \(terminalPTYGrid)",
            "parsed viewport: \(terminalRendererTextValue) \(terminalRendererTextHint)",
            "keyboard: \(terminalKeyboardHint)",
            "shell: \(host?.shellExecutable ?? "—")",
            "wrapper: \(host?.wrapperKind ?? "—") installed=\(host?.wrapperInstalled == true)",
            "wrapper session: \(host?.sessionName ?? "—") exists=\(host?.sessionExists == true) clients=\(host?.attachedClients ?? 0)",
            "wrapper pane: \(terminalHostPaneValue) command=\(host?.paneCommand ?? "—")",
        ]
        lines.append(contentsOf: terminalDiagnostics.rendererDiagnostics)
        if let error = terminalDiagnostics.hostStatusError { lines.append("host probe error: \(error)") }
        return lines.joined(separator: "\n")
    }

    /// Trailing value for a paired-Mac row — kept to a short token (route label /
    /// "Live" / "Paired") so it never widens the fixed-size trailing run; the
    /// variable-length last-seen lives in the left hint, which truncates.
    private func machineState(_ machine: AppModel.PairedMachine) -> String {
        switch machine.connectionState {
        case .connected(let route):
            return route.label.isEmpty ? "Live" : route.label
        case .connecting:
            return "…"
        case .failed:
            return "Off"
        case .idle:
            return "Paired"
        }
    }

    /// Quiet hint under the Mac name: focused says what surfaces route through;
    /// online says the keyed bridge client is live.
    private func machineHint(_ machine: AppModel.PairedMachine) -> String {
        if machine.isActive, machine.isOnline { return "active link" }
        if machine.isActive { return "focused" }
        if machine.isOnline { return "connected" }
        if case .failed = machine.connectionState { return "unreachable" }
        if case .connecting = machine.connectionState { return "connecting" }
        guard let seen = machine.lastSeen else { return "paired" }
        return "seen \(seen.formatted(.relative(presentation: .named)))"
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
            HudInspectorSection("OpenScout Net") {
                HudInspectorFieldRow("Login", value: model.openScoutNetworkAuthStatus, hint: model.openScoutNetworkAuthHint)
                HudInspectorActionRow("GitHub", value: model.openScoutNetworkAuthActionLabel, tone: .accent) {
                    model.openOpenScoutNetworkLogin()
                }
                if model.openScoutNetworkAuthStatus != "Signed out" {
                    HudInspectorActionRow("Sign out", value: "Clear", tone: .warn) {
                        model.signOutOpenScoutNetwork()
                    }
                }
            }
            HudInspectorSection("Tailnet discovery") {
                HudInspectorFieldRow("Scan", value: tailnetRepairValue, hint: tailnetRepairHint)
                HudInspectorFieldRow("Anchors", value: tailnetAnchorValue, hint: tailnetAnchorHint)
                HudInspectorActionRow("Refresh devices", value: model.isRefreshingTailnetPairTargets ? "…" : "Run", tone: .accent) {
                    Task { await model.refreshTailnetPairTargets() }
                }
                if let error = model.tailnetPairError {
                    HudInspectorFieldRow("Last error", value: "Warn", hint: error)
                }
                if model.tailnetPairTargets.isEmpty && !model.isRefreshingTailnetPairTargets {
                    HudInspectorFieldRow("No devices", value: "—", hint: "tailnet peers")
                } else {
                    ForEach(model.tailnetPairTargets) { target in
                        TailnetPairTargetRow(
                            target: target,
                            isPairing: model.tailnetPairingTargetId == target.id,
                            onPair: { Task { await model.pairWithTailnetTarget(target) } }
                        )
                    }
                }
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
            HudInspectorSection("Canvas") {
                // Live control: cycling re-tones the whole app (canvas + cards
                // read the same `scout.tone` default) without leaning on accent.
                HudInspectorCycleRow(
                    "Tone",
                    selection: $tone,
                    choices: ScoutTone.allCases.map { HudInspectorChoice(id: $0.rawValue, title: $0.title) },
                    hint: "warm or cool the charcoal"
                )
                HudInspectorFieldRow("Mode", value: "Dark", hint: "cockpit, always")
            }
        }
    }

    private var advancedPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Broker requests") {
                HudInspectorFieldRow(
                    "Recent requests",
                    value: latestRequestMetric,
                    hint: "\(BrokerRequestLog.shared.entries.count) metadata-only entries"
                )
                HudInspectorActionRow("View request log", value: "Open", tone: .accent) {
                    showingRequestLogViewer = true
                }
                HudInspectorActionRow("Clear request log", value: "Clear", tone: .warn) {
                    BrokerRequestLog.shared.clear()
                }
            }
            HudInspectorSection("Diagnostics") {
                HudInspectorFieldRow("Connection log", value: latestLogMetric, hint: "\(model.connectionLog.entries.count) entries")
                HudInspectorActionRow("View connection log", value: "Open", tone: .accent) {
                    showingLogViewer = true
                }
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
                HudInspectorFieldRow("Version", value: "0.2.70", hint: "Scout")
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
                            .foregroundStyle(ScoutInk.dim)
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
                    HStack(spacing: HudSpacing.lg) {
                        Button { showingLogViewer = true } label: {
                            Text("OPEN LOG")
                                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                                .tracking(0.8)
                                .foregroundStyle(HudPalette.accent)
                        }
                        .buttonStyle(.plain)

                        Button { copyConnectionLog() } label: {
                            Text(copiedLogs ? "COPIED" : "COPY LOG")
                                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                                .tracking(0.8)
                                .foregroundStyle(HudPalette.accent)
                        }
                        .buttonStyle(.plain)
                    }
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
                .foregroundStyle(ScoutInk.dim)
            Text(entry.event.label)
                .foregroundStyle(logEventColor(entry))
                .frame(width: 68, alignment: .leading)
            Text(compactLogMessage(entry))
                .foregroundStyle(ScoutInk.muted)
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
        case .routeDisabled, .routeUnavailable, .reconnect, .network: return HudPalette.statusWarn
        default: break
        }
        switch entry.level {
        case .error:   return HudPalette.statusError
        case .warning: return HudPalette.statusWarn
        case .success: return HudPalette.accent
        case .info:    return entry.event == .lifecycle ? ScoutInk.dim : ScoutInk.muted
        }
    }

    private var recentConnectionLogEntries: [ConnectionLogEntry] {
        Array(model.connectionLog.entries.suffix(8).reversed())
    }

    private var latestLogMetric: String {
        guard let entry = model.connectionLog.entries.last else { return "—" }
        return entry.event.label
    }

    private var latestRequestMetric: String {
        guard let entry = BrokerRequestLog.shared.entries.last else { return "—" }
        return entry.outcome == .success ? "OK" : "Failed"
    }

    private func logEntryTitle(_ entry: ConnectionLogEntry) -> String {
        "\(routeToken(entry.route)) \(entry.event.label)"
    }

    /// Inspector field rows are fixed-width and put the title and value on one
    /// line — a full relay URL in a log message ("Connected via TSN wss://arachs
    /// -mac-mini.tail1e8e67.ts.net:43131") would force the row, and the whole
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
        (ScoutTimestamp.date(fromEpoch: TimeInterval(entry.tsMs)) ?? Date(timeIntervalSince1970: 0))
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
        model.statusShortLabel
    }

    private var deviceName: String {
        #if canImport(UIKit)
        return UIDevice.current.name
        #else
        return "Scout"
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

    private var tailnetRepairValue: String {
        if model.isRefreshingTailnetPairTargets { return "…" }
        if model.tailnetPairError != nil { return "Warn" }
        let total = model.tailnetPairTargets.count
        guard total > 0 else { return "—" }
        let online = model.tailnetPairTargets.filter(\.isOnline).count
        return "\(online)/\(total)"
    }

    private var tailnetRepairHint: String {
        if model.isRefreshingTailnetPairTargets { return "scanning" }
        if let status = model.tailnetPairProbeStatus { return status }
        if let origin = model.tailnetPairDiscoveryOrigin { return origin }
        if model.tailnetPairError != nil { return "discovery failed" }
        return "mesh peers"
    }

    private var tailnetAnchorValue: String {
        let count = model.tailnetPairDiscoveryHosts.count
        guard count > 0 else { return "—" }
        return "\(count)"
    }

    private var tailnetAnchorHint: String {
        guard !model.tailnetPairDiscoveryHosts.isEmpty else {
            return model.hasTrustedBridge ? "no saved Tailnet relay" : "pair a Mac first"
        }
        return model.tailnetPairDiscoveryHosts.joined(separator: ", ")
    }
}

// MARK: - Broker request log viewer

private struct BrokerRequestLogViewer: View {
    @Bindable var log: BrokerRequestLog
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header
                Divider()
                    .overlay(HudHairline.subtle)
                requestList
            }
            .background(HudPalette.bg)
            .navigationTitle("Broker requests")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                        .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(HudPalette.accent)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear") { log.clear() }
                        .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(HudPalette.statusWarn)
                        .disabled(log.entries.isEmpty)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxs) {
            HStack(spacing: HudSpacing.md) {
                Text("\(log.entries.count) recent")
                    .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                Spacer()
                Text("MAX 200")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutInk.dim)
            }
            Text("Operation metadata only — inputs and responses are never recorded.")
                .font(HudFont.ui(HudTextSize.xs, weight: .light))
                .foregroundStyle(ScoutInk.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, HudSpacing.lg)
        .padding(.vertical, HudSpacing.md)
    }

    @ViewBuilder
    private var requestList: some View {
        if log.entries.isEmpty {
            ContentUnavailableView(
                "No broker requests yet",
                systemImage: "arrow.left.arrow.right",
                description: Text("Requests appear here as you use Scout.")
            )
            .foregroundStyle(ScoutInk.muted)
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(log.entries.reversed()) { entry in
                        requestRow(entry)
                    }
                }
                .padding(.horizontal, HudSpacing.lg)
            }
        }
    }

    private func requestRow(_ entry: BrokerRequestLogEntry) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxs) {
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                Text(requestTime(entry))
                    .foregroundStyle(ScoutInk.dim)
                Text(entry.operation)
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: HudSpacing.sm)
                Text(entry.outcome == .success ? "OK" : "FAIL")
                    .foregroundStyle(entry.outcome == .success ? HudPalette.accent : HudPalette.statusError)
            }
            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))

            HStack(spacing: HudSpacing.sm) {
                Text(entry.kind.uppercased())
                if let route = entry.route, !route.label.isEmpty {
                    Text("· \(route.label)")
                }
                Text("· \(durationLabel(entry.durationMilliseconds))")
                if let failure = entry.failureCategory {
                    Text("· \(failure)")
                        .foregroundStyle(HudPalette.statusWarn)
                }
            }
            .font(HudFont.mono(HudTextSize.micro))
            .foregroundStyle(ScoutInk.muted)
        }
        .padding(.vertical, HudSpacing.md)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HudHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
        }
        .accessibilityElement(children: .combine)
    }

    private func requestTime(_ entry: BrokerRequestLogEntry) -> String {
        entry.completedAt.formatted(.dateTime.hour().minute().second())
    }

    private func durationLabel(_ milliseconds: Int) -> String {
        if milliseconds < 1_000 { return "\(milliseconds) ms" }
        return String(format: "%.1f s", Double(milliseconds) / 1_000)
    }
}

// MARK: - Connection log viewer

private struct ConnectionLogViewer: View {
    @Bindable var model: AppModel
    @Binding var copiedLogs: Bool
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                logHeader
                Divider()
                    .overlay(HudHairline.subtle)
                logBody
            }
            .background(HudPalette.bg)
            .navigationTitle("Connection log")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                        .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(HudPalette.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var logHeader: some View {
        HStack(spacing: HudSpacing.md) {
            HudStatusDot(color: model.statusTint, size: 8, pulses: model.statusPulses)
            Text(model.statusShortLabel)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(HudPalette.ink)
                .lineLimit(1)
            Spacer()
            Text("\(model.connectionLog.entries.count) entries")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .foregroundStyle(ScoutInk.dim)
        }
        .padding(.horizontal, HudSpacing.lg)
        .padding(.vertical, HudSpacing.md)
    }

    private var logBody: some View {
        ConnectionLogList(entries: model.connectionLog.entries)
    }
}

// MARK: - Tailnet repair row

private struct TailnetPairTargetRow: View {
    let target: AppModel.TailnetPairTarget
    let isPairing: Bool
    let onPair: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: HudSpacing.sm) {
            HudStatusDot(color: target.isOnline ? HudPalette.accent : ScoutInk.dim, size: 7, pulses: target.isOnline)
                .frame(width: 12)

            VStack(alignment: .leading, spacing: 2) {
                Text(target.displayName)
                    .font(HudFont.ui(HudTextSize.md))
                    .foregroundStyle(target.isOnline ? HudPalette.ink : ScoutInk.muted)
                    .lineLimit(1)
                Text(target.detail)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            Spacer(minLength: HudSpacing.md)

            Button(action: onPair) {
                Text(isPairing ? "PAIRING" : "PAIR")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(target.isOnline ? HudPalette.accent : ScoutInk.dim)
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, HudSpacing.xxs)
                    .overlay(
                        Capsule()
                            .strokeBorder(
                                HudSurface.tintBorder(target.isOnline ? HudPalette.accent : ScoutInk.dim),
                                lineWidth: HudStrokeWidth.thin
                            )
                    )
            }
            .buttonStyle(.plain)
            .disabled(!target.isOnline || isPairing)
        }
        .frame(height: HudLayout.rowHeightRegular)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HudHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(target.displayName), \(target.detail)")
    }
}


// MARK: - Mac connection row

/// A paired Mac row has two independent states:
/// - online/offline: the keyed bridge client is live and should light up.
/// - focused: surfaces are currently filtered through that Mac's client.
///
/// The generic `HudInspectorFieldRow` only has text + value, so this local row
/// adds the status dot without changing HudsonKit.
private struct MacConnectionRow: View {
    let machine: AppModel.PairedMachine
    let value: String
    let hint: String
    let onSelect: () -> Void
    let onForget: () -> Void
    var onRename: () -> Void = {}

    var body: some View {
        HStack(alignment: .center, spacing: HudSpacing.sm) {
            HudStatusDot(color: statusColor, size: 7, pulses: statusPulses)
                .frame(width: 12)

            HStack(alignment: .center, spacing: HudSpacing.sm) {
                Text(machine.name)
                    .font(HudFont.ui(HudTextSize.md))
                    .foregroundStyle(machine.isOnline ? HudPalette.ink : ScoutInk.muted)
                    .lineLimit(1)
                    .layoutPriority(2)

                Text("· \(hint)")
                    .font(HudFont.ui(HudTextSize.sm, weight: .light))
                    .foregroundStyle(machine.isActive ? HudPalette.accent : ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(0)
            }

            Spacer(minLength: HudSpacing.md)

            HStack(spacing: 8) {
                Text(value)
                    .font(HudFont.mono(HudTextSize.md))
                    .foregroundStyle(valueTint)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(minWidth: 52, alignment: .trailing)

                Button(action: onForget) {
                    Text("FORGET")
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .tracking(0.8)
                        .foregroundStyle(HudPalette.accent)
                        .padding(.horizontal, HudSpacing.sm)
                        .padding(.vertical, HudSpacing.xxs)
                        .overlay(
                            Capsule()
                                .strokeBorder(
                                    HudSurface.tintBorder(HudPalette.accent),
                                    lineWidth: HudStrokeWidth.thin
                                )
                        )
                }
                .buttonStyle(.plain)
            }
            .fixedSize(horizontal: true, vertical: false)
        }
        .frame(height: HudLayout.rowHeightRegular)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HudHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
        // Long-press for the operator overrides: rename (mesh Macs can't report
        // their own name) and forget. Accent stays out of the row chrome.
        .contextMenu {
            Button(action: onRename) { Label("Rename", systemImage: "pencil") }
            Button(role: .destructive, action: onForget) { Label("Forget", systemImage: "trash") }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(machine.name), \(value), \(hint)")
        .accessibilityAddTraits(.isButton)
    }

    private var statusColor: Color {
        switch machine.connectionState {
        case .connected:
            return HudPalette.accent
        case .connecting:
            return HudPalette.statusWarn
        case .failed:
            return HudPalette.statusError
        case .idle:
            return ScoutInk.dim
        }
    }

    private var valueTint: Color {
        switch machine.connectionState {
        case .connected:
            return HudPalette.accent
        case .connecting:
            return HudPalette.statusWarn
        case .failed:
            return HudPalette.statusError
        case .idle:
            return ScoutInk.dim
        }
    }

    private var statusPulses: Bool {
        if case .connecting = machine.connectionState { return true }
        return false
    }
}
