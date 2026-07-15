import ScoutAppCore
import SwiftUI

struct HUDRunnerProjectOptionRow: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let project: HudRunnerProjectOption
    let focus: HUDRunnerFocusBinding

    var body: some View {
        let selected = project.id == runner.selectedProjectId
        let target = HUDRunnerFocusTarget.projectChoice(project.id)
        let cursored = runner.disclosure == .projectSearch
            && runner.projectInputFocused
            && runner.isProjectCursored(project, limit: 3)
        return Button {
            runner.chooseProject(project)
        } label: {
            HStack(spacing: 7) {
                Image(systemName: selected ? "checkmark.circle.fill" : "folder")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(selected ? HUDChrome.accent : HUDChrome.inkFaint)
                Text(project.title)
                    .font(HUDType.body(10, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                Spacer(minLength: 7)
                Text(runner.pathLabel(for: project.root))
                    .font(HUDType.mono(8))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: 27, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
        .buttonStyle(
            HUDRunnerCardButtonStyle(
                isSelected: selected,
                isFocused: focus.wrappedValue == target || cursored,
                cornerRadius: 7
            )
        )
        .focused(focus, equals: target)
        .accessibilityLabel(project.title)
        .accessibilityValue(
            cursored
                ? "Keyboard selection, \(project.root)"
                : (selected ? "Selected, \(project.root)" : project.root)
        )
    }
}
