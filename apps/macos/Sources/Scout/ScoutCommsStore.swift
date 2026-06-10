import Combine
import Foundation
import ScoutAppCore
import SwiftUI
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

@MainActor
final class ScoutCommsStore: ObservableObject {
    @Published private(set) var channels: [ScoutChannel] = []
    @Published private(set) var messages: [ScoutMessage] = []
    @Published private(set) var agents: [ScoutAgent] = []
    @Published private(set) var selectedCId: String?
    @Published var selectedAgentId: String?
    @Published var channelQuery = ""
    @Published var isLoading = false
    @Published var isSending = false
    @Published var lastError: String?
    @Published private(set) var observePayload: ScoutObservePayload?
    @Published private(set) var observeAgentId: String?
    @Published private(set) var isObserveLoading = false
    @Published private(set) var observeError: String?
    /// cIds that appeared in the latest channels fetch but weren't in the prior
    /// one — drives the list's one-shot "new conversation" reveal.
    @Published private(set) var newChannelIds: Set<String> = []

    private let decoder = JSONDecoder()
    private var knownChannelIds: Set<String> = []
    private var pollTask: Task<Void, Never>?
    private var channelsTask: Task<Void, Never>?
    private var messagesTask: Task<Void, Never>?
    private var agentsTask: Task<Void, Never>?
    private var observeTask: Task<Void, Never>?
    private var observeRequestId: UUID?
    private var attemptedInitialChannelsLoad = false

    var selectedChannel: ScoutChannel? {
        guard let selectedCId else { return nil }
        return channels.first { $0.cId == selectedCId }
    }

    var selectedAgent: ScoutAgent? {
        if let selectedAgentId,
           let direct = agents.first(where: { $0.id == selectedAgentId }) {
            return direct
        }
        guard let channel = selectedChannel else { return nil }
        if let agentId = channel.agentId,
           let agent = agents.first(where: { $0.id == agentId }) {
            return agent
        }
        if let agentName = channel.agentName?.nilIfEmpty {
            return agents.first {
                $0.name.caseInsensitiveCompare(agentName) == .orderedSame
                    || $0.id.localizedCaseInsensitiveContains(agentName)
            }
        }
        return nil
    }

    var visibleChannels: [ScoutChannel] {
        let trimmed = channelQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return channels }
        return channels.filter { channel in
            channel.displayTitle.localizedCaseInsensitiveContains(trimmed)
                || channel.cId.localizedCaseInsensitiveContains(trimmed)
                || channel.participantDisplayNames.joined(separator: " ").localizedCaseInsensitiveContains(trimmed)
        }
    }

    var activeAgentCount: Int {
        agents.filter { $0.state == .working || $0.state == .needsAttention || $0.state == .available }.count
    }

    /// Agents actually doing work right now — drives the Conversations list's
    /// quiet "something's happening" pulse.
    var workingAgentCount: Int {
        agents.filter { $0.state == .working }.count
    }

    func start() {
        guard pollTask == nil else {
            refresh(force: true)
            return
        }
        refresh(force: true)
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                let interval = self?.pollIntervalNanoseconds ?? 10_000_000_000
                try? await Task.sleep(nanoseconds: interval)
                self?.refresh()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
        channelsTask?.cancel()
        messagesTask?.cancel()
        agentsTask?.cancel()
        observeTask?.cancel()
        channelsTask = nil
        messagesTask = nil
        agentsTask = nil
        observeTask = nil
        observeRequestId = nil
        setIfChanged(false, to: \.isLoading)
        setIfChanged(false, to: \.isObserveLoading)
    }

    func refresh(force: Bool = false) {
        loadChannels(force: force)
        loadAgents(force: force)
        if let observeAgentId {
            loadObserve(agentId: observeAgentId, force: true)
        }
    }

    func selectChannel(_ cId: String) {
        guard selectedCId != cId else { return }
        selectedCId = cId
        selectedAgentId = channels.first(where: { $0.cId == cId })?.agentId
        messages = []
        loadMessages()
    }

    func selectAgent(_ agentId: String) {
        selectedAgentId = agentId
    }

    func openAgentChannel(_ agent: ScoutAgent) {
        selectedAgentId = agent.id
        if let cId = agent.conversationId ?? channels.first(where: { $0.agentId == agent.id })?.cId {
            selectedCId = cId
            loadMessages()
        }
    }

    func loadMessages() {
        guard let selectedCId else { return }
        messagesTask?.cancel()
        messagesTask = Task { [weak self] in
            await self?.loadMessages(cId: selectedCId)
        }
    }

    func loadObserve(agentId: String, force: Bool = false) {
        let isSwitchingAgent = observeAgentId != agentId
        if let observeTask {
            if isSwitchingAgent {
                observeTask.cancel()
            } else {
                return
            }
        }
        if !force, !isSwitchingAgent, observePayload != nil { return }
        if isSwitchingAgent {
            observePayload = nil
            observeError = nil
        }
        observeAgentId = agentId
        isObserveLoading = observePayload == nil
        let requestId = UUID()
        observeRequestId = requestId
        observeTask = Task { [weak self] in
            await self?.fetchObserve(agentId: agentId, requestId: requestId)
        }
    }

    func send(_ body: String, images: [ScoutComposerImage] = []) async {
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let selectedCId, !isSending, !trimmed.isEmpty || !images.isEmpty else { return }
        isSending = true
        defer { isSending = false }

        do {
            // Upload images first and turn each into a link-backed attachment.
            // We want the blob present before the message lands, so the agent's
            // first fetch succeeds — so this completes before /api/send.
            var attachments: [[String: String]] = []
            for image in images {
                let uploaded = try await uploadImage(image)
                attachments.append([
                    "mediaType": uploaded.mediaType,
                    "url": uploaded.url,
                    "fileName": uploaded.fileName ?? image.fileName,
                ])
            }

            let url = ScoutWeb.baseURL().appending(path: "api/send")
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var payload: [String: Any] = [
                "body": trimmed,
                "cId": selectedCId,
                "conversationId": selectedCId,
            ]
            if !attachments.isEmpty {
                payload["attachments"] = attachments
            }
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw ScoutCommsError.sendFailed
            }
            setIfChanged(nil, to: \.lastError)
            refresh(force: true)
            loadMessages()
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    /// Push an image to the ephemeral blob route and get back a fetchable URL.
    private func uploadImage(_ image: ScoutComposerImage) async throws -> ScoutBlobUploadResponse {
        let url = ScoutWeb.baseURL().appending(path: "api/blobs")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "data": image.data.base64EncodedString(),
            "mediaType": image.mediaType,
            "fileName": image.fileName,
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ScoutCommsError.sendFailed
        }
        return try decoder.decode(ScoutBlobUploadResponse.self, from: data)
    }

    /// Publish only what changed. Steady-state polls fetch byte-identical data;
    /// an unguarded reassignment of a @Published property still fires
    /// objectWillChange, recomputing every observer's body. Rows capture closures
    /// (so SwiftUI can't diff them away), so that recompute relayouts the whole
    /// list on a 2.5s heartbeat even when nothing moved. This keeps the store —
    /// and the UI — quiet until something actually changes.
    private func setIfChanged<T: Equatable>(_ value: T, to keyPath: ReferenceWritableKeyPath<ScoutCommsStore, T>) {
        if self[keyPath: keyPath] != value {
            self[keyPath: keyPath] = value
        }
    }

    private var pollIntervalNanoseconds: UInt64 {
        if channels.isEmpty, lastError != nil {
            return 30_000_000_000
        }
        if workingAgentCount > 0 {
            return 2_500_000_000
        }
        return 10_000_000_000
    }

    private func loadChannels(force: Bool) {
        if channelsTask != nil { return }
        if !force, pollTask == nil { return }
        setIfChanged(channels.isEmpty && !attemptedInitialChannelsLoad, to: \.isLoading)
        channelsTask = Task { [weak self] in
            await self?.fetchChannels()
        }
    }

    private func loadAgents(force: Bool) {
        if agentsTask != nil { return }
        if !force, pollTask == nil { return }
        agentsTask = Task { [weak self] in
            await self?.fetchAgents()
        }
    }

    private func fetchChannels() async {
        defer {
            attemptedInitialChannelsLoad = true
            setIfChanged(false, to: \.isLoading)
            channelsTask = nil
        }

        do {
            let next = try await ScoutCommsClient().fetchChannels(limit: 160)
            let incomingIds = Set(next.map(\.cId))
            // The first successful population shouldn't flash every row as "new".
            setIfChanged(knownChannelIds.isEmpty ? [] : incomingIds.subtracting(knownChannelIds), to: \.newChannelIds)
            knownChannelIds = incomingIds
            // Animate only when the visible order actually changes (inserts,
            // removals, bumps). Steady-state polls that merely refresh previews
            // and ages must not churn the list — and an identical poll must not
            // publish at all, else the whole UI relayouts on a 2.5s heartbeat.
            if next.map(\.cId) != channels.map(\.cId) {
                withAnimation(.spring(response: 0.42, dampingFraction: 0.86)) {
                    channels = next
                }
            } else if next != channels {
                channels = next
            }
            let shouldSelectFallback = selectedCId.map { !incomingIds.contains($0) } ?? true
            if shouldSelectFallback {
                setIfChanged(next.first?.cId, to: \.selectedCId)
                setIfChanged(next.first?.agentId, to: \.selectedAgentId)
            }
            setIfChanged(nil, to: \.lastError)
            loadMessages()
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    private func fetchAgents() async {
        defer { agentsTask = nil }
        do {
            let next = try await ScoutCommsClient().fetchAgents()
            setIfChanged(next, to: \.agents)
            setIfChanged(nil, to: \.lastError)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            if channels.isEmpty {
                setIfChanged(Self.userFacingError(error), to: \.lastError)
            }
        }
    }

    private func loadMessages(cId: String) async {
        defer { messagesTask = nil }
        do {
            let next = try await ScoutCommsClient().fetchMessages(cId: cId, limit: 260)
            guard selectedCId == cId else { return }
            setIfChanged(next, to: \.messages)
            setIfChanged(nil, to: \.lastError)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            guard selectedCId == cId else { return }
            setIfChanged(Self.userFacingError(error), to: \.lastError)
        }
    }

    private func fetchObserve(agentId: String, requestId: UUID) async {
        defer {
            if observeRequestId == requestId {
                isObserveLoading = false
                observeTask = nil
            }
        }

        do {
            let url = ScoutWeb.baseURL().appending(path: "api/agents/\(agentId)/observe")
            let next = try await fetch(ScoutObservePayload.self, from: url)
            guard observeRequestId == requestId, observeAgentId == agentId else { return }
            observePayload = next
            observeError = nil
            setIfChanged(nil, to: \.lastError)
        } catch {
            guard !ScoutAppError.isCancellation(error) else { return }
            guard observeRequestId == requestId, observeAgentId == agentId else { return }
            observeError = Self.userFacingError(error)
        }
    }

    private func fetch<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw ScoutCommsError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            throw ScoutCommsError.httpStatus(http.statusCode)
        }
        return try decoder.decode(type, from: data)
    }

    private static func userFacingError(_ error: Error) -> String {
        if let scoutError = error as? ScoutCommsError {
            return scoutError.localizedDescription
        }
        return ScoutAppError.userFacing(error)
    }
}

enum ScoutCommsError: LocalizedError {
    case invalidResponse
    case httpStatus(Int)
    case sendFailed

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Scout returned an invalid response."
        case .httpStatus(let status):
            return "Scout returned HTTP \(status)."
        case .sendFailed:
            return "Scout send failed."
        }
    }
}

/// An image staged in the composer, ready to upload as an attachment. Holds
/// raw bytes (not an NSImage) so it stays Sendable across the upload task.
struct ScoutComposerImage: Identifiable, Sendable {
    let id = UUID()
    let data: Data
    let mediaType: String
    let fileName: String
}

/// Response from POST /api/blobs — the link-backed attachment to send.
struct ScoutBlobUploadResponse: Decodable {
    let url: String
    let mediaType: String
    let fileName: String?
}

#if os(macOS)
/// Builds composer images from pasteboard, dropped files, or picked files,
/// sniffing the media type so the attachment carries a correct MIME.
enum ScoutImageIntake {
    static func fromPasteboard() -> [ScoutComposerImage] {
        let pb = NSPasteboard.general
        // Copied image files (Finder, etc.) come through as file URLs.
        if let urls = pb.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingContentsConformToTypes: [UTType.image.identifier]]
        ) as? [URL], !urls.isEmpty {
            let images = urls.compactMap(fromFileURL)
            if !images.isEmpty { return images }
        }
        // Raw PNG bytes (some apps put these directly on the pasteboard).
        if let data = pb.data(forType: .png) {
            return [ScoutComposerImage(data: data, mediaType: "image/png", fileName: "pasted-image.png")]
        }
        // Screenshots usually land as TIFF — re-encode to PNG.
        if let tiff = pb.data(forType: .tiff),
           let rep = NSBitmapImageRep(data: tiff),
           let png = rep.representation(using: .png, properties: [:]) {
            return [ScoutComposerImage(data: png, mediaType: "image/png", fileName: "pasted-image.png")]
        }
        return []
    }

    static func fromFileURL(_ url: URL) -> ScoutComposerImage? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        let resolved = mediaType(forExtension: url.pathExtension.lowercased())
            ?? sniffMediaType(data)
        guard let resolved, resolved.hasPrefix("image/") else { return nil }
        return ScoutComposerImage(data: data, mediaType: resolved, fileName: url.lastPathComponent)
    }

    private static func mediaType(forExtension ext: String) -> String? {
        switch ext {
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic": return "image/heic"
        case "tiff", "tif": return "image/tiff"
        case "bmp": return "image/bmp"
        default: return nil
        }
    }

    private static func sniffMediaType(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.count >= 4, bytes[0] == 0x89, bytes[1] == 0x50, bytes[2] == 0x4E, bytes[3] == 0x47 {
            return "image/png"
        }
        if bytes.count >= 3, bytes[0] == 0xFF, bytes[1] == 0xD8, bytes[2] == 0xFF {
            return "image/jpeg"
        }
        if bytes.count >= 3, bytes[0] == 0x47, bytes[1] == 0x49, bytes[2] == 0x46 {
            return "image/gif"
        }
        if bytes.count >= 12, bytes[0] == 0x52, bytes[1] == 0x49, bytes[2] == 0x46, bytes[3] == 0x46,
           bytes[8] == 0x57, bytes[9] == 0x45, bytes[10] == 0x42, bytes[11] == 0x50 {
            return "image/webp"
        }
        return nil
    }
}
#endif
