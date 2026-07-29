import HudsonUI
import SwiftUI

/// Content-shaped loading state shared by the native and embedded conversation
/// readers. Ghost turns preserve the transcript's eventual geometry, avoiding
/// the empty-canvas flash of a centered system spinner.
///
/// Motion is a highlight that sweeps down the ghost turns one row at a time, so
/// the wait reads as the transcript materializing top-down rather than a slab
/// of gray blinking in place. The sweep is driven off `TimelineView` clock time
/// and expressed in `UnitPoint`s, so it needs no geometry reader and stops on
/// its own when the view leaves the screen.
struct ScoutThreadLoadingSkeleton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// One full top-to-bottom pass of the highlight.
    private static let sweepPeriod: Double = 1.9
    /// Fraction of the cycle each successive row trails the one above it.
    private static let rowStagger: Double = 0.055

    private static let turns: [(nameWidth: CGFloat, lineWidths: [CGFloat])] = [
        (88, [430, 310]),
        (64, [370, 450, 220]),
        (104, [280]),
    ]

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { context in
            let phase = reduceMotion ? nil : Self.phase(at: context.date)
            VStack(alignment: .leading, spacing: HudSpacing.xxxl) {
                ForEach(Array(Self.turns.enumerated()), id: \.offset) { turn in
                    ghostTurn(
                        nameWidth: turn.element.nameWidth,
                        lineWidths: turn.element.lineWidths,
                        phase: phase,
                        firstRow: Self.rowOffset(forTurn: turn.offset)
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(reduceMotion ? 0.7 : 0.85)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading conversation")
    }

    /// Normalized position in the sweep cycle, `0..<1`.
    private static func phase(at date: Date) -> Double {
        let elapsed = date.timeIntervalSinceReferenceDate
        return (elapsed.truncatingRemainder(dividingBy: sweepPeriod) + sweepPeriod)
            .truncatingRemainder(dividingBy: sweepPeriod) / sweepPeriod
    }

    /// Running row index at the top of each turn, so the cascade keeps
    /// descending across turn boundaries instead of restarting per turn.
    private static func rowOffset(forTurn index: Int) -> Int {
        turns.prefix(index).reduce(0) { $0 + 1 + $1.lineWidths.count }
    }

    /// Where the highlight sits within a given row, or `nil` when the row is
    /// outside the sweep (and when motion is reduced).
    private static func highlight(phase: Double?, row: Int) -> Double? {
        guard let phase else { return nil }
        var local = phase - Double(row) * rowStagger
        local -= local.rounded(.down)
        // Travel from just off the leading edge to just past the trailing one.
        return local * 1.7 - 0.35
    }

    private func ghostTurn(
        nameWidth: CGFloat,
        lineWidths: [CGFloat],
        phase: Double?,
        firstRow: Int
    ) -> some View {
        HStack(alignment: .top, spacing: HudSpacing.xl) {
            ghostShape(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous),
                highlight: Self.highlight(phase: phase, row: firstRow)
            )
            .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                ghostBar(
                    maxWidth: nameWidth,
                    height: 9,
                    highlight: Self.highlight(phase: phase, row: firstRow)
                )
                VStack(alignment: .leading, spacing: HudSpacing.xs) {
                    ForEach(Array(lineWidths.enumerated()), id: \.offset) { line in
                        ghostBar(
                            maxWidth: line.element,
                            height: 10,
                            highlight: Self.highlight(phase: phase, row: firstRow + 1 + line.offset)
                        )
                    }
                }
            }

            Spacer(minLength: 0)
        }
    }

    private func ghostBar(maxWidth: CGFloat, height: CGFloat, highlight: Double?) -> some View {
        ghostShape(
            RoundedRectangle(cornerRadius: 3, style: .continuous),
            highlight: highlight
        )
        .frame(height: height)
        .frame(maxWidth: maxWidth, alignment: .leading)
    }

    private func ghostShape<S: Shape>(_ shape: S, highlight: Double?) -> some View {
        shape
            .fill(ScoutSurface.inset)
            .overlay {
                if let highlight {
                    shape
                        .fill(
                            LinearGradient(
                                stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: ScoutPalette.accentSoft.opacity(0.26), location: 0.5),
                                    .init(color: .clear, location: 1),
                                ],
                                // Unit-space endpoints keep the sweep width
                                // proportional at any bar length; the slight
                                // y offset angles it so it doesn't read as a
                                // flat wipe.
                                startPoint: UnitPoint(x: highlight - 0.35, y: 0),
                                endPoint: UnitPoint(x: highlight + 0.35, y: 1)
                            )
                        )
                        .blendMode(.screen)
                }
            }
    }
}

/// Full-canvas treatment used while the embedded web transcript materializes.
/// The compact live indicator explains the state; the ghost turns preview the
/// destination instead of making a fast load feel like a blocking operation.
struct ScoutThreadMaterializingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxl) {
            HStack(spacing: HudSpacing.sm) {
                ScoutBrailleSpinner(size: 11, speed: 0.1)
                    .accessibilityHidden(true)
                Text("Opening thread")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutPalette.dim)
            }

            ScoutThreadLoadingSkeleton()
        }
        .padding(.horizontal, 32)
        .padding(.top, 28)
        .padding(.bottom, HudSpacing.xxxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ScoutDesign.bg)
        .accessibilityElement(children: .contain)
    }
}
