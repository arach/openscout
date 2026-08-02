// ComposerKit — the shared composer primitives used by every "write something
// to an agent" surface (share composer, New/+, …). One philosophy everywhere:
//
//   TO     a recipient field — type to search any known agent or declare a
//          handle free-form; a horizontal strip of recent actives sits under
//          it for one-tap picks.
//   BODY   the message/prompt, with attachments riding directly above the
//          input row.
//   BAR    attach (photos/files) anchoring the left, then the runtime readout,
//          the mic and Send on the right.
//
// Surfaces differ only in what they pre-bake (the share composer arrives with
// a screenshot attached) and what "send" does (DM vs. new session) — and BODY
// and BAR are one type, `ScoutMessageComposer`, everywhere. The host owns the
// photo/file pickers (see `ScoutComposerAttach`), because the surface that has
// to show a read failure is the surface that asked for the file.

import ScoutCapabilities
import SwiftUI
import HudsonUI
import HudsonVoice

// MARK: - Recipient model

/// A resolved recipient pick: either a known broker agent or a free-form
/// handle the operator typed (self-declared — the broker resolves/wakes it on
/// delivery, or rejects with a readable error).
struct ComposerRecipient: Identifiable, Hashable {
    let id: String
    let title: String
    /// `harness · project` for known agents.
    let subtitle: String?
    /// What the agent is doing right now (known agents only).
    let status: String?
    let state: AgentSummary.State?
    let isTypedHandle: Bool

    init(agent: AgentSummary) {
        id = agent.id
        title = agent.title
        subtitle = [agent.harness, agent.projectName].compactMap { $0 }.joined(separator: " · ")
        status = agent.statusLabel
        state = agent.state
        isTypedHandle = false
    }

    init(handle: String) {
        let trimmed = handle.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        id = trimmed
        title = "@\(trimmed)"
        subtitle = nil
        status = nil
        state = nil
        isTypedHandle = true
    }
}

// MARK: - Recipient field

/// The shared "To" control. Unselected: a search field over known agents with
/// a recents strip underneath (live first, then most-recently-active — the
/// same ordering as the Agents tab's recent view). Typing filters the known
/// fleet; no match offers the typed text as a self-declared handle.
struct ComposerRecipientField: View {
    let agents: [AgentSummary]
    @Binding var selection: ComposerRecipient?

    @State private var search = ""
    @FocusState private var focused: Bool

    /// Recents strip: live first, then last-active — same window discipline as
    /// the Agents recent view, capped so the strip stays glanceable.
    private var recents: [AgentSummary] {
        Array(
            agents.sorted { lhs, rhs in
                if (lhs.state == .live) != (rhs.state == .live) { return lhs.state == .live }
                let l = lhs.lastActiveAt ?? .distantPast
                let r = rhs.lastActiveAt ?? .distantPast
                if l != r { return l > r }
                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }.prefix(12)
        )
    }

    private var matches: [AgentSummary] {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return [] }
        let needle = query.trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        return agents.filter { agent in
            [agent.title, agent.id, agent.harness ?? "", agent.projectName ?? ""]
                .contains { $0.lowercased().contains(needle) }
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            // The "To" row rides in the same card grammar as the project row —
            // naked text on the surface read as unfinished.
            HStack(spacing: HudSpacing.sm) {
                Text("To")
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(ScoutInk.dim)
                if let selection {
                    selectedToken(selection)
                } else {
                    TextField("Agent, @handle, or search…", text: $search)
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutPalette.ink)
                        .focused($focused)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit { focused = false }
                }
            }
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.sm + 2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .scoutCard(cornerRadius: HudRadius.standard)

            // Unselected: recents at rest, matches while searching. The whole
            // block gives way to the prompt the moment a pick lands.
            if selection == nil {
                if search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    recentsStrip
                } else {
                    suggestionList
                }
            }
        }
    }

    private func selectedToken(_ recipient: ComposerRecipient) -> some View {
        HStack(spacing: 6) {
            if let state = recipient.state {
                Circle()
                    .fill(Self.stateColor(state))
                    .frame(width: 7, height: 7)
            }
            Text(recipient.title)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
            Button {
                selection = nil
                search = ""
                focused = true
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(ScoutInk.dim)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Capsule().fill(ScoutSurface.raised))
        .overlay(Capsule().stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin))
    }

    private var recentsStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(recents) { agent in
                    Button {
                        selection = ComposerRecipient(agent: agent)
                    } label: {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(Self.stateColor(agent.state))
                                .frame(width: 6, height: 6)
                            Text(agent.title)
                                .font(HudFont.ui(HudTextSize.xs))
                                .foregroundStyle(ScoutInk.muted)
                                .lineLimit(1)
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(ScoutSurface.inset))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    /// Search matches + the self-declared handle row, scrollable when the fleet
    /// is deep; the height shrink-wraps to the rows so short lists leave no gap.
    private var suggestionList: some View {
        let agents = Array(matches.prefix(8))
        let typed = search.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        let showTyped = !typed.isEmpty && !matches.contains(where: { $0.id == typed })
        let rowCount = agents.count + (showTyped ? 1 : 0)
        return ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(agents) { agent in
                    Button {
                        selection = ComposerRecipient(agent: agent)
                    } label: {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(Self.stateColor(agent.state))
                                .frame(width: 7, height: 7)
                            Text(agent.title)
                                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                                .foregroundStyle(ScoutPalette.ink)
                                .lineLimit(1)
                            Text([agent.harness, agent.projectName].compactMap { $0 }.joined(separator: " · "))
                                .font(HudFont.ui(HudTextSize.xs))
                                .foregroundStyle(ScoutInk.dim)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 6)
                        .padding(.horizontal, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                if showTyped {
                    Button {
                        selection = ComposerRecipient(handle: typed)
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "at")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(ScoutVibe.accent)
                            Text("Send to @\(typed)")
                                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                                .foregroundStyle(ScoutVibe.accent)
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 6)
                        .padding(.horizontal, 8)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(height: min(CGFloat(max(rowCount, 1)) * 36, 216))
        .scrollDismissesKeyboard(.interactively)
    }

    static func stateColor(_ state: AgentSummary.State) -> Color {
        switch state {
        case .live: return ScoutVibe.accent
        case .idle: return ScoutVibe.amber
        case .offline, .unknown: return ScoutInk.dim
        }
    }
}

// MARK: - Message composer
//
// ScoutMessageComposer — the ONE chat input across Scout iOS, the SwiftUI port
// of the studio contract (design/studio/components/MessageComposer.tsx, phone
// defaults from components/scout-ios/composer.tsx).
//
//   ┌ error / notice ─ annotation above the shell ─────┐
//   ╭ shell ───────────────────────────────────────────╮
//   │ attachments ─ chips riding on top of the input   │
//   │ body ─── message input                           │
//   │          waveform from real mic energy           │
//   │ base ─ [attach ⊕]         [tools] [mic] [send ↑] │
//   ╰──────────────────────────────────────────────────╯
//
// Every variant any surface needs is expressible as params, so no surface
// re-rolls the markup. The contract's translation table, applied: `density` /
// `appearance` are Swift enums (never raw strings), `on*` are closures, `tools`
// is a `@ViewBuilder` slot, and `className` is dropped.
//
// State DERIVES — it is never passed in. "Armed" is the draft being non-empty
// (`canSend` only overrides that rule for attachment-only sends), focus is real
// focus, recording is `HudDictation`'s. There is no `armed` / `focused` param
// and there must not be.

/// Outer rhythm — how much room the composer takes in its host. `panel` —
/// standalone, no outer padding (the default; what a page puts its own padding
/// around). `thread` — docked at the foot of a transcript. `compact` — dense
/// chrome, tight padding and a smaller body. `lead` — the composer IS the page
/// (Home · Entry): the draft line reads a step larger with its own breathing
/// room above the base row, and Send stays legible at rest because an empty
/// front door still has to show what it can do.
enum ScoutComposerDensity { case panel, thread, compact, lead }

/// Width of the dictation trail's rolling sample window.
private let scoutComposerWaveBars = 40

/// The shell's idiom — orthogonal to density.
///
/// `panel` — the card: an 8pt radius with room for long drafts.
///
/// `pill` — the phone idiom: a soft 21pt capsule, no tray and no fence, 28pt
/// controls, a one-line body. With nothing on the base row (no `attach`, no
/// `tools`) the controls fold up beside the input and the whole thing is a
/// single ~44pt line — the classic ask box. Adding `tools` unfolds it again.
enum ScoutComposerAppearance { case panel, pill }

/// Attach anchors the base row's left end. The host owns the pickers — and so
/// the error surfacing when a file can't be read — which is why this is two
/// intents rather than a picker.
struct ScoutComposerAttach {
    var onPhoto: () -> Void
    var onFile: () -> Void
}

/// A one-line annotation above the shell: a recovered draft, a delivery that
/// needs a decision. `action` is the single way to act on it.
struct ScoutComposerNotice {
    var text: String
    var actionLabel: String?
    var action: (() -> Void)?

    init(_ text: String, actionLabel: String? = nil, action: (() -> Void)? = nil) {
        self.text = text
        self.actionLabel = actionLabel
        self.action = action
    }
}

struct ScoutMessageComposer<Tools: View>: View {
    // ── Draft ────────────────────────────────────────────────────────────
    @Binding var text: String
    /// Resting prompt. Dictation state reads in the voice line, not here, so a
    /// hot mic never overwrites what the surface is asking for.
    var placeholder: String
    /// Initial lines; the body grows from there to `maxRows` before scrolling.
    var rows: Int
    /// The host declaring that composing is this surface's RESTING posture
    /// (Home · Entry), so the field takes the keyboard on appear and gives it
    /// back when the surface stops being the page. Focus is still real focus —
    /// this only says who should be holding it; it is not an `focused` param.
    var autoFocus: Bool

    // ── Commit ───────────────────────────────────────────────────────────
    var onSend: () -> Void
    /// Overrides the derived rule (draft non-empty · not sending · enabled) —
    /// how a surface arms Send for an attachment-only message.
    var canSend: Bool?
    /// In flight — the body locks so a late failure can't clobber new typing.
    var sending: Bool
    var disabled: Bool

    // ── Toolbar ──────────────────────────────────────────────────────────
    var attach: ScoutComposerAttach?
    /// Mic starts/stops dictation — it never commits.
    var showDictation: Bool
    /// Pending attachments ride inside the shell, above the input.
    var attachments: Binding<[ScoutComposerAttachment]>?
    var error: String?
    var notice: ScoutComposerNotice?
    /// The system QuickType strip. Off for a surface that puts its OWN row on
    /// the line above the keyboard (Home · Entry) — two suggestion bars stacked
    /// is one too many, and ours is derived from real fleet state.
    var predictions: Bool
    /// Real focus, published — for hosts that hang chrome off "the keyboard is
    /// up" (the accessory line). Focus still LIVES here; this only reports it.
    var onFocusChange: ((Bool) -> Void)?
    /// Right base-row slot, before mic/Send: the runtime readout.
    var tools: Tools

    // ── Presentation ─────────────────────────────────────────────────────
    var density: ScoutComposerDensity
    var appearance: ScoutComposerAppearance

    @Environment(HudDictation.self) private var voice
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @FocusState private var focused: Bool
    @State private var micPulse = false
    @State private var wave = [CGFloat](repeating: 0.04, count: scoutComposerWaveBars)

    init(
        text: Binding<String>,
        placeholder: String = "Type a message…",
        rows: Int = 2,
        autoFocus: Bool = false,
        onSend: @escaping () -> Void,
        canSend: Bool? = nil,
        sending: Bool = false,
        disabled: Bool = false,
        attach: ScoutComposerAttach? = nil,
        showDictation: Bool = true,
        attachments: Binding<[ScoutComposerAttachment]>? = nil,
        error: String? = nil,
        notice: ScoutComposerNotice? = nil,
        predictions: Bool = true,
        onFocusChange: ((Bool) -> Void)? = nil,
        density: ScoutComposerDensity = .panel,
        appearance: ScoutComposerAppearance = .panel,
        @ViewBuilder tools: () -> Tools
    ) {
        _text = text
        self.placeholder = placeholder
        self.rows = rows
        self.autoFocus = autoFocus
        self.onSend = onSend
        self.canSend = canSend
        self.sending = sending
        self.disabled = disabled
        self.attach = attach
        self.showDictation = showDictation
        self.attachments = attachments
        self.error = error
        self.notice = notice
        self.predictions = predictions
        self.onFocusChange = onFocusChange
        self.density = density
        self.appearance = appearance
        self.tools = tools()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            if let error {
                Text(error)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.statusError)
                    .lineLimit(2)
            }
            if let notice { noticeRow(notice) }
            shell
        }
        .padding(outerPadding)
        .onChange(of: voice.state) { _, state in updatePulse(for: state) }
        .onChange(of: voice.finalCount) { _, _ in
            let final = voice.finalText
            guard showDictation, !final.isEmpty else { return }
            text = text.isEmpty ? final : text + " " + final
        }
        // The trail is real energy, not a decorative cycle: `HudDictation`
        // publishes an instantaneous RMS and leaves the history to consumers.
        .task(id: voice.isListening) { await trackEnergy() }
        // Raise on appear, and RESIGN when the host says the surface is no
        // longer the page — an always-mounted tab that kept focus would hold
        // the keyboard up over whatever the operator switched to.
        .task(id: autoFocus) {
            guard autoFocus else {
                focused = false
                return
            }
            // Focus set in the same layout pass that installs the field is
            // dropped; one beat later it lands.
            try? await Task.sleep(for: .milliseconds(140))
            guard !Task.isCancelled else { return }
            focused = true
        }
        .onChange(of: focused) { _, isFocused in
            onFocusChange?(isFocused)
            if isFocused { retireSystemPredictions() }
        }
    }

    /// Retire the system QuickType bar for real. `autocorrectionDisabled` empties
    /// it but iOS keeps the (blank) strip on screen unless spell-checking is off
    /// too — and SwiftUI exposes no spell-checking trait — so reach the live
    /// responder once it exists and set the traits there. Only runs for a
    /// surface that has declared `predictions: false`.
    private func retireSystemPredictions() {
        guard !predictions else { return }
        Task { @MainActor in
            // One beat: the responder is installed after the focus assignment.
            try? await Task.sleep(for: .milliseconds(30))
            guard let window = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene })
                .flatMap(\.windows)
                .first(where: \.isKeyWindow),
                let responder = Self.firstResponder(in: window) as? (UIView & UITextInputTraits)
            else { return }
            guard responder.spellCheckingType != .no else { return }
            if let view = responder as? UITextView {
                view.spellCheckingType = .no
                view.autocorrectionType = .no
                view.inlinePredictionType = .no
                view.reloadInputViews()
            } else if let field = responder as? UITextField {
                field.spellCheckingType = .no
                field.autocorrectionType = .no
                field.inlinePredictionType = .no
                field.reloadInputViews()
            }
        }
    }

    private static func firstResponder(in view: UIView) -> UIView? {
        if view.isFirstResponder { return view }
        for subview in view.subviews {
            if let found = firstResponder(in: subview) { return found }
        }
        return nil
    }

    // MARK: Shell

    private var shell: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let attachments, !attachments.wrappedValue.isEmpty {
                ComposerAttachmentStrip(attachments: attachments.wrappedValue) { id in
                    attachments.wrappedValue.removeAll { $0.id == id }
                }
                .padding(.horizontal, bodyInset)
                .padding(.top, HudSpacing.lg)
            }

            if foldsInline {
                HStack(alignment: .bottom, spacing: HudSpacing.sm) {
                    field
                    controls
                }
                .padding(.leading, bodyInset)
                .padding(.trailing, HudSpacing.sm)
                .padding(.vertical, HudSpacing.sm)
            } else {
                field
                    .padding(.horizontal, bodyInset)
                    .padding(.top, fieldTopInset)
                    .padding(.bottom, fieldBottomInset)
                if voiceIsActive { voiceLine.padding(.horizontal, bodyInset) }
                baseRow
            }
        }
        .background(shellShape.fill(ScoutSurface.raised))
        .overlay(
            shellShape.stroke(
                focused ? ScoutCanvas.cardEdgeTop : ScoutHairline.standard,
                lineWidth: HudStrokeWidth.thin
            )
        )
        .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: focused)
    }

    private var shellShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: appearance == .pill ? 21 : HudRadius.card, style: .continuous)
    }

    private var field: some View {
        TextField(placeholder, text: $text, axis: .vertical)
            .textFieldStyle(.plain)
            .lineLimit(rows...maxRows)
            .font(HudFont.ui(bodySize))
            .foregroundStyle(ScoutPalette.ink)
            .tint(ScoutPalette.accent)
            .focused($focused)
            .disabled(disabled || sending)
            // `autocorrectionType = .no` is what actually retires the system
            // QuickType bar — there is no dedicated predictions trait to set.
            .autocorrectionDisabled(!predictions)
            .onSubmit(onSend)
    }

    /// `[attach ⊕] … [tools] [mic] [send ↑]` — untrayed and unfenced, so the
    /// pill stays one capsule rather than a box with a toolbar bolted under it.
    private var baseRow: some View {
        HStack(spacing: 0) {
            if let attach { attachControl(attach) }
            Spacer(minLength: HudSpacing.md)
            controls
        }
        .padding(.horizontal, baseRowInset)
        .padding(.top, HudSpacing.xxs)
        .padding(.bottom, HudSpacing.sm)
    }

    private var controls: some View {
        HStack(spacing: appearance == .pill ? HudSpacing.xs : HudSpacing.sm) {
            tools
            if showDictation { micButton }
            sendButton
        }
    }

    // MARK: Controls

    private func attachControl(_ attach: ScoutComposerAttach) -> some View {
        Menu {
            Button { attach.onPhoto() } label: { Label("Photo", systemImage: "photo") }
            Button { attach.onFile() } label: { Label("File", systemImage: "paperclip") }
        } label: {
            Image(systemName: "paperclip")
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutInk.muted)
                .frame(width: controlSide, height: controlSide)
                .background(Circle().stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin))
        }
        .disabled(disabled || sending)
        .accessibilityLabel("Add attachment")
    }

    /// On-device dictation toggle (HudsonKit `HudDictation`: Parakeet via Vox,
    /// Apple Speech fallback). Listening pulses the accent ring and unfolds the
    /// voice line; each final utterance appends to the draft.
    private var micButton: some View {
        Button { voice.toggleFromUserIntent() } label: {
            ZStack {
                if voice.isListening {
                    Circle().fill(ScoutPalette.accent.opacity(micPulse ? 0.22 : 0.08))
                }
                MicGlyph()
                    .stroke(
                        micColor,
                        style: StrokeStyle(
                            lineWidth: voice.isListening ? 1.6 : 1.2,
                            lineCap: .round,
                            lineJoin: .round
                        )
                    )
                    .frame(width: controlSide * 0.54, height: controlSide * 0.54)
                    .opacity(isMicBusy && micPulse ? 0.5 : 1)
            }
            .frame(width: controlSide, height: controlSide)
            .background(
                Circle().stroke(
                    voice.isListening ? ScoutPalette.accent.opacity(0.5) : ScoutHairline.standard,
                    lineWidth: HudStrokeWidth.thin
                )
            )
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(disabled || sending)
        .accessibilityLabel(voice.isListening ? "Stop recording" : "Start recording")
    }

    /// Armed Send is an ink disc with a background-coloured arrow — the
    /// contract's canonical armed state. Unarmed recedes into an inset well; on
    /// a `lead` composer it keeps a hairline rim and a muted arrow instead, so
    /// an empty front door still reads "this is how you send" rather than
    /// hiding the control until you have already typed.
    private var sendButton: some View {
        Button(action: onSend) {
            Glyphic.arrow(.top, size: controlSide * 0.5)
                .foregroundStyle(armed ? ScoutPalette.bg : (sendRestsVisible ? ScoutInk.muted : ScoutInk.dim))
                .frame(width: controlSide, height: controlSide)
                .background(Circle().fill(armed ? ScoutPalette.ink : ScoutSurface.inset))
                .overlay {
                    if !armed, sendRestsVisible {
                        Circle().stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin)
                    }
                }
        }
        .buttonStyle(.plain)
        .disabled(!armed)
        .accessibilityLabel("Send message")
    }

    // MARK: Annotations

    private func noticeRow(_ notice: ScoutComposerNotice) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(notice.text)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.accent)
                .lineLimit(3)
            Spacer(minLength: HudSpacing.sm)
            if let label = notice.actionLabel, let action = notice.action {
                Button(label, action: action)
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
                    .buttonStyle(.plain)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// Live energy + the partial transcript. Present only while the mic is
    /// actually hot or the transcript is settling.
    private var voiceLine: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            ScoutDictationWave(samples: wave, live: voice.isListening)
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
                Text(voice.isListening ? "LISTENING" : "TRANSCRIBING")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(voice.isListening ? ScoutPalette.accent : ScoutInk.muted)
                Text(voice.isListening ? voice.partialText : "Finalizing transcript…")
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.head)
                Spacer(minLength: 0)
            }
        }
        .padding(.top, HudSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(voice.isListening ? "Listening" : "Transcribing")
    }

    // MARK: Derived

    private var armed: Bool {
        canSend ?? (!text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending && !disabled)
    }

    private var hasTools: Bool { Tools.self != EmptyView.self }

    /// The pill's fold: with nothing to put on a base row, mic and Send sit
    /// beside the input and the composer is one ~44pt line. Dictation unfolds
    /// it again — the waveform needs the full width.
    private var foldsInline: Bool {
        appearance == .pill && attach == nil && !hasTools && !voiceIsActive
    }

    private var voiceIsActive: Bool {
        guard showDictation else { return false }
        switch voice.state {
        case .listening, .transcribing: return true
        case .idle, .preparing, .unavailable: return false
        }
    }

    private var isMicBusy: Bool {
        switch voice.state {
        case .transcribing, .preparing: return true
        case .idle, .listening, .unavailable: return false
        }
    }

    private var micColor: Color {
        switch voice.state {
        case .listening:                return ScoutPalette.accent
        case .transcribing, .preparing: return ScoutInk.muted
        case .unavailable:              return ScoutInk.dim.opacity(0.5)
        case .idle:                     return ScoutInk.muted
        }
    }

    private var controlSide: CGFloat { appearance == .pill ? 28 : 32 }
    private var bodyInset: CGFloat { appearance == .pill ? HudSpacing.xxl : HudSpacing.xl }

    private var bodySize: CGFloat {
        switch density {
        case .compact:        return HudTextSize.base
        case .panel, .thread: return HudTextSize.lgm
        case .lead:           return HudTextSize.lg
        }
    }

    private var maxRows: Int { density == .compact ? 4 : 6 }

    /// The draft line's own air. `lead` gives it a full breath top and bottom so
    /// it reads as a distinct line rather than the roof of the base row.
    private var fieldTopInset: CGFloat { density == .lead ? HudSpacing.xxl : HudSpacing.md }
    private var fieldBottomInset: CGFloat { density == .lead ? HudSpacing.sm : 0 }

    /// `lead` runs the base row on the SAME rail as the draft line, so attach,
    /// the input text and whatever the host docks underneath all start on one
    /// x. Other densities keep the tighter historical inset.
    private var baseRowInset: CGFloat { density == .lead ? bodyInset : HudSpacing.md }

    private var sendRestsVisible: Bool { density == .lead }

    private var outerPadding: EdgeInsets {
        switch density {
        case .panel, .lead: return EdgeInsets()
        case .thread:  return EdgeInsets(top: 0, leading: HudSpacing.lg, bottom: HudSpacing.sm, trailing: HudSpacing.lg)
        case .compact: return EdgeInsets(top: HudSpacing.md, leading: HudSpacing.md, bottom: HudSpacing.md, trailing: HudSpacing.md)
        }
    }

    // MARK: Dictation

    private func updatePulse(for state: HudDictation.State) {
        micPulse = false
        // Pulse ONLY while actively recording. Preparing/transcribing must not
        // mimic a hot mic — they read through the voice line and a static muted
        // glyph, so a backgrounded model download never looks live.
        guard case .listening = state, !reduceMotion, !ProcessInfo.processInfo.isLowPowerModeEnabled else { return }
        withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) { micPulse = true }
    }

    private func trackEnergy() async {
        guard voice.isListening else {
            // Decay the trail rather than snapping it flat — the tail of an
            // utterance is information too. An already-quiet trail (the common
            // case: the surface just appeared) does no work at all.
            guard wave.contains(where: { $0 > 0.05 }) else { return }
            for _ in 0..<12 {
                if Task.isCancelled { return }
                wave = wave.map { max(0.04, $0 * 0.82) }
                try? await Task.sleep(for: .milliseconds(45))
            }
            return
        }
        while !Task.isCancelled && voice.isListening {
            wave.removeFirst()
            wave.append(max(0.04, min(1, CGFloat(voice.audioLevel))))
            try? await Task.sleep(for: .milliseconds(40))
        }
    }
}

extension ScoutMessageComposer where Tools == EmptyView {
    /// The no-tools composer — the same contract with an empty right slot.
    init(
        text: Binding<String>,
        placeholder: String = "Type a message…",
        rows: Int = 2,
        autoFocus: Bool = false,
        onSend: @escaping () -> Void,
        canSend: Bool? = nil,
        sending: Bool = false,
        disabled: Bool = false,
        attach: ScoutComposerAttach? = nil,
        showDictation: Bool = true,
        attachments: Binding<[ScoutComposerAttachment]>? = nil,
        error: String? = nil,
        notice: ScoutComposerNotice? = nil,
        predictions: Bool = true,
        onFocusChange: ((Bool) -> Void)? = nil,
        density: ScoutComposerDensity = .panel,
        appearance: ScoutComposerAppearance = .panel
    ) {
        self.init(
            text: text,
            placeholder: placeholder,
            rows: rows,
            autoFocus: autoFocus,
            onSend: onSend,
            canSend: canSend,
            sending: sending,
            disabled: disabled,
            attach: attach,
            showDictation: showDictation,
            attachments: attachments,
            error: error,
            notice: notice,
            predictions: predictions,
            onFocusChange: onFocusChange,
            density: density,
            appearance: appearance,
            tools: { EmptyView() }
        )
    }
}

/// The dictation trail. Bars are a rolling window of real RMS samples, so the
/// shape is representative of what is being said rather than a CSS-style loop.
private struct ScoutDictationWave: View {
    let samples: [CGFloat]
    let live: Bool

    private let side: CGFloat = 20

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(Array(samples.enumerated()), id: \.offset) { _, sample in
                Capsule()
                    .fill(live ? ScoutPalette.accent : ScoutInk.dim)
                    .frame(width: 2.5, height: max(2, side * sample))
                    .opacity(live ? 0.4 + Double(sample) * 0.55 : 0.28)
                    // Each bar takes an equal share of the width and stays
                    // hairline-thin inside it, so the trail spans the composer
                    // whatever it is docked in.
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: side)
        .accessibilityHidden(true)
    }
}

// MARK: - Runtime readout

/// The runtime a conversation runs on — harness · model — as ONE chip, the
/// resting shape of the studio's RuntimePicker (design/studio/components/
/// RuntimePicker.tsx): the harness is a MARK, not a word, because once the mark
/// is sitting there writing "claude" beside it is redundant.
///
/// On a LIVE conversation it renders as IDENTITY rather than a switcher, and it
/// carries no effort segment, because neither is a real operation there:
/// `ControlCapability` has no verb that re-points a running session's runtime.
/// On a CREATION composer it is a real choice — `SessionInitiationSpec
/// .Execution` carries harness · model · reasoningEffort — so a host that can
/// honour a pick passes `onPick` and the chip becomes the picker's trigger
/// (chevron and all). Nothing renders at all when the session names neither a
/// recognisable harness nor a model.
struct ScoutRuntimeChip: View {
    let harness: String?
    let model: String?
    /// Reasoning effort — the third of the triplet. Shown only where it is a
    /// real creation-time choice (`SessionInitiationSpec.Execution
    /// .reasoningEffort`); a live conversation leaves it nil because nothing
    /// can change it there.
    var effort: String? = nil
    /// The panel is open on this chip. The chip does NOT go away while it is —
    /// the panel grows out of it and it stays as the live readout — so it takes
    /// an active state instead: a rimmed seat and a flipped chevron.
    var isPicking: Bool = false
    /// Non-nil only where the pick genuinely takes effect (see above).
    var onPick: (() -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if identifies {
            if let onPick {
                Button(action: onPick) { chip }
                    .buttonStyle(.plain)
                    // Publish the chip's bounds so the panel can grow out of
                    // exactly this rectangle, wherever the composer has laid it
                    // out (keyboard up or down, any density).
                    .scoutRuntimeAnchor()
                    .accessibilityLabel("Runtime: \(readout). Change")
                    .accessibilityAddTraits(isPicking ? .isSelected : [])
            } else {
                chip
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("Runtime: \(readout)")
            }
        }
    }

    /// A capsule at rest, squaring toward the panel's corner radius while the
    /// panel is up. 12 IS the capsule on a 24pt-tall chip, so this is a real
    /// capsule at rest and an interpolable radius on the way to the key.
    private var chipShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: isPicking ? 9 : 12, style: .continuous)
    }

    /// Hugs its content — no minimum, no stretch. The whole point of the chip
    /// is that the toolbar spends its width on the message, not on config.
    private var chip: some View {
        HStack(spacing: HudSpacing.sm) {
            HarnessMark(harness: harness, size: 13)
                .foregroundStyle(ScoutInk.muted)
            if let label = modelLabel { modelText(label) }
            if let effortLabel {
                // A hairline rule, not a middot — the studio RuntimePicker
                // trigger's divider (`h-2.5 w-px`), which separates the two
                // runs without adding a third piece of punctuation.
                Rectangle()
                    .fill(ScoutHairline.standard)
                    .frame(width: HudStrokeWidth.thin, height: 10)
                Text(effortLabel.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.6)
                    .foregroundStyle(ScoutInk.dim)
                    .fixedSize()
            }
            if onPick != nil {
                Glyphic.chevron(.bottom, size: 9)
                    .foregroundStyle(isPicking ? ScoutPalette.accent : ScoutInk.dim)
                    // Points at the panel while the panel is up: the caret is
                    // the one part of the chip that says which way this opens.
                    .rotationEffect(.degrees(isPicking ? 180 : 0))
            }
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: 24)
        // Opening changes the chip's MATERIAL and its SHAPE, not its size.
        //
        // A few points of extra width is the one reaction a toolbar control
        // cannot afford: at that scale the eye reads it as the row failing to
        // hold still, not as a state. So the chip does something a resize can't
        // be mistaken for — it stops being a soft pill lying on the composer
        // and becomes a machined key cut from the panel's own graphite: the
        // capsule squares toward the panel's corner radius, the fill crossfades
        // to the plate the panel is made of, and it lifts on a contact shadow.
        // That is the connection the operator is meant to see, and it is not a
        // change any amount of width could have said.
        //
        // Every layer shares one `chipShape`, so the radius interpolates rather
        // than cutting between two different rectangles.
        .background {
            ZStack {
                // At rest: a step LIGHTER than the shell — the chip lifts off
                // the capsule, where the unarmed Send recesses into it.
                chipShape.fill(ScoutSurface.card)
                ScoutMachinedPlate(shape: chipShape, rimBoost: 0.1, lightReach: 26, grainOpacity: 0.05)
                    .opacity(isPicking ? 1 : 0)
            }
            .shadow(color: .black.opacity(isPicking ? 0.45 : 0), radius: 4, y: 1.5)
        }
        // One rationed hairline of accent ties the key to the panel above it.
        .overlay(
            chipShape.stroke(
                ScoutPalette.accent.opacity(isPicking ? 0.55 : 0),
                lineWidth: HudStrokeWidth.thin
            )
        )
        .contentShape(chipShape)
        // The SAME spring the panel grows on, so the chip seating itself and
        // the panel rising off it read as one gesture, not two things that
        // happened at once.
        .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.grow), value: isPicking)
    }

    @ViewBuilder
    private func modelText(_ label: String) -> some View {
        let base = Text(label)
            .font(HudFont.mono(HudTextSize.xs, weight: .medium))
            .foregroundStyle(ScoutInk.muted)
            .lineLimit(1)
            .truncationMode(.tail)
        if onPick == nil {
            // A live session can report ANY `--model` string, so cap it before
            // it pushes the composer's controls off the row.
            base.frame(maxWidth: 104, alignment: .leading)
        } else {
            // The picker's own catalog names are short and known — hug them.
            base.fixedSize()
        }
    }

    private var effortLabel: String? {
        guard let raw = effort?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        return raw
    }

    private var readout: String {
        [harness ?? "unknown", modelLabel, effortLabel].compactMap { $0 }.joined(separator: ", ")
    }

    private var identifies: Bool {
        HarnessMark.identifies(harness) || modelLabel != nil
    }

    /// The curated family name ("Opus 5") when the raw `--model` value is one we
    /// ship, otherwise the value verbatim — never an invented pretty name.
    private var modelLabel: String? {
        guard let raw = model?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        for entry in ComposerModelHarness.catalog {
            if let family = entry.families.first(where: { $0.value == raw }) {
                return family.displayName
            }
        }
        return raw
    }
}

#if DEBUG
/// The two shapes the contract folds to: the bare ask pill (no attach, no
/// tools — controls beside the input on one line) and the conversation dock
/// (attach anchoring a base row, the runtime chip in the tools slot, a
/// recovered-draft notice above).
private struct ScoutComposerPreview: View {
    @State private var resting = ""
    @State private var draft = "rerun the failing case with the fixture"
    @State private var attachments: [ScoutComposerAttachment] = []
    @State private var voice = HudDictation()

    var body: some View {
        ZStack {
            ScoutPalette.bg.ignoresSafeArea()
            VStack(spacing: HudSpacing.huge) {
                ScoutMessageComposer(
                    text: $resting,
                    placeholder: "Ask the fleet…",
                    rows: 1,
                    onSend: {},
                    appearance: .pill
                )
                ScoutMessageComposer(
                    text: $draft,
                    placeholder: "Steer the agent…",
                    rows: 1,
                    onSend: {},
                    attach: ScoutComposerAttach(onPhoto: {}, onFile: {}),
                    attachments: $attachments,
                    notice: ScoutComposerNotice(
                        "Recovered an unsent message.",
                        actionLabel: "Retry",
                        action: {}
                    ),
                    density: .thread,
                    appearance: .pill
                ) {
                    ScoutRuntimeChip(harness: "claude", model: "claude-opus-5")
                }
            }
            .padding(HudSpacing.xxl)
        }
        .environment(voice)
    }
}

#Preview("Composer · pill") { ScoutComposerPreview() }
#endif

/// Compact cockpit mic glyph — a hand-drawn capsule body, pickup arc, and
/// stand, stroked so it can pick up the composer's recording/idle tint.
struct MicGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 14.0
        let sy = rect.height / 14.0
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }
        var path = Path()
        let body = CGRect(x: rect.minX + 5 * sx, y: rect.minY + 2 * sy, width: 4 * sx, height: 6.5 * sy)
        let radius = 2 * min(sx, sy)
        path.addRoundedRect(in: body, cornerSize: CGSize(width: radius, height: radius))
        path.move(to: p(4, 8.5))
        path.addQuadCurve(to: p(10, 8.5), control: p(7, 13.5))
        path.move(to: p(7, 11))
        path.addLine(to: p(7, 12.7))
        path.move(to: p(5, 12.7))
        path.addLine(to: p(9, 12.7))
        return path
    }
}
