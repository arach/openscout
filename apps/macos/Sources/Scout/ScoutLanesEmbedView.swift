import HudsonUI
import SwiftUI

private enum ScoutLanesMetrics {
    static let pageGutter: CGFloat = 20
    static let controlHeight: CGFloat = 26
}

/// Lane column width tier — sm / md / lg maps to the web embed's
/// `--agent-lane-width` (408 / 512 / 616 px).
enum ScoutAgentLaneSize: String, CaseIterable, Identifiable {
    static let storageKey = "scout.lanes.size.v1"

    case sm
    case md
    case lg

    var id: String { rawValue }

    var label: String { rawValue.uppercased() }

    var laneWidth: CGFloat {
        switch self {
        case .sm: return 408
        case .md: return 512
        case .lg: return 616
        }
    }

    var widthLabel: String { "\(Int(laneWidth))px" }

    /// Matches `ScoutShellLayout` breakpoints — compact/balanced/wide → sm/md/lg.
    static func from(windowWidth: CGFloat) -> ScoutAgentLaneSize {
        if windowWidth < 1120 { return .sm }
        if windowWidth < 1320 { return .md }
        return .lg
    }
}

/// Lanes tab — lane-width chrome around the shared `ScoutWebEmbedContent` host.
struct ScoutLanesContent: View {
    let windowWidth: CGFloat

    @AppStorage(ScoutAgentLaneSize.storageKey) private var laneSizeOverrideRaw = ""

    private var autoLaneSize: ScoutAgentLaneSize {
        ScoutAgentLaneSize.from(windowWidth: windowWidth)
    }

    private var laneSize: ScoutAgentLaneSize {
        if let manual = ScoutAgentLaneSize(rawValue: laneSizeOverrideRaw), !laneSizeOverrideRaw.isEmpty {
            return manual
        }
        return autoLaneSize
    }

    private var laneSizeBinding: Binding<ScoutAgentLaneSize> {
        Binding(
            get: { laneSize },
            set: { laneSizeOverrideRaw = $0.rawValue }
        )
    }

    private var laneSizeSubtitle: String {
        let tier = "\(laneSize.label) · \(laneSize.widthLabel)"
        if laneSizeOverrideRaw.isEmpty {
            return "auto · \(tier) columns"
        }
        return "\(tier) columns"
    }

    private var laneQueryItems: [URLQueryItem] {
        [URLQueryItem(name: "lanes", value: laneSize.rawValue)]
    }

    var body: some View {
        ScoutWebEmbedContent(
            surface: .lanes,
            subtitle: laneSizeSubtitle,
            extraQueryItems: laneQueryItems,
            loadingLaneSize: laneSize
        ) {
            ScoutLaneSizeToggle(selection: laneSizeBinding, autoActive: laneSizeOverrideRaw.isEmpty)
        }
    }
}

struct ScoutLanesMaterializingView: View {
    let laneSize: ScoutAgentLaneSize

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HStack(spacing: HudSpacing.sm) {
                ScoutLanesShimmerBlock(width: 120, height: 18, cornerRadius: HudRadius.tight)
                ScoutLanesShimmerBlock(width: 72, height: 18, cornerRadius: HudRadius.tight)
            }
            .padding(.horizontal, ScoutLanesMetrics.pageGutter)
            .padding(.top, HudSpacing.md)

            HStack(alignment: .top, spacing: HudSpacing.md) {
                ForEach(0..<3, id: \.self) { _ in
                    laneSkeleton(width: laneSize.laneWidth)
                }
            }
            .padding(.horizontal, ScoutLanesMetrics.pageGutter)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ScoutDesign.bg)
    }

    private func laneSkeleton(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutLanesShimmerBlock(width: width, height: 92, cornerRadius: HudRadius.card)
            ForEach(0..<4, id: \.self) { _ in
                ScoutLanesShimmerBlock(
                    width: width,
                    height: 56,
                    cornerRadius: HudRadius.standard
                )
            }
        }
        .frame(width: width, alignment: .topLeading)
    }
}

private struct ScoutLanesShimmerBlock: View {
    let width: CGFloat
    let height: CGFloat
    let cornerRadius: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(ScoutSurface.control)
            .frame(width: width, height: height)
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                ScoutPalette.accent.opacity(0.06),
                                ScoutPalette.accentSoft.opacity(0.18),
                                ScoutPalette.accent.opacity(0.06),
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .blendMode(.screen)
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
            }
        .frame(width: width, height: height)
    }
}

private struct ScoutLaneSizeToggle: View {
    @Binding var selection: ScoutAgentLaneSize
    let autoActive: Bool

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            ForEach(ScoutAgentLaneSize.allCases) { size in
                Button {
                    selection = size
                } label: {
                    Text(size.label)
                        .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                        .foregroundStyle(selection == size ? ScoutPalette.ink : ScoutPalette.muted)
                        .frame(width: 22, height: ScoutLanesMetrics.controlHeight - 4)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                                .fill(selection == size ? ScoutDesign.bg : Color.clear)
                        )
                }
                .buttonStyle(.plain)
                .scoutPointerCursor()
                .help("\(size.label) lanes · \(size.widthLabel)")
            }
        }
        .padding(2)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(ScoutSurface.control)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(autoActive ? ScoutPalette.accent.opacity(0.35) : ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
        )
        .help(autoActive ? "Lane width follows window size" : "Lane width pinned")
    }
}
