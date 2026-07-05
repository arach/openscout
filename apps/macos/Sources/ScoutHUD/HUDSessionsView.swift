import AppKit
import ScoutAppCore
import SwiftUI

// Sessions tab — native port of design/studio/components/hud/HudSessions.tsx.
//
// Compact: single-col ledger, inline reveal on engage.
// Medium:  same ledger, wider meta strip (project + duration + msg), inline reveal.
// Large:   full-width ledger; lifecycle detail reveals inline on interaction.

private enum SessionStatus: Sendable {
    case running, idle, ended

    var label: String {
        switch self {
        case .running: return "RUNNING"
        case .idle: return "IDLE"
        case .ended: return "ENDED"
        }
    }

    var color: Color {
        switch self {
        case .running: return HUDChrome.accent
        case .idle: return HUDChrome.inkMuted
        case .ended: return HUDChrome.inkFaint
        }
    }
}

private struct SynthesizedSession: Identifiable {
    let id: String           // Stable row identity: source + transcript path
    let sessionRef: String   // Real ref resolvable via /api/session-ref
    let displayRef: String
    let agentId: String?
    let conversationId: String?    // Canonical operator DM thread
    let agentName: String
    let agentHandle: String?
    let harness: String
    let status: SessionStatus
    let project: String
    let branch: String
    let duration: String
    let messageCount: Int
    let lastTurn: String
    let ago: String
    let model: String
    let startedAt: String?
}

struct HUDSessionsView: View {
    private static let log = ScoutLog.hud("sessions")
    private static let sessionLimit = 10

    let agents: [HudAgent]
    @ObservedObject var tail: ScoutTailStore

    @ObservedObject private var state = HUDState.shared
    @StateObject private var engage = HUDEngageState()

    private var sessions: [SynthesizedSession] {
        Self.synthesize(from: tail.discovery, events: tail.events, agents: agents)
    }

    var body: some View {
        Group {
            if sessions.isEmpty {
                EmptySessions()
            } else {
                switch state.size {
                case .compact: rowsBody(size: .compact)
                case .medium:  rowsBody(size: .medium)
                case .large:   rowsBody(size: .large)
                }
            }
        }
        .onAppear {
            logSnapshot("appear")
            tail.start()
            tail.refreshDiscovery()
            wireNavBus()
        }
        .onDisappear {
            logSnapshot("disappear")
            tail.stop()
            HUDNavBus.shared.clear()
        }
        .onChange(of: tail.discovery?.generatedAt) { _, _ in
            logSnapshot("discovery")
        }
        .onChange(of: tail.lastError) { _, error in
            guard let error else { return }
            Self.log.error("sessions tail error=\(error, privacy: .public)")
        }
    }

    private func logSnapshot(_ phase: String) {
        let processCount = tail.discovery?.processes.count ?? 0
        let transcriptCount = tail.discovery?.transcripts.count ?? 0
        Self.log.info("sessions \(phase, privacy: .public) rows=\(sessions.count, privacy: .public) events=\(tail.events.count, privacy: .public) processes=\(processCount, privacy: .public) transcripts=\(transcriptCount, privacy: .public)")
    }

    // Register cycle/engage closures with the global key bus. Mirrors the
    // wiring HUDTailView already does — cursor tracks j/k (no expansion),
    // engaged tracks Enter (inline detail opens). A second Enter on an
    // already-engaged row stages the agent on the dock and focuses it.
    private func wireNavBus() {
        HUDNavBus.shared.cycleNext = {
            let ids = sessions.map { $0.id }
            guard !ids.isEmpty else { return }
            if let cur = engage.cursoredId, let i = ids.firstIndex(of: cur), i + 1 < ids.count {
                engage.cursor(ids[i + 1])
            } else {
                engage.cursor(ids.first)
            }
        }
        HUDNavBus.shared.cyclePrev = {
            let ids = sessions.map { $0.id }
            guard !ids.isEmpty else { return }
            if let cur = engage.cursoredId, let i = ids.firstIndex(of: cur), i > 0 {
                engage.cursor(ids[i - 1])
            } else {
                engage.cursor(ids.last)
            }
        }
        HUDNavBus.shared.jumpTop = {
            engage.cursor(sessions.first?.id)
        }
        HUDNavBus.shared.jumpBottom = {
            engage.cursor(sessions.last?.id)
        }
        HUDNavBus.shared.engageSelected = {
            // Three-level progressive disclosure on Enter:
            //   1. cursored row not yet engaged → engage it (inline detail expands)
            //   2. cursored row already engaged → stage @target on the dock + focus
            guard let cursoredId = engage.cursoredId,
                  let session = sessions.first(where: { $0.id == cursoredId }) else { return }
            if engage.engagedId != cursoredId {
                engage.toggle(cursoredId)
            } else {
                let handle = session.agentHandle ?? session.agentName
                HUDDockState.shared.setTarget(handle: handle, label: session.agentName)
                HUDDockState.shared.focus()
            }
        }
        HUDNavBus.shared.unengageSelected = {
            if engage.engagedId != nil {
                engage.unengage()
                return true
            }
            return false
        }
        // Sessions has no live-follow concept; clear the slot so a previous
        // tab's binding doesn't leak.
        HUDNavBus.shared.toggleFollow = nil
    }

    // MARK: - Rows

    private func rowsBody(size: HUDSize) -> some View {
        ScrollViewReader { proxy in
            GeometryReader { viewport in
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        LazyVStack(spacing: 0) {
                            SessionsHeader(sessions: sessions)
                            ForEach(Array(sessions.enumerated()), id: \.element.id) { idx, s in
                                SessionRow(
                                    session: s,
                                    isFirst: idx == 0,
                                    size: size,
                                    cursored: engage.isCursored(s.id),
                                    engaged: engage.isEngaged(s.id),
                                    onTap: {
                                        withAnimation(.easeOut(duration: 0.14)) {
                                            engage.toggle(s.id)
                                        }
                                    }
                                )
                                .id(s.id)
                                if engage.isEngaged(s.id) {
                                    SessionDetailInline(session: s, size: size)
                                        .transition(.move(edge: .top).combined(with: .opacity))
                                }
                            }
                        }

                        Spacer(minLength: 0)
                        SessionsFeedEndMarker()
                    }
                    .frame(minHeight: viewport.size.height, alignment: .top)
                }
                .onChange(of: engage.cursoredId) { _, id in
                    guard let id else { return }
                    withAnimation(.easeOut(duration: 0.16)) {
                        if size == .compact {
                            proxy.scrollTo(id)
                        } else {
                            proxy.scrollTo(id, anchor: .center)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private static func synthesize(
        from discovery: ScoutTailDiscoverySnapshot?,
        events: [ScoutTailEvent],
        agents: [HudAgent]
    ) -> [SynthesizedSession] {
        guard let discovery else { return [] }

        let nowMs = Date().timeIntervalSince1970 * 1_000
        let latestEventBySession = latestEventsBySession(events)
        let eventCountBySession = eventCountsBySession(events)
        let agentsBySessionRef = agentsBySessionRef(agents)
        let processByCwd = processByCwd(discovery.processes)
        let latestTranscriptByCwd = latestTranscriptsByCwd(discovery.transcripts)

        return discovery.transcripts.compactMap { transcript -> (session: SynthesizedSession, lastActivity: TimeInterval)? in
            guard let sessionRef = normalizeSessionRef(transcript.sessionId)
                    ?? normalizeSessionRef(transcript.transcriptPath) else {
                return nil
            }

            let latestEvent = latestEventBySession[sessionRef]
            let lastActivity = max(transcript.mtimeMs, latestEvent?.ts ?? 0)
            let cwdKey = clean(transcript.cwd).map { processKey(source: transcript.source, cwd: $0) }
            let isLatestForLiveProcess = cwdKey.flatMap { key in
                processByCwd[key] != nil && latestTranscriptByCwd[key]?.id == transcript.id
            } ?? false
            let hasRecentActivity = nowMs - lastActivity <= 60_000
            guard isLatestForLiveProcess || hasRecentActivity else { return nil }

            let process = isLatestForLiveProcess ? cwdKey.flatMap { processByCwd[$0] } : nil
            let status: SessionStatus = .running
            let agent = agentsBySessionRef[sessionRef]
            let project = clean(transcript.project)
                ?? clean(transcript.cwd).flatMap(pathLeaf)
                ?? pathParent(transcript.transcriptPath)
                ?? agent.flatMap { clean($0.projectRoot).flatMap(pathLeaf) }
                ?? "unknown"
            let lastTurn = clean(latestEvent?.summary)
                ?? process.flatMap { clean($0.command) }
                ?? transcript.transcriptPath
            let harness = clean(transcript.source)
                ?? clean(transcript.harness)
                ?? agent.flatMap { clean($0.harness) }
                ?? "raw"

            return (
                SynthesizedSession(
                    id: "\(transcript.source)\u{0}\(transcript.transcriptPath)",
                    sessionRef: sessionRef,
                    displayRef: String(sessionRef.prefix(8)),
                    agentId: agent?.id,
                    conversationId: agent?.conversationId,
                    agentName: agent?.name ?? project,
                    agentHandle: agent?.handle,
                    harness: harness,
                    status: status,
                    project: project,
                    branch: agent?.branchLabel ?? "—",
                    duration: process.flatMap { clean($0.etime) } ?? formatBytes(transcript.size),
                    messageCount: eventCountBySession[sessionRef] ?? 0,
                    lastTurn: lastTurn,
                    ago: ScoutAgent.formatAgo(sinceMs: lastActivity),
                    model: agent?.tokens ?? clean(transcript.harness) ?? harness,
                    startedAt: nil
                ),
                lastActivity
            )
        }
        .sorted {
            if $0.lastActivity == $1.lastActivity {
                return $0.session.project.localizedCaseInsensitiveCompare($1.session.project) == .orderedAscending
            }
            return $0.lastActivity > $1.lastActivity
        }
        .prefix(sessionLimit)
        .map(\.session)
    }

    private static func agentsBySessionRef(_ agents: [HudAgent]) -> [String: HudAgent] {
        var result: [String: HudAgent] = [:]
        for agent in agents {
            guard let ref = normalizeSessionRef(agent.harnessSessionId) else { continue }
            result[ref] = agent
        }
        return result
    }

    private static func latestEventsBySession(_ events: [ScoutTailEvent]) -> [String: ScoutTailEvent] {
        var result: [String: ScoutTailEvent] = [:]
        for event in events {
            guard let ref = normalizeSessionRef(event.sessionId) else { continue }
            if let current = result[ref], current.ts >= event.ts { continue }
            result[ref] = event
        }
        return result
    }

    private static func eventCountsBySession(_ events: [ScoutTailEvent]) -> [String: Int] {
        var result: [String: Int] = [:]
        for event in events {
            guard let ref = normalizeSessionRef(event.sessionId) else { continue }
            result[ref, default: 0] += 1
        }
        return result
    }

    private static func processByCwd(_ processes: [ScoutTailDiscoveredProcess]) -> [String: ScoutTailDiscoveredProcess] {
        var result: [String: ScoutTailDiscoveredProcess] = [:]
        for process in processes {
            guard let cwd = clean(process.cwd) else { continue }
            let key = processKey(source: process.source, cwd: cwd)
            if let current = result[key], current.pid <= process.pid { continue }
            result[key] = process
        }
        return result
    }

    private static func latestTranscriptsByCwd(
        _ transcripts: [ScoutTailDiscoveredTranscript]
    ) -> [String: ScoutTailDiscoveredTranscript] {
        var result: [String: ScoutTailDiscoveredTranscript] = [:]
        for transcript in transcripts {
            guard let cwd = clean(transcript.cwd) else { continue }
            let key = processKey(source: transcript.source, cwd: cwd)
            if let current = result[key], current.mtimeMs >= transcript.mtimeMs { continue }
            result[key] = transcript
        }
        return result
    }

    private static func processKey(source: String, cwd: String) -> String {
        "\(source)\u{0}\(cwd)"
    }

    private static func normalizeSessionRef(_ value: String?) -> String? {
        guard let trimmed = clean(value) else { return nil }
        let leaf = (trimmed as NSString).lastPathComponent
        let ref = leaf.hasSuffix(".jsonl") ? String(leaf.dropLast(".jsonl".count)) : leaf
        return clean(ref)
    }

    private static func pathLeaf(_ value: String) -> String? {
        clean((value as NSString).lastPathComponent)
    }

    private static func pathParent(_ value: String) -> String? {
        let parent = (value as NSString).deletingLastPathComponent
        return pathLeaf(parent)
    }

    private static func clean(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }

    private static func formatBytes(_ bytes: Int) -> String {
        guard bytes >= 0 else { return "—" }
        if bytes < 1_024 { return "\(bytes) B" }
        let kib = Double(bytes) / 1_024
        if kib < 1_024 { return "\(Int(kib.rounded())) KiB" }
        let mib = kib / 1_024
        return String(format: "%.1f MiB", mib)
    }
}

// MARK: - Section header

private struct SessionsHeader: View {
    let sessions: [SynthesizedSession]

    private var running: Int { sessions.filter { $0.status == .running }.count }

    var body: some View {
        // Tab name is in the masthead. Eyebrow carries count + running.
        HUDEyebrow(
            text: "\(sessions.count) SESSION\(sessions.count == 1 ? "" : "S")  ·  \(running) RUNNING",
            color: HUDChrome.inkFaint
        )
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderStrong)
                .frame(height: 0.5)
                .padding(.horizontal, 16)
        }
    }
}

// MARK: - Row

private struct SessionRow: View {
    let session: SynthesizedSession
    let isFirst: Bool
    let size: HUDSize
    var cursored: Bool = false
    let engaged: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false

    // Mirrors tail's three-tier fill: cursored (j/k landing) → engaged
    // (Enter expansion) → hovered (mouse). Background carries the state;
    // no left edge bar (operator's call).
    private var rowFill: Color {
        if engaged  { return HUDChrome.canvasLift.opacity(0.70) }
        if cursored { return HUDChrome.canvasLift.opacity(0.42) }
        if hovered  { return HUDChrome.canvasLift.opacity(0.18) }
        return Color.clear
    }

    private var verticalPad: CGFloat { size == .compact ? 10 : 12 }

    var body: some View {
        VStack(alignment: .leading, spacing: size == .compact ? 5 : 7) {
            identityLine
            metaLine
            lastTurnLine
        }
        .padding(.leading, 16)
        .padding(.trailing, 14)
        .padding(.top, isFirst ? verticalPad + 1 : verticalPad)
        .padding(.bottom, verticalPad)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowFill)
        .overlay(alignment: .leading) {
            if session.status == .running || engaged {
                Rectangle()
                    .fill(HUDChrome.accent)
                    .frame(width: 1.5)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
                .padding(.horizontal, 16)
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onTap)
        .contextMenu {
            Button("Copy session ref") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(session.sessionRef, forType: .string)
            }
            if let agentId = session.agentId {
                Button("Copy agent ID") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(agentId, forType: .string)
                }
            }
        }
    }

    private var identityLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            StatusDot(status: session.status)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

            Text(session.agentName)
                .font(HUDType.body(13, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .fixedSize()

            if let handle = session.agentHandle {
                Text(handle.hasPrefix("@") ? handle : "@" + handle)
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .fixedSize()
            }

            Text(session.status.label)
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(session.status.color)
                .fixedSize()

            Spacer(minLength: 6)

            Text(session.ago)
                .font(HUDType.mono(10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkFaint)
                .fixedSize()
        }
    }

    private var metaLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            HarnessChip(harness: session.harness)
            metaDot
            Text(session.project.uppercased())
                .font(HUDType.mono(10))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(1)
            metaDot
            Text(session.branch)
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
                .lineLimit(1)
                .truncationMode(.middle)

            // WHY: medium/large surfaces runtime/size + event count on the meta strip.
            if size != .compact {
                metaDot
                Text(session.duration)
                    .font(HUDType.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
                metaDot
                Text("\(session.messageCount) evt")
                    .font(HUDType.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
            }

            Spacer(minLength: 0)
        }
        .padding(.leading, 14)
    }

    private var lastTurnLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text("↪")
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
            Text(session.lastTurn)
                .font(HUDType.body(size == .compact ? 11 : 12))
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(size == .compact ? 1 : 2)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: true)
                .lineSpacing(1.5)
            Spacer(minLength: 0)
        }
        .padding(.leading, 14)
    }

    private var metaDot: some View {
        Circle()
            .fill(HUDChrome.inkFaint)
            .frame(width: 1.8, height: 1.8)
    }
}

// MARK: - Status dot

private struct StatusDot: View {
    let status: SessionStatus

    var body: some View {
        ZStack {
            switch status {
            case .running:
                Circle()
                    .fill(HUDChrome.accent.opacity(0.32))
                    .frame(width: 12, height: 12)
                Circle()
                    .fill(HUDChrome.accent)
                    .frame(width: 6, height: 6)
            case .idle:
                Circle()
                    .fill(HUDChrome.inkMuted.opacity(0.65))
                    .frame(width: 6, height: 6)
            case .ended:
                Circle()
                    .stroke(HUDChrome.inkFaint, lineWidth: 1)
                    .frame(width: 6, height: 6)
            }
        }
        .frame(width: 12, height: 12)
    }
}

// MARK: - Harness chip

private struct HarnessChip: View {
    let harness: String

    var body: some View {
        Text(harness.uppercased())
            .font(HUDType.mono(10, weight: .semibold))
            .tracking(HUDType.eyebrowTracking)
            .foregroundStyle(HUDChrome.inkMuted)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(HUDChrome.canvas)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .stroke(HUDChrome.border, lineWidth: 0.5)
            )
    }
}

// MARK: - Engaged inline detail (compact + medium)

private struct SessionDetailInline: View {
    let session: SynthesizedSession
    var size: HUDSize = .compact

    private var padX: CGFloat {
        size == .large ? 20 : 18
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HUDEyebrow(text: "LAST TURN", color: HUDChrome.inkFaint)
            Text(session.lastTurn)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                .lineSpacing(2)

            VStack(alignment: .leading, spacing: 3) {
                meta(label: "REF", value: session.sessionRef)
                meta(label: "HARNESS", value: session.harness)
                meta(label: "MODEL", value: session.model)
                meta(label: "BRANCH", value: session.branch)
                meta(label: "RUNTIME", value: session.duration)
                meta(label: "EVENTS", value: "\(session.messageCount)")
            }

            VStack(alignment: .leading, spacing: 3) {
                HUDDrillLink(label: "OPEN TRANSCRIPT", url: transcriptURL)
                HUDDrillLink(label: "FOLLOW LIVE", url: followURL)
                HUDDrillLink(label: session.agentId == nil ? "SESSION DETAIL" : "AGENT PROFILE", url: agentURL)
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, padX)
        .padding(.vertical, size == .compact ? 11 : 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.55))
    }

    private func meta(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkDeep)
                .frame(width: 64, alignment: .leading)
            Text(value.isEmpty ? "—" : value)
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    // WHY: these rows are real tail-discovered transcript sessions. The
    // web's /api/session-ref resolves provider session IDs and transcript
    // file leaves, so use the session ref directly and treat agent links as
    // optional enrichment.

    private var transcriptURL: URL {
        let base = ScoutWeb.baseURL()
        let ref = session.sessionRef
        if !ref.isEmpty { return relativeURL("/sessions/\(percent(ref))", base: base) }
        if let cid = session.conversationId, !cid.isEmpty {
            return relativeURL("/c/\(percent(cid))", base: base)
        }
        let aid = session.agentId ?? ""
        if !aid.isEmpty {
            return relativeURL("/agents/\(percent(aid))?tab=message", base: base)
        }
        return relativeURL("/sessions", base: base)
    }

    private var followURL: URL {
        let base = ScoutWeb.baseURL()
        var components = URLComponents(
            url: base.appending(path: "follow"),
            resolvingAgainstBaseURL: false
        )
        var items = [URLQueryItem(name: "view", value: "tail")]
        let ref = session.sessionRef
        if !ref.isEmpty {
            items.append(URLQueryItem(name: "sessionId", value: ref))
            components?.queryItems = items
            return components?.url ?? relativeURL("/follow/session/\(percent(ref))", base: base)
        }
        let aid = session.agentId ?? ""
        if !aid.isEmpty {
            items.append(URLQueryItem(name: "targetAgentId", value: aid))
            components?.queryItems = items
            return components?.url ?? relativeURL("/follow/agent/\(percent(aid))", base: base)
        }
        if let q = tailQuery() {
            return relativeURL("/ops/tail?q=\(percentQuery(q))", base: base)
        }
        return relativeURL("/ops/tail", base: base)
    }

    private var agentURL: URL {
        let base = ScoutWeb.baseURL()
        guard let aid = session.agentId, !aid.isEmpty else {
            return relativeURL("/sessions/\(percent(session.sessionRef))", base: base)
        }
        return relativeURL("/agents/\(percent(aid))", base: base)
    }

    private func tailQuery() -> String? {
        if let h = session.agentHandle, !h.isEmpty {
            return h.hasPrefix("@") ? h : "@" + h
        }
        if !session.agentName.isEmpty { return session.agentName }
        return nil
    }

    private func percent(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }

    private func percentQuery(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }

    private func relativeURL(_ path: String, base: URL) -> URL {
        URL(string: path, relativeTo: base)?.absoluteURL ?? base
    }

}

private struct SessionsFeedEndMarker: View {
    var body: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
            Text("END OF SESSIONS")
                .font(HUDType.mono(9, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkFaint)
                .fixedSize()
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 16)
    }
}

// MARK: - Empty

private struct EmptySessions: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDEyebrow(text: "LEDGER  ·  NO SESSIONS", color: HUDChrome.inkFaint)
                .padding(.top, 18)

            Text("No sessions running.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text("Agent run sessions will print here as the broker reports them.")
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 6)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
