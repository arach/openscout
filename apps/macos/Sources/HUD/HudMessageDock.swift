import HudsonUI
import ScoutNativeCore
import SwiftUI

// Scout wiring for HudsonKit's generic HUD message bar.
// HudsonKit owns the dock treatment; Scout owns routing, compose delivery,
// dictation state, and transcript insertion.
struct HudMessageDock: View {
    @ObservedObject private var dock = HUDDockState.shared
    @ObservedObject private var compose = HudComposeService.shared
    @ObservedObject private var fleet = HudFleetService.shared
    @ObservedObject private var voice = ScoutVoiceService.shared

    private var threadName: String {
        compose.activeThread?.name ?? "default"
    }

    private var target: HudMessageBarTarget? {
        guard let label = dock.targetLabel else { return nil }
        return HudMessageBarTarget(label: label, contextLabel: threadName)
    }

    private var voiceConfiguration: HudMessageBarVoiceConfiguration {
        HudMessageBarVoiceConfiguration(
            state: voice.state.hudMessageBarVoiceState,
            partialText: voice.partial,
            tooltip: voiceTooltip
        ) {
            Task { @MainActor in
                await HUDDockState.shared.toggleDictation()
            }
        }
    }

    var body: some View {
        HudMessageBar(
            text: $dock.text,
            target: target,
            isSending: dock.isSending,
            voice: voiceConfiguration,
            focusSignal: dock.focusRequested,
            blurSignal: dock.blurRequested,
            compactPlaceholder: "talk - / commands · /s search",
            expandedPlaceholder: "talk to the assistant - / for commands, /s to search",
            suggestions: messageSuggestions,
            onAcceptSuggestion: acceptSuggestion,
            onSubmit: submit
        )
        .hudTheme(scoutMessageBarTheme)
        .task {
            if voice.state == .probing {
                await voice.probe()
            }
        }
    }

    private var voiceTooltip: String {
        switch voice.state {
        case .probing:
            return "Checking voice..."
        case .idle:
            return "Hold to dictate (or tap to start)"
        case .starting:
            return "Starting recording..."
        case .recording:
            return "Recording - tap to commit"
        case .processing:
            return "Transcribing..."
        case .unavailable(let reason):
            return reason
        }
    }

    private func submit() {
        let outgoing = dock.text
        dock.text = ""
        Task { await dock.send(body: outgoing) }
    }

    private var messageSuggestions: [HudMessageBarSuggestion] {
        let draft = dock.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !draft.isEmpty else { return [] }
        if draft.hasPrefix("/") {
            let query = String(draft.dropFirst())
            guard !query.contains(where: { $0.isWhitespace }) else { return [] }
            return slashSuggestions(matching: query)
        }
        if draft.hasPrefix("@") {
            return agentSuggestions(matching: String(draft.dropFirst()))
        }
        return []
    }

    private func acceptSuggestion(_ suggestion: HudMessageBarSuggestion) {
        if suggestion.id.hasPrefix("agent:"), let handle = suggestion.completion {
            dock.setTarget(handle: handle, label: suggestion.title)
            dock.text = ""
            dock.focus()
            return
        }
        if let completion = suggestion.completion {
            dock.text = completion
            dock.focus()
        }
    }

    private func slashSuggestions(matching rawQuery: String) -> [HudMessageBarSuggestion] {
        let query = rawQuery.lowercased()
        let commands = Self.slashCommands
        let filtered = query.isEmpty
            ? commands
            : commands.filter { command in
                command.name.hasPrefix(query)
                    || command.usage.lowercased().contains(query)
                    || command.summary.lowercased().contains(query)
            }

        return filtered.map { command in
            HudMessageBarSuggestion(
                id: "slash:\(command.name)",
                title: command.usage,
                subtitle: command.summary,
                completion: command.insertionText,
                badge: "/"
            )
        }
    }

    private func agentSuggestions(matching rawQuery: String) -> [HudMessageBarSuggestion] {
        let query = rawQuery.lowercased()
        return (fleet.agents ?? [])
            .compactMap { agent -> (agent: HudAgent, handle: String)? in
                guard let handle = normalizedHandle(agent.handle ?? agent.selector ?? agent.id) else { return nil }
                return (agent, handle)
            }
            .filter { pair in
                query.isEmpty
                    || pair.handle.lowercased().contains(query)
                    || pair.agent.name.lowercased().contains(query)
            }
            .prefix(6)
            .map { pair in
                HudMessageBarSuggestion(
                    id: "agent:\(pair.handle)",
                    title: pair.agent.name,
                    subtitle: "@\(pair.handle)",
                    completion: pair.handle,
                    badge: "@"
                )
            }
    }

    private func normalizedHandle(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let bare = trimmed.hasPrefix("@") ? String(trimmed.dropFirst()) : trimmed
        return bare.isEmpty ? nil : bare
    }

    private var scoutMessageBarTheme: HudTheme {
        HudTheme(
            palette: HudThemePalette(
                bg: HUDChrome.canvas,
                surface: HUDChrome.canvasAlt,
                chrome: HUDChrome.canvas,
                ink: HUDChrome.ink,
                muted: HUDChrome.inkMuted,
                dim: HUDChrome.inkFaint,
                border: HUDChrome.border,
                accent: HUDChrome.accent,
                accentSoft: HUDChrome.accentSoft,
                statusOk: HUDChrome.accent,
                statusWarn: Color(red: 0.96, green: 0.74, blue: 0.36),
                statusError: Color(red: 0.95, green: 0.40, blue: 0.42),
                statusInfo: Color(red: 0.42, green: 0.85, blue: 0.95)
            ),
            hairline: HudThemeHairline(
                subtle: HUDChrome.borderSoft,
                standard: HUDChrome.borderRim.opacity(0.55)
            ),
            radius: .default,
            focus: HudThemeFocus(ring: HUDChrome.accent.opacity(0.85), ringWidth: 1.5)
        )
    }
}

private extension HudMessageDock {
    struct SlashCommand {
        let name: String
        let arguments: String?
        let summary: String

        var usage: String {
            if let arguments {
                return "/\(name) \(arguments)"
            }
            return "/\(name)"
        }

        var insertionText: String {
            "/\(name) "
        }
    }

    static let slashCommands: [SlashCommand] = [
        SlashCommand(name: "help", arguments: nil, summary: "Show Scoutbot commands."),
        SlashCommand(name: "agents", arguments: nil, summary: "List known agents."),
        SlashCommand(name: "status", arguments: nil, summary: "Summarize fleet activity."),
        SlashCommand(name: "recent", arguments: "@agent", summary: "Show recent agent messages."),
        SlashCommand(name: "doing", arguments: "@agent", summary: "Show active agent work."),
        SlashCommand(name: "flight", arguments: "id", summary: "Inspect a flight."),
        SlashCommand(name: "steer", arguments: "sid:<session>", summary: "Target this Scoutbot thread."),
    ]
}

private extension ScoutDictationState {
    var hudMessageBarVoiceState: HudMessageBarVoiceState {
        switch self {
        case .probing, .idle:
            return .idle
        case .starting:
            return .starting
        case .recording:
            return .recording
        case .processing:
            return .processing
        case .unavailable(let reason):
            return .unavailable(reason)
        }
    }
}
