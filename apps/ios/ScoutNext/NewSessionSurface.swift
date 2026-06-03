import SwiftUI
import HudsonUI
import ScoutCapabilities

/// New Session — a composer that builds a project-modality
/// `SessionInitiationSpec` (target.projectPath set, execution.session = .new,
/// seed.instructions) and dispatches it through the broker client, then shows
/// the returned ids. Token usage cribbed from
/// `apps/macos/Sources/Scout/ScoutSessionService.swift`.
struct NewSessionSurface: View {
    let client: any ScoutBrokerClient

    @State private var projectPath: String = "/Users/arach/dev/openscout"
    @State private var instructions: String = "Stand up the ScoutNext shell and get it running in the simulator."
    @State private var isSubmitting = false
    @State private var result: SessionInitiationResult?
    @State private var errorText: String?
    @State private var route: ConversationRoute?
    @FocusState private var instructionsFocused: Bool

    /// A Hashable navigation target — contract models stay transport-pure.
    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                projectSection
                instructionsSection
                if let errorText {
                    Text(errorText)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.statusError)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let result {
                    resultCard(result)
                }
                footer
            }
            .padding(HudSpacing.xxl)
        }
        .navigationDestination(item: $route) { route in
            ConversationSurface(
                client: client,
                conversationId: route.id,
                title: route.title,
                onClose: { self.route = nil }
            )
        }
    }

    private var projectSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Project")
            HudField("Project path", text: $projectPath, icon: "folder")
        }
    }

    private var instructionsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Instructions")
            TextEditor(text: $instructions)
                .font(HudFont.ui(HudTextSize.base))
                .foregroundStyle(HudPalette.ink)
                .scrollContentBackground(.hidden)
                .focused($instructionsFocused)
                .frame(minHeight: 120)
                .padding(HudSpacing.lg)
                .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard)
                )
        }
    }

    private func resultCard(_ result: SessionInitiationResult) -> some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack(spacing: HudSpacing.md) {
                    HudStatusDot(color: HudPalette.statusOk, size: HudDotSize.medium)
                    Text("Session started")
                        .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                }
                idRow("conversation", result.conversationId)
                idRow("agent", result.agentId)
                idRow("flight", result.flightId)
                idRow("message", result.messageId)
            }
        }
    }

    private func idRow(_ label: String, _ value: String?) -> some View {
        HStack(spacing: HudSpacing.md) {
            Text(label)
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                .tracking(0.8)
                .textCase(.uppercase)
                .foregroundStyle(HudPalette.dim)
                .frame(width: 96, alignment: .leading)
            Text(value ?? "—")
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(HudPalette.ink)
            Spacer(minLength: 0)
        }
    }

    private var footer: some View {
        HStack {
            if isSubmitting {
                ProgressView().controlSize(.small)
            }
            Spacer()
            HudButton("Start", icon: "paperplane.fill", style: .primary(.green)) {
                submit()
            }
            .disabled(isSubmitting || !canSubmit)
        }
    }

    private var canSubmit: Bool {
        !projectPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func makeSpec() -> SessionInitiationSpec {
        let trimmedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        return SessionInitiationSpec(
            target: .init(projectPath: projectPath.trimmingCharacters(in: .whitespacesAndNewlines)),
            execution: .init(session: .new),
            agent: .init(persistence: "sticky"),
            seed: .init(instructions: trimmedInstructions.isEmpty ? nil : trimmedInstructions)
        )
    }

    private func submit() {
        guard !isSubmitting, canSubmit else { return }
        isSubmitting = true
        errorText = nil
        result = nil
        instructionsFocused = false
        let spec = makeSpec()
        Task {
            do {
                let outcome = try await client.startSession(spec)
                isSubmitting = false
                result = outcome
                // Land in the new conversation when the broker returns one.
                if let conversationId = outcome.conversationId {
                    route = ConversationRoute(id: conversationId, title: sessionTitle)
                }
            } catch {
                isSubmitting = false
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    /// Title for the pushed conversation: the project's last path component,
    /// falling back to a generic label.
    private var sessionTitle: String {
        let trimmed = projectPath.trimmingCharacters(in: .whitespacesAndNewlines)
        let last = (trimmed as NSString).lastPathComponent
        return last.isEmpty ? "New session" : last
    }
}
