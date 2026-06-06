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
    /// Live runtime, passed from the conversation's loaded session so the panel
    /// reads real values instead of placeholders. Lifecycle isn't carried on the
    /// running session (it's a creation-time property), so it stays a labeled
    /// default with an explainer rather than a fabricated live read.
    var harness: String?
    var model: String?
    @Environment(\.dismiss) private var dismiss

    @State private var tab = "AGENT"
    @State private var autoApprove = false
    @State private var showLifecycleInfo = false

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
                HudInspectorFieldRow("Harness", value: harness ?? "—", hint: "backing runtime")
                HudInspectorFieldRow("Model", value: model ?? "—", hint: "weights")
                // "Sticky" is jargon on its own. The value reads plainly and the
                // trailing "?" chip opens a short definition of the two modes.
                HudInspectorFieldRow(
                    "Lifecycle",
                    value: "Persistent",
                    inlineAction: .init("?") { showLifecycleInfo = true }
                )
                .popover(isPresented: $showLifecycleInfo, arrowEdge: .top) {
                    lifecycleInfo
                        .presentationCompactAdaptation(.popover)
                        .presentationBackground(HudPalette.surface)
                }
            }
        }
    }

    /// Plain-language explainer for the two lifecycle modes, surfaced from the
    /// Lifecycle row's "?" chip.
    private var lifecycleInfo: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            Text("LIFECYCLE")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(2)
                .foregroundStyle(HudPalette.dim)
            lifecycleItem("Persistent", "Keeps its workspace, branch, and identity between sessions — you return to the same agent.")
            lifecycleItem("One-time", "Runs the task once, then closes. Nothing is kept.")
        }
        .padding(HudSpacing.xl)
        .frame(width: 260)
    }

    private func lifecycleItem(_ term: String, _ desc: String) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxs) {
            Text(term)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
            Text(desc)
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(HudPalette.muted)
                .fixedSize(horizontal: false, vertical: true)
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
