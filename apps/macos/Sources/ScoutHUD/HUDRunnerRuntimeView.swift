import AppKit
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

struct HUDRunnerModelDescriptor: Identifiable {
    let option: HudRunnerModelOption
    let familyID: String
    let familyLabel: String
    let versionLabel: String

    var id: String {
        option.id.isEmpty ? "\(familyID):\(versionLabel)" : option.id
    }
}

struct HUDRunnerModelFamily: Identifiable {
    let id: String
    let label: String
    var models: [HUDRunnerModelDescriptor]
}

struct HUDRunnerRuntimeConfiguration: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding
    var presentedInPicker = false

    var body: some View {
        HUDRunnerDisclosurePanel {
            VStack(spacing: 8) {
                if presentedInPicker {
                    HStack(spacing: 9) {
                        Button(action: runner.showRuntimePickerChoices) {
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
                        .accessibilityLabel("Back to models")

                        Text("CUSTOM RUNTIME")
                            .font(HUDType.mono(9, weight: .semibold))
                            .tracking(HUDType.eyebrowTracking)
                            .foregroundStyle(HUDChrome.inkMuted)
                        Spacer()
                    }
                    .frame(height: 30)
                } else {
                    HUDRunnerDisclosureHeader(
                        title: "CONFIGURE RUNTIME",
                        detail: "Applied together",
                        focus: focus
                    )
                }

                HStack(
                    alignment: .top,
                    spacing: 8
                ) {
                    harnessMenu
                    modelMenu
                    versionMenu
                    effortMenu
                }

                HStack {
                    Spacer()

                    Button("Use runtime", action: runner.applyRuntimeDraft)
                        .buttonStyle(
                            HUDRunnerPrimaryTextButtonStyle(
                                isFocused: focus.wrappedValue == .applyRuntime
                            )
                        )
                        .focused(focus, equals: .applyRuntime)
                }
                .frame(height: 34)
            }
        }
    }

    private var harnessMenu: some View {
        HUDRunnerRuntimeMenuControl(
            title: "HARNESS",
            isFocused: focus.wrappedValue == .harness
        ) {
            Menu {
                ForEach(HUDRunnerRuntimeFormatter.harnesses(runner)) { harness in
                    Button {
                        runner.updateRuntimeDraftHarness(harness.id)
                    } label: {
                        HStack {
                            Text(harness.label)
                            if harness.id == editorHarness {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                    .disabled(harness.ready == false)
                }
            } label: {
                menuLabel(
                    HUDRunnerRuntimeFormatter.harnessLabel(
                        editorHarness,
                        runner: runner
                    )
                )
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .focused(focus, equals: .harness)
            .accessibilityLabel(
                "Harness: \(HUDRunnerRuntimeFormatter.harnessLabel(editorHarness, runner: runner))"
            )
        }
    }

    private var modelMenu: some View {
        HUDRunnerRuntimeMenuControl(
            title: "MODEL",
            isFocused: focus.wrappedValue == .model
        ) {
            Menu {
                ForEach(editorFamilies) { family in
                    Button {
                        selectFamily(family)
                    } label: {
                        HStack {
                            Text(family.label)
                            if family.id == selectedFamily?.id {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                menuLabel(selectedFamily?.label ?? "Default")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .focused(focus, equals: .model)
            .accessibilityLabel("Model: \(selectedFamily?.label ?? "Default")")
        }
    }

    private var versionMenu: some View {
        HUDRunnerRuntimeMenuControl(
            title: "VERSION",
            isFocused: focus.wrappedValue == .version
        ) {
            Menu {
                ForEach(selectedFamily?.models ?? []) { model in
                    Button {
                        runner.updateRuntimeDraftModel(model.option.id)
                    } label: {
                        HStack {
                            Text(model.versionLabel)
                            if model.option.id == editorModel {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                menuLabel(selectedDescriptor?.versionLabel ?? "Default")
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .focused(focus, equals: .version)
            .accessibilityLabel(
                "Version: \(selectedDescriptor?.versionLabel ?? "Default")"
            )
        }
    }

    private var effortMenu: some View {
        HUDRunnerRuntimeMenuControl(
            title: "EFFORT",
            isFocused: focus.wrappedValue == .effort
        ) {
            Menu {
                ForEach(runner.runtimeDraftEfforts) { effort in
                    Button {
                        runner.updateRuntimeDraftEffort(effort.id)
                    } label: {
                        HStack {
                            Text(effort.label)
                            if effort.id == editorEffort {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                }
            } label: {
                menuLabel(
                    HUDRunnerRuntimeFormatter.effortLabel(
                        editorEffort,
                        harness: editorHarness,
                        runner: runner
                    )
                )
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .focused(focus, equals: .effort)
            .accessibilityLabel(
                "Effort: \(HUDRunnerRuntimeFormatter.effortLabel(editorEffort, harness: editorHarness, runner: runner))"
            )
        }
    }

    private func menuLabel(_ value: String) -> some View {
        HStack(spacing: 5) {
            Text(value)
                .font(HUDType.body(12, weight: .medium))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 2)
            Image(systemName: "chevron.down")
                .font(.system(size: 7, weight: .bold))
                .foregroundStyle(HUDChrome.inkFaint)
        }
        .padding(.horizontal, 11)
        .frame(height: 34)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var editorHarness: String {
        runner.runtimeDraft?.harness ?? runner.selectedHarness
    }

    private var editorModel: String {
        runner.runtimeDraft?.model ?? runner.selectedModel
    }

    private var editorEffort: String {
        runner.runtimeDraft?.effort ?? runner.reasoningEffort
    }

    private var descriptors: [HUDRunnerModelDescriptor] {
        HUDRunnerRuntimeFormatter.descriptors(
            models: runner.runtimeDraftModels,
            selectedModel: editorModel,
            harness: editorHarness
        )
    }

    private var editorFamilies: [HUDRunnerModelFamily] {
        HUDRunnerRuntimeFormatter.families(descriptors)
    }

    private var selectedDescriptor: HUDRunnerModelDescriptor? {
        descriptors.first { $0.option.id == editorModel } ?? descriptors.first
    }

    private var selectedFamily: HUDRunnerModelFamily? {
        guard let familyID = selectedDescriptor?.familyID else {
            return editorFamilies.first
        }
        return editorFamilies.first { $0.id == familyID } ?? editorFamilies.first
    }

    private func selectFamily(_ family: HUDRunnerModelFamily) {
        if family.models.contains(where: { $0.option.id == editorModel }) {
            return
        }
        let currentVersion = selectedDescriptor?.versionLabel
        let selected = family.models.first { $0.versionLabel == currentVersion }
            ?? family.models.first
        if let selected {
            runner.updateRuntimeDraftModel(selected.option.id)
        }
    }
}

private struct HUDRunnerRuntimeMenuControl<Content: View>: View {
    let title: String
    let isFocused: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(HUDType.mono(7, weight: .semibold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(HUDChrome.inkFaint)
            content()
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .background(HUDChrome.canvasAlt.opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(
                            isFocused
                                ? HUDChrome.accent.opacity(0.56)
                                : HUDChrome.border.opacity(0.72),
                            lineWidth: isFocused ? 1 : 0.75
                        )
                )
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .frame(maxWidth: .infinity, minHeight: 49, alignment: .leading)
    }
}

struct HUDRunnerRouteConfiguration: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding

    var body: some View {
        HUDRunnerDisclosurePanel {
            VStack(spacing: 10) {
                HUDRunnerDisclosureHeader(
                    title: "AGENT ROUTE",
                    detail: "Persistence and identity",
                    focus: focus
                )

                HStack(spacing: 12) {
                    Picker(
                        "",
                        selection: Binding(
                            get: { runner.persistence },
                            set: { runner.setPersistence($0) }
                        )
                    ) {
                        Text("Agent card").tag("sticky")
                        Text("One-time").tag("one_time")
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 220)
                    .accessibilityLabel("Agent persistence")
                    .focused(focus, equals: .persistence)

                    if let agentHint {
                        Text(agentHint)
                            .font(HUDType.body(9))
                            .foregroundStyle(HUDChrome.inkFaint)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 0)
                }

                HStack(spacing: 12) {
                    routeTextField(
                        "Agent name (optional)",
                        text: $runner.agentName,
                        mono: true,
                        target: .agentName
                    )
                    routeTextField(
                        "Display name (optional)",
                        text: $runner.displayName,
                        target: .displayName
                    )
                }

                HStack {
                    Spacer()
                    Button("Done", action: runner.stepBackDisclosure)
                        .buttonStyle(
                            HUDRunnerPrimaryTextButtonStyle(
                                isFocused: focus.wrappedValue == .disclosureDone
                            )
                        )
                        .focused(focus, equals: .disclosureDone)
                }
                .frame(height: 36)
            }
        }
    }

    private func routeTextField(
        _ placeholder: String,
        text: Binding<String>,
        mono: Bool = false,
        target: HUDRunnerFocusTarget
    ) -> some View {
        TextField(placeholder, text: text)
            .textFieldStyle(.plain)
            .font(mono ? HUDType.mono(11) : HUDType.body(11))
            .foregroundStyle(HUDChrome.ink)
            .padding(.horizontal, 8)
            .frame(height: 38)
            .background(HUDChrome.canvasAlt.opacity(0.72))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(
                        focus.wrappedValue == target
                            ? HUDChrome.borderStrong
                            : HUDChrome.borderSoft,
                        lineWidth: focus.wrappedValue == target ? 1.25 : 0.75
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .focused(focus, equals: target)
            .accessibilityLabel(placeholder)
    }

    private var agentHint: String? {
        let matches = runner.matchingAgents
        guard !matches.isEmpty else { return nil }
        let first = matches[0]
        let handle = first.handle.map { "@\($0)" } ?? first.id
        if matches.count == 1 {
            return "\(handle) · \(first.harness ?? "harness")"
        }
        return "\(matches.count) agents already use this project"
    }
}


@MainActor
enum HUDRunnerRuntimeFormatter {
    static func harnesses(_ runner: HUDRunnerState) -> [HudRunnerHarnessOption] {
        let loaded = runner.options?.harnesses ?? []
        if !loaded.isEmpty { return loaded }
        return [
            HudRunnerHarnessOption(
                id: "claude",
                name: "claude",
                label: "Claude Code",
                description: nil,
                state: nil,
                ready: nil,
                detail: nil
            ),
            HudRunnerHarnessOption(
                id: "codex",
                name: "codex",
                label: "Codex",
                description: nil,
                state: nil,
                ready: nil,
                detail: nil
            ),
        ]
    }

    static func harnessLabel(
        _ id: String,
        runner: HUDRunnerState
    ) -> String {
        harnesses(runner).first(where: { $0.id == id })?.label ?? id
    }

    static func effortLabel(
        _ id: String,
        harness: String,
        runner: HUDRunnerState
    ) -> String {
        runner.availableEfforts(for: harness).first { $0.id == id }?.label
            ?? (id.isEmpty ? "Medium" : id)
    }

    static func presentation(
        _ preset: HUDRunnerRuntimePreset,
        runner: HUDRunnerState
    ) -> (title: String, detail: String) {
        let harness = harnessLabel(preset.harness, runner: runner)
        let models = runner.availableModels(for: preset.harness)
        let option = models.first { $0.id == preset.model }
            ?? HudRunnerModelOption(
                id: preset.model,
                label: preset.model.isEmpty ? "Default" : preset.model,
                harnesses: [preset.harness],
                source: "selected"
            )
        let descriptor = descriptor(option)
        let effort = effortLabel(
            preset.effort,
            harness: preset.harness,
            runner: runner
        )
        return (
            "\(harness) · \(descriptor.familyLabel)",
            "\(versionDisplay(descriptor.versionLabel)) · effort \(effort.lowercased())"
        )
    }

    static func composerLabel(
        _ preset: HUDRunnerRuntimePreset,
        runner: HUDRunnerState
    ) -> String {
        let models = runner.availableModels(for: preset.harness)
        let option = models.first { $0.id == preset.model }
            ?? HudRunnerModelOption(
                id: preset.model,
                label: preset.model.isEmpty ? "Default" : preset.model,
                harnesses: [preset.harness],
                source: "selected"
            )
        let descriptor = descriptor(option)
        let version = versionDisplay(descriptor.versionLabel)
        let effort = effortLabel(
            preset.effort,
            harness: preset.harness,
            runner: runner
        )
        let model = version == "Latest"
            ? descriptor.familyLabel
            : "\(descriptor.familyLabel) \(version)"
        return "\(model) · \(effort)"
    }

    static func descriptors(
        models: [HudRunnerModelOption],
        selectedModel: String,
        harness: String
    ) -> [HUDRunnerModelDescriptor] {
        var ranked = rankedModels(models, harness: harness)
        if !selectedModel.isEmpty,
           !ranked.contains(where: { $0.id == selectedModel }) {
            ranked.append(
                HudRunnerModelOption(
                    id: selectedModel,
                    label: selectedModel,
                    harnesses: [harness],
                    source: "selected"
                )
            )
        }
        return ranked.map(descriptor)
    }

    static func families(
        _ descriptors: [HUDRunnerModelDescriptor]
    ) -> [HUDRunnerModelFamily] {
        var result: [HUDRunnerModelFamily] = []
        for model in descriptors {
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

    private static func descriptor(
        _ model: HudRunnerModelOption
    ) -> HUDRunnerModelDescriptor {
        let derived = derivedFacets(model.label.isEmpty ? model.id : model.label)
        let familyLabel = clean(model.family).map(prettyFamilyLabel) ?? derived.family
        let familyID = normalizedChoiceID(clean(model.family) ?? familyLabel)
        return HUDRunnerModelDescriptor(
            option: model,
            familyID: familyID.isEmpty ? "default" : familyID,
            familyLabel: familyLabel.isEmpty ? "Default" : familyLabel,
            versionLabel: clean(model.version) ?? derived.version
        )
    }

    private static func derivedFacets(
        _ value: String
    ) -> (family: String, version: String) {
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

    private static func isVersionToken(_ value: String) -> Bool {
        value.contains(where: \.isNumber)
            && value.allSatisfy { $0.isNumber || $0 == "." }
    }

    private static func prettyFamilyLabel(_ raw: String) -> String {
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

    private static func normalizedChoiceID(_ value: String) -> String {
        value.lowercased()
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
            .joined(separator: "-")
    }

    private static func clean(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private static func rankedModels(
        _ models: [HudRunnerModelOption],
        harness: String
    ) -> [HudRunnerModelOption] {
        let preference: [String]
        switch harness {
        case "claude":
            preference = [
                "claude-opus-4-8",
                "opus",
                "claude-sonnet-4-6",
                "sonnet",
                "claude-haiku-4-5",
                "haiku",
            ]
        case "codex":
            preference = [
                "gpt-5.6-sol",
                "gpt-5.6-terra",
                "gpt-5.6-luna",
                "gpt-5.5",
                "gpt-5.5-mini",
            ]
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

    static func versionDisplay(_ value: String) -> String {
        let lower = value.lowercased()
        if value == "Latest" || value == "Default" || lower.hasPrefix("v") {
            return value
        }
        return "v\(value)"
    }
}
