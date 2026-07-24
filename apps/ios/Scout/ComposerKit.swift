// ComposerKit — the shared composer primitives used by every "write something
// to an agent" surface (share composer, New/+, …). One philosophy everywhere:
//
//   TO     a recipient field — type to search any known agent or declare a
//          handle free-form; a horizontal strip of recent actives sits under
//          it for one-tap picks.
//   BODY   the message/prompt, with attachments riding directly above the
//          input row.
//   BAR    "+" attach (photos/files) on the left, circular send on the right.
//
// Surfaces differ only in what they pre-bake (the share composer arrives with
// a screenshot attached) and what "send" does (DM vs. new session).

import PhotosUI
import ScoutCapabilities
import SwiftUI
import UniformTypeIdentifiers
import HudsonUI

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
                        .foregroundStyle(HudPalette.ink)
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
                .foregroundStyle(HudPalette.ink)
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
        .background(Capsule().fill(Color.white.opacity(0.08)))
        .overlay(Capsule().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
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
                        .background(Capsule().fill(Color.white.opacity(0.06)))
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
                                .foregroundStyle(HudPalette.ink)
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

// MARK: - Attach "+" button

/// The composer's attach menu ("+" → Photo / File), self-contained: owns its
/// pickers and appends into the bound attachment list.
struct ComposerAttachButton: View {
    @Binding var attachments: [ScoutComposerAttachment]
    var disabled: Bool = false

    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showPhotoPicker = false
    @State private var showFileImporter = false

    var body: some View {
        Menu {
            Button { showPhotoPicker = true } label: { Label("Photo", systemImage: "photo") }
            Button { showFileImporter = true } label: { Label("File", systemImage: "paperclip") }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(ScoutInk.muted)
                .frame(width: 30, height: 30)
                .background(Circle().fill(ScoutSurface.inset))
                .overlay(Circle().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
        }
        .disabled(disabled)
        .photosPicker(isPresented: $showPhotoPicker, selection: $photoItems, maxSelectionCount: 8, matching: .images)
        .fileImporter(isPresented: $showFileImporter, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
            addFiles(result)
        }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            Task { await addPhotos(items) }
        }
    }

    @MainActor
    private func addPhotos(_ items: [PhotosPickerItem]) async {
        defer { photoItems = [] }
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            let type = item.supportedContentTypes.first { $0.conforms(to: .image) }
            let mediaType = type?.preferredMIMEType ?? "image/jpeg"
            let ext = type?.preferredFilenameExtension ?? (mediaType == "image/png" ? "png" : "jpg")
            attachments.append(
                ScoutComposerAttachment(data: data, mediaType: mediaType, fileName: "photo-\(attachments.count + 1).\(ext)")
            )
        }
    }

    private func addFiles(_ result: Result<[URL], Error>) {
        guard let urls = try? result.get() else { return }
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { continue }
            let type = UTType(filenameExtension: url.pathExtension)
            let mediaType = type?.preferredMIMEType ?? "application/octet-stream"
            attachments.append(
                ScoutComposerAttachment(data: data, mediaType: mediaType, fileName: url.lastPathComponent)
            )
        }
    }
}
