import ScoutAppCore
import SwiftUI

struct HUDRunnerProjectChoices: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding

    var body: some View {
        HUDRunnerDisclosurePanel {
            VStack(spacing: 5) {
                HUDRunnerDisclosureHeader(
                    title: "PROJECTS",
                    detail: "Recent and known",
                    focus: focus
                )

                ForEach(runner.projectQuickChoices(limit: 3)) { project in
                    HUDRunnerProjectOptionRow(
                        project: project,
                        focus: focus
                    )
                }

                Button(action: runner.openProjectSearch) {
                    HStack(spacing: 7) {
                        Image(systemName: "magnifyingglass")
                        Text("Browse all projects")
                        Spacer()
                        Image(systemName: "arrow.right")
                    }
                    .font(HUDType.body(10, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .padding(.horizontal, 9)
                    .frame(height: 24)
                    .contentShape(Rectangle())
                }
                .buttonStyle(
                    HUDRunnerCardButtonStyle(
                        isSelected: false,
                        isFocused: focus.wrappedValue == .projectSearch,
                        cornerRadius: 7
                    )
                )
                .focused(focus, equals: .projectSearch)
                .accessibilityHint("Opens project search")
            }
            .padding(7)
        }
    }
}
