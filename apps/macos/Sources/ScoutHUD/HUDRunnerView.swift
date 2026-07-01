import AppKit
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

private enum HUDRunnerFocusedField: Hashable {
    case project
    case instructions
}

struct HUDRunnerOverlay: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    @ObservedObject private var voice = HudVoiceService.shared
    @FocusState private var focusedField: HUDRunnerFocusedField?
    @State private var attachmentsDropTargeted = false

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
                                runnerModelSection
                                if runner.showAdvanced {
                                    advancedSection
                                }
                                instructionsSection
                                attachmentsSection
                                statusSection
                            }
                            .padding(14)
                        }
                        HUDHairline()
                        footer
                    }
                    .frame(
                        width: max(320, min(620, proxy.size.width - 36)),
                        height: max(430, min(640, proxy.size.height - 36))
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(HUDChrome.canvas)
                    .background {
                        HUDRunnerPasteCatcher(
                            isActive: { runner.isPresented },
                            onPasteAttachments: { runner.stageAttachments($0) }
                        )
                    }
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(HUDChrome.borderRim, lineWidth: 1)
                    )
                    .overlay {
                        if attachmentsDropTargeted {
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(HUDChrome.accent.opacity(0.08))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .strokeBorder(HUDChrome.accent.opacity(0.72), lineWidth: 1.5)
                                )
                                .allowsHitTesting(false)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .padding(18)
                    .dropDestination(for: URL.self) { urls, _ in
                        runner.stageAttachments(ScoutMediaIntake.fromFileURLs(urls))
                    } isTargeted: { targeted in
                        attachmentsDropTargeted = targeted
                    }
                }
            }
            .transition(.opacity)
            .onAppear {
                Task { await runner.loadOptionsIfNeeded() }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                    focusedField = runner.selectedProject == nil ? .project : .instructions
                }
            }
            .onChange(of: runner.selectedProjectId) { _, id in
                if id != nil {
                    focusedField = .instructions
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("RUNNER")
                    .font(HUDType.mono(9, weight: .semibold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkFaint)
                Text("Spin up a Scout ask")
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
            Button("ESC") { runner.dismiss() }
                .buttonStyle(.plain)
                .font(HUDType.mono(10, weight: .bold))
                .foregroundStyle(HUDChrome.inkMuted)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(HUDChrome.canvasLift.opacity(0.45))
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
                    .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 1))
                    .focused($focusedField, equals: .project)
                    .onChange(of: runner.projectQuery) { _, value in
                        runner.updateProjectQuery(value)
                    }
                Button(action: { runner.browseForDirectory() }) {
                    Image(systemName: "folder")
                        .frame(width: 14, height: 14)
                }
                .help("Choose project folder")
                .buttonStyle(HUDRunnerButtonStyle())
                Button(action: { runner.showAdvanced.toggle() }) {
                    Image(systemName: "slider.horizontal.3")
                        .frame(width: 14, height: 14)
                }
                .help("Runner settings")
                .buttonStyle(HUDRunnerButtonStyle(isAccent: runner.showAdvanced))
            }
            if runner.shouldShowProjectMatches {
                projectMatches
            } else {
                projectQuickPicks
            }
            if let hint = agentHint {
                Text(hint)
                    .font(HUDType.body(11))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .lineLimit(2)
            }
        }
    }

    @ViewBuilder
    private var projectQuickPicks: some View {
        let projects = quickProjects
        if !projects.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(projects) { project in
                        Button {
                            runner.chooseProject(project)
                        } label: {
                            let selected = runner.selectedProject?.id == project.id
                            VStack(alignment: .leading, spacing: 2) {
                                Text(project.title)
                                    .font(HUDType.body(10.5, weight: .semibold))
                                    .foregroundStyle(selected ? HUDChrome.accent : HUDChrome.inkMuted)
                                    .lineLimit(1)
                                Text(runner.pathLabel(for: project.root))
                                    .font(HUDType.mono(8.5))
                                    .foregroundStyle(HUDChrome.inkFaint)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            .frame(width: 128, alignment: .leading)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                            .background(selected ? HUDChrome.accentSoft.opacity(0.55) : HUDChrome.canvasLift.opacity(0.24))
                            .overlay(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .stroke(selected ? HUDChrome.accent.opacity(0.45) : HUDChrome.borderSoft, lineWidth: 0.75)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
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

    private var runnerModelSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                runnerLabel("RUNNER")
                Spacer(minLength: 0)
                Text(runner.runnerPresetLabel)
                    .font(HUDType.mono(9))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(harnesses) { harness in
                        Button {
                            runner.selectHarness(harness.id)
                        } label: {
                            HStack(spacing: 5) {
                                Circle()
                                    .fill(harness.ready == false ? HUDChrome.inkFaint : HUDChrome.accent)
                                    .frame(width: 5, height: 5)
                                Text(harnessShortLabel(harness))
                                    .lineLimit(1)
                            }
                            .font(HUDType.mono(9.5, weight: .bold))
                            .foregroundStyle(harness.id == runner.selectedHarness ? HUDChrome.canvas : HUDChrome.inkMuted)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 6)
                            .background(harness.id == runner.selectedHarness ? HUDChrome.accent : HUDChrome.canvasLift.opacity(0.30))
                            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .help(harness.detail ?? harness.description ?? harness.label)
                    }
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(runner.availableModels) { model in
                        Button {
                            runner.selectedModel = model.id
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(model.label)
                                    .font(HUDType.body(10.5, weight: .semibold))
                                    .lineLimit(1)
                                Text(model.id.isEmpty ? runner.selectedHarness : model.id)
                                    .font(HUDType.mono(8))
                                    .foregroundStyle(runner.selectedModel == model.id ? HUDChrome.canvas.opacity(0.72) : HUDChrome.inkFaint)
                                    .lineLimit(1)
                            }
                            .foregroundStyle(runner.selectedModel == model.id ? HUDChrome.canvas : HUDChrome.inkMuted)
                            .frame(width: 108, alignment: .leading)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 6)
                            .background(runner.selectedModel == model.id ? HUDChrome.accent.opacity(0.92) : HUDChrome.canvasLift.opacity(0.24))
                            .overlay(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .stroke(runner.selectedModel == model.id ? HUDChrome.accent.opacity(0.55) : HUDChrome.borderSoft, lineWidth: 0.75)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(10)
        .background(HUDChrome.canvasLift.opacity(0.18))
        .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 1))
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
                }
                Spacer()
            }

            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    runnerLabel("AGENT NAME")
                    runnerTextField("optional", text: $runner.agentName, mono: true)
                }
                VStack(alignment: .leading, spacing: 6) {
                    runnerLabel("DISPLAY")
                    runnerTextField("optional", text: $runner.displayName)
                }
            }
        }
        .padding(10)
        .background(HUDChrome.canvasLift.opacity(0.22))
        .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 1))
    }

    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                runnerLabel("INSTRUCTIONS")
                Spacer()
                Button(action: { runner.browseForAttachments() }) {
                    Image(systemName: "paperclip")
                        .frame(width: 14, height: 14)
                }
                .help("Attach files")
                .buttonStyle(HUDRunnerButtonStyle())
                Button(action: { Task { await runner.toggleDictation() } }) {
                    HStack(spacing: 5) {
                        Image(systemName: voice.state == .recording ? "stop.fill" : "mic.fill")
                        Text(voice.state == .recording ? "Stop" : "Voice")
                    }
                }
                .buttonStyle(HUDRunnerButtonStyle(isAccent: voice.state == .recording))
            }
            TextEditor(text: $runner.instructions)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.ink)
                .scrollContentBackground(.hidden)
                .focused($focusedField, equals: .instructions)
                .frame(minHeight: 105)
                .padding(6)
                .background(HUDChrome.canvasAlt.opacity(0.75))
                .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 1))
        }
    }

    private var attachmentsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                runnerLabel("ATTACHMENTS")
                Spacer()
                if !runner.attachments.isEmpty {
                    Text("\(runner.attachments.count)")
                        .font(HUDType.mono(9, weight: .semibold))
                        .foregroundStyle(HUDChrome.inkFaint)
                }
            }

            if runner.attachments.isEmpty {
                Button(action: { runner.browseForAttachments() }) {
                    HStack(spacing: 8) {
                        Image(systemName: "paperclip")
                            .font(.system(size: 12, weight: .semibold))
                        Text("No files")
                            .font(HUDType.body(11, weight: .semibold))
                        Spacer()
                        Image(systemName: "plus")
                            .font(.system(size: 11, weight: .bold))
                    }
                    .foregroundStyle(HUDChrome.inkFaint)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(HUDChrome.canvasLift.opacity(0.18))
                    .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 1))
                }
                .buttonStyle(.plain)
                .help("Attach files")
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 7) {
                        ForEach(runner.attachments) { attachment in
                            attachmentChip(attachment)
                        }
                    }
                    .padding(.vertical, 1)
                }
            }
        }
    }

    private func attachmentChip(_ attachment: ScoutComposerImage) -> some View {
        HStack(spacing: 7) {
            attachmentPreview(attachment)
                .frame(width: 24, height: 24)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(attachment.fileName)
                    .font(HUDType.body(10.5, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(attachment.mediaType)
                    .font(HUDType.mono(8.5))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
            }
            Button(action: { runner.removeAttachment(attachment.id) }) {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .frame(width: 16, height: 16)
            }
            .buttonStyle(.plain)
            .foregroundStyle(HUDChrome.inkMuted)
            .help("Remove")
        }
        .padding(.leading, 7)
        .padding(.trailing, 5)
        .padding(.vertical, 6)
        .frame(width: 176, alignment: .leading)
        .background(HUDChrome.canvasLift.opacity(0.30))
        .overlay(
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .stroke(HUDChrome.borderSoft, lineWidth: 0.75)
        )
        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    }

    @ViewBuilder
    private func attachmentPreview(_ attachment: ScoutComposerImage) -> some View {
        if attachment.isImage, let image = NSImage(data: attachment.data) {
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else {
            ZStack {
                HUDChrome.canvasAlt.opacity(0.9)
                Image(systemName: attachmentIconName(attachment))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkMuted)
            }
        }
    }

    @ViewBuilder
    private var statusSection: some View {
        if runner.isLoading {
            Text("Loading runner inputs...")
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
        } else if let error = runner.lastError {
            HStack(alignment: .center, spacing: 8) {
                Text(runnerErrorLabel(error))
                    .font(HUDType.body(11))
                    .foregroundStyle(HUDChrome.accent)
                    .lineLimit(2)
                Spacer(minLength: 0)
                Button("Retry") {
                    Task { await runner.reloadOptions() }
                }
                .buttonStyle(HUDRunnerButtonStyle())
            }
        }
    }

    private var footer: some View {
        HStack {
            Text(footerHint)
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
            Spacer()
            Button("Cancel") { runner.dismiss() }
                .buttonStyle(HUDRunnerButtonStyle())
            Button(runner.isSubmitting ? "Asking..." : "Ask") {
                Task { await runner.submit() }
            }
            .buttonStyle(HUDRunnerButtonStyle(isAccent: true))
            .disabled(runner.isSubmitting)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var footerHint: String {
        let route = runner.persistence == "sticky" ? "uses a matching agent card" : "uses a one-time agent card"
        guard !runner.attachments.isEmpty else {
            return "\(route); session context is fresh"
        }
        let noun = runner.attachments.count == 1 ? "file" : "files"
        return "\(route); \(runner.attachments.count) \(noun) staged"
    }

    private var harnesses: [HudRunnerHarnessOption] {
        let loaded = runner.options?.harnesses ?? []
        if !loaded.isEmpty { return loaded }
        return [
            HudRunnerHarnessOption(id: "claude", name: "claude", label: "Claude Code", description: nil, state: nil, ready: nil, detail: nil),
            HudRunnerHarnessOption(id: "codex", name: "codex", label: "Codex", description: nil, state: nil, ready: nil, detail: nil),
        ]
    }

    private var quickProjects: [HudRunnerProjectOption] {
        var result: [HudRunnerProjectOption] = []
        if let selected = runner.selectedProject {
            result.append(selected)
        }
        for project in runner.options?.projects ?? [] where !result.contains(where: { $0.id == project.id }) {
            result.append(project)
            if result.count >= 5 { break }
        }
        return result
    }

    private func harnessShortLabel(_ harness: HudRunnerHarnessOption) -> String {
        switch harness.id {
        case "claude": return "CLAUDE"
        case "codex": return "CODEX"
        default:
            return harness.label
                .split(separator: " ")
                .first
                .map { String($0).uppercased() }
                ?? harness.id.uppercased()
        }
    }

    private var runnerPresets: [HUDRunnerPreset] {
        let allModels = runner.options?.models ?? runner.availableModels
        var seen = Set<String>()
        var presets: [HUDRunnerPreset] = []

        for harness in harnesses {
            let models = rankedModels(
                allModels.filter { model in
                    !model.id.isEmpty && (model.harnesses.isEmpty || model.harnesses.contains(harness.id))
                        && !isRetiredModel(model.id, harness: harness.id)
                },
                harnessId: harness.id
            )
            for model in models.prefix(4) {
                let key = "\(harness.id):\(model.id.lowercased())"
                guard seen.insert(key).inserted else { continue }
                presets.append(
                    HUDRunnerPreset(
                        harnessId: harness.id,
                        modelId: model.id,
                        label: "\(harness.label) · \(model.label)"
                    )
                )
            }
            if models.isEmpty {
                let key = "\(harness.id):"
                guard seen.insert(key).inserted else { continue }
                presets.append(
                    HUDRunnerPreset(
                        harnessId: harness.id,
                        modelId: "",
                        label: harness.label
                    )
                )
            }
        }

        return presets.isEmpty
            ? [HUDRunnerPreset(harnessId: runner.selectedHarness, modelId: runner.selectedModel, label: runner.runnerPresetLabel)]
            : presets
    }

    private var harnessLabel: String {
        harnesses.first(where: { $0.id == runner.selectedHarness })?.label ?? runner.selectedHarness
    }

    private var modelLabel: String {
        if runner.selectedModel.isEmpty { return runner.runnerPresetLabel }
        return runner.availableModels.first(where: { $0.id == runner.selectedModel })?.label ?? runner.selectedModel
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
            preference = ["gpt-5.5", "gpt-5.5-mini"]
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

    private func runnerErrorLabel(_ error: String) -> String {
        let lower = error.lowercased()
        if lower.contains("unknown api route") && lower.contains("/api/runner/options") {
            return "Runner options API is unavailable on the current Scout web server."
        }
        return error
    }

    private func attachmentIconName(_ attachment: ScoutComposerImage) -> String {
        if attachment.isVideo { return "film" }
        if attachment.isMarkdown { return "doc.richtext" }
        if attachment.isCode { return "chevron.left.forwardslash.chevron.right" }
        return "doc"
    }

    private func runnerLabel(_ value: String) -> some View {
        Text(value)
            .font(HUDType.mono(9, weight: .semibold))
            .tracking(HUDType.eyebrowTracking)
            .foregroundStyle(HUDChrome.inkFaint)
    }

    private func runnerMenuLabel(_ value: String) -> some View {
        HStack(spacing: 6) {
            Text(value)
                .lineLimit(1)
                .truncationMode(.tail)
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .bold))
        }
        .font(HUDType.body(11, weight: .semibold))
        .foregroundStyle(HUDChrome.ink)
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .frame(minWidth: 150, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.75))
        .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 1))
    }

    private func runnerTextField(_ placeholder: String, text: Binding<String>, mono: Bool = false) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(mono ? HUDType.mono(11) : HUDType.body(11))
            .foregroundStyle(HUDChrome.ink)
            .padding(.horizontal, 8)
            .padding(.vertical, 7)
            .background(HUDChrome.canvasAlt.opacity(0.75))
            .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 1))
    }
}

private struct HUDRunnerPreset: Identifiable {
    let harnessId: String
    let modelId: String
    let label: String

    var id: String { "\(harnessId):\(modelId)" }
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

private struct HUDRunnerPasteCatcher: NSViewRepresentable {
    var isActive: () -> Bool
    var onPasteAttachments: ([ScoutComposerImage]) -> Bool

    func makeNSView(context: Context) -> NSView {
        context.coordinator.install()
        return NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        context.coordinator.isActive = isActive
        context.coordinator.onPasteAttachments = onPasteAttachments
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(isActive: isActive, onPasteAttachments: onPasteAttachments)
    }

    final class Coordinator {
        var isActive: () -> Bool
        var onPasteAttachments: ([ScoutComposerImage]) -> Bool
        private var monitor: Any?

        init(
            isActive: @escaping () -> Bool,
            onPasteAttachments: @escaping ([ScoutComposerImage]) -> Bool
        ) {
            self.isActive = isActive
            self.onPasteAttachments = onPasteAttachments
        }

        func install() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, self.isActive() else { return event }
                guard event.modifierFlags.contains(.command),
                      event.charactersIgnoringModifiers?.lowercased() == "v" else { return event }
                let attachments = ScoutMediaIntake.fromPasteboard()
                guard !attachments.isEmpty else { return event }
                return self.onPasteAttachments(attachments) ? nil : event
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
