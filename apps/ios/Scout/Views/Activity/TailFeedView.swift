// TailFeedView — htop / journalctl-style live firehose of agent activity.
//
// Three sources merge by timestamp into one dense stream:
//   1. mobile/activity polling — broker control events (existing)
//   2. tail.events subscription — machine-wide harness transcripts (Lane A)
//   3. turn projections — Scout in-app conversation events
//
// Rows show a leading attribution dot (Scout-managed / Hudson-managed /
// native), a kind glyph, a runtime harness tag (claude / codex / scout), the
// actor, and a snippet. A `↳` prefix indicates the row's parentPid is in the
// recently-seen process map (cross-harness spawn hint).
//
// See docs/tail-firehose.md.

import SwiftUI

struct TailFeedView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var activities: [ActivityItem] = []
    @State private var tailEvents: [TailEvent] = []
    @State private var turnRows: [TurnProjection] = []
    @State private var livePids: Set<Int> = []
    @State private var paused = false
    @State private var error: String?
    @State private var isPolling = false
    @State private var lastFetchTs: Int = 0
    @State private var ratePerMin: Int = 0
    @State private var rateWindow: [Int] = []  // ts (sec) of items observed in last 60s
    @State private var mutedActivityKinds: [String: Date] = [:]  // kind → expiry

    private static let muteDuration: TimeInterval = 5 * 60

    /// Safety-net refresh cadence in case no bridge events flow for a while.
    /// Real-time updates ride on `connection.subscribeToEvents()` instead.
    private static let safetyPollInterval: Duration = .seconds(8)
    private static let rateWindowSec = 60
    private static let tailBufferLimit = 500
    private static let turnBufferLimit = 500

    private var rows: [TailFeedRow] {
        let now = Date()
        let merged: [TailFeedRow] =
            activities.map(TailFeedRow.activity)
            + tailEvents.map(TailFeedRow.tail)
            + turnRows.map(TailFeedRow.turn)
        return merged
            .filter { !$0.isNoise }
            .filter { !isMuted($0, now: now) }
            .sorted { $0.tsMs > $1.tsMs }
    }

    private func isMuted(_ row: TailFeedRow, now: Date) -> Bool {
        guard case .activity(let item) = row,
              let expiry = mutedActivityKinds[item.kind] else {
            return false
        }
        return expiry > now
    }

    private func activityKind(_ row: TailFeedRow) -> String? {
        if case .activity(let item) = row { return item.kind }
        return nil
    }

    private func sessionId(_ row: TailFeedRow) -> String? {
        switch row {
        case .activity(let item): return item.sessionId ?? item.conversationId
        case .turn(let proj): return proj.sessionId
        case .tail: return nil
        }
    }

    private func copyLine(for row: TailFeedRow) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        let date = Date(timeIntervalSince1970: Double(row.tsMs) / 1000.0)
        let ts = formatter.string(from: date)
        switch row {
        case .activity(let item):
            let body = item.title ?? item.summary ?? item.kindLabel
            return "\(ts) [\(item.kind)] \(item.actorId ?? item.agentId ?? "system") · \(body)"
        case .tail(let event):
            return "\(ts) [\(event.kind.rawValue)] \(event.project) · \(event.summary)"
        case .turn(let proj):
            let phase = proj.phase == .start ? "start" : "end"
            return "\(ts) [turn:\(phase)] \(proj.sessionId.prefix(8)) · \(proj.snippet)"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Top safe-area inset behind the blur.
            Color.clear.frame(height: 0)

            header

            Divider()
                .background(ScoutColors.divider)

            tailList

            Divider()
                .background(ScoutColors.divider)

            footer
        }
        .background(ScoutColors.backgroundAdaptive)
        .task { await activityLoop() }
        .task { await safetyPollLoop() }
        .task { await tailEventLoop() }
        .task { await turnEventLoop() }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "terminal")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(ScoutColors.textSecondary)

            Text("TAIL")
                .font(ScoutTypography.code(11, weight: .bold))
                .foregroundStyle(ScoutColors.textPrimary)

            Text("·")
                .foregroundStyle(ScoutColors.textMuted)

            HStack(spacing: 4) {
                Circle()
                    .fill(paused ? ScoutColors.ledAmber : ScoutColors.ledGreen)
                    .frame(width: 5, height: 5)
                Text(paused ? "PAUSED" : "LIVE")
                    .font(ScoutTypography.code(9, weight: .semibold))
                    .foregroundStyle(paused ? ScoutColors.ledAmber : ScoutColors.ledGreen)
            }

            Spacer()

            Text("\(ratePerMin)/m")
                .font(ScoutTypography.code(9, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            Text("·")
                .foregroundStyle(ScoutColors.textMuted)

            Text("\(rows.count)")
                .font(ScoutTypography.code(9, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            Button {
                paused.toggle()
            } label: {
                Image(systemName: paused ? "play.fill" : "pause.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(paused ? "Resume tail" : "Pause tail")
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.sm)
        .background(ScoutColors.surfaceRaisedAdaptive)
    }

    // MARK: - Tail rows

    private var tailList: some View {
        Group {
            if let error {
                centered {
                    VStack(spacing: ScoutSpacing.sm) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 22))
                            .foregroundStyle(ScoutColors.ledRed)
                        Text(error)
                            .font(ScoutTypography.code(11))
                            .foregroundStyle(ScoutColors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                }
            } else if rows.isEmpty {
                centered {
                    VStack(spacing: ScoutSpacing.sm) {
                        Image(systemName: "terminal")
                            .font(.system(size: 22))
                            .foregroundStyle(ScoutColors.textMuted)
                        Text("waiting for events…")
                            .font(ScoutTypography.code(11))
                            .foregroundStyle(ScoutColors.textMuted)
                    }
                }
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(rows) { row in
                            TailRow(row: row, livePids: livePids)
                                .contextMenu {
                                    Button {
                                        UIPasteboard.general.string = copyLine(for: row)
                                    } label: {
                                        Label("Copy Line", systemImage: "doc.on.doc")
                                    }

                                    if let sid = sessionId(row) {
                                        Button {
                                            router.push(.sessionDetail(sessionId: sid))
                                        } label: {
                                            Label("Open Session", systemImage: "arrow.up.right.square")
                                        }
                                    }

                                    if let kind = activityKind(row) {
                                        Button(role: .destructive) {
                                            mutedActivityKinds[kind] =
                                                Date().addingTimeInterval(Self.muteDuration)
                                        } label: {
                                            Label("Mute \(kind) for 5m", systemImage: "speaker.slash")
                                        }
                                    }
                                }
                            Divider()
                                .background(ScoutColors.divider.opacity(0.4))
                        }
                        Color.clear.frame(height: 100)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func centered<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack {
            Spacer()
            content()
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: connection.state == .connected ? "wifi" : "wifi.slash")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            Text(connection.state == .connected ? "ws subscription" : "offline")
                .font(ScoutTypography.code(9, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            if isPolling {
                Text("·")
                    .foregroundStyle(ScoutColors.textMuted)
                Text("syncing")
                    .font(ScoutTypography.code(9))
                    .foregroundStyle(ScoutColors.textMuted)
            }

            Spacer()

            Text("Newest on top")
                .font(ScoutTypography.code(9))
                .foregroundStyle(ScoutColors.textMuted)
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.xs)
        .background(ScoutColors.surfaceRaisedAdaptive)
    }

    // MARK: - Live updates

    /// Subscribes to the bridge's sequenced-event fanout and refetches the
    /// activity buffer on each event. This drives source #1 (broker control
    /// events) and is the existing behavior from before the merge.
    private func activityLoop() async {
        await fetchActivityOnce()
        for await _ in connection.subscribeToEvents() {
            if Task.isCancelled { break }
            if paused { continue }
            await fetchActivityOnce()
        }
    }

    /// Backstop poll for cases where no events flow but state may still drift
    /// (offline → online transitions, cold starts, missed events).
    private func safetyPollLoop() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: Self.safetyPollInterval)
            if !paused {
                await fetchActivityOnce()
            }
            recomputeRate()
        }
    }

    /// Source #2: machine-wide harness transcript firehose (Lane A).
    /// Stays empty until the bridge wires the `tail.events` subscription.
    private func tailEventLoop() async {
        for await event in connection.subscribeToTailEvents() {
            if Task.isCancelled { break }
            if paused { continue }
            appendTailEvent(event)
        }
    }

    /// Source #3: project turnStart events from the existing fanout into
    /// firehose rows so Scout's in-app conversation appears alongside external
    /// agents. We piggyback on `subscribeToEvents()` rather than open a third
    /// stream — same wire, two consumers.
    private func turnEventLoop() async {
        for await sequenced in connection.subscribeToEvents() {
            if Task.isCancelled { break }
            if paused { continue }
            switch sequenced.event {
            case .turnStart(let sessionId, let turn):
                appendTurn(
                    TurnProjection(
                        id: "\(turn.id):start",
                        turnId: turn.id,
                        sessionId: sessionId,
                        tsMs: Int(Date().timeIntervalSince1970 * 1000),
                        phase: .start,
                        isUserTurn: turn.isUserTurn ?? false,
                        snippet: turn.isUserTurn == true ? "user message" : "agent reply"
                    )
                )
            case .turnEnd(let sessionId, let turnId, let status):
                appendTurn(
                    TurnProjection(
                        id: "\(turnId):end",
                        turnId: turnId,
                        sessionId: sessionId,
                        tsMs: Int(Date().timeIntervalSince1970 * 1000),
                        phase: .end,
                        isUserTurn: false,
                        snippet: "turn \(status.rawValue)"
                    )
                )
            default:
                break
            }
        }
    }

    private func fetchActivityOnce() async {
        guard connection.state == .connected else { return }
        isPolling = true
        defer { isPolling = false }
        do {
            let fresh = try await connection.getActivity(limit: 200)
            // Track new items for the rate window.
            let nowSec = Int(Date().timeIntervalSince1970)
            let knownIds = Set(activities.map(\.id))
            let added = fresh.filter { !knownIds.contains($0.id) }
            rateWindow.append(contentsOf: Array(repeating: nowSec, count: added.count))
            // Replace the activity slice (newest first based on tsMs descending).
            activities = fresh.sorted { $0.tsMs > $1.tsMs }
            error = nil
            lastFetchTs = nowSec
            recomputeRate()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func appendTailEvent(_ event: TailEvent) {
        tailEvents.append(event)
        if tailEvents.count > Self.tailBufferLimit {
            tailEvents.removeFirst(tailEvents.count - Self.tailBufferLimit)
        }
        livePids.insert(event.pid)
        let nowSec = Int(Date().timeIntervalSince1970)
        rateWindow.append(nowSec)
        recomputeRate()
    }

    private func appendTurn(_ turn: TurnProjection) {
        turnRows.append(turn)
        if turnRows.count > Self.turnBufferLimit {
            turnRows.removeFirst(turnRows.count - Self.turnBufferLimit)
        }
        let nowSec = Int(Date().timeIntervalSince1970)
        rateWindow.append(nowSec)
        recomputeRate()
    }

    private func recomputeRate() {
        let cutoff = Int(Date().timeIntervalSince1970) - Self.rateWindowSec
        rateWindow = rateWindow.filter { $0 >= cutoff }
        ratePerMin = rateWindow.count
    }
}

// MARK: - Row

private struct TailRow: View {
    let row: TailFeedRow
    let livePids: Set<Int>

    private var glyph: String {
        switch row {
        case .activity(let item):
            switch item.kind {
            case "message_posted":      return ">"
            case "agent_message":       return "<"
            case "ask_opened":          return "?"
            case "ask_replied":         return "↳"
            case "ask_failed":          return "✕"
            case "handoff_sent":        return "→"
            case "invocation_recorded": return "*"
            case "flight_updated":      return "≈"
            case "collaboration_event": return "·"
            default:                    return "·"
            }
        case .tail(let event):
            switch event.kind {
            case .user:       return ">"
            case .assistant:  return "<"
            case .tool:       return "*"
            case .toolResult: return "↳"
            case .system:     return "·"
            case .other:      return "·"
            }
        case .turn(let proj):
            return proj.isUserTurn ? ">" : "<"
        }
    }

    private var glyphColor: Color {
        switch row {
        case .activity(let item):
            switch item.kind {
            case "agent_message", "ask_replied":  return ScoutColors.ledGreen
            case "message_posted":                return ScoutColors.textSecondary
            case "ask_opened":                    return ScoutColors.ledAmber
            case "ask_failed":                    return ScoutColors.ledRed
            case "handoff_sent", "flight_updated": return ScoutColors.textMuted
            default:                              return ScoutColors.textMuted
            }
        case .tail(let event):
            switch event.kind {
            case .assistant: return ScoutColors.ledGreen
            case .user:      return ScoutColors.textSecondary
            case .tool:      return ScoutColors.ledAmber
            case .toolResult: return ScoutColors.textMuted
            default:         return ScoutColors.textMuted
            }
        case .turn:
            return ScoutColors.textSecondary
        }
    }

    private var attributionColor: Color {
        switch row.attribution {
        case .scoutManaged:  return ScoutColors.ledGreen
        case .hudsonManaged: return ScoutColors.ledAmber
        case .unattributed:  return ScoutColors.textMuted
        }
    }

    private var engineLabel: String {
        guard let engine = row.engine else { return "" }
        return engine
    }

    private var timeLabel: String {
        let date: Date
        switch row {
        case .activity(let item): date = item.date
        case .tail(let event): date = event.date
        case .turn(let proj): date = Date(timeIntervalSince1970: Double(proj.tsMs) / 1000.0)
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    private var actor: String {
        switch row {
        case .activity(let item):
            return item.actorId ?? item.agentId ?? "system"
        case .tail(let event):
            return event.project
        case .turn(let proj):
            return proj.sessionId.prefix(8).description
        }
    }

    private var snippet: String {
        switch row {
        case .activity(let item):
            return item.title ?? item.summary ?? item.kindLabel
        case .tail(let event):
            return event.summary
        case .turn(let proj):
            return proj.snippet
        }
    }

    /// `↳` prefix when this row's parentPid was recently seen in the firehose —
    /// a cross-harness spawn hint. Only meaningful for tail events.
    private var hasParentInScope: Bool {
        if case .tail(let event) = row, let pp = event.parentPid {
            return livePids.contains(pp)
        }
        return false
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(timeLabel)
                .font(ScoutTypography.code(10))
                .foregroundStyle(ScoutColors.textMuted)
                .frame(width: 60, alignment: .leading)

            Circle()
                .fill(attributionColor)
                .frame(width: 5, height: 5)
                .frame(width: 8, alignment: .center)

            Text(glyph)
                .font(ScoutTypography.code(11, weight: .bold))
                .foregroundStyle(glyphColor)
                .frame(width: 12)

            Text(engineLabel)
                .font(ScoutTypography.code(9, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)
                .lineLimit(1)
                .frame(width: 44, alignment: .leading)

            Text(actor)
                .font(ScoutTypography.code(10, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)
                .lineLimit(1)
                .frame(width: 84, alignment: .leading)

            HStack(spacing: 4) {
                if hasParentInScope {
                    Text("↳")
                        .font(ScoutTypography.code(10))
                        .foregroundStyle(ScoutColors.textMuted)
                }
                Text(snippet)
                    .font(ScoutTypography.code(10))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, 5)
    }
}
