import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Session Settings — per-agent configuration in the same vertical-rail shell.
/// The rail switches AGENT / EXECUTION / SESSION / ACTIONS panels. Interrupt is
/// wired live; the rest is scaffolded until the per-session RPCs land.
struct SessionSettingsView: View {
    let client: any ScoutBrokerClient
    let conversationId: String
    let title: String
    @Environment(\.dismiss) private var dismiss

    @State private var tab = "AGENT"
    @State private var autoApprove = false

    private let tabs = ["AGENT", "EXECUTION", "SESSION", "ACTIONS"]

    var body: some View {
        SettingsShell(app: title.uppercased(), context: "SESSION", tabs: tabs, selection: $tab, panel: { panel }, onDone: { dismiss() })
    }

    @ViewBuilder private var panel: some View {
        switch tab {
        case "AGENT":     agentPanel
        case "EXECUTION": executionPanel
        case "SESSION":   sessionPanel
        default:          actionsPanel
        }
    }

    private var agentPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · AGENT") {
            SettingsGroup("RUNTIME") {
                SettingsValueRow(title: "Harness", subtitle: "backing runtime", value: "claude")
                SettingsValueRow(title: "Model", subtitle: "weights", value: "opus-4.8")
                SettingsValueRow(title: "Persistence", subtitle: "lifecycle", value: "Sticky")
            }
        }
    }

    private var executionPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · EXECUTION") {
            SettingsGroup("WORKSPACE") {
                SettingsValueRow(title: "Project", value: "openscout", valueTint: HudPalette.ink)
                SettingsValueRow(title: "Branch", subtitle: "in-place", value: "main", valueTint: HudPalette.ink)
            }
            SettingsGroup("POLICY") {
                SettingsValueRow(title: "Auto-approve", subtitle: "skip low-risk gates", value: autoApprove ? "ON" : "OFF", valueTint: autoApprove ? HudTint.green.color : HudPalette.muted, onTap: { autoApprove.toggle() })
            }
        }
    }

    private var sessionPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · SESSION") {
            SettingsStatTiles(tiles: [("STATUS", "Active"), ("TURNS", "—"), ("MSGS", "—")])
            SettingsGroup("HANDLE") {
                SettingsValueRow(title: "ID", value: String(conversationId.prefix(12)), valueTint: HudPalette.muted)
            }
        }
    }

    private var actionsPanel: some View {
        SettingsPanel(breadcrumb: "INSPECTOR · ACTIONS") {
            SettingsGroup("CONTROL") {
                SettingsValueRow(title: "Interrupt turn", subtitle: "stop mid-flight", value: "STOP", valueTint: HudTint.amber.color, onTap: {
                    Task { _ = try? await client.interrupt(InterruptSpec(conversationId: conversationId)) }
                })
                SettingsValueRow(title: "Start fresh session", subtitle: "same agent, clean context", value: "NEW", onTap: {})
                SettingsValueRow(title: "Close session", subtitle: "end this conversation", value: "CLOSE", valueTint: HudPalette.statusError, onTap: {})
            }
        }
    }
}
