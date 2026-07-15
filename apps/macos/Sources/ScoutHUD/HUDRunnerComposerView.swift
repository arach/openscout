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
        .background(HUDChrome.canvasAlt.opacity(0.52))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(
                    dropTargeted
                        ? HUDChrome.accent
                        : (focus.wrappedValue == .instructions
                            ? HUDChrome.borderStrong
                            : HUDChrome.borderSoft),
                    lineWidth: dropTargeted ? 1.5 : 1
                )
        )
        .shadow(
            color: focus.wrappedValue == .instructions
                ? HUDChrome.ink.opacity(0.055)
                : .clear,
            radius: 3
        )
    }

    private var editor: some View {
        TextField(
            "",
            text: $runner.instructions,
            prompt: Text("Describe the task — what should the agent build, fix, or investigate?")
                .foregroundStyle(HUDChrome.inkFaint),
            axis: .vertical
        )
        .textFieldStyle(.plain)
        .font(HUDType.body(15))
        .foregroundStyle(HUDChrome.ink)
        .tint(HUDChrome.accent)
        .lineSpacing(3)
        .lineLimit(1...3)
        .focused(focus, equals: .instructions)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityLabel("Task instructions")
    }

    private var toolbar: some View {
        HStack(spacing: 8) {
            Button(action: runner.browseForAttachments) {
                Image(systemName: "plus")
                    .font(.system(size: 15, weight: .medium))
                    .frame(width: 38, height: 38)
            }
            .buttonStyle(
                HUDRunnerToolbarButtonStyle(
                    isActive: false,
                    isFocused: focus.wrappedValue == .attach,
                    cornerRadius: 10
                )
            )
            .focused(focus, equals: .attach)
            .help("Add files or folders (⌘O)")
            .accessibilityLabel("Attach files or folders")

            HUDRunnerInlineStatus()

            Spacer(minLength: 8)

            Button {
                Task { await runner.toggleDictation() }
            } label: {
                Image(systemName: voiceSymbol)
                    .font(.system(size: 14, weight: .semibold))
                    .frame(width: 38, height: 38)
            }
            .buttonStyle(
                HUDRunnerToolbarButtonStyle(
                    isActive: voice.state.isCaptureActive,
                    isFocused: focus.wrappedValue == .voice,
                    cornerRadius: 10
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
                .frame(width: 40, height: 40)
            }
            .buttonStyle(
                HUDRunnerSendButtonStyle(
                    isFocused: focus.wrappedValue == .create,
                    cornerRadius: 11
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
        case .starting, .recording: return "stop.fill"
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

private struct HUDRunnerInlineStatus: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    @ObservedObject private var voice = HudVoiceService.shared

    var body: some View {
        if let status = activeStatus {
            HStack(spacing: 6) {
                Image(systemName: status.symbol)
                    .font(.system(size: 9, weight: .semibold))
                Text(status.text)
                    .font(status.isError ? HUDType.body(11) : HUDType.mono(10))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .foregroundStyle(status.isError ? HUDChrome.inkMuted : HUDChrome.inkFaint)
            .frame(maxWidth: 270, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(status.text)
        }
    }

    private var activeStatus: (
        symbol: String,
        text: String,
        isError: Bool
    )? {
        if let error = runner.lastError {
            return ("exclamationmark.triangle", error, true)
        }
        if runner.isStagingFiles {
            return ("arrow.down.doc", "Staging dropped files…", false)
        }
        if runner.isPreparingVoice {
            return ("waveform", "Preparing voice dictation…", false)
        }
        if runner.isLoading {
            return ("arrow.triangle.2.circlepath", "Loading runner inputs…", false)
        }
        if voice.state == .processing {
            return ("waveform", "Transcribing voice…", false)
        }
        return nil
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
