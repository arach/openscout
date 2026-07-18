import AppKit
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

enum HUDRunnerLayout {
    static let width: CGFloat = 600
    static let collapsedHeight: CGFloat = 412
    static let collapsedRoutingHeight: CGFloat = 78
    static let captureHeightDelta: CGFloat = 44
    static let editorHeight: CGFloat = 126
    static let toolbarHeight: CGFloat = 58
    static let captureStripHeight: CGFloat = 44

    static func routingHeight(
        for disclosure: HUDRunnerDisclosure,
        projectChoiceCount: Int = 3,
        runtimeChoiceCount: Int = 3
    ) -> CGFloat {
        switch disclosure {
        case .none:
            return collapsedRoutingHeight
        case .projectChoices, .projectSearch:
            return choiceRoutingHeight(count: projectChoiceCount)
        case .runtimeChoices:
            return choiceRoutingHeight(count: runtimeChoiceCount)
        case .route:
            return 236
        case .runtimeConfiguration:
            return 136
        }
    }

    private static func choiceRoutingHeight(count: Int) -> CGFloat {
        let visibleCount = min(max(count, 1), 3)
        let rows = CGFloat(visibleCount) * 56
        let rowGaps = CGFloat(max(visibleCount - 1, 0)) * 8
        let content = 30 + 8 + rows + rowGaps + 8 + 42
        return max(collapsedRoutingHeight, content)
    }

    static func contentSize(
        disclosure: HUDRunnerDisclosure,
        hasCaptures: Bool,
        projectChoiceCount: Int = 3,
        runtimeChoiceCount: Int = 3
    ) -> NSSize {
        NSSize(
            width: width,
            height: collapsedHeight
                + routingHeight(
                    for: disclosure,
                    projectChoiceCount: projectChoiceCount,
                    runtimeChoiceCount: runtimeChoiceCount
                ) - collapsedRoutingHeight
                + (hasCaptures ? captureHeightDelta : 0)
        )
    }
}

struct HUDRunnerOverlay: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject private var runner = HUDRunnerState.shared
    @FocusState private var focusedField: HUDRunnerFocusTarget?
    @State private var dropTargeted = false
    @State private var promiseImporting = false

    var body: some View {
        if runner.isPresented {
            lifecycleLayer
        }
    }

    private var lifecycleLayer: some View {
        intakeLayer
            .onAppear {
                Task { await runner.loadOptionsIfNeeded() }
                focus(.instructions)
            }
            .onChange(of: runner.focusRequest) { _, request in
                focus(request.target)
            }
            .onChange(of: runner.focusStepRequest) { _, _ in
                moveFocus(runner.focusStepDirection)
            }
            .onChange(of: focusedField) { _, field in
                runner.projectInputFocused = field == .projectSearch
            }
            .onChange(of: runner.lastError, initial: true) { _, error in
                guard let error = error?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !error.isEmpty else { return }
                HUDRunnerAccessibility.announce(error)
            }
            .onDisappear {
                runner.projectInputFocused = false
                dropTargeted = false
                promiseImporting = false
            }
            .accessibilityElement(children: .contain)
            .accessibilityAddTraits(.isModal)
    }

    private var intakeLayer: some View {
        geometryLayer
            .transition(.opacity)
            .animation(
                reduceMotion ? nil : .easeInOut(duration: 0.16),
                value: runner.disclosure
            )
            .background(
                HUDRunnerDropCatcher(
                    onTargeted: { dropTargeted = $0 },
                    onPromiseImporting: { promiseImporting = $0 },
                    onFileURLs: runner.stageFileURLs,
                    onAttachments: runner.stageAttachments,
                    onText: { text in
                        let accepted = runner.appendCapturedText(text)
                        if accepted {
                            runner.requestFocus(.instructions)
                        }
                        return accepted
                    },
                    onError: { runner.lastError = $0 }
                )
            )
            .background(
                HUDRunnerPasteCatcher(
                    isActive: { runner.isPresented },
                    onFileURLs: runner.stageFileURLs,
                    onAttachments: runner.stageAttachments
                )
            )
    }

    private var geometryLayer: some View {
        GeometryReader { proxy in
            ZStack {
                HUDChrome.composerPanel
                    .ignoresSafeArea()
                    .onTapGesture {}

                modal(size: proxy.size)

                if dropTargeted || promiseImporting {
                    HUDRunnerDropOverlay(isImporting: promiseImporting)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
        }
    }

    private func modal(size: CGSize) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HUDRunnerHeader()
            Rectangle()
                .fill(HUDChrome.composerBorder)
                .frame(height: 1)
            VStack(alignment: .leading, spacing: 22) {
                HUDRunnerRoutingSurface(focus: $focusedField)
                    .frame(
                        height: HUDRunnerLayout.routingHeight(
                            for: runner.disclosure,
                            projectChoiceCount: projectChoiceCount,
                            runtimeChoiceCount: runtimeChoiceCount
                        ),
                        alignment: .top
                    )
                VStack(alignment: .leading, spacing: 8) {
                    HUDRunnerSectionLabel("MESSAGE")
                    HUDRunnerComposer(
                        focus: $focusedField,
                        dropTargeted: dropTargeted
                    )
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .disabled(runner.isSubmitting)
        }
        .frame(width: size.width, height: size.height)
        .background(HUDChrome.composerPanel)
    }

    private var projectChoiceCount: Int {
        switch runner.disclosure {
        case .projectChoices, .projectSearch:
            runner.projectQuickChoices(limit: 3).count
        default:
            3
        }
    }

    private var runtimeChoiceCount: Int {
        runner.runtimeQuickChoices(limit: 3).count
    }

    private func focus(_ target: HUDRunnerFocusTarget) {
        focusedField = target
        DispatchQueue.main.async {
            guard runner.isPresented else { return }
            focusedField = target
        }
    }

    private func moveFocus(_ direction: Int) {
        if runner.isRuntimePickerPresented {
            moveRuntimePickerFocus(direction)
            return
        }
        let projectIDs: [String]
        switch runner.disclosure {
        case .projectChoices:
            projectIDs = runner.projectQuickChoices(limit: 3).map(\.id)
        case .projectSearch:
            projectIDs = runner.projectMatches(limit: 3).map(\.id)
        default:
            projectIDs = []
        }
        let runtimeIDs = runner.disclosure == .runtimeChoices
            ? runner.runtimeQuickChoices(limit: 3).map(\.id)
            : []
        let order = HUDRunnerFocusTarget.visibleOrder(
            disclosure: runner.disclosure,
            projectChoiceIDs: projectIDs,
            runtimeChoiceIDs: runtimeIDs,
            attachmentIDs: runner.attachments.map(\.id),
            referenceIDs: runner.localReferences.map(\.id)
        )
        guard !order.isEmpty else { return }
        let current = focusedField.flatMap { order.firstIndex(of: $0) }
            ?? (direction < 0 ? 0 : order.count - 1)
        let next = (current + (direction < 0 ? -1 : 1) + order.count) % order.count
        focusedField = order[next]
    }

    private func moveRuntimePickerFocus(_ direction: Int) {
        let order: [HUDRunnerFocusTarget]
        if runner.runtimePickerShowsConfiguration {
            order = [
                .disclosureBack,
                .harness,
                .model,
                .version,
                .effort,
                .applyRuntime,
            ]
        } else {
            let presets = runner.runtimeQuickChoices(limit: 3)
            order = presets.flatMap { preset in
                [
                    HUDRunnerFocusTarget.runtimeChoice(preset.id),
                    HUDRunnerFocusTarget.runtimeTweaks(preset.id),
                ]
            } + [.configureRuntime]
        }
        guard !order.isEmpty else { return }
        let current = focusedField.flatMap { order.firstIndex(of: $0) }
            ?? (direction < 0 ? 0 : order.count - 1)
        let next = (current + (direction < 0 ? -1 : 1) + order.count) % order.count
        focusedField = order[next]
    }
}

struct HUDRunnerSectionLabel: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(HUDType.mono(9, weight: .semibold))
            .tracking(HUDType.eyebrowTracking)
            .foregroundStyle(HUDChrome.inkFaint)
    }
}
