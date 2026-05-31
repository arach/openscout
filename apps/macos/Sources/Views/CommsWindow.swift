import AppKit
import SwiftUI

@MainActor
final class CommsWindowController {
    static let shared = CommsWindowController()

    private let service = CommsService.shared
    private var panel: OverlayPanel?

    private init() {}

    func show(cId: String? = nil) {
        service.start(preferredCId: cId)
        if panel == nil {
            panel = OverlayPanelShell.makePanel(
                config: OverlayPanelShell.Config(
                    size: NSSize(width: 1020, height: 720),
                    title: "OpenScout Comms",
                    isMovableByWindowBackground: true,
                    activatesOnMouseDown: true,
                    resizable: true,
                    minContentSize: NSSize(width: 780, height: 540)
                ),
                rootView: CommsRootView(service: service)
            )
        }
        guard let panel else { return }
        OverlayPanelShell.position(panel, placement: .mouseScreenCentered(yOffsetRatio: 0.04))
        OverlayPanelShell.present(panel, activate: true)
    }

    func toggle() {
        if panel?.isVisible == true {
            dismiss()
        } else {
            show()
        }
    }

    func dismiss() {
        panel?.orderOut(nil)
        service.stop()
    }
}

struct CommsRootView: View {
    @ObservedObject var service: CommsService

    enum Field: Hashable { case search, composer, command }

    // Drafts are kept per-channel so switching cId never loses in-progress
    // text — a core "don't surprise me" affordance for a comms tool.
    @State private var drafts: [String: String] = [:]
    @State private var channelQuery = ""
    @State private var showCommands = false
    @State private var commandQuery = ""
    @State private var commandIndex = 0
    @FocusState private var focus: Field?

    var body: some View {
        ZStack {
            VisualEffectBackground(material: .hudWindow, cornerRadius: 8)
            HUDChrome.canvas
            HUDPaperGrain(opacity: 0.03)

            VStack(spacing: 0) {
                header
                HUDHairline()
                main
            }
            .background(keyboardCommands)
        }
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(HUDChrome.borderRim, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .preferredColorScheme(.dark)
        .onAppear { focusComposerSoon() }
        .onChange(of: service.selectedCId) { _, _ in focusComposerSoon() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("C")
                .font(HUDType.mono(15, weight: .bold))
                .foregroundStyle(HUDChrome.canvas)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(HUDChrome.accent)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text("COMMS")
                    .font(HUDType.mono(11, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.ink)
                Text(service.selectedItem?.cIdShort ?? "cId")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
            }

            Spacer(minLength: 10)

            HStack(spacing: 4) {
                ForEach(CommsFilter.allCases) { filter in
                    CommsFilterButton(
                        label: filter.label,
                        isSelected: service.filter == filter
                    ) {
                        service.filter = filter
                    }
                }
            }

            Button {
                service.refresh(force: true)
                service.loadMessages()
            } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(CommsIconButtonStyle())
            .help("Refresh")

            Button {
                CommsWindowController.shared.dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
            }
            .buttonStyle(CommsIconButtonStyle())
            .help("Close")
        }
        .padding(.horizontal, 18)
        .frame(height: 54)
        .background(HUDChrome.canvasAlt)
    }

    private var main: some View {
        HStack(spacing: 0) {
            rail
                .frame(width: 304)
            HUDHairline(axis: .vertical)
            detail
        }
    }

    private var rail: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("\(visibleItems.count)")
                    .font(HUDType.mono(18, weight: .bold))
                    .foregroundStyle(HUDChrome.ink)
                Text("CHANNELS")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
                Spacer()
                if service.isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .scaleEffect(0.7)
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 44)
            .background(HUDChrome.canvas)

            railSearch

            HUDHairline()

            if visibleItems.isEmpty {
                railPlaceholder
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(visibleItems) { item in
                            CommsRailRow(
                                item: item,
                                isSelected: service.selectedCId == item.cId
                            ) {
                                service.select(item.cId)
                            }
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
        .background(HUDChrome.canvas)
    }

    private var railSearch: some View {
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(HUDChrome.inkFaint)
            TextField("Jump to channel", text: $channelQuery)
                .textFieldStyle(.plain)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.ink)
                .focused($focus, equals: .search)
                .onSubmit {
                    if let first = visibleItems.first {
                        service.select(first.cId)
                        channelQuery = ""
                        focus = .composer
                    }
                }
            if channelQuery.isEmpty {
                Text("⌘K")
                    .font(HUDType.mono(9, weight: .bold))
                    .foregroundStyle(HUDChrome.inkDeep)
            } else {
                Button {
                    channelQuery = ""
                    focus = .search
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(HUDChrome.inkFaint)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(HUDChrome.canvas)
    }

    @ViewBuilder
    private var railPlaceholder: some View {
        VStack(spacing: 10) {
            if service.isLoading && service.items.isEmpty {
                ProgressView()
                    .controlSize(.small)
                Text("LOADING CHANNELS")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
            } else if let error = service.lastError, !error.isEmpty, service.items.isEmpty {
                Image(systemName: "wifi.exclamationmark")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(HUDChrome.inkDeep)
                Text("COMMS UNREACHABLE")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
                Text(error)
                    .font(HUDType.body(11))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            } else if !channelQuery.isEmpty {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(HUDChrome.inkDeep)
                Text("NO MATCHES")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
            } else {
                Image(systemName: "tray")
                    .font(.system(size: 22, weight: .regular))
                    .foregroundStyle(HUDChrome.inkDeep)
                Text(service.filter == .all ? "NO CHANNELS" : "NO \(service.filter.label.uppercased()) CHANNELS")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 20)
        .background(HUDChrome.canvas)
    }

    @ViewBuilder
    private var detail: some View {
        if let item = service.selectedItem {
            VStack(spacing: 0) {
                detailHeader(item)
                HUDHairline()
                messages
                HUDHairline()
                composer
            }
            .background(HUDChrome.canvas)
        } else {
            VStack(spacing: 14) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 34, weight: .regular))
                    .foregroundStyle(HUDChrome.inkDeep)
                Text("NO CHANNEL SELECTED")
                    .font(HUDType.mono(11, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
                if let error = service.lastError, !error.isEmpty {
                    Text(error)
                        .font(HUDType.body(12))
                        .foregroundStyle(ShellPalette.error)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .frame(maxWidth: 360)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(HUDChrome.canvas)
        }
    }

    private func detailHeader(_ item: CommsItem) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text(item.displayTitle)
                    .font(HUDType.body(20, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                HStack(spacing: 8) {
                    CommsChip(text: item.scopeLabel.uppercased())
                    CommsChip(text: item.cIdShort)
                    CommsChip(text: "\(item.participantIds.count) member\(item.participantIds.count == 1 ? "" : "s")")
                }
            }
            Spacer(minLength: 12)
            if let branch = item.currentBranch, !branch.isEmpty {
                Text(branch)
                    .font(HUDType.mono(10, weight: .medium))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: 180, alignment: .trailing)
            }
        }
        .padding(.horizontal, 20)
        .frame(height: 72)
        .background(HUDChrome.canvasAlt)
    }

    private var messages: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(Array(service.messages.enumerated()), id: \.element.id) { index, message in
                        CommsMessageRow(
                            message: message,
                            showsHeader: Self.showsHeader(at: index, in: service.messages)
                        )
                        .id(message.id)
                        .padding(.top, Self.showsHeader(at: index, in: service.messages) ? 8 : 0)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
            .scrollIndicators(.visible)
            .background(HUDChrome.canvas)
            .overlay {
                if service.messages.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "text.bubble")
                            .font(.system(size: 26, weight: .regular))
                            .foregroundStyle(HUDChrome.inkDeep)
                        Text("NO MESSAGES YET")
                            .font(HUDType.mono(10, weight: .bold))
                            .tracking(HUDType.eyebrowTracking)
                            .foregroundStyle(HUDChrome.inkMuted)
                    }
                    .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .bottom) {
                if showCommands {
                    commandPalette
                }
            }
            .onChange(of: service.messages.count) { _, _ in
                withAnimation(.easeOut(duration: 0.16)) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            .onAppear {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if let error = service.lastError, !error.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 11, weight: .semibold))
                    Text(error)
                        .font(HUDType.body(12))
                        .lineLimit(2)
                    Spacer()
                }
                .foregroundStyle(ShellPalette.error)
            }

            HStack(alignment: .bottom, spacing: 10) {
                Button {
                    startDictation()
                } label: {
                    Image(systemName: "mic.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .frame(width: 38, height: 38)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(HUDChrome.canvasLift)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .stroke(HUDChrome.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .help("Dictate — or press Fn twice")

                Button {
                    showCommands ? closeCommands() : openCommands()
                } label: {
                    Image(systemName: "command")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(showCommands ? HUDChrome.accent : HUDChrome.inkMuted)
                        .frame(width: 38, height: 38)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(HUDChrome.canvasLift)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .stroke(showCommands ? HUDChrome.accentDim : HUDChrome.border, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .help("Commands — ⌘P or type /")

                TextField(composerPlaceholder, text: draftBinding, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(HUDType.body(14))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1...5)
                    .focused($focus, equals: .composer)
                    .onKeyPress(phases: .down) { press in
                        // Return sends; Shift+Return inserts a newline
                        // (Messages-style). ⌘↩ still works via the send button.
                        guard press.key == .return else { return .ignored }
                        if press.modifiers.contains(.shift) { return .ignored }
                        sendDraft()
                        return .handled
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(HUDChrome.canvasLift)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(focus == .composer ? HUDChrome.accentDim : HUDChrome.border, lineWidth: 1)
                    )

                Button {
                    sendDraft()
                } label: {
                    Image(systemName: service.isSending ? "hourglass" : "paperplane.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 38, height: 38)
                }
                .buttonStyle(CommsSendButtonStyle())
                .disabled(currentDraftEmpty || service.isSending)
                .keyboardShortcut(.return, modifiers: [.command])
                .help("Send")
            }

            if !currentDraftEmpty {
                HStack(spacing: 0) {
                    Spacer()
                    Text("⏎ to send · ⇧⏎ newline")
                        .font(HUDType.mono(9))
                        .foregroundStyle(HUDChrome.inkFaint)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(HUDChrome.canvasAlt)
    }

    private func sendDraft() {
        guard let cId = service.selectedCId else { return }
        let body = drafts[cId] ?? ""
        guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        drafts[cId] = ""
        focus = .composer
        Task {
            await service.send(body)
        }
    }

    // Per-channel draft binding — text follows the selected cId so switching
    // channels parks the draft instead of discarding it.
    private var draftBinding: Binding<String> {
        let key = service.selectedCId ?? ""
        return Binding(
            get: { drafts[key] ?? "" },
            set: { newValue in
                // Typing "/" into an empty composer opens the command area
                // instead of entering the slash as message text — "/" stays
                // a control key, never a literal sent to an agent.
                if newValue == "/" && (drafts[key] ?? "").isEmpty {
                    openCommands()
                    return
                }
                drafts[key] = newValue
            }
        )
    }

    private var currentDraftEmpty: Bool {
        (drafts[service.selectedCId ?? ""] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .isEmpty
    }

    // Scope filter (All/Private/Shared) plus the live quick-filter query.
    private var visibleItems: [CommsItem] {
        let scoped = service.filteredItems
        let query = channelQuery.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return scoped }
        return scoped.filter {
            $0.displayTitle.lowercased().contains(query) || $0.cId.lowercased().contains(query)
        }
    }

    private func moveSelection(_ delta: Int) {
        let items = visibleItems
        guard !items.isEmpty else { return }
        let current = items.firstIndex { $0.cId == service.selectedCId } ?? -1
        let next = max(0, min(items.count - 1, current + delta))
        guard items.indices.contains(next) else { return }
        service.select(items[next].cId)
    }

    private func focusComposerSoon() {
        DispatchQueue.main.async { focus = .composer }
    }

    // Routes to the focused field's editor via the standard responder action,
    // the same one Edit ▸ Start Dictation uses. No-op if nothing accepts it.
    private func startDictation() {
        focus = .composer
        NSApp.sendAction(Selector(("startDictation:")), to: nil, from: nil)
    }

    private func copyCId() {
        guard let cId = service.selectedCId else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(cId, forType: .string)
    }

    // ── Command area ────────────────────────────────────────────────────
    // A local command surface anchored over the chat area. Every entry acts
    // on the Comms UI (navigate, scope, refresh, dictate, copy) — none of it
    // transmits text to agents, which is why "/" can safely open it.
    private func openCommands() {
        commandQuery = ""
        commandIndex = 0
        showCommands = true
        focus = .command
    }

    private func closeCommands() {
        showCommands = false
        focus = .composer
    }

    private func runCommand(_ command: CommsCommand) {
        closeCommands()
        command.run()
    }

    private var commands: [CommsCommand] {
        [
            CommsCommand(id: "jump", title: "Jump to channel", hint: "⌘K", systemImage: "magnifyingglass", keywords: ["search", "find", "goto"]) { focus = .search },
            CommsCommand(id: "next", title: "Next channel", hint: "⌘↓", systemImage: "chevron.down", keywords: ["down"]) { moveSelection(1) },
            CommsCommand(id: "prev", title: "Previous channel", hint: "⌘↑", systemImage: "chevron.up", keywords: ["up"]) { moveSelection(-1) },
            CommsCommand(id: "all", title: "Show all channels", hint: "⌘1", systemImage: "tray.full", keywords: ["filter"]) { service.filter = .all },
            CommsCommand(id: "private", title: "Show private", hint: "⌘2", systemImage: "lock", keywords: ["filter", "dm", "direct"]) { service.filter = .private },
            CommsCommand(id: "shared", title: "Show shared", hint: "⌘3", systemImage: "person.2", keywords: ["filter", "group"]) { service.filter = .shared },
            CommsCommand(id: "refresh", title: "Refresh", hint: "⌘R", systemImage: "arrow.clockwise", keywords: ["reload", "sync"]) {
                service.refresh(force: true)
                service.loadMessages()
            },
            CommsCommand(id: "dictate", title: "Dictate message", hint: "fn fn", systemImage: "mic", keywords: ["voice", "speak"]) { startDictation() },
            CommsCommand(id: "copy", title: "Copy cId", hint: "", systemImage: "doc.on.doc", keywords: ["clipboard", "id"]) { copyCId() },
        ]
    }

    private var filteredCommands: [CommsCommand] {
        let query = commandQuery.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return commands }
        return commands.filter {
            $0.title.lowercased().contains(query) || $0.keywords.contains { $0.contains(query) }
        }
    }

    private var commandPalette: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("›")
                    .font(HUDType.mono(14, weight: .bold))
                    .foregroundStyle(HUDChrome.accent)
                TextField("Run a command", text: $commandQuery)
                    .textFieldStyle(.plain)
                    .font(HUDType.body(13))
                    .foregroundStyle(HUDChrome.ink)
                    .focused($focus, equals: .command)
                    .onSubmit {
                        if let command = filteredCommands[safe: commandIndex] {
                            runCommand(command)
                        }
                    }
                Text("ESC")
                    .font(HUDType.mono(9, weight: .bold))
                    .foregroundStyle(HUDChrome.inkDeep)
            }
            .padding(.horizontal, 12)
            .frame(height: 40)

            HUDHairline()

            if filteredCommands.isEmpty {
                Text("NO COMMANDS")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkMuted)
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(filteredCommands.enumerated()), id: \.element.id) { index, command in
                            Button {
                                runCommand(command)
                            } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: command.systemImage)
                                        .font(.system(size: 12, weight: .semibold))
                                        .frame(width: 16)
                                        .foregroundStyle(index == commandIndex ? HUDChrome.accent : HUDChrome.inkMuted)
                                    Text(command.title)
                                        .font(HUDType.body(13))
                                        .foregroundStyle(HUDChrome.ink)
                                    Spacer()
                                    if !command.hint.isEmpty {
                                        Text(command.hint)
                                            .font(HUDType.mono(9, weight: .bold))
                                            .foregroundStyle(HUDChrome.inkFaint)
                                    }
                                }
                                .padding(.horizontal, 12)
                                .frame(height: 34)
                                .background(index == commandIndex ? HUDChrome.canvasLift : Color.clear)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .onHover { hovering in
                                if hovering { commandIndex = index }
                            }
                        }
                    }
                }
                .frame(maxHeight: 240)
                .scrollIndicators(.hidden)
            }
        }
        .frame(width: 360)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(HUDChrome.canvasAlt)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(HUDChrome.borderRim, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .shadow(color: Color.black.opacity(0.45), radius: 24, y: 12)
        .padding(.bottom, 14)
        .onChange(of: commandQuery) { _, _ in commandIndex = 0 }
        .onKeyPress(.upArrow) {
            commandIndex = max(0, commandIndex - 1)
            return .handled
        }
        .onKeyPress(.downArrow) {
            commandIndex = min(filteredCommands.count - 1, commandIndex + 1)
            return .handled
        }
        .onKeyPress(.escape) {
            closeCommands()
            return .handled
        }
    }

    // Invisible buttons that register window-level shortcuts. Kept active
    // (opacity 0, not .hidden/.disabled) so the chords stay live.
    private var keyboardCommands: some View {
        Group {
            Button("") { service.filter = .all }.keyboardShortcut("1", modifiers: .command)
            Button("") { service.filter = .private }.keyboardShortcut("2", modifiers: .command)
            Button("") { service.filter = .shared }.keyboardShortcut("3", modifiers: .command)
            Button("") { moveSelection(1) }.keyboardShortcut(.downArrow, modifiers: .command)
            Button("") { moveSelection(-1) }.keyboardShortcut(.upArrow, modifiers: .command)
            Button("") {
                service.refresh(force: true)
                service.loadMessages()
            }.keyboardShortcut("r", modifiers: .command)
            Button("") { focus = .composer }.keyboardShortcut("l", modifiers: .command)
            Button("") { focus = .search }.keyboardShortcut("k", modifiers: .command)
            Button("") { showCommands ? closeCommands() : openCommands() }.keyboardShortcut("p", modifiers: .command)
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }

    private var composerPlaceholder: String {
        if let title = service.selectedItem?.displayTitle, !title.isEmpty {
            return "Message \(title)"
        }
        return "Message"
    }

    private static func showsHeader(at index: Int, in messages: [CommsMessage]) -> Bool {
        guard index > 0 else { return true }
        let prev = messages[index - 1]
        let current = messages[index]
        if prev.actorId != current.actorId || prev.isOperator != current.isOperator { return true }
        return normalizedSeconds(current.createdAt) - normalizedSeconds(prev.createdAt) > 300
    }

    private static func normalizedSeconds(_ timestamp: TimeInterval) -> TimeInterval {
        timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp
    }
}

private struct CommsFilterButton: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label.uppercased())
                .font(HUDType.mono(10, weight: .bold))
                .tracking(1.0)
                .foregroundStyle(isSelected ? HUDChrome.canvas : HUDChrome.inkMuted)
                .frame(minWidth: 70, minHeight: 28)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isSelected ? HUDChrome.accent : HUDChrome.canvasLift)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(isSelected ? HUDChrome.accentDim : HUDChrome.border, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct CommsRailRow: View {
    let item: CommsItem
    let isSelected: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 7) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(item.scopeLabel.uppercased())
                        .font(HUDType.mono(8, weight: .bold))
                        .tracking(1.2)
                        .foregroundStyle(isSelected ? HUDChrome.accent : HUDChrome.inkFaint)
                    Spacer(minLength: 8)
                    Text(item.lastMessageAt.map(formatShortTime) ?? "NEW")
                        .font(HUDType.mono(9))
                        .foregroundStyle(HUDChrome.inkFaint)
                }

                Text(item.displayTitle)
                    .font(HUDType.body(14, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)

                HStack(spacing: 6) {
                    Text(item.preview?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? item.cIdShort)
                        .font(HUDType.body(11))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 8)
                    if item.messageCount > 0 {
                        Text("\(item.messageCount)")
                            .font(HUDType.mono(9, weight: .bold))
                            .foregroundStyle(HUDChrome.inkFaint)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, minHeight: 82, alignment: .leading)
            .background(rowFill)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(HUDChrome.accent)
                    .frame(width: 2.5)
                    .opacity(isSelected ? 1 : 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { next in
            hovering = next
        }

        HUDHairline()
    }

    private var rowFill: Color {
        if isSelected { return HUDChrome.canvasLift }
        if hovering { return HUDChrome.canvasAlt }
        return HUDChrome.canvas
    }
}

private struct CommsMessageRow: View {
    let message: CommsMessage
    var showsHeader: Bool = true

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            if message.isOperator {
                Spacer(minLength: 54)
            }

            VStack(alignment: message.isOperator ? .trailing : .leading, spacing: 5) {
                if showsHeader {
                    HStack(spacing: 8) {
                        Text(message.actorName.uppercased())
                            .font(HUDType.mono(9, weight: .bold))
                            .tracking(1.0)
                            .foregroundStyle(message.isOperator ? HUDChrome.accent : HUDChrome.inkMuted)
                        Text(formatShortTime(message.createdAt))
                            .font(HUDType.mono(9))
                            .foregroundStyle(HUDChrome.inkFaint)
                    }
                }

                Text(message.body)
                    .font(HUDType.body(13))
                    .foregroundStyle(HUDChrome.ink)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(message.isOperator ? HUDChrome.accentWhisper : HUDChrome.canvasAlt)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(message.isOperator ? HUDChrome.accentSoft : HUDChrome.borderSoft, lineWidth: 1)
                    )
            }
            .frame(maxWidth: 560, alignment: message.isOperator ? .trailing : .leading)

            if !message.isOperator {
                Spacer(minLength: 54)
            }
        }
        .frame(maxWidth: .infinity, alignment: message.isOperator ? .trailing : .leading)
    }
}

private struct CommsChip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(HUDType.mono(9, weight: .bold))
            .tracking(0.8)
            .foregroundStyle(HUDChrome.inkMuted)
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.horizontal, 8)
            .frame(height: 22)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(HUDChrome.canvasLift)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(HUDChrome.border, lineWidth: 1)
            )
    }
}

private struct CommsIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(HUDChrome.inkMuted)
            .frame(width: 28, height: 28)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(configuration.isPressed ? HUDChrome.canvasLift : HUDChrome.canvas)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(HUDChrome.border, lineWidth: 1)
            )
    }
}

private struct CommsSendButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(HUDChrome.canvas)
            .background(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(configuration.isPressed ? HUDChrome.accentDim : HUDChrome.accent)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
    }
}

private struct CommsCommand: Identifiable {
    let id: String
    let title: String
    let hint: String
    let systemImage: String
    let keywords: [String]
    let run: () -> Void
}

private extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

private func formatShortTime(_ timestamp: TimeInterval) -> String {
    let seconds = timestamp > 10_000_000_000 ? timestamp / 1000 : timestamp
    let date = Date(timeIntervalSince1970: seconds)
    if Calendar.current.isDateInToday(date) {
        return SelfTimeFormatter.time.string(from: date)
    }
    return SelfTimeFormatter.date.string(from: date)
}

private enum SelfTimeFormatter {
    static let time: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter
    }()

    static let date: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter
    }()
}

private extension String {
    var nilIfEmpty: String? {
        isEmpty ? nil : self
    }
}
