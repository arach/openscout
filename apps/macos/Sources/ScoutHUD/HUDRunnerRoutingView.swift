import AppKit
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

struct HUDRunnerHeader: View {
    @ObservedObject private var runner = HUDRunnerState.shared

    var body: some View {
        HStack {
            Text("New task")
                .font(HUDType.body(17, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
            Spacer()
        }
        .padding(.horizontal, 20)
        .frame(height: 62)
        .contentShape(Rectangle())
        .accessibilityElement(children: .contain)
        .accessibilityAction(.escape) { runner.escapePressed() }
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
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(isResolved ? HUDRunnerPalette.accent : HUDChrome.inkMuted)
                    .frame(width: 18)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(HUDType.body(13, weight: .semibold))
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
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(
            HUDRunnerCardButtonStyle(
                isSelected: false,
                isFocused: focus.wrappedValue == target,
                cornerRadius: 9
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
