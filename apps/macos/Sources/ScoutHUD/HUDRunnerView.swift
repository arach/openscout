import AppKit
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

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
                HUDChrome.canvas
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
            HUDRunnerHeader(focus: $focusedField)
            HUDHairline()
            VStack(alignment: .leading, spacing: 12) {
                HUDRunnerRoutingSurface(focus: $focusedField)
                    .frame(
                        height: runner.disclosure == .none ? 124 : 166,
                        alignment: .top
                    )
                HUDRunnerComposer(
                    focus: $focusedField,
                    dropTargeted: dropTargeted
                )
                .frame(
                    minHeight: runner.disclosure == .none ? 240 : 198,
                    maxHeight: .infinity
                )
            }
            .padding(14)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .disabled(runner.isSubmitting)
        }
        .frame(width: size.width, height: size.height)
        .background(
            LinearGradient(
                colors: [
                    HUDChrome.canvasAlt.opacity(0.38),
                    HUDChrome.canvas,
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private func focus(_ target: HUDRunnerFocusTarget) {
        focusedField = target
        DispatchQueue.main.async {
            guard runner.isPresented else { return }
            focusedField = target
        }
    }

    private func moveFocus(_ direction: Int) {
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
}
