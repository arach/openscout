import HudsonShell
import HudsonUI
import ScoutNativeCore
import ScoutSharedUI
import SwiftUI
#if os(macOS)
import AppKit
#endif

// MARK: - Network spec / result

/// Flexible session-initiation request. Mirrors `POST /api/sessions`: every
/// modality (new conversation in a project, "same agent" fresh, continue an
/// agent's session with full context, seed-from-message) is expressed by which
/// fields are set rather than by a dedicated endpoint.
struct SessionInitiationSpec {
    enum Session: String { case new, existing, any }

    var targetAgentId: String?
    var projectPath: String?
    var harness: String?
    var model: String?
    var session: Session?
    var targetSessionId: String?
    var persistence: String?
    var agentName: String?
    var displayName: String?
    var instructions: String?
    var fromMessageId: String?
    var fromConversationId: String?

    func jsonBody() -> [String: Any] {
        var target: [String: Any] = [:]
        if let targetAgentId { target["agentId"] = targetAgentId }
        if let projectPath { target["projectPath"] = projectPath }

        var execution: [String: Any] = [:]
        if let harness { execution["harness"] = harness }
        if let model { execution["model"] = model }
        if let session { execution["session"] = session.rawValue }
        if let targetSessionId { execution["targetSessionId"] = targetSessionId }

        var agent: [String: Any] = [:]
        if let persistence { agent["persistence"] = persistence }
        if let agentName { agent["name"] = agentName }
        if let displayName { agent["displayName"] = displayName }

        var seed: [String: Any] = [:]
        if let instructions, !instructions.isEmpty { seed["instructions"] = instructions }
        if let fromMessageId { seed["fromMessageId"] = fromMessageId }
        if let fromConversationId { seed["fromConversationId"] = fromConversationId }

        var body: [String: Any] = [:]
        if !target.isEmpty { body["target"] = target }
        if !execution.isEmpty { body["execution"] = execution }
        if !agent.isEmpty { body["agent"] = agent }
        if !seed.isEmpty { body["seed"] = seed }
        return body
    }
}

struct SessionInitiationResult: Decodable {
    let ok: Bool?
    let conversationId: String?
    let agentId: String?
    let flightId: String?
    let messageId: String?
}

enum SessionInitiationError: LocalizedError {
    case invalidResponse
    case httpStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid response."
        case .httpStatus(let status, let message):
            return message.isEmpty ? "Scout returned HTTP \(status)." : message
        }
    }
}

enum SessionInitiationService {
    static func start(_ spec: SessionInitiationSpec) async throws -> SessionInitiationResult {
        let url = ScoutWeb.baseURL().appending(path: "api/sessions")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: spec.jsonBody())

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw SessionInitiationError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw SessionInitiationError.httpStatus(http.statusCode, Self.decodeError(data))
        }
        return try JSONDecoder().decode(SessionInitiationResult.self, from: data)
    }

    private static func decodeError(_ data: Data) -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let message = object["error"] as? String else {
            return ""
        }
        return message
    }
}

// MARK: - Composer draft

/// In-flight composer state shared by every entry point (the "+" in the
/// conversation list, a message context menu, the agent inspector). The entry
/// point configures the draft; the composer builds the `SessionInitiationSpec`.
struct ScoutSessionDraft: Identifiable {
    enum Mode: Hashable { case fresh, continueContext }
    enum Target {
        case agent(ScoutAgent)
        case project
    }

    let id = UUID()
    var title: String
    var target: Target
    var projectPath: String
    var mode: Mode
    var instructions: String
    var fromMessageId: String?
    var fromConversationId: String?

    var agent: ScoutAgent? {
        if case let .agent(agent) = target { return agent }
        return nil
    }

    /// Whether continuing the same harness session (full context) is possible —
    /// requires the agent to expose a resolvable session id.
    var canContinue: Bool {
        agent?.harnessSessionId?.nilIfEmpty != nil
    }
}

// MARK: - Composer

/// Modal sheet that turns a `ScoutSessionDraft` into a session-initiation call.
/// Renders its own dimmed backdrop so the host only needs `if let draft`.
struct ScoutSessionComposer: View {
    let onClose: () -> Void
    let onComplete: (SessionInitiationResult) -> Void

    @State private var draft: ScoutSessionDraft
    @State private var isSubmitting = false
    @State private var errorText: String?
    @FocusState private var instructionsFocused: Bool
    @ObservedObject private var vox = ScoutVoxService.shared

    init(
        draft: ScoutSessionDraft,
        onClose: @escaping () -> Void,
        onComplete: @escaping (SessionInitiationResult) -> Void
    ) {
        self.onClose = onClose
        self.onComplete = onComplete
        _draft = State(initialValue: draft)
    }

    var body: some View {
        ZStack {
            Color.black.opacity(0.42)
                .ignoresSafeArea()
                .onTapGesture { if !isSubmitting { onClose() } }

            card
                .frame(width: 460)
                .padding(HudSpacing.xxl)
        }
        .onExitCommand { if !isSubmitting { onClose() } }
        .onReceive(vox.$lastFinalText) { spliceDictatedFinal($0) }
    }

    private var isDictating: Bool { vox.state.isCaptureActive }

    private var showDictationPreview: Bool {
        draft.instructions.isEmpty && (vox.state.isCaptureActive || vox.state.isProcessing)
    }

    private var messagePlaceholder: String {
        switch draft.target {
        case .agent(let agent):
            return draft.mode == .continueContext
                ? "Message \(agent.displayName)…"
                : "What should \(agent.displayName) start on?"
        case .project:
            return "What should the new agent start on?"
        }
    }

    private func toggleDictation() {
        instructionsFocused = true
        Task {
            switch ScoutDictationController.toggleDecision(for: vox.state) {
            case .probeThenStartIfIdle:
                await vox.probe()
                if case .idle = vox.state { vox.start() }
            case .start:
                vox.start()
            case .stop:
                vox.stop()
            case .ignore:
                break
            }
        }
    }

    private func spliceDictatedFinal(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft.instructions = ScoutDictationBuffer.appending(trimmed, to: draft.instructions)
        ScoutVoxService.shared.consumeFinalText()
        instructionsFocused = true
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            header
            targetSection
            instructionsSection
            if let errorText {
                Text(errorText)
                    .font(HudFont.mono(10))
                    .foregroundStyle(HudPalette.accent)
                    .fixedSize(horizontal: false, vertical: true)
            }
            footer
        }
        .padding(HudSpacing.xxl)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(HudPalette.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(HudHairline.standard, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.35), radius: 30, y: 12)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            Text(draft.title)
                .font(HudFont.ui(16, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
            Text(subtitle)
                .font(HudFont.mono(10))
                .foregroundStyle(HudPalette.dim)
                .lineLimit(1)
        }
    }

    private var subtitle: String {
        switch draft.target {
        case .agent(let agent):
            return draft.mode == .continueContext
                ? "Continue \(agent.displayName) with full context"
                : "Fresh session with \(agent.displayName)"
        case .project:
            return "Start a new agent in a project"
        }
    }

    @ViewBuilder
    private var targetSection: some View {
        switch draft.target {
        case .agent(let agent):
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack(spacing: HudSpacing.md) {
                    Image(systemName: "person.crop.circle")
                        .font(HudFont.ui(12, weight: .semibold))
                        .foregroundStyle(HudPalette.accent)
                    Text(agent.displayName)
                        .font(HudFont.ui(12, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                    Text(agent.detail)
                        .font(HudFont.mono(9))
                        .foregroundStyle(HudPalette.dim)
                        .lineLimit(1)
                }
                if draft.canContinue {
                    modePicker
                }
            }
        case .project:
            HudField("Project path", text: $draft.projectPath, icon: "folder")
        }
    }

    private var modePicker: some View {
        HStack(spacing: HudSpacing.xs) {
            modeButton(.fresh, title: "Fresh session", icon: "plus.bubble")
            modeButton(.continueContext, title: "Continue (full context)", icon: "arrow.uturn.forward")
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
    }

    private func modeButton(_ mode: ScoutSessionDraft.Mode, title: String, icon: String) -> some View {
        Button {
            draft.mode = mode
        } label: {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(10, weight: .semibold))
                Text(title)
                    .font(HudFont.mono(9, weight: .semibold))
            }
            .foregroundStyle(draft.mode == mode ? HudPalette.ink : HudPalette.muted)
            .frame(maxWidth: .infinity)
            .frame(height: 26)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(draft.mode == mode ? HudSurface.selected(HudPalette.accent) : Color.clear)
            )
        }
        .buttonStyle(.plain).scoutPointerCursor()
    }

    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HudSectionLabel(draft.mode == .continueContext ? "Follow-up message" : "First message")
            messageWell
        }
    }

    private var messageWell: some View {
        HStack(alignment: .bottom, spacing: HudSpacing.sm) {
            ZStack(alignment: .topLeading) {
                if draft.instructions.isEmpty && !showDictationPreview {
                    Text(messagePlaceholder)
                        .font(HudFont.ui(12))
                        .foregroundStyle(HudPalette.dim)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }

                TextEditor(text: $draft.instructions)
                    .font(HudFont.ui(12))
                    .foregroundStyle(HudPalette.ink)
                    .tint(showDictationPreview ? Color.clear : HudPalette.accent)
                    .scrollContentBackground(.hidden)
                    .focused($instructionsFocused)
                    .frame(minHeight: 64, maxHeight: 132)

                if showDictationPreview {
                    ScoutDictationPreview(text: vox.partial)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 8)
                        .allowsHitTesting(false)
                }
            }

            ScoutMicButton(box: 30, glyph: 14, action: toggleDictation)
                .padding(.bottom, 2)
        }
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(HudSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(instructionsFocused ? HudSurface.tintBorder(HudPalette.accent) : HudHairline.standard, lineWidth: HudStrokeWidth.thin)
        )
    }

    private var footer: some View {
        HStack {
            HudButton("Cancel", style: .ghost) { onClose() }
                .disabled(isSubmitting)
            Spacer()
            if isSubmitting {
                ProgressView().controlSize(.small)
            }
            HudButton(startTitle, icon: "paperplane.fill", style: .primary(.green)) {
                submit()
            }
            .disabled(isSubmitting || !canSubmit)
        }
    }

    private var startTitle: String {
        draft.mode == .continueContext ? "Continue" : "Start"
    }

    private var canSubmit: Bool {
        switch draft.target {
        case .agent:
            if draft.mode == .continueContext { return draft.canContinue }
            return true
        case .project:
            return !draft.projectPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func makeSpec() -> SessionInitiationSpec {
        var spec = SessionInitiationSpec()
        spec.persistence = "sticky"
        let trimmed = draft.instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        spec.instructions = trimmed.isEmpty ? nil : trimmed
        spec.fromMessageId = draft.fromMessageId
        spec.fromConversationId = draft.fromConversationId

        switch draft.target {
        case .agent(let agent):
            spec.targetAgentId = agent.id
            spec.agentName = agent.name.nilIfEmpty
            if draft.mode == .continueContext {
                spec.session = .existing
                spec.targetSessionId = agent.harnessSessionId?.nilIfEmpty
            } else {
                spec.session = .new
            }
        case .project:
            spec.projectPath = draft.projectPath.trimmingCharacters(in: .whitespacesAndNewlines)
            spec.session = .new
        }
        return spec
    }

    private func submit() {
        guard !isSubmitting, canSubmit else { return }
        isSubmitting = true
        errorText = nil
        let spec = makeSpec()
        Task {
            do {
                let result = try await SessionInitiationService.start(spec)
                isSubmitting = false
                onComplete(result)
            } catch {
                isSubmitting = false
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
