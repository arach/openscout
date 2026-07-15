import AppKit
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

private enum HUDRunnerFocusedField: Hashable {
    case project
    case harness
    case model
    case version
    case effort
    case settings
    case persistence
    case agentName
    case displayName
    case instructions
    case attachment(UUID)
    case reference(String)
    case attach
    case voice
    case cancel
    case create
}

private struct HUDRunnerModelDescriptor: Identifiable {
    let option: HudRunnerModelOption
    let familyID: String
    let familyLabel: String
    let versionLabel: String

    var id: String {
        option.id.isEmpty ? "\(familyID):\(versionLabel)" : option.id
    }
}

private struct HUDRunnerModelFamily: Identifiable {
    let id: String
    let label: String
    var models: [HUDRunnerModelDescriptor]
}

struct HUDRunnerOverlay: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    @ObservedObject private var voice = HudVoiceService.shared
    @FocusState private var focusedField: HUDRunnerFocusedField?
    @State private var dropTargeted = false
    @State private var promiseImporting = false

    var body: some View {
        if runner.isPresented {
            GeometryReader { proxy in
                ZStack {
                    HUDChrome.canvas.opacity(0.82)
                        .ignoresSafeArea()
                        .onTapGesture {}

                    VStack(alignment: .leading, spacing: 0) {
                        header
                        HUDHairline()
                        ScrollView(.vertical, showsIndicators: true) {
                            VStack(alignment: .leading, spacing: 12) {
                                projectSection
                                runtimeSection
                                if runner.showAdvanced {
                                    advancedSection
                                }
                                instructionsSection
                            }
                            .padding(14)
                        }
                        .disabled(runner.isSubmitting)
                        statusSection
                        HUDHairline()
                        footer
                    }
                    .frame(
                        width: max(320, min(620, proxy.size.width - 36)),
                        height: max(340, min(450, proxy.size.height - 36))
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(HUDChrome.canvas)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(HUDChrome.borderRim, lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(18)

                    if dropTargeted || promiseImporting {
                        captureDropOverlay
                            .allowsHitTesting(false)
                    }
                }
            }
            .transition(.opacity)
            .background(
                HUDRunnerDropCatcher(
                    onTargeted: { dropTargeted = $0 },
                    onPromiseImporting: { promiseImporting = $0 },
                    onFileURLs: runner.stageFileURLs,
                    onAttachments: runner.stageAttachments,
                    onText: { text in
                        let accepted = runner.appendCapturedText(text)
                        if accepted {
                            runner.instructionsFocusRequest &+= 1
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
            .onAppear {
                Task { await runner.loadOptionsIfNeeded() }
                // Hyper+A is a command bar: immediate typing/paste should
                // always become the task. Project selection is one ⌘L away.
                let initialFocus: HUDRunnerFocusedField = .instructions
                focusedField = initialFocus
                DispatchQueue.main.async {
                    guard runner.isPresented else { return }
                    focusedField = initialFocus
                }
            }
            .onChange(of: runner.selectedProjectId) { _, id in
                if id != nil {
                    focusedField = .instructions
                }
            }
            .onChange(of: focusedField) { _, field in
                runner.projectInputFocused = field == .project
            }
            .onChange(of: runner.projectFocusRequest) { _, _ in
                focusedField = .project
            }
            .onChange(of: runner.runtimeFocusRequest) { _, _ in
                focusedField = .harness
            }
            .onChange(of: runner.instructionsFocusRequest) { _, _ in
                focusedField = .instructions
            }
            .onChange(of: runner.focusStepRequest) { _, _ in
                moveFocus(runner.focusStepDirection)
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
    }

    private var header: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(HUDChrome.accentSoft)
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .stroke(HUDChrome.accent.opacity(0.28), lineWidth: 0.75)
                )
                .frame(width: 30, height: 30)
                .overlay(
                    Image(systemName: "plus.bubble")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(HUDChrome.accent)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text("NEW TASK")
                    .font(HUDType.mono(9, weight: .semibold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkFaint)
                Text("Send work to an agent")
                    .font(HUDType.body(16, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
            }
            Spacer()
            Text("SCOUT")
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(HUDChrome.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(HUDChrome.accentSoft)
            Button("ESC") { runner.cancel() }
                .buttonStyle(.plain)
                .font(HUDType.mono(10, weight: .bold))
                .foregroundStyle(HUDChrome.inkMuted)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(HUDChrome.canvasLift.opacity(0.45))
                .disabled(runner.isCommittingTask)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var projectSection: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                runnerLabel("PROJECT")
                Spacer()
                if !runner.directoryHint.isEmpty {
                    Text(runner.directoryHint)
                        .font(HUDType.mono(10))
                        .foregroundStyle(HUDChrome.inkFaint)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            HStack(spacing: 8) {
                TextField("Find a known project", text: $runner.projectQuery)
                    .textFieldStyle(.plain)
                    .font(HUDType.body(13, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(HUDChrome.canvasAlt.opacity(0.75))
                    .overlay(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(
                                focusedField == .project ? HUDChrome.accent : HUDChrome.borderSoft,
                                lineWidth: focusedField == .project ? 1.5 : 1
                            )
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .focused($focusedField, equals: .project)
                    .onChange(of: runner.projectQuery) { _, value in
                        runner.updateProjectQuery(value)
                    }
                Button(action: { runner.showAdvanced.toggle() }) {
                    Image(systemName: "slider.horizontal.3")
                        .frame(width: 14, height: 14)
                }
                .help("Runner settings")
                .accessibilityLabel("Task runner settings")
                .focused($focusedField, equals: .settings)
                .buttonStyle(HUDRunnerButtonStyle(isAccent: runner.showAdvanced))
            }
            if runner.shouldShowProjectMatches {
                projectMatches
            }
            if runner.showAdvanced, let hint = agentHint {
                Text(hint)
                    .font(HUDType.body(11))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .lineLimit(2)
            }
        }
    }

    private var projectMatches: some View {
        VStack(spacing: 0) {
            let matches = runner.projectMatches(limit: 5)
            ForEach(Array(matches.enumerated()), id: \.element.id) { index, project in
                Button {
                    runner.chooseProject(project)
                } label: {
                    let cursored = runner.isProjectCursored(project, limit: 5)
                    HStack(spacing: 8) {
                        Text(project.title)
                            .font(HUDType.body(11, weight: .semibold))
                            .foregroundStyle(cursored ? HUDChrome.accent : HUDChrome.ink)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(runner.pathLabel(for: project.root))
                            .font(HUDType.mono(9))
                            .foregroundStyle(HUDChrome.inkFaint)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(cursored ? HUDChrome.accentSoft.opacity(0.55) : Color.clear)
                }
                .buttonStyle(.plain)
                if index < matches.count - 1 {
                    Rectangle().fill(HUDChrome.borderSoft).frame(height: 0.5)
                }
            }
        }
        .background(HUDChrome.canvasLift.opacity(0.22))
        .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 1))
    }

    private var runtimeSection: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 8) {
                runnerLabel("RUNTIME")
                Spacer()
                Text("⌘R")
                    .font(HUDType.mono(9, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkFaint)
            }

            HStack(spacing: 7) {
                harnessMenu
                modelMenu
                versionMenu
                effortMenu
            }
        }
    }

    private var harnessMenu: some View {
        VStack(alignment: .leading, spacing: 4) {
            runtimeChoiceLabel("HARNESS")
            Menu {
                ForEach(harnesses) { harness in
                    Button {
                        runner.selectHarness(harness.id)
                    } label: {
                        HStack {
                            Text(harness.label)
                            if harness.id == runner.selectedHarness {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                    .disabled(harness.ready == false)
                }
            } label: {
                runtimeMenuLabel(value: harnessLabel, focus: .harness)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .focused($focusedField, equals: .harness)
            .accessibilityLabel("Harness: \(harnessLabel)")
        }
        .frame(minWidth: 104, maxWidth: .infinity, alignment: .leading)
    }

    private var modelMenu: some View {
        VStack(alignment: .leading, spacing: 4) {
            runtimeChoiceLabel("MODEL")
            Menu {
                ForEach(modelFamilies) { family in
                    Button {
                        selectModelFamily(family)
                    } label: {
                        HStack {
                            Text(family.label)
                            if family.id == selectedModelFamily?.id {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                runtimeMenuLabel(
                    value: selectedModelFamily?.label ?? "Default",
                    focus: .model
                )
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .focused($focusedField, equals: .model)
            .accessibilityLabel("Model: \(selectedModelFamily?.label ?? "Default")")
        }
        .frame(minWidth: 104, maxWidth: .infinity, alignment: .leading)
    }

    private var versionMenu: some View {
        VStack(alignment: .leading, spacing: 4) {
            runtimeChoiceLabel("VERSION")
            Menu {
                ForEach(selectedModelFamily?.models ?? []) { model in
                    Button {
                        // Model + version are presentation facets. The exact model
                        // id remains the sole execution value sent to Scout.
                        runner.selectedModel = model.option.id
                    } label: {
                        HStack {
                            Text(model.versionLabel)
                            if model.option.id == runner.selectedModel {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                runtimeMenuLabel(
                    value: selectedModelDescriptor?.versionLabel ?? "Default",
                    focus: .version
                )
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .focused($focusedField, equals: .version)
            .accessibilityLabel("Version: \(selectedModelDescriptor?.versionLabel ?? "Default")")
        }
        .frame(minWidth: 104, maxWidth: .infinity, alignment: .leading)
    }

    private var effortMenu: some View {
        VStack(alignment: .leading, spacing: 4) {
            runtimeChoiceLabel("EFFORT")
            Menu {
                ForEach(runner.availableEfforts) { effort in
                    Button {
                        runner.reasoningEffort = effort.id
                    } label: {
                        HStack {
                            Text(effort.label)
                            if effort.id == runner.reasoningEffort {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                runtimeMenuLabel(value: runner.effortLabel, focus: .effort)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .focused($focusedField, equals: .effort)
            .accessibilityLabel("Effort: \(runner.effortLabel)")
            .disabled(runner.availableEfforts.isEmpty)
        }
        .frame(minWidth: 104, maxWidth: .infinity, alignment: .leading)
    }

    private var advancedSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    runnerLabel("ROUTE")
                    Picker("", selection: $runner.persistence) {
                        Text("Agent card").tag("sticky")
                        Text("One-time").tag("one_time")
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 230)
                    .accessibilityLabel("Agent persistence")
                    .focused($focusedField, equals: .persistence)
                }
                Spacer()
            }

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    runnerLabel("AGENT NAME")
                    runnerTextField(
                        "optional",
                        text: $runner.agentName,
                        accessibilityLabel: "Agent name",
                        mono: true,
                        focus: .agentName
                    )
                }
                VStack(alignment: .leading, spacing: 6) {
                    runnerLabel("DISPLAY")
                    runnerTextField(
                        "optional",
                        text: $runner.displayName,
                        accessibilityLabel: "Display name",
                        focus: .displayName
                    )
                }
            }
        }
        .padding(10)
        .background(HUDChrome.canvasLift.opacity(0.22))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(HUDChrome.borderSoft, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                runnerLabel("INSTRUCTIONS")
                Spacer()
                Button(action: runner.browseForAttachments) {
                    HStack(spacing: 5) {
                        Image(systemName: "paperclip")
                        Text("Attach")
                    }
                }
                .buttonStyle(HUDRunnerButtonStyle())
                .help("Add files or folders (⌘O)")
                .focused($focusedField, equals: .attach)
                Button(action: { Task { await runner.toggleDictation() } }) {
                    HStack(spacing: 5) {
                        Image(systemName: voiceButtonSymbol)
                        Text(voiceButtonLabel)
                    }
                }
                .buttonStyle(HUDRunnerButtonStyle(isAccent: voice.state.isCaptureActive))
                .disabled(runner.isPreparingVoice || voice.state == .probing || voice.state.isProcessing)
                .help(voiceButtonHelp)
                .focused($focusedField, equals: .voice)
            }
            TextEditor(text: $runner.instructions)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.ink)
                .scrollContentBackground(.hidden)
                .focused($focusedField, equals: .instructions)
                .frame(minHeight: 105)
                .padding(6)
                .background(HUDChrome.canvasAlt.opacity(0.75))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(
                            dropTargeted || focusedField == .instructions
                                ? HUDChrome.accent
                                : HUDChrome.borderSoft,
                            lineWidth: dropTargeted || focusedField == .instructions ? 1.5 : 1
                        )
                )
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .accessibilityLabel("Task instructions")
            if !runner.attachments.isEmpty || !runner.localReferences.isEmpty {
                captureStrip
            } else {
                Text("Drop or paste files, folders, screenshots, links, and text")
                    .font(HUDType.mono(9))
                    .foregroundStyle(HUDChrome.inkFaint)
            }
        }
    }

    private var captureStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                ForEach(runner.attachments) { attachment in
                    HUDRunnerAttachmentChip(
                        attachment: attachment,
                        focus: $focusedField,
                        onRemove: { runner.removeAttachment(attachment.id) }
                    )
                }
                ForEach(runner.localReferences) { reference in
                    HUDRunnerReferenceChip(
                        reference: reference,
                        focus: $focusedField,
                        onRemove: { runner.removeLocalReference(reference.id) }
                    )
                }
            }
            .padding(.vertical, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var captureDropOverlay: some View {
        VStack(spacing: 9) {
            Image(systemName: "arrow.down.doc.fill")
                .font(.system(size: 28, weight: .semibold))
            Text(promiseImporting ? "IMPORTING…" : "DROP INTO TASK")
                .font(HUDType.mono(12, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
            Text(
                promiseImporting
                    ? "Receiving promised originals"
                    : "Files · folders · images · links · text"
            )
                .font(HUDType.mono(9))
        }
        .foregroundStyle(HUDChrome.accent)
        .padding(.horizontal, 28)
        .padding(.vertical, 22)
        .background(HUDChrome.canvas.opacity(0.96))
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(HUDChrome.accent.opacity(0.8), lineWidth: 1.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    @ViewBuilder
    private var statusSection: some View {
        if let error = runner.lastError {
            runnerStatus(error, isError: true)
        } else if runner.isStagingFiles {
            runnerStatus("Staging dropped files...")
        } else if runner.isPreparingVoice {
            runnerStatus("Preparing voice dictation...")
        } else if runner.isLoading {
            runnerStatus("Loading runner inputs...", isFaint: true)
        } else if voice.state == .processing {
            runnerStatus("Transcribing voice...")
        } else if case .unavailable(let reason) = voice.state {
            runnerStatus(reason, isError: true)
        }
    }

    private func runnerStatus(
        _ message: String,
        isError: Bool = false,
        isFaint: Bool = false
    ) -> some View {
        Text(message)
            .font(isError ? HUDType.body(11) : HUDType.mono(10))
            .foregroundStyle(
                isError
                    ? HUDChrome.accent
                    : (isFaint ? HUDChrome.inkFaint : HUDChrome.inkMuted)
            )
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .accessibilityLabel("Task status: \(message)")
    }

    private var voiceButtonLabel: String {
        if runner.isPreparingVoice { return "Preparing..." }
        switch voice.state {
        case .starting, .recording: return "Stop"
        case .probing: return "Preparing..."
        case .processing: return "Transcribing..."
        case .idle, .unavailable: return "Voice"
        }
    }

    private var voiceButtonSymbol: String {
        if runner.isPreparingVoice { return "waveform" }
        switch voice.state {
        case .starting, .recording: return "stop.fill"
        case .probing, .processing: return "waveform"
        case .unavailable: return "mic.badge.xmark"
        case .idle: return "mic.fill"
        }
    }

    private var voiceButtonHelp: String {
        if runner.isPreparingVoice { return "Preparing voice dictation" }
        if case .unavailable(let reason) = voice.state { return reason }
        if voice.state.isCaptureActive { return "Stop voice dictation" }
        if voice.state.isProcessing { return "Transcribing voice" }
        return "Start voice dictation"
    }

    private var footer: some View {
        HStack {
            Text("⌘L project  ·  ⌘R runtime  ·  ⌘O attach  ·  ⌘↵ create")
                .font(HUDType.mono(9))
                .foregroundStyle(HUDChrome.inkFaint)
            Spacer()
            Button("Cancel") { runner.cancel() }
                .buttonStyle(HUDRunnerButtonStyle())
                .focused($focusedField, equals: .cancel)
                .disabled(runner.isCommittingTask)
            Button(
                runner.isSubmitting
                    ? "Creating..."
                    : (runner.isStagingFiles ? "Staging..." : "Create Task")
            ) {
                runner.beginSubmit()
            }
            .buttonStyle(HUDRunnerButtonStyle(isAccent: true))
            .disabled(
                runner.isSubmitting
                    || runner.isPreparingVoice
                    || voice.state.isCaptureActive
                    || voice.state.isProcessing
                    || runner.isStagingFiles
            )
            .keyboardShortcut(.return, modifiers: .command)
            .focused($focusedField, equals: .create)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var harnesses: [HudRunnerHarnessOption] {
        let loaded = runner.options?.harnesses ?? []
        if !loaded.isEmpty { return loaded }
        return [
            HudRunnerHarnessOption(id: "claude", name: "claude", label: "Claude Code", description: nil, state: nil, ready: nil, detail: nil),
            HudRunnerHarnessOption(id: "codex", name: "codex", label: "Codex", description: nil, state: nil, ready: nil, detail: nil),
        ]
    }

    private var harnessLabel: String {
        harnesses.first(where: { $0.id == runner.selectedHarness })?.label ?? runner.selectedHarness
    }

    private var modelDescriptors: [HUDRunnerModelDescriptor] {
        var models = rankedModels(runner.availableModels, harnessId: runner.selectedHarness)
        if !runner.selectedModel.isEmpty,
           !models.contains(where: { $0.id == runner.selectedModel }) {
            models.append(
                HudRunnerModelOption(
                    id: runner.selectedModel,
                    label: runner.selectedModel,
                    harnesses: [runner.selectedHarness],
                    source: "selected"
                )
            )
        }
        return models.map(modelDescriptor)
    }

    private var modelFamilies: [HUDRunnerModelFamily] {
        var result: [HUDRunnerModelFamily] = []
        for model in modelDescriptors {
            if let index = result.firstIndex(where: { $0.id == model.familyID }) {
                result[index].models.append(model)
            } else {
                result.append(
                    HUDRunnerModelFamily(
                        id: model.familyID,
                        label: model.familyLabel,
                        models: [model]
                    )
                )
            }
        }
        return result
    }

    private var selectedModelDescriptor: HUDRunnerModelDescriptor? {
        modelDescriptors.first { $0.option.id == runner.selectedModel }
            ?? modelDescriptors.first
    }

    private var selectedModelFamily: HUDRunnerModelFamily? {
        guard let familyID = selectedModelDescriptor?.familyID else { return modelFamilies.first }
        return modelFamilies.first { $0.id == familyID } ?? modelFamilies.first
    }

    private func selectModelFamily(_ family: HUDRunnerModelFamily) {
        if family.models.contains(where: { $0.option.id == runner.selectedModel }) {
            return
        }
        let currentVersion = selectedModelDescriptor?.versionLabel
        let selected = family.models.first { $0.versionLabel == currentVersion }
            ?? family.models.first
        if let selected {
            runner.selectedModel = selected.option.id
        }
    }

    private func modelDescriptor(_ model: HudRunnerModelOption) -> HUDRunnerModelDescriptor {
        let derived = derivedModelFacets(model.label.isEmpty ? model.id : model.label)
        let familyLabel = clean(model.family).map(prettyFamilyLabel) ?? derived.family
        let familyID = normalizedChoiceID(clean(model.family) ?? familyLabel)
        return HUDRunnerModelDescriptor(
            option: model,
            familyID: familyID.isEmpty ? "default" : familyID,
            familyLabel: familyLabel.isEmpty ? "Default" : familyLabel,
            versionLabel: clean(model.version) ?? derived.version
        )
    }

    private func derivedModelFacets(_ value: String) -> (family: String, version: String) {
        var tokens = value
            .split { $0.isWhitespace || $0 == "-" || $0 == "_" }
            .map(String.init)
        guard !tokens.isEmpty else { return ("Default", "Default") }

        var version = "Latest"
        if let start = tokens.firstIndex(where: isVersionToken) {
            var end = start
            if !tokens[start].contains(".") {
                while end + 1 < tokens.count,
                      tokens[end + 1].allSatisfy(\.isNumber) {
                    end += 1
                }
            }
            version = tokens[start...end].joined(separator: ".")
            tokens.removeSubrange(start...end)
        }

        if tokens.first?.lowercased() == "claude", tokens.count > 1 {
            tokens.removeFirst()
        }
        let family = prettyFamilyLabel(tokens.joined(separator: " "))
        return (family.isEmpty ? value : family, version)
    }

    private func isVersionToken(_ value: String) -> Bool {
        value.contains(where: \.isNumber)
            && value.allSatisfy { $0.isNumber || $0 == "." }
    }

    private func prettyFamilyLabel(_ raw: String) -> String {
        raw
            .split { $0.isWhitespace || $0 == "-" || $0 == "_" }
            .map { token in
                let value = String(token)
                if value.lowercased() == "gpt" { return "GPT" }
                if value != value.lowercased() { return value }
                return value.prefix(1).uppercased() + value.dropFirst()
            }
            .joined(separator: " ")
    }

    private func normalizedChoiceID(_ value: String) -> String {
        value.lowercased()
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
            .joined(separator: "-")
    }

    private func clean(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private var agentHint: String? {
        let matches = runner.matchingAgents
        guard !matches.isEmpty else { return nil }
        let first = matches[0]
        let handle = first.handle.map { "@\($0)" } ?? first.id
        if matches.count == 1 {
            return "Existing agent: \(handle) · \(first.harness ?? "harness") · \(first.harnessSessionId ?? "no session yet")"
        }
        return "\(matches.count) existing agents for this directory; TS will resolve the right route."
    }

    private func rankedModels(_ models: [HudRunnerModelOption], harnessId: String) -> [HudRunnerModelOption] {
        let preference: [String]
        switch harnessId {
        case "claude":
            preference = ["claude-opus-4-8", "opus", "claude-sonnet-4-6", "sonnet", "claude-haiku-4-5", "haiku"]
        case "codex":
            preference = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-mini"]
        default:
            preference = []
        }
        func rank(_ model: HudRunnerModelOption) -> Int {
            preference.firstIndex(of: model.id.lowercased()) ?? (preference.count + 1)
        }
        return models.sorted { lhs, rhs in
            let lhsRank = rank(lhs)
            let rhsRank = rank(rhs)
            if lhsRank != rhsRank { return lhsRank < rhsRank }
            return lhs.label.localizedCaseInsensitiveCompare(rhs.label) == .orderedAscending
        }
    }

    private func isRetiredModel(_ model: String, harness: String) -> Bool {
        guard harness.lowercased() == "codex" else { return false }
        let lower = model.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return lower == "gpt-5.3-codex-spark" || lower.hasPrefix("gpt-5.4")
    }

    private func runnerLabel(_ value: String) -> some View {
        Text(value)
            .font(HUDType.mono(9, weight: .semibold))
            .tracking(HUDType.eyebrowTracking)
            .foregroundStyle(HUDChrome.inkFaint)
    }

    private func runtimeChoiceLabel(_ value: String) -> some View {
        Text(value)
            .font(HUDType.mono(8, weight: .semibold))
            .tracking(HUDType.eyebrowMicro)
            .foregroundStyle(HUDChrome.inkFaint)
    }

    private func runtimeMenuLabel(value: String, focus: HUDRunnerFocusedField) -> some View {
        HStack(spacing: 6) {
            Text(value)
                .font(HUDType.body(11, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 2)
            Image(systemName: "chevron.down")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(
                    focusedField == focus ? HUDChrome.accent : HUDChrome.inkFaint
                )
        }
        .padding(.horizontal, 8)
        .frame(height: 30)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(
                    focusedField == focus
                        ? HUDChrome.accentSoft.opacity(0.42)
                        : HUDChrome.canvasAlt.opacity(0.75)
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(
                    focusedField == focus ? HUDChrome.accent.opacity(0.8) : HUDChrome.borderSoft,
                    lineWidth: focusedField == focus ? 1.5 : 1
                )
        )
        .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }

    private func runnerTextField(
        _ placeholder: String,
        text: Binding<String>,
        accessibilityLabel: String,
        mono: Bool = false,
        focus: HUDRunnerFocusedField
    ) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(mono ? HUDType.mono(11) : HUDType.body(11))
            .foregroundStyle(HUDChrome.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(HUDChrome.canvasAlt.opacity(0.75))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(HUDChrome.borderSoft, lineWidth: 1)
            )
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .focused($focusedField, equals: focus)
            .accessibilityLabel(accessibilityLabel)
    }

    private func moveFocus(_ direction: Int) {
        var order: [HUDRunnerFocusedField] = [
            .project,
            .harness,
            .model,
            .version,
            .effort,
            .settings,
        ]
        if runner.showAdvanced {
            order += [.persistence, .agentName, .displayName]
        }
        order.append(.instructions)
        order += runner.attachments.map { .attachment($0.id) }
        order += runner.localReferences.map { .reference($0.id) }
        order += [.attach, .voice, .cancel, .create]
        guard !order.isEmpty else { return }
        let current = focusedField.flatMap { order.firstIndex(of: $0) }
            ?? (direction < 0 ? 0 : order.count - 1)
        let next = (current + (direction < 0 ? -1 : 1) + order.count) % order.count
        focusedField = order[next]
    }
}

private struct HUDRunnerAttachmentChip: View {
    let attachment: ScoutComposerImage
    let focus: FocusState<HUDRunnerFocusedField?>.Binding
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 7) {
            Group {
                if attachment.isImage, let image = NSImage(data: attachment.data) {
                    Image(nsImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    Image(systemName: symbol)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(width: 30, height: 30)
            .background(HUDChrome.canvasAlt)
            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(attachment.fileName)
                    .font(HUDType.body(10, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                Text(ByteCountFormatter.string(fromByteCount: Int64(attachment.data.count), countStyle: .file))
                    .font(HUDType.mono(8))
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            removeButton
        }
        .padding(.horizontal, 7)
        .frame(width: 172, height: 42)
        .background(HUDChrome.canvasLift.opacity(0.34))
        .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 0.75))
    }

    private var removeButton: some View {
        Button(action: onRemove) {
            Image(systemName: "xmark")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(HUDChrome.inkFaint)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Remove \(attachment.fileName)")
        .accessibilityLabel("Remove \(attachment.fileName)")
        .focused(focus, equals: .attachment(attachment.id))
    }

    private var symbol: String {
        if attachment.isVideo { return "film" }
        if attachment.isMarkdown { return "doc.richtext" }
        if attachment.isCode { return "chevron.left.forwardslash.chevron.right" }
        return "doc"
    }
}

private struct HUDRunnerReferenceChip: View {
    let reference: HUDRunnerLocalReference
    let focus: FocusState<HUDRunnerFocusedField?>.Binding
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: isDirectory ? "folder.fill" : "doc.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(HUDChrome.inkMuted)
                .frame(width: 30, height: 30)
                .background(HUDChrome.canvasAlt)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))

            VStack(alignment: .leading, spacing: 2) {
                Text(reference.displayName)
                    .font(HUDType.body(10, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                Text(reference.url.deletingLastPathComponent().path)
                    .font(HUDType.mono(8))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Remove \(reference.displayName)")
            .accessibilityLabel("Remove \(reference.displayName)")
            .focused(focus, equals: .reference(reference.id))
        }
        .padding(.horizontal, 7)
        .frame(width: 172, height: 42)
        .background(HUDChrome.canvasLift.opacity(0.34))
        .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 0.75))
        .help(reference.url.path)
    }

    private var isDirectory: Bool {
        (try? reference.url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
    }
}

private struct HUDRunnerDropCatcher: NSViewRepresentable {
    var onTargeted: (Bool) -> Void
    var onPromiseImporting: (Bool) -> Void
    var onFileURLs: ([URL]) -> Bool
    var onAttachments: ([ScoutComposerImage]) -> Bool
    var onText: (String) -> Bool
    var onError: (String) -> Void

    func makeNSView(context: Context) -> HUDRunnerDropView {
        let view = HUDRunnerDropView()
        update(view)
        return view
    }

    func updateNSView(_ nsView: HUDRunnerDropView, context: Context) {
        update(nsView)
    }

    private func update(_ view: HUDRunnerDropView) {
        view.onTargeted = onTargeted
        view.onPromiseImporting = onPromiseImporting
        view.onFileURLs = onFileURLs
        view.onAttachments = onAttachments
        view.onText = onText
        view.onError = onError
    }
}

private final class HUDRunnerDropView: NSView {
    var onTargeted: (Bool) -> Void = { _ in }
    var onPromiseImporting: (Bool) -> Void = { _ in }
    var onFileURLs: ([URL]) -> Bool = { _ in false }
    var onAttachments: ([ScoutComposerImage]) -> Bool = { _ in false }
    var onText: (String) -> Bool = { _ in false }
    var onError: (String) -> Void = { _ in }

    private let dragTypes: [NSPasteboard.PasteboardType] = [
        .fileURL,
        .URL,
        .string,
        .png,
        .tiff,
    ] + HUDFilePromiseIntake.draggedTypes

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes(dragTypes)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        guard canAccept(sender.draggingPasteboard) else {
            onTargeted(false)
            return []
        }
        onTargeted(true)
        return .copy
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        canAccept(sender.draggingPasteboard) ? .copy : []
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        onTargeted(false)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        onTargeted(false)
        let pasteboard = sender.draggingPasteboard
        if HUDFilePromiseIntake.isOffered(by: pasteboard) {
            onPromiseImporting(true)
            let started = HUDFilePromiseIntake.receive(from: pasteboard) { [weak self] outcome in
                guard let self else { return }
                let accepted = !outcome.fileURLs.isEmpty && self.onFileURLs(outcome.fileURLs)
                if let message = outcome.errorMessage {
                    self.onError(message)
                } else if !accepted {
                    self.onError("The promised files could not be added to this task.")
                }
                self.onPromiseImporting(false)
            }
            if started { return true }
            onPromiseImporting(false)
            // Legacy drags can advertise promise types but expose only a
            // regular file URL. Let the ordinary intake below handle those.
        }
        let urls = (pasteboard.readObjects(forClasses: [NSURL.self], options: nil) as? [URL]) ?? []
        let fileURLs = urls.filter(\.isFileURL)
        var accepted = !fileURLs.isEmpty && onFileURLs(fileURLs)

        let attachments = ScoutMediaIntake.inlineFromPasteboard(pasteboard)
        if !attachments.isEmpty {
            accepted = onAttachments(attachments) || accepted
        }

        var textParts = urls.filter { !$0.isFileURL }.map(\.absoluteString)
        if let text = pasteboard.string(forType: .string)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !text.isEmpty,
           !textParts.contains(text),
           !fileURLs.contains(where: { $0.absoluteString == text || $0.path == text }) {
            textParts.append(text)
        }
        if !textParts.isEmpty {
            accepted = onText(textParts.joined(separator: "\n")) || accepted
        }
        return accepted
    }

    private func canAccept(_ pasteboard: NSPasteboard) -> Bool {
        let offered = Set(pasteboard.types ?? [])
        return dragTypes.contains { offered.contains($0) }
    }
}

private struct HUDRunnerPasteCatcher: NSViewRepresentable {
    var isActive: () -> Bool
    var onFileURLs: ([URL]) -> Bool
    var onAttachments: ([ScoutComposerImage]) -> Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(isActive: isActive, onFileURLs: onFileURLs, onAttachments: onAttachments)
    }

    func makeNSView(context: Context) -> NSView {
        context.coordinator.install()
        return NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.isActive = isActive
        context.coordinator.onFileURLs = onFileURLs
        context.coordinator.onAttachments = onAttachments
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    final class Coordinator {
        var isActive: () -> Bool
        var onFileURLs: ([URL]) -> Bool
        var onAttachments: ([ScoutComposerImage]) -> Bool
        private var monitor: Any?

        init(
            isActive: @escaping () -> Bool,
            onFileURLs: @escaping ([URL]) -> Bool,
            onAttachments: @escaping ([ScoutComposerImage]) -> Bool
        ) {
            self.isActive = isActive
            self.onFileURLs = onFileURLs
            self.onAttachments = onAttachments
        }

        deinit { uninstall() }

        func install() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, self.isActive() else { return event }
                guard event.modifierFlags.contains(.command),
                      event.charactersIgnoringModifiers?.lowercased() == "v" else { return event }
                let pasteboard = NSPasteboard.general
                let fileURLs = (pasteboard.readObjects(
                    forClasses: [NSURL.self],
                    options: [.urlReadingFileURLsOnly: true]
                ) as? [URL]) ?? []
                if !fileURLs.isEmpty {
                    return self.onFileURLs(fileURLs) ? nil : event
                }
                let attachments = ScoutMediaIntake.inlineFromPasteboard(pasteboard)
                guard !attachments.isEmpty else { return event }
                return self.onAttachments(attachments) ? nil : event
            }
        }

        func uninstall() {
            if let monitor {
                NSEvent.removeMonitor(monitor)
            }
            monitor = nil
        }
    }
}

private struct HUDRunnerButtonStyle: ButtonStyle {
    var isAccent = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(HUDType.mono(10, weight: .semibold))
            .foregroundStyle(isAccent ? HUDChrome.canvas : HUDChrome.inkMuted)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(isAccent ? HUDChrome.accent.opacity(configuration.isPressed ? 0.75 : 0.95) : HUDChrome.canvasLift.opacity(configuration.isPressed ? 0.60 : 0.38))
    }
}
