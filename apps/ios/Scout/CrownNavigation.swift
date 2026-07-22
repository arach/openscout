import SwiftUI
import HudsonUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Crown navigation (opt-in "crown mode")
//
// An alternative navigation chrome the operator can flip on from Settings →
// Appearance. The shipped `titleBar + dockedTabBar + status strip` stays fully
// intact for `.tabs`; `.crown` replaces it with a summonable hex crown that
// anchors a fused bottom nav bar plus a live Fleet LED.
//
// Design spec: design/studio/views/crown-complications.tsx (Variant B). The
// geometry is authored with SwiftUI layout (not ported pixel-for-pixel) and
// derives from the safe area, so it is island-aware and works on iPad (no
// island). App-local on purpose — HudsonKit is untouched this pass.

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

// MARK: - Hex mark
//
// No hex/scout glyph exists in Glyphs.swift or Assets, so the crown is drawn
// here in the same thin-line spirit as the unified Glyphic set: a pointy-top
// hexagon with a warm-dark face, an emerald rim, one inner facet, and a lit
// core that carries fleet-alive state.

struct ScoutHexagon: Shape {
    func path(in rect: CGRect) -> Path {
        let cx = rect.midX
        var p = Path()
        p.move(to: CGPoint(x: cx, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.25))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + rect.height * 0.75))
        p.addLine(to: CGPoint(x: cx, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + rect.height * 0.75))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + rect.height * 0.25))
        p.closeSubpath()
        return p
    }
}

struct CrownHexMark: View {
    var size: CGFloat = 30
    var lit: Bool = true

    var body: some View {
        let tokens = ScoutTone.stored.tokens
        ZStack {
            ScoutHexagon()
                .fill(
                    LinearGradient(
                        colors: [tokens.cardTop, tokens.cardBottom],
                        startPoint: .top, endPoint: .bottom
                    )
                )
            ScoutHexagon()
                .stroke(ScoutCanvas.accentGradient, lineWidth: lit ? 2 : 1.6)
            ScoutHexagon()
                .scale(0.52)
                .stroke(ScoutSignalSurface.neutralSignal.opacity(0.22), lineWidth: 1)
            Circle()
                .fill(lit ? HudPalette.accent : HudPalette.accent.opacity(0.4))
                .frame(width: size * 0.2, height: size * 0.2)
                .shadow(color: lit ? HudPalette.accent.opacity(0.85) : .clear, radius: 3)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - The crown button

private struct CrownButton: View {
    var active: Bool
    var alive: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [ScoutTone.stored.tokens.cardTop, ScoutTone.stored.tokens.cardBottom],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
                    .overlay(
                        Circle().stroke(
                            active ? HudPalette.accent.opacity(0.4) : ScoutCanvas.cardEdgeTop,
                            lineWidth: active ? 1 : 0.8
                        )
                    )
                    .shadow(color: .black.opacity(0.55), radius: active ? 12 : 8, y: 5)
                // Summoned halo, or a resting breathing ring when the fleet is live.
                Circle()
                    .stroke(HudPalette.accent.opacity(active ? 0.42 : (alive ? 0.22 : 0)), lineWidth: 1)
                    .padding(active ? -8 : -2)
                    .shadow(color: active ? HudPalette.accent.opacity(0.25) : .clear, radius: 12)
                CrownHexMark(size: 30, lit: active || alive)
            }
            .frame(width: 56, height: 56)
            .scaleEffect(active ? 1.06 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(active ? "Close navigation" : "Open navigation")
    }
}

// MARK: - Fleet LED (top-middle, real data)
//
// An inset instrument well: a pip meter (lit = active of total), a
// tightly-glowing active count, and a dim relative age from the same fetch
// instant as the shipped status bar. Staleness sinks (dims); no yellow alarm.

private struct FleetLED: View {
    var total: Int
    var active: Int
    var fetchedAt: Date?

    private let ledGreen = Color(red: 63.0 / 255, green: 240.0 / 255, blue: 176.0 / 255)

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            HStack(spacing: 9) {
                Text("FLEET")
                    .font(HudFont.mono(7, weight: .semibold))
                    .tracking(1.4)
                    .foregroundStyle(Color(red: 86.0 / 255, green: 96.0 / 255, blue: 88.0 / 255))
                HStack(spacing: 3) {
                    ForEach(0..<pipCount, id: \.self) { index in
                        Circle()
                            .fill(index < litCount ? HudPalette.accent : Color(red: 20.0 / 255, green: 29.0 / 255, blue: 24.0 / 255))
                            .frame(width: 5, height: 5)
                            .shadow(color: index < litCount ? HudPalette.accent.opacity(0.7) : .clear, radius: 2)
                    }
                }
                Text("\(active) ACTIVE")
                    .font(HudFont.mono(9, weight: .bold))
                    .tracking(0.8)
                    .foregroundStyle(ledGreen)
                    .shadow(color: HudPalette.accent.opacity(0.5), radius: 3)
                Text(ageLabel(now: context.date))
                    .font(HudFont.mono(8, weight: .medium))
                    .foregroundStyle(ScoutInk.dim.opacity(0.7))
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color(red: 7.0 / 255, green: 10.0 / 255, blue: 9.0 / 255))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(red: 30.0 / 255, green: 35.0 / 255, blue: 31.0 / 255), lineWidth: 1))
                    .shadow(color: .black.opacity(0.85), radius: 3, y: 1)
            )
        }
    }

    private var pipCount: Int { min(max(total, 1), 6) }
    private var litCount: Int { max(0, min(active, pipCount)) }

    private func ageLabel(now: Date) -> String {
        guard let fetchedAt else { return "—" }
        let age = max(0, Int(now.timeIntervalSince(fetchedAt)))
        if age < 60 { return "\(age)s" }
        if age < 3600 { return "\(age / 60)m" }
        return "\(age / 3600)h"
    }
}

// MARK: - Alignment constants
//
// Every bottom control (corner circles, inner seats, crown) is centered on ONE
// shared horizontal line — an `HStack(alignment: .center)` aligns the circle
// centers automatically, and every label sits at the SAME distance below that
// line, so the six labels share one baseline outside the bar. Geometry-derived,
// not eyeballed.

private enum CrownMetric {
    static let cornerDiameter: CGFloat = 54
    static let seatDiameter: CGFloat = 38
    static let crownDiameter: CGFloat = 56
    static let barHeight: CGFloat = 52
    /// Distance from the shared centerline to every label — uniform for all six.
    static let labelOffset: CGFloat = 40
}

// MARK: - Corner button (big primary affordance)

private struct CrownCornerButton: View {
    var glyph: GlyphShape.Kind
    var label: String
    var isActive: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            // Frame == the circle, so the HStack centers on the circle's center;
            // the label overflows below at a uniform offset (not part of layout).
            Circle()
                .fill(
                    LinearGradient(
                        colors: [ScoutTone.stored.tokens.cardTop, ScoutTone.stored.tokens.cardBottom],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .overlay(
                    Circle().stroke(
                        isActive ? HudPalette.accent.opacity(0.45) : ScoutCanvas.cardEdgeTop,
                        lineWidth: isActive ? 1 : 0.8
                    )
                )
                .overlay(Glyphic(kind: glyph, size: 22).foregroundStyle(isActive ? HudPalette.accent : ScoutInk.muted))
                .shadow(color: .black.opacity(0.5), radius: 6, y: 4)
                .frame(width: CrownMetric.cornerDiameter, height: CrownMetric.cornerDiameter)
                .overlay(alignment: .center) {
                    Text(label)
                        .font(HudFont.mono(8, weight: .medium)).tracking(0.6).fixedSize()
                        .foregroundStyle(isActive ? ScoutInk.dim : ScoutInk.dim.opacity(0.8))
                        .offset(y: CrownMetric.labelOffset)
                }
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
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(isActive ? HudPalette.accent.opacity(0.08) : Color.white.opacity(0.025))
                .overlay(
                    Circle().stroke(
                        isActive ? HudPalette.accent.opacity(0.5) : ScoutSignalSurface.neutralSignal.opacity(0.28),
                        lineWidth: 1
                    )
                )
                .overlay(Glyphic(kind: glyph, size: 16).foregroundStyle(isActive ? HudPalette.accent : ScoutInk.dim))
                .frame(width: CrownMetric.seatDiameter, height: CrownMetric.seatDiameter)
                .overlay(alignment: .center) {
                    Text(label)
                        .font(HudFont.mono(7, weight: .medium)).tracking(0.4).fixedSize()
                        .foregroundStyle(isActive ? ScoutInk.dim : ScoutInk.dim.opacity(0.75))
                        .offset(y: CrownMetric.labelOffset)
                }
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

    @Binding var assembled: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var alive: Bool { model.activeAgentCount > 0 }

    // Bottom nav: each of the six phone surfaces once. Corners are the big
    // primary circles; the inner four are the seated round targets.
    private let innerLeft: [(GlyphShape.Kind, String, RootView.Surface)] = [
        (.agent, "Agents", .agents), (.tail, "Tail", .tail),
    ]
    private let innerRight: [(GlyphShape.Kind, String, RootView.Surface)] = [
        (.comms, "Comms", .comms), (.terminal, "Term", .terminal),
    ]

    var body: some View {
        GeometryReader { geo in
            ZStack {
                topCluster
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .padding(.top, 6)
                bottomCluster
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, max(geo.safeAreaInsets.bottom, 8) + 2)
            }
        }
        .environment(\.colorScheme, .dark)
    }

    // The two top corners host the app's real top-level sheets (Connect ·
    // Settings) — not a redundant "Deck". The Fleet LED sits centered below
    // the island (safe area keeps it clear on Dynamic Island phones).
    private var topCluster: some View {
        ZStack {
            FleetLED(total: model.agentCount, active: model.activeAgentCount, fetchedAt: model.lastSuccessfulFetchAt)
                .opacity(assembled ? 1 : 0)
                .offset(y: assembled ? 0 : -9)
                .animation(anim(2), value: assembled)

            HStack {
                staged(0) { CrownCornerButton(glyph: .signal, label: "Connect", action: onConnect) }
                Spacer()
                staged(1) { CrownCornerButton(glyph: .gear, label: "Settings", action: onSettings) }
            }
            .padding(.horizontal, 20)
        }
    }

    private var bottomCluster: some View {
        // A ZStack whose vertical center IS the shared centerline. The bar, the
        // HStack of controls (center-aligned), and the crown all center here, so
        // every element sits on one line. `.bottom` label room is reserved below.
        ZStack {
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
                .overlay(Capsule().stroke(ScoutSignalSurface.edge, lineWidth: 1))
                .frame(height: CrownMetric.barHeight)
                .padding(.horizontal, 20)
                .shadow(color: .black.opacity(0.5), radius: 12, y: 6)
                .scaleEffect(x: assembled ? 1 : 0.16, y: 1, anchor: .center)
                .opacity(assembled ? 1 : 0)
                .animation(anim(0), value: assembled)

            // Controls seated on the bar. HStack(.center) puts every circle center
            // on the shared line regardless of diameter.
            HStack(alignment: .center, spacing: 0) {
                staged(1) {
                    CrownCornerButton(glyph: .home, label: "Home", isActive: currentSurface == .home) { onSelect(.home) }
                }
                Spacer(minLength: 4)
                ForEach(Array(innerLeft.enumerated()), id: \.offset) { index, item in
                    staged(2 + index) {
                        CrownInnerSeat(glyph: item.0, label: item.1, isActive: currentSurface == item.2) { onSelect(item.2) }
                    }
                    if index == 0 { Spacer(minLength: 4) }
                }
                Spacer().frame(width: CrownMetric.crownDiameter + 14)
                ForEach(Array(innerRight.enumerated()), id: \.offset) { index, item in
                    staged(4 + index) {
                        CrownInnerSeat(glyph: item.0, label: item.1, isActive: currentSurface == item.2) { onSelect(item.2) }
                    }
                    if index == 0 { Spacer(minLength: 4) }
                }
                Spacer(minLength: 4)
                staged(6) {
                    CrownCornerButton(glyph: .plus, label: "New", isActive: currentSurface == .new) { onSelect(.new) }
                }
            }
            .padding(.horizontal, 26)

            // Crown — hex visual center exactly on the shared centerline (no notch;
            // its halo is symmetric, so geometric == optical center).
            CrownButton(active: assembled, alive: alive) {
                #if canImport(UIKit)
                UIImpactFeedbackGenerator(style: .soft).impactOccurred()
                #endif
                assembled.toggle()
            }
        }
        // Reserve room below the centerline for the uniform label baseline.
        .padding(.bottom, CrownMetric.labelOffset + 12)
    }

    // Spring + stagger matching the study; Reduce Motion collapses to a
    // cross-fade (mirrors how RootView already gates reduceMotion).
    private func anim(_ index: Int) -> Animation {
        if reduceMotion { return .easeOut(duration: 0.18) }
        return .spring(response: 0.34, dampingFraction: 0.72).delay(Double(index) * 0.036)
    }

    @ViewBuilder
    private func staged<Content: View>(_ index: Int, @ViewBuilder _ content: () -> Content) -> some View {
        content()
            .scaleEffect(assembled ? 1 : 0.3)
            .opacity(assembled ? 1 : 0)
            .allowsHitTesting(assembled)
            .animation(anim(index), value: assembled)
    }
}
