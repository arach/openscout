import SwiftUI

struct ScoutSettingsView: View {
    let viewModel: ScoutShellViewModel
    @State private var selectedTab: SettingsTab = .general
    @State private var notes = ""

    private enum SettingsTab: String, Hashable {
        case general
        case runtime
        case surfaces
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
                    ScoutTabItem(id: SettingsTab.surfaces, title: "Surfaces"),
                ],
                selection: $selectedTab
            )

            switch selectedTab {
            case .general:
                generalTab
            case .runtime:
                runtimeTab
            case .surfaces:
                surfacesTab
            }
        }
    }

    private var generalTab: some View {
        HStack(alignment: .top, spacing: 18) {
            ScoutSection(
                title: "Identity",
                subtitle: "Core application metadata and location awareness."
            ) {
                ScoutValueRow(label: "Support Directory", value: viewModel.supportPaths.applicationSupportDirectory.path(percentEncoded: false))
                ScoutValueRow(label: "Console Source", value: viewModel.consoleURL.absoluteString)
            }

            ScoutSection(
                title: "Notes",
                subtitle: "A primitive settings text area for future rules, prompts, and local annotations."
            ) {
                ScoutTextArea(
                    title: "Operator Notes",
                    prompt: "Capture product notes, shell ideas, or environment context here.",
                    text: $notes
                )
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

    private var surfacesTab: some View {
        ScoutSection(
            title: "Surface System",
            subtitle: "The main section and subsection wrappers should be reusable across settings, dashboards, and future inspectors."
        ) {
            ScoutSubsection(
                title: "Current Direction",
                subtitle: "These components are the first pass of Scout-native layout primitives."
            ) {
                ScoutValueRow(label: "Buttons", value: "Shared button style with primary, secondary, and quiet tones")
                ScoutValueRow(label: "Tabs", value: "Reusable tab bar for settings or inspectors")
                ScoutValueRow(label: "Sections", value: "Page, section, subsection, and surface wrappers")
                ScoutValueRow(label: "Inputs", value: "Text area and key-value rows")
            }
        }
    }
}
