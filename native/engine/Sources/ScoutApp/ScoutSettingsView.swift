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
                subtitle: "The end-user layer now lives in the local workspace snapshot and relay hub."
            ) {
                ScoutValueRow(label: "Support Directory", value: viewModel.supportPaths.applicationSupportDirectory.path(percentEncoded: false))
                ScoutValueRow(label: "Workspace State", value: viewModel.supportPaths.workspaceStateFileURL.path(percentEncoded: false))
                ScoutValueRow(label: "Relay Hub", value: viewModel.supportPaths.relayHubDirectory.path(percentEncoded: false))
                ScoutValueRow(label: "Relay Events", value: viewModel.supportPaths.relayEventStreamURL.path(percentEncoded: false))
            }

            ScoutSection(
                title: "Current Totals",
                subtitle: "Quick visibility into what the native shell is storing and surfacing."
            ) {
                ScoutValueRow(label: "Notes", value: "\(viewModel.notes.count)")
                ScoutValueRow(label: "Drafts", value: "\(viewModel.drafts.count)")
                ScoutValueRow(label: "Workflow Runs", value: "\(viewModel.workflowRuns.count)")
                ScoutValueRow(label: "Relay Messages", value: "\(viewModel.relayMessages.count)")
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

            ScoutSubsection(title: "Relay") {
                ScoutValueRow(label: "Event Stream", value: viewModel.supportPaths.relayEventStreamURL.path(percentEncoded: false))
                ScoutValueRow(label: "Channel Log", value: viewModel.supportPaths.relayChannelLogURL.path(percentEncoded: false))
                ScoutValueRow(label: "Inbox Directory", value: viewModel.supportPaths.relayInboxDirectory.path(percentEncoded: false))
                ScoutValueRow(label: "Active Messages", value: "\(viewModel.relayMessages.count)")
            }

            HStack(spacing: 10) {
                Button("Restart Helper") {
                    viewModel.supervisor.restart()
                }
                .buttonStyle(ScoutButtonStyle(tone: .primary))

                Button("Open Support Directory") {
                    viewModel.supervisor.openSupportDirectory()
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
                ScoutValueRow(label: "Relay", value: "Event-backed relay with a channel-log mirror, compatible with the existing OpenScout CLI")
            }
        }
    }
}
