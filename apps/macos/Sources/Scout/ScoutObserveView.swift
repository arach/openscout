import Foundation
import HudsonUI
import SwiftUI

struct ScoutAgentObserveContent: View {
    let agent: ScoutAgent
    let payload: ScoutObservePayload?
    let isLoading: Bool
    let error: String?
    let refresh: () -> Void
    let showRoster: () -> Void
    let openChannel: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            HudDivider(color: ScoutDesign.hairline)
            content
        }
        .background(ScoutDesign.bg)
    }

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: HudSpacing.huge) {
            HStack(spacing: HudSpacing.md) {
                Text(agent.displayName)
                    .font(HudFont.ui(HudTextSize.xxl, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                HudBadge(agent.state.label, tint: agent.state.tint, dot: true)
            }
        } secondary: {
            HStack(spacing: HudSpacing.md) {
                HudBadge("Observe", tint: HudPalette.accent)
                if let payload {
                    HudBadge(payload.source.uppercased(), tint: payload.data.live ? HudPalette.statusOk : HudPalette.muted, dot: payload.data.live)
                    HudBadge(payload.fidelity.uppercased(), tint: HudPalette.statusInfo)
                } else {
                    HudBadge("Native", tint: HudPalette.muted)
                }
                Text(agent.id)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(HudPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        } trailing: {
            HStack(spacing: HudSpacing.xl) {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                }

                HudButton("Refresh", icon: "arrow.clockwise", style: .secondary, action: refresh)
                HudButton("Roster", icon: "square.grid.2x2", style: .secondary, action: showRoster)
                HudButton("Open DM", icon: "bubble.left", style: .ghost, action: openChannel)
            }
        }
        .background(ScoutDesign.bg)
    }

    @ViewBuilder
    private var content: some View {
        if let payload {
            ScrollView {
                VStack(alignment: .leading, spacing: HudSpacing.xl) {
                    ScoutObserveSourceStrip(agent: agent, payload: payload)
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: HudSpacing.xxl) {
                            ScoutObserveTimeline(events: payload.data.events)
                                .frame(minWidth: 360, maxWidth: .infinity, alignment: .topLeading)
                            ScoutObserveDetailsRail(payload: payload)
                                .frame(width: 286)
                        }

                        VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                            ScoutObserveTimeline(events: payload.data.events)
                            ScoutObserveDetailsRail(payload: payload)
                        }
                    }
                }
                .padding(HudSpacing.huge)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .scoutOverlayScrollers()
            }
            .scrollIndicators(.visible)
        } else if isLoading {
            VStack(spacing: HudSpacing.md) {
                ProgressView()
                Text("Loading observe stream")
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(HudPalette.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(spacing: HudSpacing.xl) {
                HudEmptyState(
                    title: "Observe unavailable",
                    subtitle: error ?? "This agent does not have a readable observe stream yet.",
                    icon: "eye.slash"
                )
                .frame(maxWidth: 420)
                HudButton("Retry", icon: "arrow.clockwise", style: .secondary, action: refresh)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(HudSpacing.huge)
        }
    }
}

private struct ScoutObserveSourceStrip: View {
    let agent: ScoutAgent
    let payload: ScoutObservePayload

    var body: some View {
        HStack(spacing: HudSpacing.xl) {
            ScoutObserveMetric(title: "Events", value: "\(payload.data.events.count)", icon: "waveform.path.ecg")
            ScoutObserveMetric(title: "Files", value: "\(payload.data.files.count)", icon: "doc.text")
            ScoutObserveMetric(title: "Updated", value: payload.updatedLabel, icon: "clock")
            if let sessionId = payload.sessionId?.nilIfEmpty {
                ScoutObserveMetric(title: "Session", value: sessionId, icon: "number")
            }
            Spacer(minLength: HudSpacing.xxl)
            Text(agent.workspace)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(HudPalette.dim)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(HudSpacing.xl)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(HudSurface.inset))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
    }
}

private struct ScoutObserveMetric: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: icon)
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(HudPalette.accent)
                .frame(width: 18, height: 18)
                .background(Circle().fill(HudPalette.accent.opacity(0.12)))
            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                Text(title.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(HudPalette.dim)
                Text(value)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }
}

private struct ScoutObserveTimeline: View {
    let events: [ScoutObserveEvent]

    private var sortedEvents: [ScoutObserveEvent] {
        events.sorted { lhs, rhs in
            if lhs.t == rhs.t { return lhs.id < rhs.id }
            return lhs.t < rhs.t
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            HStack {
                HudSectionLabel("Timeline")
                Spacer()
                HudBadge("\(events.count)", tint: HudPalette.muted)
            }

            if sortedEvents.isEmpty {
                HudEmptyState(title: "No observe events", subtitle: "Scout has not seen a session stream for this agent.", icon: "timeline.selection")
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(sortedEvents.enumerated()), id: \.element.id) { index, event in
                        ScoutObserveEventRow(event: event, isLast: index == sortedEvents.count - 1)
                    }
                }
                .padding(.vertical, HudSpacing.sm)
            }
        }
    }
}

private struct ScoutObserveEventRow: View {
    let event: ScoutObserveEvent
    let isLast: Bool

    var body: some View {
        HStack(alignment: .top, spacing: HudSpacing.lg) {
            Text(event.timelineLabel)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(HudPalette.dim)
                .frame(width: 42, alignment: .trailing)
                .padding(.top, HudSpacing.xxs)

            VStack(spacing: 0) {
                Circle()
                    .fill(event.kind.tint)
                    .frame(width: 9, height: 9)
                    .overlay(Circle().stroke(ScoutDesign.bg, lineWidth: HudStrokeWidth.bold))
                    .padding(.top, HudSpacing.sm)
                if !isLast {
                    Rectangle()
                        .fill(ScoutDesign.hairlineStrong)
                        .frame(width: 1)
                        .frame(maxHeight: .infinity)
                }
            }
            .frame(width: 12)
            .frame(minHeight: 38)

            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack(spacing: HudSpacing.md) {
                    Label(event.kind.label, systemImage: event.kind.icon)
                        .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                        .foregroundStyle(event.kind.tint)
                        .labelStyle(.titleAndIcon)
                    if event.live {
                        HudBadge("Live", tint: HudPalette.statusOk, dot: true)
                    }
                    if let tool = event.tool?.nilIfEmpty {
                        HudBadge(tool, tint: HudPalette.accent)
                    }
                    if let to = event.to?.nilIfEmpty {
                        HudBadge("@\(to)", tint: HudPalette.statusInfo)
                    }
                    Spacer(minLength: HudSpacing.md)
                }

                if !event.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(event.text)
                        .font(event.kind == .think ? HudFont.ui(HudTextSize.lgm) : HudFont.ui(HudTextSize.base))
                        .foregroundStyle(event.kind == .think ? HudPalette.muted : HudPalette.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }

                if let detail = event.detail?.nilIfEmpty {
                    Text(detail)
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(HudPalette.dim)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }

                if let arg = event.arg?.nilIfEmpty {
                    ScoutObserveMonoBlock(text: arg, accent: event.kind.tint)
                }

                if !event.result.isEmpty {
                    ScoutObserveResultGrid(result: event.result)
                }

                if let diff = event.diff {
                    ScoutObserveDiffBlock(diff: diff)
                }

                if !event.stream.isEmpty {
                    ScoutObserveMonoBlock(text: event.stream.joined(separator: "\n"), accent: HudPalette.muted)
                }

                if let answer = event.answer?.nilIfEmpty {
                    VStack(alignment: .leading, spacing: HudSpacing.sm) {
                        HudSectionLabel("Answer")
                        Text(answer)
                            .font(HudFont.ui(HudTextSize.sm))
                            .foregroundStyle(HudPalette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }
                    .padding(.top, HudSpacing.xs)
                }
            }
            .padding(.bottom, isLast ? 0 : HudSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ScoutObserveResultGrid: View {
    let result: [String: ScoutObserveValue]

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ForEach(result.keys.sorted(), id: \.self) { key in
                if let value = result[key] {
                    HStack(spacing: HudSpacing.md) {
                        Text(key.uppercased())
                            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                            .tracking(0.8)
                            .foregroundStyle(HudPalette.dim)
                            .frame(width: 92, alignment: .leading)
                        Text(value.description)
                            .font(HudFont.mono(HudTextSize.xxs))
                            .foregroundStyle(HudPalette.muted)
                            .lineLimit(2)
                            .truncationMode(.middle)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
        .padding(HudSpacing.md)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.control))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
        )
    }
}

private struct ScoutObserveDiffBlock: View {
    let diff: ScoutObserveDiff

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack(spacing: HudSpacing.md) {
                HudBadge("+\(diff.add)", tint: HudPalette.statusOk)
                if diff.del > 0 {
                    HudBadge("-\(diff.del)", tint: HudPalette.statusError)
                }
            }
            if !diff.preview.isEmpty {
                ScoutObserveMonoBlock(text: diff.preview, accent: HudPalette.statusOk)
            }
        }
    }
}

private struct ScoutObserveMonoBlock: View {
    let text: String
    let accent: Color

    var body: some View {
        ScrollView(.horizontal) {
            Text(text)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(HudPalette.muted)
                .textSelection(.enabled)
                .padding(HudSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.hidden)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(accent.opacity(0.24), lineWidth: HudStrokeWidth.thin)
        )
    }
}

private struct ScoutObserveDetailsRail: View {
    let payload: ScoutObservePayload

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            ScoutObserveStatusCard(payload: payload)
            if let session = payload.data.metadata?.session {
                ScoutObserveSessionCard(session: session)
            }
            if let usage = payload.data.metadata?.usage {
                ScoutObserveUsageCard(usage: usage, contextUsage: payload.data.contextUsage)
            } else if !payload.data.contextUsage.isEmpty {
                ScoutObserveContextCard(contextUsage: payload.data.contextUsage)
            }
            ScoutObserveFilesCard(files: payload.data.files)
        }
    }
}

private struct ScoutObserveStatusCard: View {
    let payload: ScoutObservePayload

    var body: some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HudSectionLabel("Observe")
                HudKVRow("Source", value: payload.source)
                HudKVRow("Fidelity", value: payload.fidelity)
                HudKVRow("Updated", value: payload.updatedLabel)
                HudKVRow("Live", value: payload.data.live ? "yes" : "no", valueColor: payload.data.live ? HudPalette.statusOk : HudPalette.muted)
                if let sessionId = payload.sessionId?.nilIfEmpty {
                    HudKVRow("Session", value: sessionId)
                }
                if let historyPath = payload.historyPath?.nilIfEmpty {
                    HudKVRow("History", value: historyPath)
                }
            }
        }
    }
}

private struct ScoutObserveSessionCard: View {
    let session: ScoutObserveSessionMeta

    var body: some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HudSectionLabel("Session")
                ForEach(rows, id: \.0) { key, value in
                    HudKVRow(key, value: value)
                }
            }
        }
    }

    private var rows: [(String, String)] {
        [
            ("Adapter", session.adapterType),
            ("Model", session.model),
            ("Provider", session.modelProvider),
            ("Effort", session.effort),
            ("Turns", session.turnCount.map(String.init)),
            ("Branch", session.gitBranch),
            ("CWD", session.cwd),
            ("Sandbox", session.sandbox),
            ("Approval", session.approvalPolicy ?? session.permissionMode),
            ("CLI", session.cliVersion),
            ("TZ", session.timezone),
        ].compactMap { key, value in
            guard let value = value?.nilIfEmpty else { return nil }
            return (key, value)
        }
    }
}

private struct ScoutObserveUsageCard: View {
    let usage: ScoutObserveUsageMeta
    let contextUsage: [Double]

    var body: some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HudSectionLabel("Usage")
                ForEach(rows, id: \.0) { key, value in
                    HudKVRow(key, value: value)
                }
                if let latestContext = contextUsage.last {
                    HudKVRow("Context", value: ScoutObserveFormatting.percent(latestContext), valueColor: HudPalette.statusInfo)
                }
            }
        }
    }

    private var rows: [(String, String)] {
        [
            ("Total", usage.totalTokens.map(ScoutObserveFormatting.compactNumber)),
            ("Input", usage.inputTokens.map(ScoutObserveFormatting.compactNumber)),
            ("Output", usage.outputTokens.map(ScoutObserveFormatting.compactNumber)),
            ("Reasoning", usage.reasoningOutputTokens.map(ScoutObserveFormatting.compactNumber)),
            ("Cache read", usage.cacheReadInputTokens.map(ScoutObserveFormatting.compactNumber)),
            ("Cache write", usage.cacheCreationInputTokens.map(ScoutObserveFormatting.compactNumber)),
            ("Window", usage.contextWindowTokens.map(ScoutObserveFormatting.compactNumber)),
            ("Speed", usage.speed),
            ("Tier", usage.serviceTier),
            ("Plan", usage.planType),
            ("Web search", usage.webSearchRequests.map(String.init)),
            ("Web fetch", usage.webFetchRequests.map(String.init)),
        ].compactMap { key, value in
            guard let value = value?.nilIfEmpty else { return nil }
            return (key, value)
        }
    }
}

private struct ScoutObserveContextCard: View {
    let contextUsage: [Double]

    var body: some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HudSectionLabel("Context")
                if let latest = contextUsage.last {
                    HudKVRow("Latest", value: ScoutObserveFormatting.percent(latest), valueColor: HudPalette.statusInfo)
                }
                HudKVRow("Samples", value: "\(contextUsage.count)")
            }
        }
    }
}

private struct ScoutObserveFilesCard: View {
    let files: [ScoutObserveFile]

    private var sortedFiles: [ScoutObserveFile] {
        files.sorted { lhs, rhs in
            if lhs.lastT == rhs.lastT { return lhs.path < rhs.path }
            return lhs.lastT > rhs.lastT
        }
    }

    var body: some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                HStack {
                    HudSectionLabel("Files")
                    Spacer()
                    HudBadge("\(files.count)", tint: HudPalette.muted)
                }

                if sortedFiles.isEmpty {
                    Text("No file touches yet.")
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(HudPalette.dim)
                } else {
                    ForEach(sortedFiles.prefix(12)) { file in
                        ScoutObserveFileRow(file: file)
                    }
                }
            }
        }
    }
}

private struct ScoutObserveFileRow: View {
    let file: ScoutObserveFile

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
            Circle()
                .fill(fileTint)
                .frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                Text(file.path)
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("\(file.state) · \(file.touches)x · \(file.ageLabel)")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(HudPalette.dim)
                    .lineLimit(1)
            }
        }
    }

    private var fileTint: Color {
        switch file.state.lowercased() {
        case "created":
            return HudPalette.statusOk
        case "modified":
            return HudPalette.accent
        default:
            return HudPalette.muted
        }
    }
}

private enum ScoutObserveFormatting {
    static func compactNumber(_ value: Int) -> String {
        let absValue = abs(value)
        if absValue >= 1_000_000 {
            return String(format: "%.1fm", Double(value) / 1_000_000).replacingOccurrences(of: ".0m", with: "m")
        }
        if absValue >= 1_000 {
            return String(format: "%.1fk", Double(value) / 1_000).replacingOccurrences(of: ".0k", with: "k")
        }
        return "\(value)"
    }

    static func percent(_ value: Double) -> String {
        let normalized = value <= 1 ? value * 100 : value
        return String(format: "%.0f%%", normalized)
    }
}

private extension ScoutObserveEventKind {
    var label: String {
        switch self {
        case .think: return "Think"
        case .tool: return "Tool"
        case .ask: return "Ask"
        case .message: return "Message"
        case .note: return "Note"
        case .system: return "System"
        case .boot: return "Boot"
        case .unknown: return "Event"
        }
    }

    var icon: String {
        switch self {
        case .think: return "sparkles"
        case .tool: return "wrench.and.screwdriver"
        case .ask: return "questionmark.bubble"
        case .message: return "bubble.left"
        case .note: return "note.text"
        case .system: return "gearshape"
        case .boot: return "power"
        case .unknown: return "circle"
        }
    }

    var tint: Color {
        switch self {
        case .think: return HudPalette.dim
        case .tool: return HudPalette.accent
        case .ask: return HudPalette.statusWarn
        case .message: return HudPalette.statusInfo
        case .note: return HudPalette.statusOk
        case .system: return HudPalette.muted
        case .boot: return HudPalette.muted
        case .unknown: return HudPalette.dim
        }
    }
}
