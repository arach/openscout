import SwiftUI
import HudsonUI

// MARK: - v3 navigation (experimental)
//
// The additive "fleet timeline" navigation slice, gated behind Settings →
// Appearance → "v3 navigation (experimental)" (off by default). Source of
// truth: design/studio/views/mobile-timeline.tsx (the MTL_CSS template) and
// plans/scout-mobile-timeline.md → "## v3 (settled shape)".
//
// Tab bar: Home · Chats · [hex] · Projects · Alerts. Consumption left of the
// hex (the feed, conversations); the fleet's structure and demands right of
// it (places, obligations). Chrome is a fixed stack: a 52pt masthead, one
// 44pt per-surface sub bar, and a 60pt tab bar.

enum ScoutV3 {
    /// The off-by-default root swap. Read via `@AppStorage` in ScoutApp (the
    /// swap) and AppSettingsView (the toggle row).
    static let storageKey = "scout.nav.v3"
}

// MARK: - Scout mark

/// The Scout mark as a logo lockup — the filleted-hex geometry of the wire
/// mark, drawn heavy: a thick outer ring with a filled inner hex (the studio
/// `ScoutMark`, viewBox "0 0 224 236", outer strokeWidth 26). Monochrome ink;
/// the logo carries the identity, so the masthead has no wordmark.
struct V3ScoutMark: View {
    var size: CGFloat = 23

    private static let viewBox = CGSize(width: 224, height: 236)
    private static let outerRing = SVGPathData.parse(
        "M103.01 13.21 Q112 8 120.99 13.21 L198.01 57.79 Q207 63 207 73.39 L207 162.61 Q207 173 198.01 178.21 L120.99 222.79 Q112 228 103.01 222.79 L25.99 178.21 Q17 173 17 162.61 L17 73.39 Q17 63 25.99 57.79 Z"
    )
    private static let innerHex = SVGPathData.parse("M112 70 154 94v48l-42 24-42-24V94Z")

    var body: some View {
        let scale = size / Self.viewBox.width
        let transform = CGAffineTransform(scaleX: scale, y: scale)
        ZStack {
            Self.outerRing
                .applying(transform)
                .stroke(style: StrokeStyle(lineWidth: 26 * scale, lineJoin: .round))
            Self.innerHex
                .applying(transform)
                .fill()
        }
        .foregroundStyle(ScoutPalette.ink)
        .frame(width: size, height: size * (Self.viewBox.height / Self.viewBox.width))
        .accessibilityHidden(true)
    }
}

// MARK: - Bespoke gear

/// The bespoke Scout gear (design/studio/components/scout-ios/Glyph.tsx,
/// case "gear"): an 8-tooth rounded gear in a 24-unit viewBox with a center
/// circle r=3.2. Path data is VERBATIM from the studio source — v3 uses our
/// gear, never an SF Symbol. Stroked at the shared glyph weight.
struct V3GearGlyph: View {
    var size: CGFloat = 20

    private static let gearPath: Path = {
        var path = SVGPathData.parse(
            "M9.63 4.95 Q10.69 4.51 10.84 3.37 L10.85 3.29 Q10.99 2.15 12.14 2.15 L11.86 2.15 Q13.01 2.15 13.15 3.29 L13.16 3.37 Q13.31 4.51 14.37 4.95 L15.31 5.34 Q16.37 5.78 17.28 5.08 L17.34 5.03 Q18.25 4.32 19.06 5.14 L18.86 4.94 Q19.68 5.75 18.97 6.66 L18.92 6.72 Q18.22 7.63 18.66 8.69 L19.05 9.63 Q19.49 10.69 20.63 10.84 L20.71 10.85 Q21.85 10.99 21.85 12.14 L21.85 11.86 Q21.85 13.01 20.71 13.15 L20.63 13.16 Q19.49 13.31 19.05 14.37 L18.66 15.31 Q18.22 16.37 18.92 17.28 L18.97 17.34 Q19.68 18.25 18.86 19.06 L19.06 18.86 Q18.25 19.68 17.34 18.97 L17.28 18.92 Q16.37 18.22 15.31 18.66 L14.37 19.05 Q13.31 19.49 13.16 20.63 L13.15 20.71 Q13.01 21.85 11.86 21.85 L12.14 21.85 Q10.99 21.85 10.85 20.71 L10.84 20.63 Q10.69 19.49 9.63 19.05 L8.69 18.66 Q7.63 18.22 6.72 18.92 L6.66 18.97 Q5.75 19.68 4.94 18.86 L5.14 19.06 Q4.32 18.25 5.03 17.34 L5.08 17.28 Q5.78 16.37 5.34 15.31 L4.95 14.37 Q4.51 13.31 3.37 13.16 L3.29 13.15 Q2.15 13.01 2.15 11.86 L2.15 12.14 Q2.15 10.99 3.29 10.85 L3.37 10.84 Q4.51 10.69 4.95 9.63 L5.34 8.69 Q5.78 7.63 5.08 6.72 L5.03 6.66 Q4.32 5.75 5.14 4.94 L4.94 5.14 Q5.75 4.32 6.66 5.03 L6.72 5.08 Q7.63 5.78 8.69 5.34 Z"
        )
        path.addEllipse(in: CGRect(x: 12 - 3.2, y: 12 - 3.2, width: 6.4, height: 6.4))
        return path
    }()

    var body: some View {
        let scale = size / 24
        Self.gearPath
            .applying(CGAffineTransform(scaleX: scale, y: scale))
            .stroke(style: Glyph.style(for: size))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

// MARK: - Magnifier

/// The studio kit's `search` mark (circle + handle), in the shared thin-line
/// voice. The app's `GlyphShape` set has no search case, and v3 chrome
/// doesn't add one — this stays scoped to the v3 masthead.
struct V3SearchGlyph: View {
    var size: CGFloat = 16

    var body: some View {
        let s = size / 24
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }
        var path = Path()
        path.addEllipse(in: CGRect(x: 4.5 * s, y: 4.5 * s, width: 11 * s, height: 11 * s))
        path.move(to: pt(14.4, 14.4))
        path.addLine(to: pt(20, 20))
        return path
            .stroke(style: Glyph.style(for: size))
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

// MARK: - Center hex (compose)

/// The canonical Scout hex, bare — quiet, small, the same visual weight as
/// the other four seats. Accent only while the compose tab is active (the
/// studio `HexCompose`: outer ring only, stroke-width 10 on the 224 grid).
struct V3HexCompose: View {
    var isActive: Bool

    private static let ring = SVGPathData.parse(
        "M103.01 13.21 Q112 8 120.99 13.21 L198.01 57.79 Q207 63 207 73.39 L207 162.61 Q207 173 198.01 178.21 L120.99 222.79 Q112 228 103.01 222.79 L25.99 178.21 Q17 173 17 162.61 L17 73.39 Q17 63 25.99 57.79 Z"
    )

    var body: some View {
        let scale: CGFloat = 33 / 224
        let transform = CGAffineTransform(scaleX: scale, y: scale)
        Self.ring
            .applying(transform)
            .stroke(style: StrokeStyle(lineWidth: 10 * scale, lineJoin: .round))
            .foregroundStyle(isActive ? ScoutPalette.accent : ScoutInk.muted)
            .background {
                Self.ring
                    .applying(transform)
                    .fill(isActive ? ScoutPalette.accentSoft : .clear)
            }
            .frame(width: 33, height: 33 * (236.0 / 224.0))
            .accessibilityHidden(true)
    }
}

// MARK: - Tabs

/// Seven seats, symmetric about the hex: consumption left (what happened —
/// Home, Chats, Logs), structure right (where it happens — Projects, Shell,
/// Alerts). Logs sits beside Chats because both are things agents said; Shell
/// sits beside Projects because a terminal is a place.
enum V3Tab: String, CaseIterable, Identifiable {
    case home, chats, logs, compose, projects, shell, alerts

    var id: String { rawValue }

    var label: String {
        switch self {
        case .home: "Home"
        case .chats: "Chats"
        case .logs: "Logs"
        case .compose: "New"
        case .projects: "Projects"
        case .shell: "Shell"
        case .alerts: "Alerts"
        }
    }

    /// The hand-drawn glyph for the labeled seats; `.compose` carries the bare
    /// hex instead (`V3HexCompose`).
    var glyph: GlyphShape.Kind? {
        switch self {
        case .home: .home
        case .chats: .comms
        case .logs: .tail
        case .compose: nil
        case .projects: .folder
        case .shell: .terminal
        case .alerts: .inbox
        }
    }
}

// MARK: - Host scope

/// Home's fleet scope, from the masthead: a quiet borderless menu naming the
/// current scope — "All hosts" or one paired Mac's name — with a downward
/// caret. No counts, no capsule: the technical network view lives in Settings
/// (the gear), the masthead only scopes. Driven by the same `pairedMachines`
/// read RootView's `HostFacetQualifier` uses.
struct V3HostScopeMenu: View {
    let machines: [AppModel.PairedMachine]
    /// The scoped machine's id; nil = all hosts.
    let selection: String?
    let onSelect: (String?) -> Void

    private var scoped: AppModel.PairedMachine? {
        machines.first { $0.id == selection }
    }

    var body: some View {
        Menu {
            Button { onSelect(nil) } label: {
                if selection == nil {
                    Label("All hosts", systemImage: "checkmark")
                } else {
                    Text("All hosts")
                }
            }
            ForEach(machines) { machine in
                Button { onSelect(machine.id) } label: {
                    if selection == machine.id {
                        Label(machine.name, systemImage: "checkmark")
                    } else {
                        Text(machine.name)
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                if let scoped {
                    Circle()
                        .fill(scoped.isOnline ? ScoutPalette.accent : ScoutInk.dim)
                        .frame(width: 5, height: 5)
                        .accessibilityHidden(true)
                }
                Text(scoped?.name ?? "All hosts")
                    .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                Glyphic(kind: .chevron, size: 10, rotation: .degrees(90))
                    .foregroundStyle(ScoutInk.dim)
            }
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Host scope")
    }
}

// MARK: - Feed filter

/// Home's feed filters. Both have an honest feed behind them: "For you" is
/// everything, "Working" narrows to posts whose agent the broker reports as
/// live (which it does during an active flight — quiet, but never fake).
///
/// "Thinking" was removed: nothing ever branched on it, so it silently WAS
/// "For you" wearing a different name. A menu option that lies about what it
/// filters is worse than one fewer option.
enum V3HomeFilter: String, CaseIterable {
    case forYou = "For you"
    case working = "Working"
}

/// The filter control in Home's sub bar: one borderless button — the current
/// filter's name + a downward caret — opening the filter menu. It must not
/// read as a selectable tab: no pill background, no border.
struct V3FeedFilterMenu: View {
    let selection: V3HomeFilter
    let onSelect: (V3HomeFilter) -> Void

    var body: some View {
        Menu {
            ForEach(V3HomeFilter.allCases, id: \.rawValue) { filter in
                Button { onSelect(filter) } label: {
                    if selection == filter {
                        Label(filter.rawValue, systemImage: "checkmark")
                    } else {
                        Text(filter.rawValue)
                    }
                }
            }
            Divider()
            // Lists don't exist yet — the row names the direction, disabled
            // so it never implies a working feature.
            Button("New list…") {}
                .disabled(true)
        } label: {
            HStack(spacing: 5) {
                Text(selection.rawValue)
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Glyphic(kind: .chevron, size: 10, rotation: .degrees(90))
                    .foregroundStyle(ScoutInk.dim)
            }
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Feed filter, \(selection.rawValue)")
    }
}

// MARK: - Masthead

/// The v3 masthead: the Scout mark alone + the host-scope menu + search +
/// the bespoke gear. Fixed 52pt so it pairs with the 44pt sub bar as one
/// consistent chrome stack, hairline below.
struct V3Masthead: View {
    let model: AppModel
    /// Home's host scope (a paired-machine id, nil = all hosts).
    let hostScope: String?
    var onSelectHostScope: (String?) -> Void
    /// Search is a placeholder in this slice — the destination it opens
    /// (fleet-wide search) doesn't exist yet. Wired as a no-op on purpose.
    var onSearch: () -> Void
    var onSettings: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                V3ScoutMark(size: 23)
                V3HostScopeMenu(
                    machines: model.pairedMachines,
                    selection: hostScope,
                    onSelect: onSelectHostScope
                )
                Spacer(minLength: 0)
                Button(action: onSearch) {
                    V3SearchGlyph(size: 16)
                        .foregroundStyle(ScoutInk.muted)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Search")
                Button(action: onSettings) {
                    V3GearGlyph(size: 20)
                        .foregroundStyle(ScoutInk.muted)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Settings")
            }
            .padding(.horizontal, 16)
            .frame(height: 52)
            // Chrome-to-content seam, not a row rule: the masthead needs a
            // visible edge under the status bar.
            Rectangle()
                .fill(ScoutHairline.strong)
                .frame(height: HudStrokeWidth.thin)
        }
    }
}

// MARK: - Sub bar

/// The secondary bar — one fixed-height component under the masthead, on
/// every surface. Contents change per tab (list switcher, scope seg,
/// destination context); the chrome doesn't: 44pt, full-bleed hairline below.
struct V3SubBar<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 7) { content }
                .padding(.horizontal, 14)
                .frame(height: 44)
                .frame(maxWidth: .infinity, alignment: .leading)
            Rectangle()
                .fill(ScoutHairline.strong)
                .frame(height: HudStrokeWidth.thin)
        }
    }
}

// MARK: - Tab bar

/// The v3 tab bar — Home · Chats · [hex] · Projects · Alerts, 60pt. A docked
/// full-width bar on the chrome fill with a top hairline, bleeding into the
/// home-indicator zone like the shipped bar.
struct V3TabBar: View {
    let active: V3Tab
    /// Open (still-waiting-on-you) alerts — the action-queue count.
    var alerts: Int = 0
    let onSelect: (V3Tab) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(V3Tab.allCases) { tab in
                seat(tab)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 60)
        .background(alignment: .top) {
            ZStack(alignment: .top) {
                ScoutPalette.chrome
                Rectangle()
                    .fill(ScoutHairline.standard)
                    .frame(height: HudStrokeWidth.thin)
            }
            .ignoresSafeArea(edges: .bottom)
        }
    }

    @ViewBuilder
    private func seat(_ tab: V3Tab) -> some View {
        let isOn = active == tab
        Button { onSelect(tab) } label: {
            VStack(spacing: 2) {
                if tab == .compose {
                    V3HexCompose(isActive: isOn)
                        .frame(height: 24)
                } else if let glyph = tab.glyph {
                    Glyphic(kind: glyph, size: 19)
                        .foregroundStyle(isOn ? ScoutPalette.ink : ScoutInk.dim)
                        .frame(height: 24)
                        .overlay(alignment: .topTrailing) {
                            if tab == .alerts, alerts > 0 {
                                Text(alerts > 99 ? "99+" : "\(alerts)")
                                    .font(HudFont.mono(HudTextSize.micro - 1, weight: .bold))
                                    .monospacedDigit()
                                    .foregroundStyle(ScoutPalette.bg)
                                    .padding(.horizontal, 3)
                                    .frame(minWidth: 14, minHeight: 14)
                                    .background(Capsule().fill(ScoutPalette.accent))
                                    .offset(x: 10, y: -4)
                            }
                        }
                }
                // The center hex is a bare mark — no label (the study seats it
                // as a quiet glyph at the same weight as the other four).
                if tab != .compose {
                    Text(tab.label)
                        .font(HudFont.mono(HudTextSize.micro, weight: isOn ? .bold : .medium))
                        .foregroundStyle(isOn ? ScoutPalette.ink : ScoutInk.dim)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab == .alerts && alerts > 0 ? "\(tab.label), \(alerts) waiting" : tab.label)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}
