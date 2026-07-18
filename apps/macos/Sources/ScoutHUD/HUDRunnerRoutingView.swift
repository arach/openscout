import AppKit
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

struct HUDRunnerHeader: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding

    var body: some View {
        HStack(spacing: 14) {
            Button {
                runner.escapePressed()
            } label: {
                Text("ESC")
                    .font(HUDType.mono(9, weight: .bold))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(HUDChrome.canvasLift.opacity(0.30))
                    .overlay(
                        RoundedRectangle(cornerRadius: 5, style: .continuous)
                            .stroke(
                                focus.wrappedValue == .dismiss
                                    ? HUDChrome.borderStrong
                                    : HUDChrome.borderSoft,
                                lineWidth: focus.wrappedValue == .dismiss ? 1.25 : 0.75
                            )
                    )
            }
            .buttonStyle(.plain)
            .focused(focus, equals: .dismiss)
            .disabled(runner.isCommittingTask)
            .accessibilityLabel(
                runner.disclosure == .none ? "Close task composer" : "Back"
            )

            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(HUDChrome.canvasAlt.opacity(0.82))
                .overlay(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .stroke(HUDChrome.borderStrong.opacity(0.46), lineWidth: 0.75)
                )
                .frame(width: 40, height: 40)
                .overlay(
                    Image(systemName: "plus.bubble")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(HUDChrome.accent)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text("NEW TASK")
                    .font(HUDType.mono(9, weight: .semibold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkFaint)
                Text("Send work to an agent")
                    .font(HUDType.body(17, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
            }

            Spacer()

            HStack(spacing: 6) {
                Circle()
                    .fill(HUDChrome.accent)
                    .frame(width: 6, height: 6)
                Text("SCOUT")
                    .font(HUDType.mono(9, weight: .bold))
                    .tracking(HUDType.eyebrowMicro)
            }
            .foregroundStyle(HUDChrome.accent)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(HUDChrome.accent.opacity(0.30), lineWidth: 0.75)
            )
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Scout is ready")

        }
        .padding(.horizontal, 26)
        .padding(.vertical, 17)
    }
}

struct HUDRunnerRoutingSurface: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding

    @ViewBuilder
    var body: some View {
        switch runner.disclosure {
        case .none:
            HUDRunnerSummaryCards(focus: focus)
        case .projectChoices:
            HUDRunnerProjectChoices(focus: focus)
        case .projectSearch:
            HUDRunnerProjectSearch(focus: focus)
        case .runtimeChoices:
            HUDRunnerRuntimeChoices(focus: focus)
        case .runtimeConfiguration:
            HUDRunnerRuntimeConfiguration(focus: focus)
        case .route:
            HUDRunnerRouteConfiguration(focus: focus)
        }
    }
}

private struct HUDRunnerSummaryCards: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HUDRunnerSectionLabel("PROJECT")
            HUDRunnerSummaryCard(
                icon: "folder",
                title: projectTitle,
                detail: projectDetail,
                isResolved: projectIsResolved,
                accessibilityLabel: "Project",
                accessibilityValue: "\(projectTitle), \(projectDetail)",
                accessibilityHint: "Shows project choices",
                target: .projectSummary,
                focus: focus,
                action: runner.toggleProjectChoices
            )
        }
    }

    private var projectIsResolved: Bool {
        runner.selectedProject != nil
            || !runner.directory.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var projectTitle: String {
        if let selected = runner.selectedProject {
            return selected.title
        }
        let value = runner.projectQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty {
            let basename = URL(fileURLWithPath: value).lastPathComponent
            return basename.isEmpty ? value : basename
        }
        return "Choose a project"
    }

    private var projectDetail: String {
        runner.directoryHint.isEmpty
            ? "Choose where this work belongs"
            : runner.directoryHint
    }
}

private struct HUDRunnerSummaryCard: View {
    let icon: String
    let title: String
    let detail: String
    let isResolved: Bool
    let accessibilityLabel: String
    let accessibilityValue: String
    let accessibilityHint: String
    let target: HUDRunnerFocusTarget
    let focus: HUDRunnerFocusBinding
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 13) {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(isResolved ? HUDChrome.accentWhisper : HUDChrome.canvasLift.opacity(0.24))
                    .frame(width: 38, height: 38)
                    .overlay(
                        Image(systemName: icon)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(isResolved ? HUDChrome.accent : HUDChrome.inkMuted)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(
                                isResolved ? HUDChrome.accent.opacity(0.40) : HUDChrome.borderSoft,
                                lineWidth: 0.75
                            )
                    )

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(HUDType.body(14, weight: .semibold))
                        .foregroundStyle(HUDChrome.ink)
                        .lineLimit(1)
                    Text(detail)
                        .font(HUDType.mono(9))
                        .foregroundStyle(HUDChrome.inkFaint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer(minLength: 6)

                Image(systemName: "chevron.right")
                    .symbolVariant(.none)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .rotationEffect(.degrees(90))
            }
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(
            HUDRunnerCardButtonStyle(
                isSelected: false,
                isFocused: focus.wrappedValue == target,
                cornerRadius: 12
            )
        )
        .focused(focus, equals: target)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityValue(accessibilityValue)
        .accessibilityHint(accessibilityHint)
    }
}

struct HUDRunnerDisclosurePanel<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

struct HUDRunnerDisclosureHeader: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let title: String
    let detail: String
    let focus: HUDRunnerFocusBinding

    var body: some View {
        HStack(spacing: 9) {
            Button(action: runner.stepBackDisclosure) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 10, weight: .bold))
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(
                HUDRunnerToolbarButtonStyle(
                    isActive: false,
                    isFocused: focus.wrappedValue == .disclosureBack
                )
            )
            .focused(focus, equals: .disclosureBack)
            .accessibilityLabel("Back")

            Text(title)
                .font(HUDType.mono(9, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkMuted)
            Spacer()
        }
        .frame(height: 30)
    }
}
