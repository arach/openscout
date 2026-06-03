import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Session Settings — per-agent configuration for the conversation you're in,
/// built from the HudSettings* family. Scaffolded values for now; the AGENT /
/// EXECUTION / SESSION / ACTIONS shape is the point. Interrupt is wired live.
struct SessionSettingsView: View {
    let client: any ScoutBrokerClient
    let conversationId: String
    let title: String
    @Environment(\.dismiss) private var dismiss

    @State private var persistence = "Sticky"
    @State private var autoApprove = false

    private let anchors: [HudSettingsQuickNav.Item] = [
        .init(icon: "cpu", label: "Agent", anchor: "AGENT"),
        .init(icon: "gearshape.2", label: "Execution", anchor: "EXECUTION"),
        .init(icon: "bubble.left.and.bubble.right", label: "Session", anchor: "SESSION"),
        .init(icon: "bolt", label: "Actions", anchor: "ACTIONS"),
    ]

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                        HudSettingsQuickNav(items: anchors, proxy: proxy)
                        agentSection
                        executionSection
                        sessionSection
                        actionsSection
                    }
                    .padding(HudSpacing.xxl)
                }
                .background(HudPalette.bg)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(HudPalette.accent)
                }
            }
        }
        .preferredColorScheme(.dark)
    }

    private var agentSection: some View {
        HudSettingsSection("AGENT") {
            HudSettingsRow(icon: "cpu", iconColor: HudTint.green.color, title: "Harness", subtitle: "Runtime backing this agent") {
                Text("claude").font(HudFont.mono(HudTextSize.xs)).foregroundStyle(HudPalette.muted)
            }
            HudSettingsRow(icon: "brain", iconColor: HudTint.violet.color, title: "Model") {
                Text("opus-4.8").font(HudFont.mono(HudTextSize.xs)).foregroundStyle(HudPalette.muted)
            }
            HudSettingsPickerRow(title: "Persistence", subtitle: "How long the agent sticks around", icon: "pin", iconColor: HudTint.amber.color, selection: $persistence) {
                Text("Sticky").tag("Sticky")
                Text("Fresh").tag("Fresh")
            }
        }
    }

    private var executionSection: some View {
        HudSettingsSection("EXECUTION") {
            HudSettingsRow(icon: "folder", iconColor: HudTint.blue.color, title: "Project", subtitle: "/Users/arach/dev/openscout")
            HudSettingsRow(icon: "arrow.triangle.branch", iconColor: HudTint.teal.color, title: "Branch", subtitle: "in-place · main")
            HudSettingsControlRow(title: "Auto-approve", subtitle: "Skip the approval gate for low-risk actions", icon: "checkmark.shield", iconColor: HudTint.green.color) {
                Toggle("", isOn: $autoApprove).labelsHidden().tint(HudPalette.accent)
            }
        }
    }

    private var sessionSection: some View {
        HudSettingsSection("SESSION") {
            HudKVRow("ID", value: conversationId, valueLineLimit: 1)
            HudKVRow("STATUS", value: "active")
            HudKVRow("MESSAGES", value: "—")
        }
    }

    private var actionsSection: some View {
        HudSettingsSection("ACTIONS") {
            HudSettingsRow(icon: "stop.circle", iconColor: HudPalette.statusWarn, title: "Interrupt turn", subtitle: "Stop the agent mid-flight", onTap: {
                Task { _ = try? await client.interrupt(InterruptSpec(conversationId: conversationId)) }
            })
            HudSettingsRow(icon: "arrow.counterclockwise.circle", title: "Start fresh session", subtitle: "Same agent, clean context", onTap: {})
            HudSettingsRow(icon: "xmark.circle", iconColor: HudPalette.statusError, title: "Close session", onTap: {})
        }
    }
}
