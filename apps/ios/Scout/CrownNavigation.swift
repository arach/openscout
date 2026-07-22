import SwiftUI
import HudsonUI
import ScoutCapabilities
import ScoutIOSCore
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Crown navigation (opt-in "crown mode")
//
// An alternative navigation chrome the operator can flip on from Settings →
// Appearance. The shipped `titleBar + dockedTabBar + status strip` stays fully
// intact for `.tabs`; `.crown` replaces it with a summonable hex crown that
// anchors a fused bottom nav bar plus a PERMANENT Fleet LED top display.
//
// Design spec: design/studio/views/fleet-led-carousel.tsx (the converged
// pass-5 model: permanent full-bleed top strip, morphing LED, pill
// complications on iPad, compact bottom island on iPad). The geometry is
// authored with SwiftUI layout (not ported pixel-for-pixel) and derives from
// the safe area, so it is island-aware and works on iPad (no island).
// App-local on purpose — HudsonKit is untouched this pass.

enum ScoutNavMode: String, CaseIterable {
    case tabs
    case crown

    var title: String {
        switch self {
        case .tabs:  return "Tabs"
        case .crown: return "Crown"
        }
    }

    static let storageKey = "scout.navMode"
    static let `default`: ScoutNavMode = .tabs

    static func resolve(_ raw: String?) -> ScoutNavMode {
        ScoutNavMode(rawValue: raw ?? "") ?? .default
    }
}

// MARK: - Crown theme
//
// The studio-converged crown palette (fleet-led-carousel.tsx). The signal lime
// is the crown chrome's ONE accent — hudson's emerald never reaches the crown.
// Graphite structure comes from ScoutSignalSurface, which already carries the
// same values as the study's --sig-* tokens.

enum CrownTheme {
    /// Signal lime (#A6EF87) — LED pips/dots, hot quota fills, the inner seats'
    /// active ring.
    static let signal = Color(red: 166.0/255, green: 239.0/255, blue: 135.0/255)
    /// Active-count text (#3FF0B0) — a cooler read than the lime so the number
    /// stays distinct from the pips beside it.
    static let activeText = Color(red: 63.0/255, green: 240.0/255, blue: 176.0/255)
    /// Instrument well fill / rim (#070A09 / #1E231F).
    static let well = Color(red: 7.0/255, green: 10.0/255, blue: 9.0/255)
    static let wellEdge = Color(red: 30.0/255, green: 35.0/255, blue: 31.0/255)
    static let pipOff = Color(red: 20.0/255, green: 29.0/255, blue: 24.0/255)
    static let dimLED = Color(red: 86.0/255, green: 96.0/255, blue: 88.0/255)
}

// MARK: - Hex mark
//
// No hex/scout glyph exists in Glyphs.swift or Assets, so the crown is drawn
// here in the same thin-line spirit as the unified Glyphic set: a pointy-top
// hexagon with a graphite face, an OFF-WHITE rim (a clean logo at rest), one
// inner facet, and a quiet core. The mark has ONE semantic state of its own:
// while the app is loading/connecting it colorizes to the signal lime and
// breathes. Otherwise NO accent green — fleet-alive state lives on the Fleet
// LED, not the crown.

struct ScoutHexagon: Shape {
    func path(in rect: CGRect) -> Path {
        // A REGULAR pointy-top hexagon (matches the brand mark / study Jewel, whose
        // path is 34w×40h ≈ √3/2). The height spans the frame; the width is derived
        // as height·(√3/2) so it never looks squeezed when drawn in a square frame —
        // the old version filled the square edge-to-edge, which read as vertically
        // compressed (too wide for its height).
        let h = rect.height
        let w = h * 0.8660254        // flat-to-flat width of a regular hexagon
        let cx = rect.midX
        let left = cx - w / 2
        let right = cx + w / 2
        let top = rect.minY
        let bottom = rect.maxY
        let shoulderTop = rect.minY + h * 0.25
        let shoulderBottom = rect.minY + h * 0.75
        var p = Path()
        p.move(to: CGPoint(x: cx, y: top))
        p.addLine(to: CGPoint(x: right, y: shoulderTop))
        p.addLine(to: CGPoint(x: right, y: shoulderBottom))
        p.addLine(to: CGPoint(x: cx, y: bottom))
        p.addLine(to: CGPoint(x: left, y: shoulderBottom))
        p.addLine(to: CGPoint(x: left, y: shoulderTop))
        p.closeSubpath()
        return p
    }
}

struct CrownHexMark: View {
    var size: CGFloat = 30
    var lit: Bool = true
    /// Fleet work in flight (connecting / loading) — the mark colorizes to the
    /// signal lime and breathes gently, so the brand logo doubles as the
    /// activity indicator. At rest it stays a CLEAN logo: off-white rim.
    var loading: Bool = false

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        ZStack {
            // Neutral graphite face (ScoutSignalSurface, the same grammar
            // that keeps operational panels from going brown under the warm
            // tone) — never the tone cards, never the accent gradient.
            ScoutHexagon()
                .fill(
                    LinearGradient(
                        colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                        startPoint: .top, endPoint: .bottom
                    )
                )
            // The outer boundary reads as the logo's linework: OFF-WHITE at
            // rest (the operator's clean-logo direction), signal lime while
            // loading. Fleet-alive state still lives on the Fleet LED — the
            // lime only ever means "working", never a permanent highlight.
            ScoutHexagon()
                .stroke(rimColor, lineWidth: 1.6)
            ScoutHexagon()
                .scale(0.52)
                .stroke(loading ? CrownTheme.signal.opacity(0.4) : ScoutSignalSurface.neutralSignal.opacity(0.22), lineWidth: 1)
            Circle()
                .fill(loading ? CrownTheme.signal : (lit ? HudPalette.ink.opacity(0.9) : ScoutInk.dim.opacity(0.6)))
                .frame(width: size * 0.2, height: size * 0.2)
                .shadow(color: loading ? CrownTheme.signal.opacity(0.8) : .clear, radius: 3)
        }
        .frame(width: size, height: size)
        // The breath: a gentle scale + dip on a repeat loop while loading.
        // Reduce Motion skips the loop — the lime color alone carries state.
        .scaleEffect(breathing ? 1.06 : 1)
        .opacity(breathing ? 0.82 : 1)
        .animation(
            breathing ? .easeInOut(duration: 0.72).repeatForever(autoreverses: true) : .easeOut(duration: 0.25),
            value: breathing
        )
        .onChange(of: loading) { _, isLoading in
            breathing = isLoading && !reduceMotion
        }
        .onAppear { breathing = loading && !reduceMotion }
    }

    private var rimColor: Color {
        if loading { return CrownTheme.signal }
        return HudPalette.ink.opacity(lit ? 0.8 : 0.5)
    }
}

// MARK: - Machined lighting helpers
//
// The studio reference's physicality comes from LIGHTING, not hue: a crisp
// top-only rim light on raised plates (its `inset 0 1px 0 card-edge`), a soft
// light pooled at the top of each face, and genuinely RECESSED instrument
// wells (inner shadows + a faint bottom outer light — the opposite of a drop
// shadow). These two helpers carry that grammar onto any Shape so the crown,
// corners, pills, bar, and LED wells all share one light source.

/// Top-weighted rim light + soft inner top glow for RAISED plates (crown,
/// corners, pills, bar). Replaces the flat full-perimeter stroke, which read
/// as a flat outline rather than lit metal.
private struct CrownMachined<S: Shape>: ViewModifier {
    let shape: S
    /// Extra rim brightness for the active state.
    var rimBoost: Double = 0

    func body(content: Content) -> some View {
        content
            // Soft light pooled at the top of the face.
            .overlay(
                shape.fill(
                    RadialGradient(
                        colors: [Color.white.opacity(0.09), .clear],
                        center: .top, startRadius: 0, endRadius: 78
                    )
                )
            )
            // Crisp rim light — bright at the top, gone by the waist.
            .overlay(
                shape.stroke(
                    LinearGradient(
                        stops: [
                            .init(color: ScoutSignalSurface.neutralSignal.opacity(0.55 + rimBoost), location: 0),
                            .init(color: ScoutSignalSurface.neutralSignal.opacity(0.16 + rimBoost * 0.4), location: 0.35),
                            .init(color: .clear, location: 0.55),
                        ],
                        startPoint: .top, endPoint: .bottom
                    ),
                    lineWidth: 1
                )
            )
            // Faint full hairline so the silhouette holds against the canvas.
            .overlay(shape.stroke(ScoutSignalSurface.edge.opacity(0.35), lineWidth: HudStrokeWidth.thin))
    }
}

/// An inner shadow for RECESSED wells (the LED faces): a blurred shape stroke
/// nudged downward and masked to the fill, so darkness pools at the top inner
/// edge — the study's `inset 0 1px 4px` stack.
private struct CrownInsetShadow<S: Shape>: View {
    let shape: S
    var color: Color
    var radius: CGFloat
    var y: CGFloat = 1

    var body: some View {
        shape
            .stroke(color, lineWidth: radius * 2)
            .blur(radius: radius)
            .offset(y: y)
            .mask(shape.fill())
            .allowsHitTesting(false)
    }
}

// MARK: - The crown button

private struct CrownButton: View {
    var active: Bool
    var alive: Bool
    var loading: Bool = false
    var diameter: CGFloat = 56
    var hexSize: CGFloat = 30
    var action: () -> Void

    @State private var pulsing = false

    var body: some View {
        Button {
            // A glimpse of a pulse on tap — the crown NEVER travels (no rise
            // into place); the assembly expands around it in place.
            withAnimation(.easeOut(duration: 0.08)) { pulsing = true }
            withAnimation(.easeInOut(duration: 0.18).delay(0.08)) { pulsing = false }
            action()
        } label: {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                    // Machined top rim light (the study's `inset 0 1px 0 card-edge`)
                    // so the plate reads lit from above. Neutral in both states —
                    // no accent ring on the brand mark.
                    .modifier(CrownMachined(shape: Circle(), rimBoost: active ? 0.15 : 0))
                    // Machined grain, clipped to the plate.
                    .overlay(ScoutFilmGrain(grainOpacity: 0.06).clipShape(Circle()))
                    // Two stacked shadows = a physical object: a tight contact shadow
                    // plus the study's soft ambient (0 5px 13px @ .55).
                    .shadow(color: .black.opacity(0.6), radius: 4, y: 2)
                    .shadow(color: .black.opacity(0.55), radius: active ? 16 : 13, y: active ? 6 : 5)
                CrownHexMark(size: hexSize, lit: active || alive, loading: loading)
            }
            .frame(width: diameter, height: diameter)
            .scaleEffect(pulsing ? 1.09 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(active ? "Close navigation" : "Open navigation")
    }
}

// MARK: - Fleet LED (permanent top display, real data)
//
// The display is PERMANENT — always on screen at the top, never part of the
// summon (the operator: "this display being available to me makes sense").
// The iPhone carries a single compressed face in both states. The iPad face
// MORPHS on summon: the hosts · pips · active core stays mounted and
// stationary while the worker + quota wings unfold from zero width beside it —
// nothing disappears, nothing is replaced. Deliberately NO fetch-age readout
// anywhere ("one of the least useful measures"); staleness lives in the
// vitals panel instead.

private struct LEDCore: View {
    var agents: Int
    var active: Int
    var hostsOnline: Int
    var hostsTotal: Int
    var compact: Bool = false

    var body: some View {
        HStack(spacing: compact ? 8 : 11) {
            // Connected hosts FIRST — the operator runs several Macs, so "who's
            // online" reads before agent counts. Dot lights when any Mac is up.
            HStack(spacing: 5) {
                Circle()
                    .fill(hostsOnline > 0 ? CrownTheme.signal : CrownTheme.dimLED)
                    .frame(width: 5, height: 5)
                    .shadow(color: hostsOnline > 0 ? CrownTheme.signal.opacity(0.7) : .clear, radius: 2)
                Text(hostLabel)
                    .font(HudFont.mono(compact ? 8.5 : 10, weight: .semibold)).tracking(0.5)
                    .foregroundStyle(hostsOnline > 0 ? HudPalette.ink : ScoutInk.muted)
            }
            divider
            // Active agents — pip meter (dropped on the mini for width) + count.
            HStack(spacing: compact ? 5 : 7) {
                if !compact {
                    HStack(spacing: 3) {
                        ForEach(0..<pipCount, id: \.self) { index in
                            Circle()
                                .fill(index < litCount ? CrownTheme.signal : CrownTheme.pipOff)
                                .frame(width: 5, height: 5)
                                .shadow(color: index < litCount ? CrownTheme.signal.opacity(0.7) : .clear, radius: 2)
                        }
                    }
                }
                Text("\(active) ACTIVE")
                    .font(HudFont.mono(compact ? 9 : 11, weight: .bold)).tracking(0.7)
                    .foregroundStyle(active > 0 ? CrownTheme.activeText : CrownTheme.dimLED)
                    .shadow(color: active > 0 ? CrownTheme.signal.opacity(0.5) : .clear, radius: 3)
            }
        }
    }

    private var divider: some View {
        Rectangle().fill(CrownTheme.dimLED.opacity(0.32)).frame(width: HudStrokeWidth.thin, height: 12)
    }

    private var hostLabel: String {
        if hostsTotal <= 0 { return "NO MACS" }
        if hostsOnline == hostsTotal { return "\(hostsTotal) MAC\(hostsTotal == 1 ? "" : "S")" }
        return "\(hostsOnline)/\(hostsTotal) MACS"
    }

    private var pipCount: Int { min(max(agents, 1), 6) }
    private var litCount: Int { max(0, min(active, pipCount)) }
}

/// The inset instrument well both LED faces share: near-black fill, hairline
/// rim, and the study's RECESSED lighting — inner shadows pooling at the top,
/// a faint outer light along the bottom edge, NO drop shadow.
private struct LEDWell: ViewModifier {
    var compact = false

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, compact ? 12 : 15)
            .padding(.vertical, compact ? 8 : 10)
            .background(
                RoundedRectangle(cornerRadius: 9)
                    .fill(CrownTheme.well)
                    .overlay(ScoutFilmGrain(grainOpacity: 0.05).clipShape(RoundedRectangle(cornerRadius: 9)))
                    .overlay(RoundedRectangle(cornerRadius: 9).stroke(CrownTheme.wellEdge, lineWidth: HudStrokeWidth.thin))
                    .overlay(CrownInsetShadow(shape: RoundedRectangle(cornerRadius: 9), color: .black.opacity(0.9), radius: 2, y: 1))
                    .overlay(CrownInsetShadow(shape: RoundedRectangle(cornerRadius: 9), color: .black.opacity(0.55), radius: 5.5, y: 0))
                    .shadow(color: ScoutSignalSurface.neutralSignal.opacity(0.07), radius: 0, y: 1)
            )
    }
}

/// The iPhone face: the core alone in the well, identical at rest and summoned.
private struct FleetLED: View {
    var agents: Int
    var active: Int
    var hostsOnline: Int
    var hostsTotal: Int
    var compact: Bool = false

    var body: some View {
        LEDCore(agents: agents, active: active, hostsOnline: hostsOnline, hostsTotal: hostsTotal, compact: compact)
            .modifier(LEDWell(compact: compact))
    }
}

/// One provider's quota in LED grammar: dim label, a micro bar (lime when hot),
/// and the percent. The meter picks the provider's most-constrained window.
private struct QuotaMeter: View {
    var label: String
    var pct: Double   // 0…100

    private var hot: Bool { pct >= 75 }

    var body: some View {
        HStack(spacing: 5) {
            Text(label)
                .font(HudFont.mono(8.5, weight: .regular))
                .foregroundStyle(ScoutInk.muted)
            ZStack(alignment: .leading) {
                Capsule().fill(CrownTheme.pipOff)
                Capsule()
                    .fill(hot ? CrownTheme.signal : ScoutSignalSurface.neutralSignal)
                    .frame(width: max(2, 52 * min(max(pct, 0), 100) / 100))
            }
            .frame(width: 52, height: 3)
            .clipShape(Capsule())
            Text("\(Int(pct.rounded()))%")
                .font(HudFont.mono(8.5, weight: .semibold))
                .foregroundStyle(hot ? CrownTheme.signal : ScoutInk.muted)
        }
    }
}

/// The iPad face: ONE well, two sizes. The shared core never unmounts and never
/// moves; summon widens the well and the worker + quota wings unfold
/// symmetrically from zero width beside it, so the content visibly travels to
/// its destination layout instead of cross-fading into a different structure.
private struct MorphLED: View {
    var agents: Int
    var active: Int
    var hostsOnline: Int
    var hostsTotal: Int
    var working: [AgentSummary]
    var budgets: [ServiceBudget]
    var expanded: Bool

    var body: some View {
        HStack(spacing: 0) {
            wing(alignment: .trailing) { workingWing }
            wingDivider
            LEDCore(agents: agents, active: active, hostsOnline: hostsOnline, hostsTotal: hostsTotal)
                .padding(.horizontal, 15)
            wingDivider
            wing(alignment: .leading) { quotaWing }
        }
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(CrownTheme.well)
                .overlay(ScoutFilmGrain(grainOpacity: 0.05).clipShape(RoundedRectangle(cornerRadius: 10)))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(CrownTheme.wellEdge, lineWidth: HudStrokeWidth.thin))
                .overlay(CrownInsetShadow(shape: RoundedRectangle(cornerRadius: 10), color: .black.opacity(0.9), radius: 2, y: 1))
                .overlay(CrownInsetShadow(shape: RoundedRectangle(cornerRadius: 10), color: .black.opacity(0.55), radius: 5.5, y: 0))
                .shadow(color: ScoutSignalSurface.neutralSignal.opacity(0.07), radius: 0, y: 1)
        )
        .animation(.timingCurve(0.2, 0.9, 0.25, 1.06, duration: 0.26), value: expanded)
    }

    /// A wing unfolds from zero width: fixed content, clipped, expanding to an
    /// equal flex share of the well (both wings match, so the core stays
    /// centered). Content hugs the core on both sides.
    private func wing<Content: View>(alignment: Alignment, @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .fixedSize()
            .frame(maxWidth: expanded ? .infinity : 0, alignment: alignment)
            .clipped()
            .opacity(expanded ? 1 : 0)
    }

    private var wingDivider: some View {
        Rectangle().fill(CrownTheme.dimLED.opacity(0.32))
            .frame(width: HudStrokeWidth.thin, height: 12)
            .opacity(expanded ? 1 : 0)
    }

    /// Left wing — who's working: harness (bold) · project for up to two live
    /// agents, then a "+N" overflow. An honest dim placeholder when the fleet
    /// is idle so the wing geometry (and the core's centering) stays stable.
    private var workingWing: some View {
        HStack(spacing: 12) {
            if working.isEmpty {
                Text("NO LIVE WORK")
                    .font(HudFont.mono(8.5, weight: .medium)).tracking(0.6)
                    .foregroundStyle(ScoutInk.dim)
            } else {
                ForEach(working.prefix(2)) { agent in
                    HStack(spacing: 4) {
                        Circle().fill(CrownTheme.signal).frame(width: 4, height: 4)
                        Text(agent.harness?.lowercased() ?? "agent")
                            .font(HudFont.mono(8.5, weight: .semibold))
                            .foregroundStyle(HudPalette.ink)
                        if let project = agent.projectName, !project.isEmpty {
                            Text(project)
                                .font(HudFont.mono(8.5, weight: .regular))
                                .foregroundStyle(ScoutInk.muted)
                        }
                    }
                }
                if working.count > 2 {
                    Text("+\(working.count - 2)")
                        .font(HudFont.mono(8.5, weight: .medium))
                        .foregroundStyle(ScoutInk.dim)
                }
            }
        }
    }

    /// Right wing — account quota: one meter per provider (CLAUDE ▓▓ 88%),
    /// sourced from the same merged budgets the vitals panel expands.
    private var quotaWing: some View {
        HStack(spacing: 12) {
            if budgets.isEmpty {
                Text("NO QUOTA DATA")
                    .font(HudFont.mono(8.5, weight: .medium)).tracking(0.6)
                    .foregroundStyle(ScoutInk.dim)
            } else {
                ForEach(budgets.prefix(2), id: \.provider) { budget in
                    QuotaMeter(
                        label: (budget.label.isEmpty ? budget.provider : budget.label).uppercased(),
                        pct: budget.windows.map(\.usedPercent).max() ?? 0
                    )
                }
            }
        }
    }
}

// MARK: - Alignment constants
//
// Every bottom control (corner circles, inner seats, crown) is centered on ONE
// shared horizontal line — an `HStack(alignment: .center)` aligns the circle
// centers automatically, and every label sits at the SAME distance below that
// line, so the six labels share one baseline outside the bar. Geometry-derived,
// not eyeballed.

enum CrownMetric {
    /// Distance from the shared centerline to the corner labels.
    static let labelOffset: CGFloat = 40
    /// Reserved chrome zone (added beyond the safe area) so surface content is
    /// inset clear of the top strip. Matches the strip's content zone exactly:
    /// the iPad's permanent strip is shallow (no island to clear); the phone
    /// rail hangs the dials 14pt below the island — row is CENTER-aligned so
    /// the LED and the dials share one horizontal centerline (dial-bottom at
    /// 14 + 54), and content tucks just under that. Single-sourced here and
    /// consumed by RootView's crown-mode safeAreaInset.
    static func topReserve(for layout: ScoutLayoutMetrics) -> CGFloat {
        layout.physicalWidth >= 700 ? 48 : 69
    }
    /// Tracks the lowered bottom unit: ~the assembled assembly's top (crown,
    /// including its tap pulse) above the screen bottom. Crown mode no longer
    /// RESERVES this — content flows through behind the crown (operator
    /// direction) — but surfaces may still consult it for their own lifts.
    static let bottomReserve: CGFloat = 66
}

// MARK: - Per-device chrome sizing
//
// The roomy footprint (2 corners + 4 seats + the crown gap) sums past 375pt, so
// the 13 mini overflowed — pushing the crown's halo into the New corner (which
// read as a stray accent ring). The mini gets a tightened set that fits with
// margin; standard iPhone keeps the roomy one. Derives from scoutLayout, the same
// isMiniPhone discipline the rest of the chrome uses.

struct CrownSizing: Equatable {
    let corner: CGFloat
    let seat: CGFloat
    let crown: CGFloat
    let hex: CGFloat
    let barHeight: CGFloat
    let crownGap: CGFloat
    let hPad: CGFloat
    let cornerGlyph: CGFloat
    let seatGlyph: CGFloat

    // barHeight trimmed (52 → 46) so the corner circles sit PROUD of the bar and
    // read as objects resting on it, not discs sunk into a slab.
    // crownGap spans the crown circle with even breathing room on both sides.
    // (Tightened in pass 5: the old 74/64 cleared the since-removed accent halo;
    // with the halo gone the gap now clears just the circle + the same margin.)
    static let regular = CrownSizing(
        corner: 54, seat: 36, crown: 56, hex: 30, barHeight: 46,
        crownGap: 64, hPad: 20, cornerGlyph: 22, seatGlyph: 16
    )
    static let compact = CrownSizing(
        corner: 48, seat: 33, crown: 50, hex: 27, barHeight: 44,
        crownGap: 56, hPad: 14, cornerGlyph: 20, seatGlyph: 15
    )

    static func resolve(_ layout: ScoutLayoutMetrics) -> CrownSizing {
        layout.isMiniPhone ? .compact : .regular
    }
}

// MARK: - Corner button (big primary affordance)

private struct CrownCornerButton: View {
    var glyph: GlyphShape.Kind
    var label: String
    var isActive: Bool = false
    var diameter: CGFloat = 54
    var glyphSize: CGFloat = 22
    var labelOffset: CGFloat = CrownMetric.labelOffset
    var showsLabel: Bool = true
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            // Frame == the circle, so the HStack centers on the circle's center;
            // the label overflows below at a uniform offset (not part of layout).
            // The four corners share ONE styling — only `isActive` (the current
            // surface) lifts the neutral edge + glyph; everything else is equal.
            // Neutral graphite, never the tone cards (brown under the warm tone)
            // and never the accent — the operator rejected green highlights on
            // the complications; the inner seats carry the accent active signal.
            Circle()
                .fill(
                    LinearGradient(
                        colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                // Machined top rim light — the disc reads lit from above;
                // active simply brightens the rim further.
                .modifier(CrownMachined(shape: Circle(), rimBoost: isActive ? 0.15 : 0))
                // Machined grain, clipped to the disc.
                .overlay(ScoutFilmGrain(grainOpacity: 0.06).clipShape(Circle()))
                .overlay(Glyphic(kind: glyph, size: glyphSize).foregroundStyle(isActive ? HudPalette.ink : ScoutInk.muted))
                // Layered drop shadow (contact + the study's 0 5px 13px @ .55
                // ambient) so the corner floats over the canvas like the
                // crown-complications.tsx reference.
                .shadow(color: .black.opacity(0.6), radius: 4, y: 2)
                .shadow(color: .black.opacity(0.55), radius: 13, y: 5)
                .frame(width: diameter, height: diameter)
                .overlay(alignment: .center) {
                    if showsLabel {
                        Text(label)
                            .font(HudFont.mono(8, weight: .medium)).tracking(0.6).fixedSize()
                            .foregroundStyle(isActive ? ScoutInk.muted : ScoutInk.dim.opacity(0.8))
                            .offset(y: labelOffset)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - iPad top complication (horizontal pill)
//
// On the wide canvas the top complications are HORIZONTAL — capsule pills
// (glyph + label side by side) that match the strip's own nature and leave the
// display's wings uncovered. Same neutral graphite as the round corners; the
// strip's hairline is their only backdrop.

private struct CrownPill: View {
    var glyph: GlyphShape.Kind
    var label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Glyphic(kind: glyph, size: 15).foregroundStyle(ScoutInk.muted)
                Text(label.uppercased())
                    .font(HudFont.mono(8, weight: .medium)).tracking(1.0)
                    .foregroundStyle(ScoutInk.muted)
            }
            .frame(width: 104, height: 40)
            .background(
                Capsule().fill(
                    LinearGradient(
                        colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                        startPoint: .top, endPoint: .bottom
                    )
                )
            )
            .modifier(CrownMachined(shape: Capsule()))
            .overlay(ScoutFilmGrain(grainOpacity: 0.06).clipShape(Capsule()))
            .shadow(color: .black.opacity(0.6), radius: 4, y: 2)
            .shadow(color: .black.opacity(0.55), radius: 13, y: 5)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - Inner seat (round button target seated in the bar)

private struct CrownInnerSeat: View {
    var glyph: GlyphShape.Kind
    var label: String
    var isActive: Bool
    var diameter: CGFloat = 36
    var glyphSize: CGFloat = 16
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            // Secondary to the corners: a RECESSED hole in the bar (a faint dark
            // inset, no drop shadow) rather than a raised disc — the inner four sink
            // back so the corners lead. Label-less; the unified glyph carries it.
            Circle()
                .fill(isActive ? CrownTheme.signal.opacity(0.10) : Color.black.opacity(0.22))
                .overlay(
                    Circle().stroke(
                        isActive ? CrownTheme.signal.opacity(0.5) : ScoutSignalSurface.neutralSignal.opacity(0.16),
                        lineWidth: isActive ? 1 : HudStrokeWidth.thin
                    )
                )
                .overlay(Glyphic(kind: glyph, size: glyphSize).foregroundStyle(isActive ? CrownTheme.signal : ScoutInk.dim.opacity(0.85)))
                .frame(width: diameter, height: diameter)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - Crown navigation chrome

struct CrownNavChrome: View {
    @Bindable var model: AppModel
    var currentSurface: RootView.Surface
    var onSelect: (RootView.Surface) -> Void
    var onSettings: () -> Void
    var onConnect: () -> Void
    var onLED: () -> Void

    @Binding var assembled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scoutLayout) private var layout

    // MARK: Idle auto-hide (EXPERIMENT — one switch reverses it)
    //
    // The RESTING crown fades and slides down after `timeout` seconds without
    // chrome interaction; a tap on the invisible wake zone at the bottom edge
    // brings it back. The summoned assembly NEVER auto-hides — the operator is
    // navigating. Flip `enabled` to false and the timer, the wake zone, and
    // the hide transforms all become no-ops; nothing else references these.
    private enum IdleHide {
        static let enabled = true
        static let timeout: TimeInterval = 4
    }
    @State private var crownHidden = false
    @State private var lastInteraction = Date()

    /// Hiding only ever applies to the resting crown — never the assembly.
    private var restHidden: Bool { IdleHide.enabled && crownHidden && !assembled }

    private func poke() {
        lastInteraction = Date()
        dismissIdleHint()
        guard crownHidden else { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.25, dampingFraction: 0.85)) {
            crownHidden = false
        }
    }

    // MARK: First-run hint (companion to the IdleHide experiment)
    //
    // Shown ONCE, shortly after the chrome first appears, so the operator
    // learns the tuck-away / wake-up gesture before it first fires. Dismisses
    // on any chrome tap, on its own tap, or after a few seconds — then never
    // returns. To re-calibrate: delete the `scout.crown.idleHintSeen` default
    // (currently suffixed `.2` while the design is being tuned — settle on the
    // bare key once the card is final), or flip IdleHide.enabled off, which
    // suppresses the hint entirely.
    @AppStorage("scout.crown.idleHintSeen.2") private var idleHintSeen = false
    @State private var idleHintVisible = false

    private func dismissIdleHint() {
        guard idleHintVisible, !idleHintSeen else { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .easeOut(duration: 0.2)) {
            idleHintVisible = false
        }
        idleHintSeen = true
    }

    private var alive: Bool { model.activeAgentCount > 0 }
    /// The crown's one semantic state: work in flight. Driven by the bridge
    /// connecting/loading — frequent sub-second fleet polls would keep the
    /// mark breathing constantly, so the loop only covers real transitions.
    private var loading: Bool {
        if case .connecting = model.connectionState { return true }
        return false
    }
    private var sizing: CrownSizing { CrownSizing.resolve(layout) }
    private var hostsTotal: Int { model.pairedMachines.count }
    private var hostsOnline: Int { model.pairedMachines.filter(\.isOnline).count }
    /// The wide-canvas policy (iPad): permanent strip, pill complications, the
    /// morphing LED, and a compact bottom island. Phones keep dials + full-width.
    private var isWide: Bool { layout.physicalWidth >= 700 }
    /// The strip's content zone BELOW the safe area — the value RootView
    /// reserves via `CrownMetric.topReserve(for:)`, so content and chrome can
    /// never drift apart.
    private var railZone: CGFloat { CrownMetric.topReserve(for: layout) }
    /// RootView ignores the TOP safe area for the chrome (so the strip bleeds
    /// from the very top of the screen) — but that also zeroes
    /// `safeAreaInsets.top` inside our GeometryReader, which parked the dials
    /// at padding-from-the-screen-top, clipped by the island. Read the REAL
    /// device inset from the window instead. iPad keeps 0: its layout there
    /// is operator-approved as-is.
    private var deviceTopInset: CGFloat {
        #if canImport(UIKit)
        return UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.windows.first }
            .first?.safeAreaInsets.top ?? 0
        #else
        return 0
        #endif
    }

    // Bottom nav: each of the six phone surfaces once. Corners are the big
    // primary circles; the inner seats are the seated round targets. On the
    // wide canvas Deck earns a seat — the strip's pill pair has no third slot,
    // and the compact island row has room for it.
    private var innerLeft: [(GlyphShape.Kind, String, RootView.Surface)] {
        var items: [(GlyphShape.Kind, String, RootView.Surface)] = [
            (.agent, "Agents", .agents), (.tail, "Tail", .tail),
        ]
        if isWide { items.append((.lanes, "Deck", .deck)) }
        return items
    }
    private let innerRight: [(GlyphShape.Kind, String, RootView.Surface)] = [
        (.comms, "Comms", .comms), (.terminal, "Term", .terminal),
    ]

    var body: some View {
        GeometryReader { geo in
            ZStack {
                topCluster(geo)
                bottomCluster
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    // Hug the true bottom the way the shipped docked tab bar does:
                    // descend INTO the home-indicator band (−36) rather than floating
                    // above the full safe area. The corner circles sit at the screen's
                    // left/right edges — the indicator pill is horizontally centered,
                    // so they never collide even at this depth. Applies to the
                    // collapsed crown too — it shares this centerline.
                    .padding(.bottom, max(geo.safeAreaInsets.bottom - 36, 0))
                    // Idle auto-hide (see IdleHide): resting crown sinks away;
                    // a tap anywhere on the chrome pokes the timer.
                    .opacity(restHidden ? 0 : 1)
                    .offset(y: restHidden ? 24 : 0)
                    .allowsHitTesting(!restHidden)
                    .simultaneousGesture(TapGesture().onEnded { poke() })

                // Invisible wake zone: once the crown has sunk, a tap where it
                // lives restores it. Sized to the crown's own footprint so it
                // doesn't eat taps meant for content behind the bottom edge.
                if restHidden {
                    Color.clear
                        .frame(width: sizing.crown + 48, height: sizing.crown + 12)
                        .contentShape(Rectangle())
                        .onTapGesture { poke() }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, max(geo.safeAreaInsets.bottom - 36, 0))
                }

                // One-time explainer for the tuck-away gesture (see
                // dismissIdleHint). Floats just above the crown's home so the
                // pointer reads as indicating the wake zone.
                if idleHintVisible {
                    idleHint
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, sizing.crown + 56)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
        }
        .onChange(of: assembled) { _, summoned in
            // Summoning always revives the crown and re-arms the timer.
            if summoned { crownHidden = false; lastInteraction = Date() }
        }
        .task {
            // Idle watcher: parks the resting crown after the timeout. No-op
            // while IdleHide is disabled or the assembly is summoned.
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard IdleHide.enabled, !assembled, !crownHidden,
                      Date().timeIntervalSince(lastInteraction) > IdleHide.timeout else { continue }
                withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.3, dampingFraction: 0.85)) {
                    crownHidden = true
                }
            }
        }
        .task(id: crownHidden) {
            // One-time IdleHide onboarding: fire right AFTER the first
            // disappearance, so the operator sees the crown tuck away and the
            // card explains what just happened. If they wake the crown first,
            // the id change cancels this — they've discovered the gesture on
            // their own and the next hide will offer the card again.
            guard crownHidden, IdleHide.enabled, !idleHintSeen else { return }
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, !idleHintSeen, crownHidden else { return }
            withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.3, dampingFraction: 0.85)) {
                idleHintVisible = true
            }
            try? await Task.sleep(for: .seconds(8))
            dismissIdleHint()
        }
        .environment(\.colorScheme, .dark)
    }

    /// The one-time IdleHide explainer — a small card in the crown's own
    /// machined material, hovering over the crown's home so the wake-up
    /// gesture is learned before it's needed.
    private var idleHint: some View {
        VStack(spacing: 8) {
            HStack(spacing: 7) {
                ScoutHexagon()
                    .stroke(ScoutInk.dim.opacity(0.85), lineWidth: 1)
                    .frame(width: 9, height: 10.5)
                Text("THE CROWN TUCKED ITSELF AWAY")
                    .font(HudFont.mono(8.5, weight: .semibold)).tracking(1.5)
                    .foregroundStyle(ScoutInk.dim)
            }
            Text("After \(Int(IdleHide.timeout))s idle it sinks out of view —\ntap the bottom edge to bring it back.")
                .font(HudFont.mono(10.5, weight: .medium))
                .foregroundStyle(HudPalette.ink)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
            Glyphic(kind: .chevron, size: 9, rotation: .degrees(180))
                .foregroundStyle(ScoutInk.dim)
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .modifier(CrownMachined(shape: RoundedRectangle(cornerRadius: 14, style: .continuous)))
                .overlay(
                    ScoutFilmGrain(grainOpacity: 0.05)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                )
                .shadow(color: .black.opacity(0.55), radius: 16, y: 8)
        )
        .onTapGesture { dismissIdleHint() }
        .accessibilityLabel("The crown hides after a few seconds idle. Tap the bottom edge to bring it back.")
    }

    // The permanent top strip: a FULL-BLEED solid band (the docked tab bar's
    // top sibling — solid graphite, hairline, drop shadow), sized to HOST the
    // complications, so a circle (phone) or pill (iPad) landing in it reads as
    // a perfect fit, not an overlay. The display docks into its center and
    // NEVER unmounts, permanently reserving the middle so nothing is covered
    // when the complications lodge into the strip's ends on summon. The iPad
    // keeps the strip at ALL times (the wide canvas has space to cover and not
    // always enough content, so the band earns its keep); the iPhone goes
    // minimal — no strip at rest, and on summon the strip fades in full-bleed
    // FROM THE VERY TOP so the island punches through it (a strip starting
    // below the notch leaves an ugly dead band). Phone content TOP-ANCHORS
    // 14pt below the REAL device inset (`deviceTopInset` — the chrome ignores
    // the top safe area, so geo's inset reads 0 here), the row CENTER-aligned
    // so LED and dials share one centerline.
    private func topCluster(_ geo: GeometryProxy) -> some View {
        let inset = deviceTopInset
        let railHeight = inset + railZone
        return ZStack(alignment: .top) {
            LinearGradient(
                colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                startPoint: .top, endPoint: .bottom
            )
            .overlay(ScoutFilmGrain(grainOpacity: 0.04))
            .overlay(alignment: .bottom) {
                Rectangle().fill(ScoutSignalSurface.edge.opacity(0.5)).frame(height: HudStrokeWidth.thin)
            }
            .shadow(color: .black.opacity(0.5), radius: 12, y: 6)
            .opacity(isWide || assembled ? 1 : 0)
            .animation(.easeOut(duration: 0.14), value: assembled)
            .frame(height: railHeight)

            VStack(spacing: 0) {
                Spacer().frame(height: inset)
                HStack(alignment: .center, spacing: 0) {
                    topLeading
                    Spacer(minLength: 8)
                    Button(action: onLED) { ledDisplay }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Fleet vitals")
                    Spacer(minLength: 8)
                    topTrailing
                }
                .padding(.horizontal, isWide ? 22 : sizing.hPad)
                .padding(.top, isWide ? 0 : 14)
                .frame(height: railZone, alignment: isWide ? .center : .top)
            }
            .frame(height: railHeight)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // Connect lodges into the strip's left end — a pill on iPad, a dial on the
    // phone. Both slide IN FROM THE CENTER on summon (the study's lodging
    // motion), and both sit at the same inset as the bottom corners, so each
    // side shares one vertical line top to bottom.
    @ViewBuilder
    private var topLeading: some View {
        if isWide {
            stagedTop(leading: true, 0) { CrownPill(glyph: .signal, label: "Connect", action: onConnect) }
        } else {
            stagedTop(leading: true, 0) {
                CrownCornerButton(glyph: .signal, label: "Connect", diameter: sizing.corner, glyphSize: sizing.cornerGlyph, showsLabel: false, action: onConnect)
            }
        }
    }

    @ViewBuilder
    private var topTrailing: some View {
        if isWide {
            stagedTop(leading: false, 1) { CrownPill(glyph: .gear, label: "Settings", action: onSettings) }
        } else {
            stagedTop(leading: false, 1) {
                CrownCornerButton(glyph: .gear, label: "Settings", diameter: sizing.corner, glyphSize: sizing.cornerGlyph, showsLabel: false, action: onSettings)
            }
        }
    }

    @ViewBuilder
    private var ledDisplay: some View {
        if isWide {
            MorphLED(
                agents: model.agentCount,
                active: model.activeAgentCount,
                hostsOnline: hostsOnline,
                hostsTotal: hostsTotal,
                working: model.liveAgents,
                budgets: model.serviceBudgets,
                expanded: assembled
            )
        } else {
            FleetLED(
                agents: model.agentCount,
                active: model.activeAgentCount,
                hostsOnline: hostsOnline,
                hostsTotal: hostsTotal,
                compact: layout.isMiniPhone
            )
        }
    }

    private var bottomCluster: some View {
        // A ZStack whose vertical center IS the shared centerline. The bar, the
        // HStack of controls (center-aligned), and the crown all center here, so
        // every element sits on one line. `.bottom` label room is reserved below.
        // On iPad the whole unit is a compact centered ISLAND (the phone
        // treatment, not a full-width extrusion): zero horizontal padding inside
        // a 620pt frame, so the bar ends exactly at the corner buttons' edges.
        let hPad: CGFloat = isWide ? 0 : sizing.hPad
        return ZStack {
            // The one continuous bar — rounded ends run under the Home/New circles
            // so the whole bottom reads as a single joined unit. Its Capsule caps
            // are concentric with the corner circles that sit on them.
            Capsule()
                .fill(
                    LinearGradient(
                        colors: [ScoutSignalSurface.top, ScoutSignalSurface.bottom],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .modifier(CrownMachined(shape: Capsule()))
                .overlay(ScoutFilmGrain(grainOpacity: 0.05).clipShape(Capsule()))
                .frame(height: sizing.barHeight)
                .padding(.horizontal, hPad)
                .shadow(color: .black.opacity(0.5), radius: 20, y: 8)
                .scaleEffect(x: assembled ? 1 : 0.16, y: 1, anchor: .center)
                .opacity(assembled ? 1 : 0)
                .animation(anim(0), value: assembled)

            // Controls seated on the bar. HStack(.center) puts every circle center
            // on the shared line regardless of diameter.
            HStack(alignment: .center, spacing: 0) {
                staged(1) {
                    CrownCornerButton(glyph: .home, label: "Home", isActive: currentSurface == .home, diameter: sizing.corner, glyphSize: sizing.cornerGlyph, showsLabel: false) { onSelect(.home) }
                }
                Spacer(minLength: 4)
                ForEach(Array(innerLeft.enumerated()), id: \.offset) { index, item in
                    staged(2 + index) {
                        CrownInnerSeat(glyph: item.0, label: item.1, isActive: currentSurface == item.2, diameter: sizing.seat, glyphSize: sizing.seatGlyph) { onSelect(item.2) }
                    }
                    if index < innerLeft.count - 1 { Spacer(minLength: 4) }
                }
                Spacer().frame(width: sizing.crownGap)
                ForEach(Array(innerRight.enumerated()), id: \.offset) { index, item in
                    staged(2 + innerLeft.count + index) {
                        CrownInnerSeat(glyph: item.0, label: item.1, isActive: currentSurface == item.2, diameter: sizing.seat, glyphSize: sizing.seatGlyph) { onSelect(item.2) }
                    }
                    if index < innerRight.count - 1 { Spacer(minLength: 4) }
                }
                Spacer(minLength: 4)
                staged(2 + innerLeft.count + innerRight.count) {
                    CrownCornerButton(glyph: .plus, label: "New", isActive: currentSurface == .new, diameter: sizing.corner, glyphSize: sizing.cornerGlyph, showsLabel: false) { onSelect(.new) }
                }
            }
            .padding(.horizontal, hPad)

            // Crown — hex visual center exactly on the shared centerline, and it
            // STAYS there: the operator rejected the old rise-into-place on
            // summon. Tapping pulses the crown in place (see CrownButton); the
            // bar and seats expand around it.
            CrownButton(active: assembled, alive: alive, loading: loading, diameter: sizing.crown, hexSize: sizing.hex) {
                #if canImport(UIKit)
                UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                #endif
                assembled.toggle()
            }
        }
        .frame(maxWidth: isWide ? 620 : .infinity)
        // Labels are gone — only a snug reserve below the control row so the
        // unit hugs the bottom without dead space padding it out. The wide
        // canvas keeps 2pt more so the island's rim never kisses the status
        // strip's top edge below it.
        .padding(.bottom, isWide ? 6 : 4)
    }

    // Fast spring + tight stagger — the operator wants the choreography
    // EXTREMELY quick. Reduce Motion collapses to a cross-fade (mirrors how
    // RootView already gates reduceMotion).
    private func anim(_ index: Int) -> Animation {
        if reduceMotion { return .easeOut(duration: 0.12) }
        return .spring(response: 0.17, dampingFraction: 0.82).delay(Double(index) * 0.014)
    }

    @ViewBuilder
    private func staged<Content: View>(_ index: Int, @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .scaleEffect(assembled ? 1 : 0.3)
            .opacity(assembled ? 1 : 0)
            .allowsHitTesting(assembled)
            .animation(anim(index), value: assembled)
    }

    /// The top complications' entrance: a scale-up PLUS a slide in from the
    /// strip's center — the study's "lodging" motion, so a complication reads
    /// as docking into its slot rather than popping into existence. Wide-canvas
    /// pills ride 1pt high so their bottom rim clears the strip's lower edge.
    @ViewBuilder
    private func stagedTop<Content: View>(leading: Bool, _ index: Int, @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .scaleEffect(assembled ? 1 : 0.4)
            .opacity(assembled ? 1 : 0)
            .offset(x: assembled ? 0 : (leading ? 90 : -90))
            .offset(y: isWide ? -1 : 0)
            .allowsHitTesting(assembled)
            .animation(anim(index), value: assembled)
    }
}

// MARK: - Fleet vitals panel (LED quick-action surface)
//
// Tapping the LED opens this compact instrument card — glance + quick action,
// NOT the full ConnectionView (that stays behind the Connect corner). It reuses
// what AppModel already exposes: the transport route, per-host state, the shared
// fetch instant, and the existing refresh / pairing paths. No new RPCs.

struct CrownVitalsPanel: View {
    @Bindable var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var refreshing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("FLEET · VITALS")
                    .font(HudFont.mono(9, weight: .semibold)).tracking(1.6)
                    .foregroundStyle(ScoutInk.dim)
                Spacer()
                Button { dismiss() } label: {
                    Glyphic(kind: .chevron, size: 13, rotation: .degrees(90))
                        .foregroundStyle(ScoutInk.dim)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 12)

            // Route + freshness — the LED's data, expanded.
            TimelineView(.periodic(from: .now, by: 1)) { context in
                HStack(spacing: 10) {
                    HudStatusDot(color: model.statusTint, size: 7, pulses: model.statusPulses)
                    Text(model.statusLabel.uppercased())
                        .font(HudFont.mono(11, weight: .semibold)).tracking(0.5)
                        .foregroundStyle(HudPalette.ink)
                    Spacer()
                    Text("FETCHED \(ageLabel(from: model.lastSuccessfulFetchAt, now: context.date))")
                        .font(HudFont.mono(9, weight: .medium))
                        .foregroundStyle(ScoutInk.dim)
                }
                .padding(.vertical, 10)
            }

            Rectangle().fill(ScoutSignalSurface.rule).frame(height: 1)

            // Per-host connection status.
            if model.pairedMachines.isEmpty {
                Text("No Macs paired yet")
                    .font(HudFont.mono(10, weight: .medium))
                    .foregroundStyle(ScoutInk.dim)
                    .padding(.vertical, 16)
            } else {
                VStack(spacing: 0) {
                    ForEach(model.pairedMachines) { machine in
                        hostRow(machine)
                    }
                }
                .padding(.vertical, 2)
            }

            // Discoverable Macs on this Wi-Fi that aren't paired yet — the same
            // cheap Bonjour scan the Connect screen runs on appear. Glance only:
            // tapping a peer routes into the real pairing flow (no inline pair).
            if !availablePeers.isEmpty {
                Rectangle().fill(ScoutSignalSurface.rule).frame(height: 1)
                Text("ON YOUR NETWORK")
                    .font(HudFont.mono(7, weight: .semibold)).tracking(1.4)
                    .foregroundStyle(ScoutInk.dim.opacity(0.7))
                    .padding(.top, 12).padding(.bottom, 2)
                VStack(spacing: 0) {
                    ForEach(availablePeers.prefix(3)) { peer in
                        peerRow(peer)
                    }
                }
                .padding(.vertical, 2)
            }

            // Usage — per-provider quota windows (Claude / Codex / Kimi …). The richer
            // stats the operator wants living in the LED/vitals rather than crowding
            // Home. Only when the connected bridge reports them.
            if !model.serviceBudgets.isEmpty {
                Rectangle().fill(ScoutSignalSurface.rule).frame(height: 1)
                Text("USAGE")
                    .font(HudFont.mono(7, weight: .semibold)).tracking(1.4)
                    .foregroundStyle(ScoutInk.dim.opacity(0.7))
                    .padding(.top, 12).padding(.bottom, 2)
                VStack(spacing: 0) {
                    ForEach(model.serviceBudgets.prefix(3)) { budget in
                        usageRow(budget)
                    }
                }
                .padding(.vertical, 2)
            }

            Rectangle().fill(ScoutSignalSurface.rule).frame(height: 1)

            // Quick actions: refresh (fleet stats + reconnect) and the existing
            // LAN discovery / pairing flow — no new endpoints.
            HStack(spacing: 10) {
                actionButton(title: refreshing ? "Refreshing…" : "Refresh", glyph: .arrow, accent: true) {
                    guard !refreshing else { return }
                    refreshing = true
                    Task {
                        await model.refreshFleetStats()
                        await model.reconnect()
                        refreshing = false
                    }
                }
                actionButton(title: "Find Macs", glyph: .signal, accent: false) {
                    dismiss()
                    model.showPairing = true
                }
            }
            .padding(.top, 14)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .presentationDetents([.height(panelHeight)])
        .presentationDragIndicator(.visible)
        .presentationBackground(HudPalette.chrome)
        .preferredColorScheme(.dark)
        // Same idempotent LAN browse the Connect screen runs on appear — surfaces
        // any not-yet-paired Scout Macs on this Wi-Fi. No broker RPC.
        .task { await model.refreshLanPairTargets() }
    }

    /// Discovered LAN Macs that aren't already paired — the "available to add"
    /// peers, distinct from the paired hosts above. Keyed on the shared public-key
    /// hex, case-normalized (paired ids are lowercased).
    private var availablePeers: [AppModel.LanPairTarget] {
        let paired = Set(model.pairedMachines.map { $0.id.lowercased() })
        return model.lanPairTargets.filter { !paired.contains($0.id.lowercased()) }
    }

    private var panelHeight: CGFloat {
        let hosts = 200 + CGFloat(max(1, min(model.pairedMachines.count, 4))) * 38
        let peers = availablePeers.isEmpty ? 0 : 30 + CGFloat(min(availablePeers.count, 3)) * 32
        let usage = model.serviceBudgets.isEmpty ? 0 : 30 + CGFloat(min(model.serviceBudgets.count, 3)) * 34
        return hosts + peers + usage
    }

    private func hostRow(_ machine: AppModel.PairedMachine) -> some View {
        HStack(spacing: 10) {
            HudStatusDot(color: machine.isOnline ? HudPalette.accent : ScoutInk.dim, size: 6, pulses: false)
            Text(machine.name)
                .font(HudFont.mono(11, weight: .medium))
                .foregroundStyle(machine.isOnline ? HudPalette.ink : ScoutInk.muted)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(machine.route?.label ?? "offline")
                .font(HudFont.mono(9, weight: .medium))
                .foregroundStyle(machine.isOnline ? HudPalette.accent : ScoutInk.dim)
            if let seen = lastSeenLabel(machine.lastSeen) {
                Text(seen)
                    .font(HudFont.mono(9, weight: .regular))
                    .foregroundStyle(ScoutInk.dim)
                    .frame(width: 42, alignment: .trailing)
            }
        }
        .padding(.vertical, 9)
    }

    /// A discoverable-but-unpaired Mac. Reads as a dim, dotted instrument row (not
    /// an online host); tapping routes into the existing pairing sheet rather than
    /// pairing inline (trust-on-first-use needs the Mac's approval).
    private func peerRow(_ peer: AppModel.LanPairTarget) -> some View {
        Button {
            dismiss()
            model.showPairing = true
        } label: {
            HStack(spacing: 10) {
                Circle()
                    .stroke(ScoutSignalSurface.neutralSignal.opacity(0.5), lineWidth: 1)
                    .frame(width: 6, height: 6)
                Text(peer.displayName)
                    .font(HudFont.mono(11, weight: .medium))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text("PAIR")
                    .font(HudFont.mono(8, weight: .semibold)).tracking(0.8)
                    .foregroundStyle(HudPalette.accent.opacity(0.85))
                Glyphic(kind: .chevron, size: 10).foregroundStyle(ScoutInk.dim)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Pair \(peer.displayName)")
    }

    /// One provider's quota, in LED grammar: a bold provider tag + its windows as
    /// "label pct" pairs, the percent brightening as it fills. Read-only glance.
    private func usageRow(_ budget: ServiceBudget) -> some View {
        HStack(spacing: 10) {
            Text((budget.label.isEmpty ? budget.provider : budget.label).uppercased())
                .font(HudFont.mono(10, weight: .semibold)).tracking(0.4)
                .foregroundStyle(HudPalette.ink)
                .lineLimit(1)
                .frame(width: 78, alignment: .leading)
            Spacer(minLength: 8)
            HStack(spacing: 12) {
                ForEach(Array(budget.windows.prefix(2).enumerated()), id: \.offset) { _, window in
                    HStack(spacing: 5) {
                        Text(window.label)
                            .font(HudFont.mono(9, weight: .regular))
                            .foregroundStyle(ScoutInk.dim)
                        Text("\(Int(window.usedPercent.rounded()))%")
                            .font(HudFont.mono(9, weight: .semibold))
                            .foregroundStyle(window.usedPercent >= 80 ? HudPalette.accent : ScoutInk.muted)
                    }
                }
            }
        }
        .padding(.vertical, 8)
    }

    private func actionButton(title: String, glyph: GlyphShape.Kind, accent: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Glyphic(kind: glyph, size: 13)
                Text(title).font(HudFont.mono(10, weight: .semibold)).tracking(0.4)
            }
            .foregroundStyle(accent ? HudPalette.accent : ScoutInk.muted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(ScoutSurface.inset))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(accent ? HudPalette.accent.opacity(0.4) : HudHairline.standard, lineWidth: HudStrokeWidth.thin)
            )
        }
        .buttonStyle(.plain)
    }

    private func ageLabel(from date: Date?, now: Date) -> String {
        guard let date else { return "—" }
        let age = max(0, Int(now.timeIntervalSince(date)))
        if age < 60 { return "\(age)s" }
        if age < 3600 { return "\(age / 60)m" }
        return "\(age / 3600)h"
    }

    private func lastSeenLabel(_ date: Date?) -> String? {
        guard let date else { return nil }
        let age = max(0, Int(Date.now.timeIntervalSince(date)))
        if age < 60 { return "\(age)s" }
        if age < 3600 { return "\(age / 60)m" }
        if age < 86_400 { return "\(age / 3600)h" }
        return "\(age / 86_400)d"
    }
}
