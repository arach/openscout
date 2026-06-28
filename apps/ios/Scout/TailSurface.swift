import SwiftUI
import HudsonUI
import HudsonLive
import ScoutCapabilities

/// Tail — recent cross-agent activity. Polls a recent-tail snapshot
/// (`recentTail(limit:)`) on a slow cadence while the view is open, newest-first,
/// capped at ~200. Each row reads: time (HH:mm:ss) · /path:session (tinted by
/// model) · kind glyph · summary. The header shows when it last pulled + a ↻ button
/// — no live indicator, since mobile doesn't need a low-latency firehose for "a
/// sense of what's going on". Polling keeps the firehose off the cellular link
/// except while Tail is the active surface (the task tears down otherwise).
struct TailSurface: View {
    let client: any ScoutBrokerClient
    var reloadToken: Int = 0

    private static let maxRows = 200
    /// Slow background refresh cadence — this surface isn't live; the header shows
    /// when it last pulled and the ↻ button forces an immediate refresh, so the
    /// auto-poll just keeps it loosely current at minimal cellular/battery cost.
    private static let pollIntervalSeconds: Double = 15

    @State private var events: [TailEvent] = []
    /// When the snapshot was last pulled — shown in the header in place of a live
    /// indicator (this surface polls; it isn't a real-time stream).
    @State private var lastUpdated: Date?
    /// Bumped by the header refresh button to force an immediate re-poll.
    @State private var refreshToken = 0

    private static let hmFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f
    }()
    /// Row timestamps keep the seconds — dense HH:mm:ss reads well in the
    /// firehose. (The header `updated` stays coarse HH:mm.)
    private static let clockFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: HudSpacing.sm) {
                HudSectionLabel("Tail")
                Spacer()
                if let lastUpdated {
                    Text("updated \(Self.hmFormatter.string(from: lastUpdated))")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutInk.dim)
                }
                Button { refreshToken += 1 } label: {
                    Text("↻")
                        .font(.system(size: 14, weight: .semibold, design: .monospaced))
                        .foregroundStyle(ScoutInk.muted)
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
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
        .task(id: reloadToken) { await poll() }
        .task(id: refreshToken) { if refreshToken != 0 { await fetchOnce() } }
    }

    private func row(_ event: TailEvent) -> some View {
        // One uniform gap (HudSpacing.sm) between every token — the columns hug
        // their content instead of sitting in over-wide fixed frames, so the gaps
        // are methodical and the glyph reads tight against the path. Only the
        // timestamp keeps a fixed width (it's the constant-width anchor).
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(timeLabel(event.tsMs))
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
                .frame(width: 54, alignment: .leading)
            handleText(event)
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .fixedSize(horizontal: true, vertical: false)
            Text(kindGlyph(event.kind))
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(kindColor(event.kind))
                .fixedSize()
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

    private static let pathFixedLen = 14

    /// `/project-rooted-path[:fixedlen]:sessionlast4` — e.g. `/openscout:9688`.
    /// The folder path is primary ink so the location reads first; the `:session`
    /// tail is the secondary/muted tone so the id recedes.
    private func handleText(_ event: TailEvent) -> Text {
        var path = projectRootedPath(cwd: event.cwd, project: event.project)
        if path.count > Self.pathFixedLen { path = String(path.prefix(Self.pathFixedLen)) }
        let base = Text(path).foregroundStyle(HudPalette.ink)
        let last4 = String((event.conversationId ?? "").suffix(4))
        guard !last4.isEmpty else { return base }
        return base + Text(":\(last4)").foregroundStyle(ScoutInk.muted)
    }

    /// The cwd re-rooted at the project dir so the meaningful tail leads: e.g.
    /// `/Users/arach/dev/openscout/apps/ios` → `/openscout/apps/ios`. Falls back
    /// to `/project`, then the last two path components.
    private func projectRootedPath(cwd: String?, project: String?) -> String {
        if let project, !project.isEmpty, let cwd, let r = cwd.range(of: "/" + project) {
            return String(cwd[r.lowerBound...])
        }
        if let project, !project.isEmpty { return "/" + project }
        if let cwd, !cwd.isEmpty {
            return "/" + cwd.split(separator: "/").suffix(2).joined(separator: "/")
        }
        return "—"
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

    /// Color per event kind so the glyph column scans at a glance: user/assistant
    /// are the conversation poles, tool/result the work, system/other recede.
    private func kindColor(_ kind: TailEvent.Kind) -> Color {
        switch kind {
        case .user: return Color(red: 0.50, green: 0.68, blue: 0.95)       // blue
        case .assistant: return Color(red: 0.45, green: 0.78, blue: 0.55)  // green
        case .tool: return Color(red: 0.88, green: 0.62, blue: 0.38)       // amber
        case .toolResult: return Color(red: 0.52, green: 0.72, blue: 0.70) // teal
        case .system: return ScoutInk.muted
        case .other: return ScoutInk.dim
        }
    }

    private func timeLabel(_ tsMs: Int64) -> String {
        Self.clockFormatter.string(from: Date(timeIntervalSince1970: Double(tsMs) / 1000.0))
    }

    private func poll() async {
        // Re-fetch a recent snapshot on a slow cadence for as long as this surface
        // is on screen. The `.task` is torn down when Tail isn't the active
        // surface, so the firehose only crosses the link while you're watching;
        // backgrounding is covered by iOS suspending the app. The query is
        // resilient server-side (a fresh broker read per call — no stale push).
        while !Task.isCancelled {
            await fetchOnce()
            if Task.isCancelled { break }
            try? await Task.sleep(for: .seconds(Self.pollIntervalSeconds))
        }
    }

    /// One snapshot fetch — shared by the slow auto-poll and the manual refresh
    /// button. Records `lastUpdated` only on success, so a transient failure
    /// leaves the last good data (and its timestamp) on screen.
    private func fetchOnce() async {
        guard let snapshot = try? await client.recentTail(limit: Self.maxRows),
              !Task.isCancelled else { return }
        events = snapshot.sorted { $0.tsMs > $1.tsMs }
        lastUpdated = Date()
    }
}
