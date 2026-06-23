import SwiftUI
import HudsonUI
import HudsonLive
import ScoutCapabilities

/// Tail — recent cross-agent activity. Subscribes to `tailEvents(since:)`,
/// prepends newest events (capped at ~200), and labels each row's attribution
/// (scoutManaged / hudsonManaged / unattributed) via `HudBadge`. A
/// `HudLiveIndicator` pinned at the top reflects the stream state (a live
/// adapter keeps it open; a finite batch settles to idle once it's drained).
struct TailSurface: View {
    let client: any ScoutBrokerClient
    var reloadToken: Int = 0

    private static let maxRows = 200

    @State private var events: [TailEvent] = []
    @State private var status: HudLiveStatus = .connecting

    private var source: HudLiveSourceDescriptor {
        HudLiveSourceDescriptor(
            id: "scout.tail",
            label: "Activity firehose",
            kind: "tail",
            status: status,
            detail: "\(events.count) events",
            lastEventSummary: events.first?.summary
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                HudSectionLabel("Tail")
                Spacer()
                HudLiveIndicator(source: source, displayMode: .compact, chrome: .pill)
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.bottom, HudSpacing.lg)

            if events.isEmpty {
                HudEmptyState(title: "No recent activity", subtitle: "Cross-agent events will appear here.", icon: "waveform")
                    .padding(HudSpacing.xxl)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(events) { event in
                            row(event)
                        }
                    }
                    .padding(.horizontal, HudSpacing.xxl)
                    .padding(.bottom, HudSpacing.xxl)
                }
            }
        }
        .task(id: reloadToken) { await subscribe() }
    }

    private func row(_ event: TailEvent) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(timeLabel(event.tsMs))
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
                .frame(width: 52, alignment: .leading)
            Text(event.source)
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .foregroundStyle(ScoutInk.muted)
                .frame(width: 48, alignment: .leading)
                .lineLimit(1)
            Text(originAbbrev(event.harness))
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
                .frame(width: 18, alignment: .leading)
            HStack(spacing: 2) {
                Text(kindGlyph(event.kind))
                Text(kindLabel(event.kind))
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            }
            .foregroundStyle(ScoutInk.dim)
            .frame(width: 40, alignment: .leading)
            Text(event.summary)
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(HudPalette.ink)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, HudSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            HudDivider(color: HudHairline.subtle)
        }
    }

    private func originAbbrev(_ harness: TailEvent.Harness) -> String {
        switch harness {
        case .scoutManaged: return "sc"
        case .hudsonManaged: return "hu"
        case .unattributed: return "na"
        }
    }

    private func kindGlyph(_ kind: TailEvent.Kind) -> String {
        switch kind {
        case .user: return ">"
        case .assistant: return "<"
        case .tool: return "*"
        case .toolResult: return "="
        case .system: return "~"
        case .other: return "·"
        }
    }

    private func kindLabel(_ kind: TailEvent.Kind) -> String {
        switch kind {
        case .user: return "USR"
        case .assistant: return "AST"
        case .tool: return "TOL"
        case .toolResult: return "OUT"
        case .system: return "SYS"
        case .other: return "EVT"
        }
    }

    private func timeLabel(_ tsMs: Int64) -> String {
        ScoutTimestamp.clockTime(fromEpoch: TimeInterval(tsMs)) ?? "—"
    }

    private func subscribe() async {
        status = .connecting
        for await event in client.tailEvents(since: nil) {
            if status != .live { status = .live }
            events.insert(event, at: 0)
            if events.count > Self.maxRows {
                events.removeLast(events.count - Self.maxRows)
            }
        }
        // Stream finished: a live adapter would stay `.live`; a finite batch
        // settles to a calm, non-pulsing state once it's all in.
        if !Task.isCancelled {
            status = .stale
        }
    }
}
