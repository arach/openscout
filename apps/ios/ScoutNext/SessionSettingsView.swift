import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Session Settings — per-agent configuration in HudsonKit's `HudInspectorSettings`
/// vertical-rail inspector. The rail switches AGENT / EXECUTION / SESSION /
/// ACTIONS panels. Interrupt is wired live; the rest is scaffolded until the
/// per-session RPCs land.
struct SessionSettingsView: View {
    let client: any ScoutBrokerClient
    let conversationId: String
    let title: String
    @Environment(\.dismiss) private var dismiss

    @State private var tab = "AGENT"
    @State private var autoApprove = false

    private let tabIDs = ["AGENT", "EXECUTION", "SESSION", "ACTIONS"]

    var body: some View {
        HudInspectorSettings(
            title: title,
            subtitle: "session",
            tabs: tabIDs.map { HudInspectorTab(id: $0, label: $0.capitalized) },
            selection: $tab,
            onClose: { dismiss() }
        ) { tabID in
            switch tabID {
            case "AGENT":     agentPanel
            case "EXECUTION": executionPanel
            case "SESSION":   sessionPanel
            default:          actionsPanel
            }
        }
    }

    private var agentPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Runtime") {
                HudInspectorFieldRow("Harness", value: "claude", hint: "backing runtime")
                HudInspectorFieldRow("Model", value: "opus-4.8", hint: "weights")
                HudInspectorFieldRow("Persistence", value: "Sticky", hint: "lifecycle")
            }
        }
    }

    private var executionPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Workspace") {
                HudInspectorFieldRow("Project", value: "openscout")
                HudInspectorFieldRow("Branch", value: "main", hint: "in-place")
            }
            HudInspectorSection("Policy") {
                HudInspectorToggleRow("Auto-approve", isOn: $autoApprove, valueOn: "On", valueOff: "Off", hint: "skip low-risk gates")
            }
        }
    }

    private var sessionPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorMetricStrip([
                .init("Status", value: "Active"),
                .init("Turns", value: "—"),
                .init("Msgs", value: "—")
            ])
            HudInspectorSection("Handle") {
                HudInspectorFieldRow("ID", value: String(conversationId.prefix(12)))
            }
        }
    }

    private var actionsPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            HudInspectorSection("Control") {
                HudInspectorActionRow("Interrupt turn", value: "Stop", tone: .warn) {
                    Task { _ = try? await client.interrupt(InterruptSpec(conversationId: conversationId)) }
                }
                HudInspectorActionRow("Start fresh session", value: "New", tone: .accent) {}
                HudInspectorActionRow("Close session", value: "Close", tone: .warn) {}
            }
        }
    }
}
