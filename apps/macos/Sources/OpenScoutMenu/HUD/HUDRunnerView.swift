import ScoutSharedUI
import SwiftUI

private enum HUDRunnerFocusedField: Hashable {
    case project
    case instructions
}

struct HUDRunnerOverlay: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    @ObservedObject private var vox = HudVoxService.shared
    @FocusState private var focusedField: HUDRunnerFocusedField?

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
                                if runner.showAdvanced {
                                    advancedSection
                                }
                                instructionsSection
                                statusSection
                            }
                            .padding(14)
                        }
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
                runnerPresetMenu
                Button(action: { runner.showAdvanced.toggle() }) {
                    Image(systemName: "slider.horizontal.3")
                        .frame(width: 14, height: 14)
                }
                .help("Runner settings")
                .buttonStyle(HUDRunnerButtonStyle(isAccent: runner.showAdvanced))
            }
            if runner.shouldShowProjectMatches {
                projectMatches
            }
            if let hint = agentHint {
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

    private var runnerPresetMenu: some View {
        Menu {
            ForEach(runnerPresets) { preset in
                Button {
                    runner.selectHarness(preset.harnessId)
                    runner.selectedModel = preset.modelId
                } label: {
                    HStack {
                        Text(preset.label)
                        if preset.harnessId == runner.selectedHarness && preset.modelId == runner.selectedModel {
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            runnerMenuLabel(runner.runnerPresetLabel)
        }
        .menuStyle(.borderlessButton)
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
                Button(action: { Task { await runner.toggleDictation() } }) {
                    HStack(spacing: 5) {
                        Image(systemName: vox.state == .recording ? "stop.fill" : "mic.fill")
                        Text(vox.state == .recording ? "Stop" : "Voice")
                    }
                }
                .buttonStyle(HUDRunnerButtonStyle(isAccent: vox.state == .recording))
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

    @ViewBuilder
    private var statusSection: some View {
        if runner.isLoading {
            Text("Loading runner inputs...")
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
        } else if let error = runner.lastError {
            Text(error)
                .font(HUDType.body(11))
                .foregroundStyle(HUDChrome.accent)
                .lineLimit(2)
        }
    }

    private var footer: some View {
        HStack {
            Text(runner.persistence == "sticky" ? "uses a matching agent card; session context is fresh" : "uses a one-time agent card; session context is fresh")
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

    private var harnesses: [HudRunnerHarnessOption] {
        let loaded = runner.options?.harnesses ?? []
        if !loaded.isEmpty { return loaded }
        return [
            HudRunnerHarnessOption(id: "claude", name: "claude", label: "Claude Code", description: nil, state: nil, ready: nil, detail: nil),
            HudRunnerHarnessOption(id: "codex", name: "codex", label: "Codex", description: nil, state: nil, ready: nil, detail: nil),
        ]
    }

    private var runnerPresets: [HUDRunnerPreset] {
        let allModels = runner.options?.models ?? runner.availableModels
        var seen = Set<String>()
        var presets: [HUDRunnerPreset] = []

        for harness in harnesses {
            let models = rankedModels(
                allModels.filter { model in
                    !model.id.isEmpty && (model.harnesses.isEmpty || model.harnesses.contains(harness.id))
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
            preference = ["claude-opus-4-7", "opus", "sonnet", "haiku"]
        case "codex":
            preference = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]
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
