import HudsonUI
import ScoutAppCore
import SwiftUI
#if os(macOS)
import AppKit
#endif

/// Full-window drag overlay — appears when files cross the app chrome so drops
/// read as intentional capture, not an accident on a list row.
struct ScoutWindowCaptureOverlay: View {
    var body: some View {
        ZStack {
            ScoutPalette.accent.opacity(0.08)
                .background(.ultraThinMaterial)
                .ignoresSafeArea()

            VStack(spacing: HudSpacing.lg) {
                Image(systemName: "arrow.down.doc.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
                Text("Drop to attach")
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text("Markdown · code · images · clips")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.muted)
            }
            .padding(HudSpacing.huge)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .fill(ScoutSurface.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(ScoutPalette.accent.opacity(0.55), lineWidth: HudStrokeWidth.standard)
            )
            .shadow(color: ScoutSurface.shadow(0.18), radius: 18, y: 8)
        }
        .allowsHitTesting(false)
        .transition(.opacity)
    }
}

/// Comms empty state — a capture-first surface instead of a dead composer.
struct ScoutQuickChatSurface: View {
    let recentChannels: [ScoutChannel]
    let stagedAttachments: [ScoutComposerImage]
    let dropHint: String?
    let onNewChat: () -> Void
    let onSelectChannel: (ScoutChannel) -> Void
    let onStageAttachments: ([ScoutComposerImage]) -> Bool
    let onBrowse: () -> Void
    let onRemoveAttachment: (ScoutComposerImage) -> Void

    @State private var dropTargeted = false

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: HudSpacing.xxl)

            ScoutCaptureDropZone(
                isTargeted: dropTargeted,
                stagedCount: stagedAttachments.count,
                dropHint: dropHint,
                onBrowse: onBrowse,
                onStageAttachments: onStageAttachments,
                onTargeted: { dropTargeted = $0 }
            )
            .frame(maxWidth: 520)
            .padding(.horizontal, HudSpacing.huge)

            if !stagedAttachments.isEmpty {
                stagedStrip
                    .padding(.top, HudSpacing.xl)
            }

            quickActions
                .padding(.top, HudSpacing.xxl)

            if !recentChannels.isEmpty {
                recentChats
                    .padding(.top, HudSpacing.xxl)
            }

            Spacer(minLength: HudSpacing.huge)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutDesign.bg)
    }

    private var stagedStrip: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HudSectionLabel("Staged")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.sm) {
                    ForEach(stagedAttachments) { attachment in
                        ScoutCaptureAttachmentChip(attachment: attachment) {
                            onRemoveAttachment(attachment)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: 520, alignment: .leading)
        .padding(.horizontal, HudSpacing.huge)
    }

    private var quickActions: some View {
        HStack(spacing: HudSpacing.md) {
            Button(action: onNewChat) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: "square.and.pencil")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    Text("New chat")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                }
                .foregroundStyle(ScoutPalette.bg)
                .padding(.horizontal, HudSpacing.xl)
                .frame(height: 34)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(ScoutPalette.accent)
                )
            }
            .buttonStyle(.plain)
            .scoutPointerCursor()
            .help("Start a new agent chat")

            Button(action: onBrowse) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: "folder")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    Text("Browse…")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                }
                .foregroundStyle(ScoutPalette.muted)
                .padding(.horizontal, HudSpacing.lg)
                .frame(height: 34)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(ScoutSurface.control)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
                )
            }
            .buttonStyle(.plain)
            .scoutPointerCursor()
        }
    }

    private var recentChats: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HudSectionLabel("Recent")
            VStack(spacing: HudSpacing.xs) {
                ForEach(recentChannels) { channel in
                    Button {
                        onSelectChannel(channel)
                    } label: {
                        HStack(spacing: HudSpacing.md) {
                            Image(systemName: channel.scope == .shared ? "number" : "bubble.left")
                                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                                .foregroundStyle(ScoutPalette.dim)
                                .frame(width: 16)
                            Text(channel.displayHandle)
                                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                                .foregroundStyle(ScoutPalette.ink)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            if !channel.ageLabel.isEmpty {
                                Text(channel.ageLabel)
                                    .font(HudFont.mono(HudTextSize.micro))
                                    .foregroundStyle(ScoutPalette.dim)
                            }
                        }
                        .padding(.horizontal, HudSpacing.lg)
                        .frame(height: 34)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .fill(ScoutSurface.control)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
                        )
                    }
                    .buttonStyle(.plain)
                    .scoutPointerCursor()
                }
            }
            .frame(maxWidth: 420)
        }
        .padding(.horizontal, HudSpacing.huge)
    }
}

private struct ScoutCaptureDropZone: View {
    let isTargeted: Bool
    let stagedCount: Int
    let dropHint: String?
    let onBrowse: () -> Void
    let onStageAttachments: ([ScoutComposerImage]) -> Bool
    let onTargeted: (Bool) -> Void

    var body: some View {
        VStack(spacing: HudSpacing.lg) {
            Image(systemName: isTargeted ? "arrow.down.circle.fill" : "photo.on.rectangle.angled")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(isTargeted ? ScoutPalette.accent : ScoutPalette.dim)
                .symbolEffect(.bounce, value: isTargeted)

            VStack(spacing: HudSpacing.xs) {
                Text(isTargeted ? "Release to stage" : "Drop markdown, code, images, or clips")
                    .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text("Drag source files, screenshots, recordings, or pick from disk")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.muted)
                    .multilineTextAlignment(.center)
            }

            if let dropHint {
                Text(dropHint)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutPalette.statusWarn)
                    .multilineTextAlignment(.center)
            } else if stagedCount > 0 {
                Text("\(stagedCount) staged · pick a chat or start new")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, HudSpacing.huge)
        .padding(.horizontal, HudSpacing.xxl)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(isTargeted ? ScoutPalette.accentSoft.opacity(0.55) : ScoutSurface.control)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .strokeBorder(
                    isTargeted ? ScoutPalette.accent.opacity(0.72) : ScoutDesign.hairlineStrong,
                    style: StrokeStyle(lineWidth: isTargeted ? 1.5 : 1, dash: isTargeted ? [] : [7, 5])
                )
        )
        .background {
            ScoutAttachmentDropCatcher(
                onTargeted: onTargeted,
                onStageAttachments: onStageAttachments
            )
        }
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .animation(.easeOut(duration: 0.14), value: isTargeted)
        .onTapGesture(perform: onBrowse)
    }
}

struct ScoutCaptureAttachmentChip: View {
    let attachment: ScoutComposerImage
    let onRemove: () -> Void

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if attachment.isImage, let nsImage = NSImage(data: attachment.data) {
                    Image(nsImage: nsImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    VStack(spacing: HudSpacing.xs) {
                        Image(systemName: attachmentSymbol(for: attachment))
                            .font(.system(size: HudTextSize.lg, weight: .semibold))
                            .foregroundStyle(ScoutPalette.muted)
                        Text(attachment.fileName)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutPalette.dim)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 72)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(ScoutSurface.inset)
                }
            }
            .frame(width: 72, height: 72)
            .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: HudTextSize.md))
                    .foregroundStyle(.white, .black.opacity(0.55))
            }
            .buttonStyle(.plain)
            .scoutPointerCursor()
            .offset(x: 5, y: -5)
        }
    }
}

private func attachmentSymbol(for attachment: ScoutComposerImage) -> String {
    if attachment.isVideo { return "film" }
    if attachment.isMarkdown { return "doc.richtext" }
    if attachment.isCode { return "chevron.left.forwardslash.chevron.right" }
    return "doc"
}
