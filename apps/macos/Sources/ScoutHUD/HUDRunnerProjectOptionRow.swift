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
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(selected ? HUDChrome.accentWhisper : HUDChrome.canvasLift.opacity(0.24))
                    .frame(width: 34, height: 34)
                    .overlay(
                        Image(systemName: "folder")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(selected ? HUDChrome.accent : HUDChrome.inkMuted)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(
                                selected ? HUDChrome.accent.opacity(0.40) : HUDChrome.borderSoft,
                                lineWidth: 0.75
                            )
                    )
                VStack(alignment: .leading, spacing: 3) {
                    Text(project.title)
                        .font(HUDType.body(13, weight: .semibold))
                        .foregroundStyle(HUDChrome.ink)
                        .lineLimit(1)
                    Text(runner.pathLabel(for: project.root))
                        .font(HUDType.mono(9))
                        .foregroundStyle(HUDChrome.inkFaint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(HUDChrome.accent)
                }
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(
            HUDRunnerCardButtonStyle(
                isSelected: selected,
                isFocused: focus.wrappedValue == target || cursored,
                cornerRadius: 11
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
