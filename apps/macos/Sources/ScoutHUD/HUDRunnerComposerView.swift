import AppKit
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

struct HUDRunnerComposer: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    @ObservedObject private var voice = HudVoiceService.shared
    let focus: HUDRunnerFocusBinding
    let dropTargeted: Bool

    var body: some View {
        VStack(spacing: 0) {
            editor
                .frame(height: HUDRunnerLayout.editorHeight)

            if !runner.attachments.isEmpty || !runner.localReferences.isEmpty {
                captureStrip
                    .padding(.horizontal, 10)
                    .frame(height: HUDRunnerLayout.captureStripHeight)
                    .background(HUDChrome.canvasLift.opacity(0.10))
            }

            toolbar
                .frame(height: HUDRunnerLayout.toolbarHeight)
                .padding(.horizontal, 10)
        }
        .background(HUDChrome.composerField)
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(
                    dropTargeted
                        ? HUDChrome.composerAction
                        : HUDChrome.composerBorder,
                    lineWidth: dropTargeted ? 1.5 : 1
                )
        )
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if runner.instructions.isEmpty {
                Text("Describe the task — what should the agent build, fix, or investigate?")
                    .font(HUDType.body(14))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }

            TextField("", text: $runner.instructions, axis: .vertical)
                .textFieldStyle(.plain)
                .font(HUDType.body(14))
                .foregroundStyle(HUDChrome.ink)
                .tint(HUDChrome.composerAction)
                .lineSpacing(3)
                .lineLimit(1...3)
                .focused(focus, equals: .instructions)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .accessibilityLabel("Task instructions")
        }
    }

    private var toolbar: some View {
        HStack(spacing: 8) {
            Button(action: runner.browseForAttachments) {
                Image(systemName: "plus")
                    .font(.system(size: 15, weight: .medium))
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(
                HUDRunnerCircleButtonStyle(
                    isActive: false,
                    isFocused: focus.wrappedValue == .attach
                )
            )
            .focused(focus, equals: .attach)
            .help("Add files or folders (⌘O)")
            .accessibilityLabel("Attach files or folders")

            if voice.state.isCaptureActive || voice.state.isProcessing || runner.isPreparingVoice {
                voiceActivity
                Spacer(minLength: 0)
            } else {
                voiceButton(size: 40)
                Spacer(minLength: 8)
            }

            runtimeButton

            Button(action: runner.beginSubmit) {
                Group {
                    if runner.isSubmitting {
                        ProgressView()
                            .controlSize(.small)
                            .tint(HUDChrome.canvas)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.system(size: 16, weight: .bold))
                    }
                }
                .frame(width: 44, height: 44)
            }
            .buttonStyle(
                HUDRunnerSendButtonStyle(
                    isFocused: focus.wrappedValue == .create
                )
            )
            .disabled(submitDisabled)
            .keyboardShortcut(.return, modifiers: .command)
            .focused(focus, equals: .create)
            .help(
                submitDisabled
                    ? "Add instructions or wait for the current action"
                    : "Create task (⌘Return)"
            )
            .accessibilityLabel(runner.isSubmitting ? "Creating task" : "Create task")
        }
        .animation(.easeInOut(duration: 0.18), value: voice.state.isCaptureActive)
        .animation(.easeInOut(duration: 0.18), value: voice.state.isProcessing)
    }

    private func voiceButton(size: CGFloat) -> some View {
        Button {
            Task { await runner.toggleDictation() }
        } label: {
            Image(systemName: voiceSymbol)
                .font(.system(size: 13, weight: .semibold))
                .frame(width: size, height: size)
        }
        .buttonStyle(
            HUDRunnerCircleButtonStyle(
                isActive: voice.state.isCaptureActive,
                isFocused: focus.wrappedValue == .voice
            )
        )
        .disabled(
            runner.isPreparingVoice
                || voice.state == .probing
                || voice.state.isProcessing
        )
        .focused(focus, equals: .voice)
        .help(voiceHelp)
        .accessibilityLabel(voiceLabel)
    }

    private var runtimeButton: some View {
        let presentation = HUDRunnerRuntimeFormatter.presentation(
            runner.currentRuntimePreset,
            runner: runner
        )
        let label = HUDRunnerRuntimeFormatter.composerLabel(
            runner.currentRuntimePreset,
            runner: runner
        )
        return Button(action: runner.toggleRuntimePicker) {
            HStack(spacing: 6) {
                Text(label)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 7, weight: .bold))
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            .font(HUDType.body(10, weight: .medium))
            .foregroundStyle(HUDChrome.inkMuted)
            .padding(.horizontal, 8)
            .frame(height: 40)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(
                        focus.wrappedValue == .runtimeSummary
                            ? HUDChrome.composerFieldLift.opacity(0.58)
                            : .clear
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(
                        focus.wrappedValue == .runtimeSummary
                            ? HUDChrome.composerBorderStrong
                            : .clear,
                        lineWidth: 1
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .focused(focus, equals: .runtimeSummary)
        .help("Choose model and runtime (⌘R)")
        .accessibilityLabel("Runtime: \(presentation.title), \(presentation.detail)")
        .popover(
            isPresented: Binding(
                get: { runner.isRuntimePickerPresented },
                set: { presented in
                    if !presented, runner.isRuntimePickerPresented {
                        runner.closeRuntimePicker()
                    }
                }
            ),
            arrowEdge: .top
        ) {
            HUDRunnerRuntimePicker(focus: focus)
                .preferredColorScheme(.dark)
        }
    }

    @ViewBuilder
    private var voiceActivity: some View {
        HStack(spacing: 7) {
            voiceButton(size: 32)
            if voice.state.isProcessing || runner.isPreparingVoice {
                ProgressView()
                    .controlSize(.small)
                    .tint(HUDChrome.composerAction)
                Text("Transcribing…")
                    .font(HUDType.mono(9, weight: .medium))
                    .foregroundStyle(HUDChrome.inkFaint)
                Spacer(minLength: 0)
            } else {
                HUDRunnerVoiceWaveform()
            }
        }
        .padding(.horizontal, 4)
        .frame(
            minWidth: 160,
            idealWidth: 250,
            maxWidth: 280,
            minHeight: 40,
            maxHeight: 40
        )
        .background(Capsule().fill(HUDChrome.composerActionWhisper))
        .overlay(
            Capsule()
                .stroke(HUDChrome.composerAction.opacity(0.58), lineWidth: 0.8)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(voice.state.isProcessing ? "Transcribing voice" : "Recording voice")
        .transition(.opacity.combined(with: .scale(scale: 0.92, anchor: .leading)))
    }

    private var captureStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                ForEach(runner.attachments) { attachment in
                    HUDRunnerAttachmentChip(
                        attachment: attachment,
                        focus: focus,
                        onRemove: { runner.removeAttachment(attachment.id) }
                    )
                }
                ForEach(runner.localReferences) { reference in
                    HUDRunnerReferenceChip(
                        reference: reference,
                        focus: focus,
                        onRemove: { runner.removeLocalReference(reference.id) }
                    )
                }
            }
            .padding(.vertical, 4)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var submitDisabled: Bool {
        !runner.hasTaskContent
            || runner.isSubmitting
            || runner.isPreparingVoice
            || voice.state.isCaptureActive
            || voice.state.isProcessing
            || runner.isStagingFiles
    }

    private var voiceLabel: String {
        if runner.isPreparingVoice { return "Preparing voice dictation" }
        switch voice.state {
        case .starting, .recording: return "Stop voice dictation"
        case .probing: return "Preparing voice dictation"
        case .processing: return "Transcribing voice"
        case .idle: return "Start voice dictation"
        case .unavailable: return "Voice dictation unavailable"
        }
    }

    private var voiceSymbol: String {
        if runner.isPreparingVoice { return "waveform" }
        switch voice.state {
        case .starting, .recording: return "mic.fill"
        case .probing, .processing: return "waveform"
        case .unavailable: return "mic.badge.xmark"
        case .idle: return "mic.fill"
        }
    }

    private var voiceHelp: String {
        if runner.isPreparingVoice { return "Preparing voice dictation" }
        if case .unavailable(let reason) = voice.state { return reason }
        if voice.state.isCaptureActive { return "Stop voice dictation" }
        if voice.state.isProcessing { return "Transcribing voice" }
        return "Start voice dictation"
    }
}

private struct HUDRunnerVoiceWaveform: View {
    @State private var animate = false

    private let low: [CGFloat] = [3, 5, 7, 4, 9, 5, 11, 6, 8, 4, 7, 3, 6, 9, 5, 8, 4]
    private let high: [CGFloat] = [8, 13, 18, 10, 20, 12, 22, 15, 19, 9, 16, 8, 14, 21, 11, 17, 10]

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(low.indices, id: \.self) { index in
                Capsule(style: .continuous)
                    .fill(HUDChrome.composerAction.opacity(0.90))
                    .frame(
                        width: 1.5,
                        height: animate ? high[index] : low[index]
                    )
                    .animation(
                        .easeInOut(duration: 0.42 + Double(index % 5) * 0.08)
                            .repeatForever(autoreverses: true),
                        value: animate
                    )
            }
        }
        .frame(maxWidth: .infinity, minHeight: 24)
        .overlay {
            Rectangle()
                .fill(HUDChrome.composerAction.opacity(0.42))
                .frame(height: 0.75)
                .zIndex(-1)
        }
        .onAppear { animate = true }
        .accessibilityHidden(true)
    }
}

struct HUDRunnerDropOverlay: View {
    let isImporting: Bool

    var body: some View {
        VStack(spacing: 9) {
            Image(systemName: "arrow.down.doc.fill")
                .font(.system(size: 28, weight: .semibold))
            Text(isImporting ? "IMPORTING…" : "DROP INTO TASK")
                .font(HUDType.mono(12, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
            Text(
                isImporting
                    ? "Receiving promised originals"
                    : "Files · folders · images · links · text"
            )
            .font(HUDType.mono(9))
        }
        .foregroundStyle(HUDChrome.accent)
        .padding(.horizontal, 30)
        .padding(.vertical, 24)
        .background(HUDChrome.canvas.opacity(0.97))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(HUDChrome.accent.opacity(0.72), lineWidth: 1.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct HUDRunnerAttachmentChip: View {
    let attachment: ScoutComposerImage
    let focus: FocusState<HUDRunnerFocusTarget?>.Binding
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
            .frame(width: 28, height: 28)
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
        .frame(width: 164, height: 36)
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
        .buttonStyle(
            HUDRunnerIconButtonStyle(
                isFocused: focus.wrappedValue == .attachment(attachment.id)
            )
        )
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
    let focus: FocusState<HUDRunnerFocusTarget?>.Binding
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: isDirectory ? "folder.fill" : "doc.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(HUDChrome.inkMuted)
                .frame(width: 28, height: 28)
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
            .buttonStyle(
                HUDRunnerIconButtonStyle(
                    isFocused: focus.wrappedValue == .reference(reference.id)
                )
            )
            .help("Remove \(reference.displayName)")
            .accessibilityLabel("Remove \(reference.displayName)")
            .focused(focus, equals: .reference(reference.id))
        }
        .padding(.horizontal, 7)
        .frame(width: 164, height: 36)
        .background(HUDChrome.canvasLift.opacity(0.34))
        .overlay(Rectangle().stroke(HUDChrome.borderSoft, lineWidth: 0.75))
        .help(reference.url.path)
    }

    private var isDirectory: Bool {
        (try? reference.url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true
    }
}
