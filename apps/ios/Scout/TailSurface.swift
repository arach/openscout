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
                    LazyVStack(alignment: .leading, spacing: HudSpacing.sm) {
                        ForEach(events) { event in
                            row(event)
                        }
                    }
                    .padding(.horizontal, HudSpacing.xxl)
                    .padding(.bottom, HudSpacing.xxl)
                }
            }
        }
        .task { await subscribe() }
    }

    private func row(_ event: TailEvent) -> some View {
        HStack(alignment: .top, spacing: HudSpacing.lg) {
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                HStack(spacing: HudSpacing.sm) {
                    HudBadge(attributionLabel(event.harness), tint: attributionColor(event.harness), dot: true)
                    Text(event.source)
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .foregroundStyle(HudPalette.dim)
                    Text(event.kind.rawValue)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(HudPalette.muted)
                    Spacer(minLength: 0)
                    Text(timeLabel(event.tsMs))
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(HudPalette.dim)
                }
                Text(event.summary)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(HudPalette.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(HudSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(HudHairline.subtle, lineWidth: HudStrokeWidth.standard)
        )
    }

    private func attributionLabel(_ harness: TailEvent.Harness) -> String {
        switch harness {
        case .scoutManaged: return "scout"
        case .hudsonManaged: return "hudson"
        case .unattributed: return "unattributed"
        }
    }

    private func attributionColor(_ harness: TailEvent.Harness) -> Color {
        switch harness {
        case .scoutManaged: return HudPalette.accent   // the one accent
        case .hudsonManaged: return HudPalette.muted
        case .unattributed: return HudPalette.dim
        }
    }

    private func timeLabel(_ tsMs: Int64) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(tsMs) / 1000)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    private func subscribe() async {
        for await event in client.tailEvents(since: nil) {
            events.insert(event, at: 0)
            if events.count > Self.maxRows {
                events.removeLast(events.count - Self.maxRows)
            }
        }
        // Stream finished: a live adapter would stay `.live`; a finite batch
        // settles to a calm, non-pulsing state once it's all in.
        status = .stale
    }
}
