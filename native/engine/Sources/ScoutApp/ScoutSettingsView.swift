import SwiftUI

struct ScoutSettingsView: View {
    let viewModel: ScoutShellViewModel
    @State private var selectedTab: SettingsTab = .general

    private enum SettingsTab: String, Hashable {
        case general
        case runtime
        case shell
    }

    var body: some View {
        ScoutPage {
            ScoutPageHeader(
                eyebrow: "Settings",
                title: "Scout Settings",
                subtitle: "Reusable layout primitives should make every settings subsection feel like the same system, not a one-off view.",
                actions: AnyView(
                    Button("Open Support Directory") {
                        viewModel.supervisor.openSupportDirectory()
                    }
                    .buttonStyle(ScoutButtonStyle())
                )
            )

            ScoutTabBar(
                items: [
                    ScoutTabItem(id: SettingsTab.general, title: "General"),
                    ScoutTabItem(id: SettingsTab.runtime, title: "Runtime"),
                    ScoutTabItem(id: SettingsTab.shell, title: "Shell"),
                ],
                selection: $selectedTab
            )

            switch selectedTab {
            case .general:
                generalTab
            case .runtime:
                runtimeTab
            case .shell:
                shellTab
            }
        }
    }

    private var generalTab: some View {
        HStack(alignment: .top, spacing: 18) {
            ScoutSection(
                title: "Workspace",
                subtitle: "The end-user layer now lives in the local workspace snapshot and control plane."
            ) {
                ScoutValueRow(label: "Support Directory", value: viewModel.supportPaths.applicationSupportDirectory.path(percentEncoded: false))
                ScoutValueRow(label: "Workspace State", value: viewModel.supportPaths.workspaceStateFileURL.path(percentEncoded: false))
                ScoutValueRow(label: "Control Plane", value: viewModel.supportPaths.controlPlaneDirectory.path(percentEncoded: false))
                ScoutValueRow(label: "SQLite", value: viewModel.supportPaths.controlPlaneDatabaseURL.path(percentEncoded: false))
            }

            ScoutSection(
                title: "Current Totals",
                subtitle: "Quick visibility into what the native shell is storing and surfacing."
            ) {
                ScoutValueRow(label: "Notes", value: "\(viewModel.notes.count)")
                ScoutValueRow(label: "Drafts", value: "\(viewModel.drafts.count)")
                ScoutValueRow(label: "Workflow Runs", value: "\(viewModel.workflowRuns.count)")
                ScoutValueRow(label: "Messages", value: "\(viewModel.relayMessages.count)")
            }
        }
    }

    private var runtimeTab: some View {
        ScoutSection(
            title: "Runtime",
            subtitle: "A parameterized section wrapper for worker and runtime settings."
        ) {
            ScoutSubsection(title: "Helper") {
                ScoutValueRow(label: "State", value: viewModel.supervisor.state.title)
                ScoutValueRow(label: "Detail", value: viewModel.supervisor.detail)
                if let lastHeartbeat = viewModel.supervisor.lastHeartbeat {
                    ScoutValueRow(
                        label: "Last Heartbeat",
                        value: lastHeartbeat.formatted(date: .abbreviated, time: .standard)
                    )
                }
            }

            ScoutSubsection(title: "Broker") {
                ScoutValueRow(label: "State", value: viewModel.brokerSupervisor.state.title)
                ScoutValueRow(label: "Detail", value: viewModel.brokerSupervisor.detail)
                ScoutValueRow(label: "URL", value: viewModel.brokerSupervisor.brokerURL.absoluteString)
                if let serviceLabel = viewModel.brokerSupervisor.serviceLabel {
                    ScoutValueRow(label: "Service Label", value: serviceLabel)
                }
                if let serviceMode = viewModel.brokerSupervisor.serviceMode {
                    ScoutValueRow(label: "Service Mode", value: serviceMode)
                }
                ScoutValueRow(label: "LaunchAgent", value: viewModel.brokerSupervisor.serviceInstalled ? "Installed" : "Not installed")
                ScoutValueRow(label: "Loaded", value: viewModel.brokerSupervisor.serviceLoaded ? "Yes" : "No")
                if let launchAgentPath = viewModel.brokerSupervisor.launchAgentPath {
                    ScoutValueRow(label: "Plist", value: launchAgentPath)
                }
                ScoutValueRow(label: "Control Plane", value: viewModel.supportPaths.controlPlaneDirectory.path(percentEncoded: false))
                ScoutValueRow(label: "SQLite", value: viewModel.supportPaths.controlPlaneDatabaseURL.path(percentEncoded: false))
                if let nodeID = viewModel.brokerSupervisor.nodeID {
                    ScoutValueRow(label: "Node ID", value: nodeID)
                }
                if let meshID = viewModel.brokerSupervisor.meshID {
                    ScoutValueRow(label: "Mesh ID", value: meshID)
                }
                ScoutValueRow(label: "Counts", value: viewModel.brokerSupervisor.counts.summary)
                if let lastHealthCheck = viewModel.brokerSupervisor.lastHealthCheck {
                    ScoutValueRow(
                        label: "Last Health",
                        value: lastHealthCheck.formatted(date: .abbreviated, time: .standard)
                    )
                }
                if let deviceActorID = viewModel.brokerSupervisor.localDeviceActorID {
                    ScoutValueRow(label: "Device Actor", value: deviceActorID)
                }
                if let lastLogLine = viewModel.brokerSupervisor.lastLogLine, !lastLogLine.isEmpty {
                    ScoutValueRow(label: "Last Log", value: lastLogLine)
                }
                if let stdoutLogPath = viewModel.brokerSupervisor.stdoutLogPath {
                    ScoutValueRow(label: "Stdout Log", value: stdoutLogPath)
                }
                if let stderrLogPath = viewModel.brokerSupervisor.stderrLogPath {
                    ScoutValueRow(label: "Stderr Log", value: stderrLogPath)
                }
            }

            ScoutSubsection(title: "Messaging") {
                ScoutValueRow(label: "Authority", value: "Broker-backed control plane")
                ScoutValueRow(label: "Active Messages", value: "\(viewModel.relayMessages.count)")
                ScoutValueRow(label: "Recent Flights", value: "\(viewModel.relayFlights.count)")
                ScoutValueRow(label: "Recent Events", value: "\(viewModel.relayEvents.count)")
            }

            ScoutSubsection(title: "tmux Inventory") {
                ScoutValueRow(label: "State", value: viewModel.tmuxInventoryState.title)
                ScoutValueRow(label: "Detail", value: viewModel.tmuxInventoryDetail)
                ScoutValueRow(label: "Reachable Hosts", value: "\(viewModel.tmuxHosts.filter(\.reachable).count)")
                ScoutValueRow(label: "Sessions", value: "\(viewModel.tmuxSessions.count)")
                if let tmuxInventoryLastUpdatedAt = viewModel.tmuxInventoryLastUpdatedAt {
                    ScoutValueRow(
                        label: "Last Updated",
                        value: tmuxInventoryLastUpdatedAt.formatted(date: .abbreviated, time: .standard)
                    )
                }
                if let tmuxInventoryLastError = viewModel.tmuxInventoryLastError {
                    ScoutValueRow(label: "Last Error", value: tmuxInventoryLastError)
                }
            }

            if !viewModel.tmuxHosts.isEmpty {
                ScoutSubsection(title: "tmux Hosts") {
                    ForEach(viewModel.tmuxHosts) { host in
                        ScoutValueRow(
                            label: host.name,
                            value: "\(host.target) · \(host.displayValue)"
                        )
                    }
                }
            }

            if !viewModel.tmuxSessions.isEmpty {
                ScoutSubsection(title: "Available tmux Sessions") {
                    ForEach(viewModel.tmuxSessions) { session in
                        ScoutValueRow(
                            label: "\(session.hostLabel) · \(session.sessionName)",
                            value: "\(session.laneLabel) · \(session.detail)"
                        )
                    }
                }
            }

            if !viewModel.visibleRuntimeAgents.isEmpty {
                ScoutSubsection(title: "Known Agents") {
                    ForEach(viewModel.visibleRuntimeAgents) { agent in
                        ScoutValueRow(
                            label: "\(agent.displayName) · \(agent.state)",
                            value: "\(agent.id) · \(agent.detail)"
                        )
                    }
                }
            }

            ScoutSubsection(title: "Mesh") {
                ScoutValueRow(label: "Discovery", value: viewModel.meshDiscoveryState.title)
                ScoutValueRow(label: "Detail", value: viewModel.meshDiscoveryDetail)
                ScoutValueRow(label: "Broker Port", value: "\(viewModel.meshBrokerPort)")
                ScoutValueRow(label: "Local Broker", value: viewModel.meshLocalBrokerReachable ? "Reachable" : "Not running")
                ScoutValueRow(label: "Brokers Found", value: "\(viewModel.meshBrokerNodeCount)")
                ScoutValueRow(label: "Tailscale Peers", value: "\(viewModel.meshPeersScanned)")
                if let meshLastUpdatedAt = viewModel.meshLastUpdatedAt {
                    ScoutValueRow(
                        label: "Last Updated",
                        value: meshLastUpdatedAt.formatted(date: .abbreviated, time: .standard)
                    )
                }
                if !viewModel.meshNodes.isEmpty {
                    ForEach(viewModel.meshNodes) { node in
                        ScoutValueRow(
                            label: node.name,
                            value: "\(node.detail) · \(node.brokerLabel)"
                        )
                    }
                }
            }

            if !viewModel.meshProbeResults.isEmpty {
                ScoutSubsection(title: "Mesh Probes") {
                    ForEach(viewModel.meshProbeResults) { probe in
                        ScoutValueRow(
                            label: probe.target,
                            value: probe.detail
                        )
                    }
                }
            }

            if !viewModel.relayFlights.isEmpty {
                ScoutSubsection(title: "Recent Flights") {
                    ForEach(Array(viewModel.relayFlights.prefix(8)), id: \.id) { flight in
                        ScoutValueRow(
                            label: "\(flight.targetAgentID) · \(flight.state)",
                            value: flight.summary ?? flight.error ?? "No detail yet."
                        )
                    }
                }
            }

            if !viewModel.relayEvents.isEmpty {
                ScoutSubsection(title: "Recent Broker Events") {
                    ForEach(Array(viewModel.relayEvents.prefix(12)), id: \.id) { event in
                        ScoutValueRow(
                            label: "\(event.kind) · \(event.actorID)",
                            value: Date(timeIntervalSince1970: TimeInterval(event.timestamp) / 1000).formatted(date: .omitted, time: .standard)
                        )
                    }
                }
            }

            ScoutSubsection(title: "Diagnostics Log") {
                if viewModel.diagnosticsLogLines.isEmpty {
                    ScoutValueRow(label: "Status", value: "No diagnostic lines captured yet.")
                } else {
                    ScrollView {
                        Text(viewModel.diagnosticsLogLines.joined(separator: "\n"))
                            .font(.system(size: 11, weight: .regular, design: .monospaced))
                            .foregroundStyle(ScoutTheme.inkSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(12)
                    }
                    .frame(minHeight: 180, maxHeight: 260)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(ScoutTheme.input)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .strokeBorder(ScoutTheme.border.opacity(0.6), lineWidth: 0.75)
                            )
                    )
                }
            }

            HStack(spacing: 10) {
                Button("Restart Helper") {
                    viewModel.supervisor.restart()
                }
                .buttonStyle(ScoutButtonStyle(tone: .primary))

                Button("Start Broker") {
                    viewModel.brokerSupervisor.startIfNeeded()
                }
                .buttonStyle(ScoutButtonStyle())

                Button("Stop Broker") {
                    viewModel.brokerSupervisor.stop()
                }
                .buttonStyle(ScoutButtonStyle())

                Button("Restart Broker") {
                    viewModel.brokerSupervisor.restart()
                }
                .buttonStyle(ScoutButtonStyle())

                Button("Refresh Broker") {
                    Task {
                        await viewModel.brokerSupervisor.refreshNow()
                    }
                }
                .buttonStyle(ScoutButtonStyle())

                Button("Install LaunchAgent") {
                    viewModel.brokerSupervisor.install()
                }
                .buttonStyle(ScoutButtonStyle())

                Button("Remove LaunchAgent") {
                    viewModel.brokerSupervisor.uninstall()
                }
                .buttonStyle(ScoutButtonStyle())

                Button("Refresh Mesh") {
                    Task {
                        await viewModel.refreshMeshNow()
                    }
                }
                .buttonStyle(ScoutButtonStyle())

                Button("Refresh tmux") {
                    Task {
                        await viewModel.refreshTmuxInventoryNow()
                    }
                }
                .buttonStyle(ScoutButtonStyle())

                Button("Open Support Directory") {
                    viewModel.supervisor.openSupportDirectory()
                }
                .buttonStyle(ScoutButtonStyle())

                Button("Open Control Plane") {
                    viewModel.brokerSupervisor.openControlPlaneDirectory()
                }
                .buttonStyle(ScoutButtonStyle())
            }
        }
    }

    private var shellTab: some View {
        ScoutSection(
            title: "Shell Direction",
            subtitle: "OpenScout should own chrome, local persistence, and agent handoff while keeping deeper orchestration portable."
        ) {
            ScoutSubsection(
                title: "Current Direction",
                subtitle: "The new end-user value is notes + compose + prompt workflows + relay delivery."
            ) {
                ScoutValueRow(label: "Editors", value: "AppKit-backed text surfaces for serious note and brief writing")
                ScoutValueRow(label: "Compose", value: "Prompt packets generated from workflow templates and linked notes")
                ScoutValueRow(label: "Workflows", value: "Data-driven prompt structures inspired by Talkie’s non-voice workflows")
                ScoutValueRow(label: "Messaging", value: "Broker-backed local communication and delivery planning")
            }
        }
    }
}
